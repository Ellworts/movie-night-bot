import { env } from '../config/env';
import { buildMovieId, IWatchlistEntry, UserSettings } from '../models/User';
import { logger } from '../utils/logger';

export type TmdbSyncStatus = 'matched' | 'not_found' | 'error';

export interface MovieCardData {
  id: string;
  title: string;
  originalTitle: string | null;
  year: number | null;
  letterboxdUri: string | null;
  tmdbId: number | null;
  overview: string | null;
  genres: string[];
  runtime: number | null;
  tmdbRating: number | null;
  posterUrl: string | null;
  trailerUrl: string | null;
  tmdbStatus: TmdbSyncStatus;
}

export interface TmdbMovieMetadata {
  tmdbId: number;
  title?: string;
  originalTitle?: string | null;
  year?: number | null;
  overview: string | null;
  genres: string[];
  runtime: number | null;
  tmdbRating: number | null;
  posterUrl: string | null;
  trailerUrl: string | null;
}

export interface TmdbDiscoverCandidate {
  tmdbId: number;
  title: string;
  originalTitle: string | null;
  year: number | null;
  genreIds: number[];
}

interface TmdbSearchResponse {
  page?: number;
  total_pages?: number;
  results?: Array<{
    id: number;
    title: string;
    original_title?: string;
    release_date?: string;
    genre_ids?: number[];
  }>;
}

interface TmdbVideo {
  key: string;
  site: string;
  type: string;
  official?: boolean;
}

interface TmdbMovieDetailsResponse {
  id: number;
  title?: string;
  original_title?: string;
  release_date?: string;
  overview?: string;
  runtime?: number | null;
  vote_average?: number | null;
  poster_path?: string | null;
  genres?: Array<{ id: number; name: string }>;
  videos?: {
    results?: TmdbVideo[];
  };
}

const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const TMDB_IMAGE_BASE_URL = 'https://image.tmdb.org/t/p/w500';

export const TMDB_GENRE_NAME_TO_ID: Record<string, number> = {
  боевик: 28,
  приключения: 12,
  мультфильм: 16,
  комедия: 35,
  криминал: 80,
  документальный: 99,
  драма: 18,
  семейный: 10751,
  фэнтези: 14,
  история: 36,
  ужасы: 27,
  музыка: 10402,
  детектив: 9648,
  мелодрама: 10749,
  фантастика: 878,
  триллер: 53,
  военный: 10752,
  вестерн: 37,
};

export const TMDB_ID_TO_GENRE_NAME: Record<number, string> = Object.fromEntries(
  Object.entries(TMDB_GENRE_NAME_TO_ID).map(([name, id]) => [id, name])
);

export class TmdbService {
  private readonly apiKey: string;
  private readonly language: string;
  private readonly fetchFn: typeof fetch;
  private readonly cache = new Map<string, MovieCardData>();

  constructor(
    apiKey: string = env.TMDB_API_KEY,
    language: string = env.TMDB_LANGUAGE,
    fetchFn: typeof fetch = global.fetch
  ) {
    this.apiKey = apiKey;
    this.language = language;
    this.fetchFn = fetchFn;
  }

  public getCachedMovie(id: string): MovieCardData | undefined {
    return this.cache.get(id);
  }

