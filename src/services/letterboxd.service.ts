import {
  buildMovieId,
  IWatchedEntry,
  IWatchlistEntry,
  ReactionType,
  UserModel,
} from '../models/User';
import { logger } from '../utils/logger';

export class LetterboxdError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LetterboxdError';
  }
}

export interface ScrapedLetterboxdMovie {
  id: string;
  title: string;
  year: number | null;
  letterboxdUri: string | null;
  reaction: ReactionType | null;
}

export interface LetterboxdSyncResult {
  username: string;
  letterboxdWatchlistCount: number;
  botWatchlistCount: number;
  totalWatchlistCount: number;
  newlyAddedToWatchlist: number;
  newlyWatchedCount: number;
  ratedLikedCount: number;
  ratedDislikedCount: number;
}

const RESERVED_PATHS = new Set([
  'film',
  'films',
  'lists',
  'members',
  'journal',
  'search',
  'settings',
  'about',
  'pro',
  'patron',
  'apps',
  'YEAR',
  'welcome',
  'activity',
  'contact',
  'legal',
]);

export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

export function parseTitleAndYear(rawName: string): {
  title: string;
  year: number | null;
} {
  const decoded = decodeHtmlEntities(rawName).trim();
  const match = decoded.match(/^(.*?)\s*\((\d{4})\)\s*$/);
  if (match && match[1].trim().length > 0) {
    const year = Number(match[2]);
    return {
      title: match[1].trim(),
      year: year >= 1870 && year <= 2100 ? year : null,
    };
  }
  return {
    title: decoded,
    year: null,
  };
}

export class LetterboxdService {
  private readonly fetchFn: typeof fetch;

  constructor(fetchFn: typeof fetch = global.fetch) {
    this.fetchFn = fetchFn;
  }

  /**
   * Extracts a Letterboxd username from a profile URL or raw username string.
   * Examples:
   * - "https://letterboxd.com/dave/" -> "dave"
   * - "letterboxd.com/dave/watchlist" -> "dave"
   * - "@dave" -> "dave"
   */
  public static extractUsername(
    input: string,
    allowPlainUsername: boolean = false
  ): string | null {
    const trimmed = input.trim();
    if (!trimmed) {
      return null;
    }

    const urlMatch = trimmed.match(
      /(?:https?:\/\/)?(?:www\.)?letterboxd\.com\/([a-zA-Z0-9_-]+)(?:\/|$|\?)/i
    );
    if (urlMatch) {
      const candidate = urlMatch[1].toLowerCase();
      if (!RESERVED_PATHS.has(candidate)) {
        return candidate;
      }
      return null;
    }

    if (allowPlainUsername) {
      const cleaned = trimmed.replace(/^@/, '').toLowerCase();
      if (/^[a-z0-9_-]{1,40}$/.test(cleaned) && !RESERVED_PATHS.has(cleaned)) {
        return cleaned;
      }
    }

    return null;
  }

  /**
   * Parses movies (and optional star ratings) from a Letterboxd grid HTML page.
   */
  public static parseGridHtml(html: string): ScrapedLetterboxdMovie[] {
    const results: ScrapedLetterboxdMovie[] = [];
    const seenIds = new Set<string>();

    // Match each <li> block that contains a poster item, or fallback to div components
    const liBlocks =
      html.match(/<li[^>]*>[\s\S]*?data-item-name="[^"]+"[\s\S]*?<\/li>/g) ||
      html.match(/<div[^>]*data-item-name="[^"]+"[^>]*>/g) ||
      [];

    for (const block of liBlocks) {
      const nameMatch =
        block.match(/data-item-full-display-name="([^"]+)"/) ||
        block.match(/data-item-name="([^"]+)"/);

      if (!nameMatch) {
        continue;
      }

      const { title, year } = parseTitleAndYear(nameMatch[1]);
      if (!title) {
        continue;
      }