  public cacheMovie(card: MovieCardData): void {
    if (this.cache.size >= 1000) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }
    this.cache.set(card.id, card);
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
    };
    if (this.apiKey.startsWith('eyJ')) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }
    return headers;
  }

  private buildUrl(path: string, params: Record<string, string>): string {
    const searchParams = new URLSearchParams(params);
    if (!this.apiKey.startsWith('eyJ')) {
      searchParams.set('api_key', this.apiKey);
    }
    return `${TMDB_BASE_URL}${path}?${searchParams.toString()}`;
  }

  /**
   * Selects the best YouTube trailer URL from TMDB videos list.
   */
  public static selectYoutubeTrailer(videos: TmdbVideo[] = []): string | null {
    const youtubeVideos = videos.filter(
      (v) => v.site?.toLowerCase() === 'youtube' && Boolean(v.key)
    );
    if (youtubeVideos.length === 0) {
      return null;
    }

    const officialTrailer = youtubeVideos.find(
      (v) => v.type === 'Trailer' && v.official === true
    );
    const anyTrailer = youtubeVideos.find((v) => v.type === 'Trailer');
    const teaser = youtubeVideos.find((v) => v.type === 'Teaser');

    const chosen = officialTrailer || anyTrailer || teaser;
    if (!chosen) {
      return null;
    }
    return `https://www.youtube.com/watch?v=${chosen.key}`;
  }

  /**
   * Fetches full details (including videos/trailers) by TMDB ID.
   */
  public async fetchDetailsById(tmdbId: number): Promise<TmdbMovieMetadata> {
    const langPrefix = this.language.split('-')[0] || 'ru';
    const detailsUrl = this.buildUrl(`/movie/${tmdbId}`, {
      language: this.language,
      append_to_response: 'videos',
      include_video_language: `${langPrefix},en,null`,
    });

    const detailsRes = await this.fetchFn(detailsUrl, { headers: this.buildHeaders() });
    if (!detailsRes.ok) {
      throw new Error(`TMDB details failed with status ${detailsRes.status}`);
    }

    const details = (await detailsRes.json()) as TmdbMovieDetailsResponse;

    const genres = (details.genres || []).map((g) => g.name).filter(Boolean);
    const posterUrl = details.poster_path
      ? `${TMDB_IMAGE_BASE_URL}${details.poster_path}`
      : null;
    const trailerUrl = TmdbService.selectYoutubeTrailer(details.videos?.results || []);

    const releaseYear = details.release_date
      ? Number(details.release_date.slice(0, 4)) || null
      : null;

    return {
      tmdbId: details.id,
      ...(details.title ? { title: details.title } : {}),
      ...(details.original_title ? { originalTitle: details.original_title } : {}),
      ...(releaseYear ? { year: releaseYear } : {}),
      overview: details.overview?.trim() || null,
      genres,
      runtime: typeof details.runtime === 'number' && details.runtime > 0 ? details.runtime : null,
      tmdbRating:
        typeof details.vote_average === 'number' && details.vote_average > 0
          ? Math.round(details.vote_average * 10) / 10
          : null,
      posterUrl,
      trailerUrl,
    };
  }

  /**
   * Fetches metadata from TMDB API by title and optional year.
   */
  public async fetchMetadata(
    title: string,
    year?: number | null
  ): Promise<TmdbMovieMetadata | null> {
    try {
      const searchParams: Record<string, string> = {
        query: title,
        language: this.language,
        include_adult: 'false',
      };
      if (year) {
        searchParams.year = String(year);
      }

      const searchUrl = this.buildUrl('/search/movie', searchParams);
      const searchRes = await this.fetchFn(searchUrl, { headers: this.buildHeaders() });

      if (!searchRes.ok) {
        throw new Error(`TMDB search failed with status ${searchRes.status}`);
      }

      const searchData = (await searchRes.json()) as TmdbSearchResponse;
      let match = searchData.results?.[0];

      if (!match && year) {
        const fallbackUrl = this.buildUrl('/search/movie', {
          query: title,
          language: this.language,
          include_adult: 'false',
        });
        const fallbackRes = await this.fetchFn(fallbackUrl, { headers: this.buildHeaders() });
        if (fallbackRes.ok) {
          const fallbackData = (await fallbackRes.json()) as TmdbSearchResponse;
          match = fallbackData.results?.[0];
        }
      }

      if (!match) {
        return null;
      }

      return await this.fetchDetailsById(match.id);
    } catch (error) {
      logger.error({ err: error, title, year }, 'Error fetching metadata from TMDB');
      throw error;
    }
  }

  /**
   * Resolves a WatchlistEntry into a full MovieCardData (using in-memory cache first).
   */
  public async resolveWatchlistMovie(entry: IWatchlistEntry): Promise<MovieCardData> {
    const existing = this.cache.get(entry.id);
    if (existing && existing.tmdbStatus !== 'error') {
      return existing;
    }

    try {
      const metadata = entry.tmdbId
        ? await this.fetchDetailsById(entry.tmdbId)
        : await this.fetchMetadata(entry.title, entry.year);

      if (!metadata) {
        const notFoundCard: MovieCardData = {
          id: entry.id,
          title: entry.title,
          originalTitle: entry.title,
          year: entry.year,
          letterboxdUri: entry.letterboxdUri,
          tmdbId: null,
          overview: null,
          genres: [],
          runtime: null,
          tmdbRating: null,
          posterUrl: null,
          trailerUrl: null,
          tmdbStatus: 'not_found',
        };
        this.cacheMovie(notFoundCard);
        return notFoundCard;
      }

      const card: MovieCardData = {
        id: entry.id,
        title: entry.title,
        originalTitle: metadata.originalTitle || entry.title,
        year: entry.year ?? metadata.year ?? null,
        letterboxdUri:
          entry.letterboxdUri || `https://letterboxd.com/tmdb/${metadata.tmdbId}`,
        tmdbId: metadata.tmdbId,
        overview: metadata.overview,
        genres: metadata.genres,
        runtime: metadata.runtime,
        tmdbRating: metadata.tmdbRating,
        posterUrl: metadata.posterUrl,
        trailerUrl: metadata.trailerUrl,
        tmdbStatus: 'matched',
      };
      this.cacheMovie(card);
      return card;
    } catch {
      return {
        id: entry.id,
        title: entry.title,
        originalTitle: entry.title,
        year: entry.year,
        letterboxdUri: entry.letterboxdUri,
        tmdbId: entry.tmdbId,
        overview: null,
        genres: [],
        runtime: null,
        tmdbRating: null,
        posterUrl: null,
        trailerUrl: null,
        tmdbStatus: 'error',
      };
    }
  }

  /**
   * Resolves a TMDB ID into a full MovieCardData and caches it in memory.
   */
  public async resolveDiscoverMovie(candidate: TmdbDiscoverCandidate): Promise<MovieCardData> {
    const details = await this.fetchDetailsById(candidate.tmdbId);
    const title = details.title || candidate.title;
    const origTitle = details.originalTitle || candidate.originalTitle || title;
    const year = details.year ?? candidate.year;
    const id = buildMovieId(origTitle, year);

    const card: MovieCardData = {
      id,
      title,
      originalTitle: origTitle,
      year,
      letterboxdUri: `https://letterboxd.com/tmdb/${details.tmdbId}`,
      tmdbId: details.tmdbId,
      overview: details.overview,
      genres: details.genres,
      runtime: details.runtime,
      tmdbRating: details.tmdbRating,
      posterUrl: details.posterUrl,
      trailerUrl: details.trailerUrl,
      tmdbStatus: 'matched',
    };
    this.cacheMovie(card);
    return card;
  }

  /**
   * Queries TMDB /discover/movie with user's filter settings and returns a page of candidates.
   */
  public async discoverCandidates(
    settings: UserSettings,
    randomFn: () => number = Math.random
  ): Promise<TmdbDiscoverCandidate[]> {
    const params: Record<string, string> = {
      language: this.language,
      include_adult: 'false',
      include_video: 'false',
      sort_by: 'popularity.desc',
      'vote_count.gte': '80',
    };

    if (settings.excludedGenres.length > 0) {
      const excludedIds = settings.excludedGenres
        .map((g) => TMDB_GENRE_NAME_TO_ID[g.toLowerCase()])
        .filter((id): id is number => Boolean(id));
      if (excludedIds.length > 0) {
        params.without_genres = excludedIds.join(',');
      }
    }

    if (settings.maxRuntime !== null && settings.maxRuntime > 0) {
      params['with_runtime.lte'] = String(settings.maxRuntime);
    }

    if (settings.releaseYearFrom !== null) {
      params['primary_release_date.gte'] = `${settings.releaseYearFrom}-01-01`;
    }

    if (settings.releaseYearTo !== null) {
      params['primary_release_date.lte'] = `${settings.releaseYearTo}-12-31`;
    }

    if (settings.minRating !== null && settings.minRating > 0) {
      params['vote_average.gte'] = String(settings.minRating);
    } else {
      params['vote_average.gte'] = '5.5';
    }

    const page1Url = this.buildUrl('/discover/movie', { ...params, page: '1' });
    const page1Res = await this.fetchFn(page1Url, { headers: this.buildHeaders() });
    if (!page1Res.ok) {
      throw new Error(`TMDB discover failed with status ${page1Res.status}`);
    }

    const page1Data = (await page1Res.json()) as TmdbSearchResponse;
    const totalPages = Math.min(page1Data.total_pages || 1, 30);

    let results = page1Data.results || [];
    if (totalPages > 1) {
      const randomPage = Math.floor(randomFn() * totalPages) + 1;
      if (randomPage > 1) {
        const pageUrl = this.buildUrl('/discover/movie', {
          ...params,
          page: String(randomPage),
        });
        const pageRes = await this.fetchFn(pageUrl, { headers: this.buildHeaders() });
        if (pageRes.ok) {
          const pageData = (await pageRes.json()) as TmdbSearchResponse;
          if (pageData.results && pageData.results.length > 0) {
            results = pageData.results;
          }
        }
      }
    }

    return results.map((item) => {
      const year = item.release_date ? Number(item.release_date.slice(0, 4)) || null : null;
      return {
        tmdbId: item.id,
        title: item.title,
        originalTitle: item.original_title || null,
        year,
        genreIds: item.genre_ids || [],
      };
    });
  }
}

export const tmdbService = new TmdbService();