      const linkMatch =
        block.match(/data-target-link="([^"]+)"/) ||
        block.match(/data-item-link="([^"]+)"/);
      const relativeLink = linkMatch ? linkMatch[1] : null;
      const letterboxdUri = relativeLink
        ? relativeLink.startsWith('http')
          ? relativeLink
          : `https://letterboxd.com${relativeLink}`
        : null;

      let reaction: ReactionType | null = null;
      const ratingMatch = block.match(/\brated-(\d+)\b/);
      if (ratingMatch) {
        const ratedTenScale = Number(ratingMatch[1]); // 1..10 (corresponds to 0.5..5.0 stars)
        if (!Number.isNaN(ratedTenScale) && ratedTenScale > 0) {
          // <= 2.5 stars is rated-5 or lower -> dislike; > 2.5 stars is rated-6 or higher -> like
          reaction = ratedTenScale <= 5 ? 'dislike' : 'like';
        }
      }

      const id = buildMovieId(title, year);
      if (seenIds.has(id)) {
        continue;
      }
      seenIds.add(id);

      results.push({
        id,
        title,
        year,
        letterboxdUri,
        reaction,
      });
    }

    return results;
  }

  public static extractMaxPage(html: string, section: 'watchlist' | 'films'): number {
    const regex = new RegExp(`/${section}/page/(\\d+)/`, 'g');
    let maxPage = 1;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(html)) !== null) {
      const pageNum = Number(match[1]);
      if (!Number.isNaN(pageNum) && pageNum > maxPage) {
        maxPage = pageNum;
      }
    }
    return maxPage;
  }

  /**
   * Parses the user's public Letterboxd RSS feed (`/<username>/rss/`) for recent diary entries & ratings.
   */
  public async scrapeRssFeed(username: string): Promise<ScrapedLetterboxdMovie[]> {
    const rssUrl = `https://letterboxd.com/${encodeURIComponent(username)}/rss/`;
    const res = await this.fetchHtml(rssUrl);
    if (res.status !== 200) {
      return [];
    }

    const items = res.html.match(/<item>[\s\S]*?<\/item>/g) || [];
    const results: ScrapedLetterboxdMovie[] = [];

    for (const itemXml of items) {
      const titleMatch = itemXml.match(
        /<letterboxd:filmTitle>([\s\S]*?)<\/letterboxd:filmTitle>/
      );
      if (!titleMatch) {
        continue;
      }

      const title = decodeHtmlEntities(titleMatch[1]).trim();
      if (!title) {
        continue;
      }

      const yearMatch = itemXml.match(
        /<letterboxd:filmYear>(\d{4})<\/letterboxd:filmYear>/
      );
      const year = yearMatch ? Number(yearMatch[1]) : null;

      const ratingMatch = itemXml.match(
        /<letterboxd:memberRating>([\d.]+)<\/letterboxd:memberRating>/
      );
      let reaction: ReactionType | null = null;
      if (ratingMatch) {
        const stars = Number(ratingMatch[1]);
        if (!Number.isNaN(stars) && stars > 0) {
          reaction = stars <= 2.5 ? 'dislike' : 'like';
        }
      }

      const linkMatch = itemXml.match(/<link>([\s\S]*?)<\/link>/);
      const letterboxdUri = linkMatch ? linkMatch[1].trim() : null;

      results.push({
        id: buildMovieId(title, year),
        title,
        year,
        letterboxdUri,
        reaction,
      });
    }

    return results;
  }

  private async fetchHtml(url: string): Promise<{ status: number; html: string }> {
    const response = await this.fetchFn(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    const html = await response.text();
    return { status: response.status, html };
  }

  private async scrapePaginatedSection(
    username: string,
    section: 'watchlist' | 'films',
    maxPagesLimit: number
  ): Promise<ScrapedLetterboxdMovie[]> {
    const firstUrl = `https://letterboxd.com/${encodeURIComponent(username)}/${section}/`;
    const firstPage = await this.fetchHtml(firstUrl);

    if (firstPage.status === 404) {
      throw new LetterboxdError(
        `Профиль Letterboxd «${username}» не найден или его список скрыт настройками приватности.`
      );
    }

    if (firstPage.status >= 400) {
      throw new LetterboxdError(
        `Не удалось загрузить страницу Letterboxd (код ${firstPage.status}). Попробуйте чуть позже.`
      );
    }

    const allMovies: ScrapedLetterboxdMovie[] = [
      ...LetterboxdService.parseGridHtml(firstPage.html),
    ];

    const totalPages = Math.min(
      LetterboxdService.extractMaxPage(firstPage.html, section),
      maxPagesLimit
    );

    if (totalPages <= 1) {
      return allMovies;
    }

    const remainingPages: number[] = [];
    for (let p = 2; p <= totalPages; p++) {
      remainingPages.push(p);
    }

    const batchSize = 4;
    for (let i = 0; i < remainingPages.length; i += batchSize) {
      const batch = remainingPages.slice(i, i + batchSize);
      const batchPages = await Promise.all(
        batch.map(async (pageNum) => {
          const pageUrl = `https://letterboxd.com/${encodeURIComponent(
            username
          )}/${section}/page/${pageNum}/`;
          try {
            const res = await this.fetchHtml(pageUrl);
            if (res.status === 200) {
              return LetterboxdService.parseGridHtml(res.html);
            }
          } catch (err) {
            logger.warn({ err, username, section, pageNum }, 'Failed to scrape page');
          }
          return [];
        })
      );

      for (const movies of batchPages) {
        allMovies.push(...movies);
      }
    }

    const dedupMap = new Map<string, ScrapedLetterboxdMovie>();
    for (const m of allMovies) {
      if (!dedupMap.has(m.id)) {
        dedupMap.set(m.id, m);
      }
    }

    return Array.from(dedupMap.values());
  }

  /**
   * Synchronizes a user's Letterboxd Watchlist and Watched/Ratings directly from their public profile,
   * while preserving movies added inside the bot (`source: 'bot'`).
   */
  public async syncUserProfile(
    telegramId: number,
    usernameOrUrl: string,
    allowPlainUsername: boolean = true
  ): Promise<LetterboxdSyncResult> {
    const username = LetterboxdService.extractUsername(
      usernameOrUrl,
      allowPlainUsername
    );

    if (!username) {
      throw new LetterboxdError(
        'Не удалось распознать ссылку на профиль Letterboxd.\nОтправьте ссылку вида <code>https://letterboxd.com/ваш_ник</code>'
      );
    }

    const [scrapedWatchlist, scrapedFilmsPage, scrapedRss] = await Promise.all([
      this.scrapePaginatedSection(username, 'watchlist', 25),
      this.scrapePaginatedSection(username, 'films', 1).catch((err) => {
        logger.warn({ err, username }, 'Could not scrape watched films; continuing with watchlist');
        return [] as ScrapedLetterboxdMovie[];
      }),
      this.scrapeRssFeed(username).catch(() => [] as ScrapedLetterboxdMovie[]),
    ]);

    const watchedDedup = new Map<string, ScrapedLetterboxdMovie>();
    for (const item of [...scrapedFilmsPage, ...scrapedRss]) {
      const prev = watchedDedup.get(item.id);
      if (!prev || (prev.reaction === null && item.reaction !== null)) {
        watchedDedup.set(item.id, item);
      }
    }
    const scrapedWatched = Array.from(watchedDedup.values());

    const user = await UserModel.findOneAndUpdate(
      { telegramId },
      {
        $setOnInsert: {
          telegramId,
          settings: {
            excludedGenres: [],
            maxRuntime: null,
            releaseYearFrom: null,
            releaseYearTo: null,
            minRating: null,
            genreDiversity: true,
            showWatchedDate: false,
          },
          watchlist: [],
          watched: [],
          selected: [],
        },
      },
      { upsert: true, new: true }
    );

    user.letterboxdUsername = username;

    // 1. Merge watched movies & ratings
    const watchedById = new Map<string, IWatchedEntry>();
    for (const w of user.watched) {
      watchedById.set(w.id, w);
    }

    let newlyWatchedCount = 0;
    let ratedLikedCount = 0;
    let ratedDislikedCount = 0;

    // Scraped watched list is newest-first on Letterboxd; reverse so oldest is added first
    for (const item of [...scrapedWatched].reverse()) {
      const existing = watchedById.get(item.id);
      if (existing) {
        if (item.reaction !== null && existing.reaction !== item.reaction) {
          existing.reaction = item.reaction;
          if (item.reaction === 'like') ratedLikedCount++;
          if (item.reaction === 'dislike') ratedDislikedCount++;
        }
        if (!existing.letterboxdUri && item.letterboxdUri) {
          existing.letterboxdUri = item.letterboxdUri;
        }
      } else {
        if (item.reaction === 'like') ratedLikedCount++;
        if (item.reaction === 'dislike') ratedDislikedCount++;
        newlyWatchedCount++;
        const entry: IWatchedEntry = {
          id: item.id,
          title: item.title,
          year: item.year,
          letterboxdUri: item.letterboxdUri,
          tmdbId: null,
          reaction: item.reaction,
          watchedAt: new Date(),
        };
        user.watched.push(entry);
        watchedById.set(item.id, entry);
      }
    }

    // 2. Keep Bot Watchlist (`source === 'bot'`) that hasn't been watched
    const botWatchlistMap = new Map<string, IWatchlistEntry>();
    const previousWatchlistIds = new Set(user.watchlist.map((w) => w.id));
    const existingTmdbIds = new Map<string, number | null>();
    for (const w of user.watchlist) {
      existingTmdbIds.set(w.id, w.tmdbId);
      if (w.source === 'bot' && !watchedById.has(w.id)) {
        botWatchlistMap.set(w.id, w);
      }
    }

    // 3. Build Letterboxd Watchlist (`source: 'letterboxd'`), excluding watched movies
    const letterboxdWatchlist: IWatchlistEntry[] = [];
    let newlyAddedToWatchlist = 0;

    // Reverse scrapedWatchlist so most recently added on Letterboxd is at the end of array (shown first in reverse pagination)
    for (const item of [...scrapedWatchlist].reverse()) {
      if (watchedById.has(item.id)) {
        continue;
      }
      // If it's also in botWatchlistMap, remove from botWatchlistMap so we don't duplicate
      botWatchlistMap.delete(item.id);

      if (!previousWatchlistIds.has(item.id)) {
        newlyAddedToWatchlist++;
      }

      letterboxdWatchlist.push({
        id: item.id,
        title: item.title,
        year: item.year,
        letterboxdUri: item.letterboxdUri,
        tmdbId: existingTmdbIds.get(item.id) ?? null,
        source: 'letterboxd',
      });
    }

    const botWatchlist = Array.from(botWatchlistMap.values());
    user.watchlist = [...letterboxdWatchlist, ...botWatchlist];

    // Also remove any watched movies from pending `selected`
    user.selected = user.selected.filter((s) => !watchedById.has(s.id));

    await user.save();

    return {
      username,
      letterboxdWatchlistCount: letterboxdWatchlist.length,
      botWatchlistCount: botWatchlist.length,
      totalWatchlistCount: user.watchlist.length,
      newlyAddedToWatchlist,
      newlyWatchedCount,
      ratedLikedCount,
      ratedDislikedCount,
    };
  }
}

export const letterboxdService = new LetterboxdService();
