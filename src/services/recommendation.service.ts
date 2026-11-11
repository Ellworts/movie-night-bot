import {
  buildMovieId,
  ISelectedEntry,
  IWatchedEntry,
  UserSettings,
} from '../models/User';
import { UserService, userService } from './user.service';
import {
  MovieCardData,
  TmdbService,
  tmdbService,
  TMDB_ID_TO_GENRE_NAME,
} from './tmdb.service';

export type RecommendationMode = 'watchlist' | 'random';

export type RecommendationOutcome =
  | { status: 'ok'; movie: MovieCardData; mode: RecommendationMode }
  | { status: 'empty_watchlist' }
  | { status: 'no_matching_movies' }
  | { status: 'session_exhausted'; totalMatching: number };

export class RecommendationService {
  private readonly users: UserService;
  private readonly tmdb: TmdbService;

  constructor(users: UserService = userService, tmdb: TmdbService = tmdbService) {
    this.users = users;
    this.tmdb = tmdb;
  }

  /**
   * Pure predicate checking whether a movie satisfies user settings.
   */
  public static matchesSettings(
    movie: Pick<
      MovieCardData,
      'year' | 'genres' | 'runtime' | 'tmdbRating' | 'tmdbStatus'
    >,
    settings: UserSettings
  ): boolean {
    if (settings.excludedGenres.length > 0 && movie.genres.length > 0) {
      const excludedLower = new Set(settings.excludedGenres.map((g) => g.toLowerCase()));
      const hasExcluded = movie.genres.some((g) => excludedLower.has(g.toLowerCase()));
      if (hasExcluded) {
        return false;
      }
    }

    if (settings.maxRuntime !== null && settings.maxRuntime > 0) {
      if (movie.runtime !== null && movie.runtime > settings.maxRuntime) {
        return false;
      }
    }

    if (settings.releaseYearFrom !== null) {
      if (movie.year === null || movie.year < settings.releaseYearFrom) {
        return false;
      }
    }
    if (settings.releaseYearTo !== null) {
      if (movie.year === null || movie.year > settings.releaseYearTo) {
        return false;
      }
    }

    if (settings.minRating !== null && settings.minRating > 0) {
      if (movie.tmdbRating !== null && movie.tmdbRating < settings.minRating) {
        return false;
      }
      if (movie.tmdbStatus === 'matched' && movie.tmdbRating === null) {
        return false;
      }
    }

    return true;
  }

  /**
   * Applies genre diversity to narrow down candidates when consecutive recommendations occur.
   */
  public static filterForGenreDiversity<T extends { genres: string[] }>(
    candidates: T[],
    lastGenres: string[],
    enableDiversity: boolean
  ): T[] {
    if (!enableDiversity || lastGenres.length === 0 || candidates.length <= 1) {
      return candidates;
    }

    const lastGenresLower = new Set(lastGenres.map((g) => g.toLowerCase()));

    const completelyDifferent = candidates.filter((movie) => {
      if (!movie.genres || movie.genres.length === 0) {
        return true;
      }
      return !movie.genres.some((g) => lastGenresLower.has(g.toLowerCase()));
    });

    if (completelyDifferent.length > 0) {
      return completelyDifferent;
    }

    const scored = candidates.map((movie) => {
      if (!movie.genres || movie.genres.length === 0) {
        return { movie, ratio: 0 };
      }
      const overlap = movie.genres.filter((g) => lastGenresLower.has(g.toLowerCase())).length;
      const unionSize = new Set([
        ...lastGenresLower,
        ...movie.genres.map((g) => g.toLowerCase()),
      ]).size;
      const ratio = unionSize > 0 ? overlap / unionSize : 0;
      return { movie, ratio };
    });

    const minRatio = Math.min(...scored.map((s) => s.ratio));
    const leastSimilar = scored.filter((s) => s.ratio <= minRatio + 0.01).map((s) => s.movie);

    return leastSimilar.length > 0 ? leastSimilar : candidates;
  }

  /**
   * Picks a random movie from the user's Letterboxd Watchlist.
   */
  public async getRecommendation(
    telegramId: number,
    randomFn: () => number = Math.random
  ): Promise<RecommendationOutcome> {
    const user = await this.users.findOrCreateUser({ telegramId });

    if (user.watchlist.length === 0) {
      return { status: 'empty_watchlist' };
    }

    const watchedIdSet = new Set(user.watched.map((w) => w.id));
    const unwatchedEntries = user.watchlist.filter((w) => !watchedIdSet.has(w.id));

    if (unwatchedEntries.length === 0) {
      return { status: 'no_matching_movies' };
    }

    // Filter by releaseYearFrom / releaseYearTo first before calling TMDB
    const yearFiltered = unwatchedEntries.filter((entry) => {
      if (
        user.settings.releaseYearFrom !== null &&
        (entry.year === null || entry.year < user.settings.releaseYearFrom)
      ) {
        return false;
      }
      if (
        user.settings.releaseYearTo !== null &&
        (entry.year === null || entry.year > user.settings.releaseYearTo)
      ) {
        return false;
      }
      return true;
    });

    if (yearFiltered.length === 0) {
      return { status: 'no_matching_movies' };
    }

    const session = this.users.getSession(telegramId);
    const sessionCandidates = yearFiltered.filter(
      (entry) => !session.shownIds.has(entry.id)
    );

    if (sessionCandidates.length === 0) {
      return {
        status: 'session_exhausted',
        totalMatching: yearFiltered.length,
      };
    }

    // Try up to 6 candidates to find one matching TMDB settings (genres, runtime, rating)
    const remaining = [...sessionCandidates];
    let fallbackCard: MovieCardData | null = null;

    const maxAttempts = Math.min(remaining.length, 6);
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const idx = Math.floor(randomFn() * remaining.length);
      const [entry] = remaining.splice(idx, 1);

      const card = await this.tmdb.resolveWatchlistMovie(entry);
      if (!RecommendationService.matchesSettings(card, user.settings)) {
        session.shownIds.add(card.id);
        continue;
      }

      // Check genre diversity if we have more candidates to try
      if (
        user.settings.genreDiversity &&
        session.lastGenres.length > 0 &&
        remaining.length > 0 &&
        attempt < maxAttempts - 1
      ) {
        const diverse = RecommendationService.filterForGenreDiversity(
          [card, { genres: [] }],
          session.lastGenres,
          true
        );
        if (!diverse.includes(card)) {
          fallbackCard = card;
          continue;
        }
      }

      this.users.recordShownInSession(telegramId, card.id, card.genres);
      return { status: 'ok', movie: card, mode: 'watchlist' };
    }

    if (fallbackCard) {
      this.users.recordShownInSession(telegramId, fallbackCard.id, fallbackCard.genres);
      return { status: 'ok', movie: fallbackCard, mode: 'watchlist' };
    }

    return { status: 'no_matching_movies' };
  }

  /**
   * Picks a random movie outside the user's Watchlist via TMDB Discover.
   */
  public async getDiscoverRecommendation(
    telegramId: number,
    randomFn: () => number = Math.random
  ): Promise<RecommendationOutcome> {
    const user = await this.users.findOrCreateUser({ telegramId });
    const session = this.users.getSession(telegramId);

    const excludedIds = new Set<string>([
      ...user.watched.map((w) => w.id),
      ...user.watchlist.map((w) => w.id),
      ...session.shownIds,
    ]);

    const candidates = await this.tmdb.discoverCandidates(user.settings, randomFn);
    if (candidates.length === 0) {
      return { status: 'no_matching_movies' };
    }

    const availableCandidates = candidates.filter((c) => {
      const id1 = buildMovieId(c.title, c.year);
      if (excludedIds.has(id1)) {
        return false;
      }
      if (c.originalTitle) {
        const id2 = buildMovieId(c.originalTitle, c.year);
        if (excludedIds.has(id2)) {
          return false;
        }
      }
      return true;
    });

    if (availableCandidates.length === 0) {
      return { status: 'no_matching_movies' };
    }

    const candidatesWithGenres = availableCandidates.map((c) => ({
      ...c,
      genres: c.genreIds
        .map((id) => TMDB_ID_TO_GENRE_NAME[id])
        .filter((g): g is string => Boolean(g)),
    }));

    const diversePool = RecommendationService.filterForGenreDiversity(
      candidatesWithGenres,
      session.lastGenres,
      user.settings.genreDiversity
    );

    const chosen = diversePool[Math.floor(randomFn() * diversePool.length)];
    const card = await this.tmdb.resolveDiscoverMovie(chosen);

    this.users.recordShownInSession(telegramId, card.id, card.genres);
    return { status: 'ok', movie: card, mode: 'random' };
  }

  private resolveKnownMovie(
    user: { watchlist: Array<{ id: string; title: string; year: number | null; letterboxdUri: string | null; tmdbId: number | null }> },
    movieId: string
  ): MovieCardData | null {
    const cached = this.tmdb.getCachedMovie(movieId);
    if (cached) {
      return cached;
    }

    const wl = user.watchlist.find((w) => w.id === movieId);
    if (wl) {
      return {
        id: wl.id,
        title: wl.title,
        originalTitle: wl.title,
        year: wl.year,
        letterboxdUri: wl.letterboxdUri,
        tmdbId: wl.tmdbId,
        overview: null,
        genres: [],
        runtime: null,
        tmdbRating: null,
        posterUrl: null,
        trailerUrl: null,
        tmdbStatus: 'not_found',
      };
    }

    return null;
  }

  /**
   * Handles the user clicking «А давай!» on a recommended movie.
   */
  public async acceptRecommendation(
    telegramId: number,
    movieId: string
  ): Promise<{ selection: ISelectedEntry; movie: MovieCardData } | null> {
    const user = await this.users.findOrCreateUser({ telegramId });
    const movie = this.resolveKnownMovie(user, movieId);
    if (!movie) {
      return null;
    }

    const now = new Date();
    let existing = user.selected.find((s) => s.id === movie.id);
    if (existing) {
      existing.selectedAt = now;
      existing.notificationSent = false;
    } else {
      existing = {
        id: movie.id,
        title: movie.title,
        year: movie.year,
        letterboxdUri: movie.letterboxdUri,
        tmdbId: movie.tmdbId,
        selectedAt: now,
        notificationSent: false,
      };
      user.selected.push(existing);
    }

    await user.save();
    return { selection: existing, movie };
  }

  /**
   * Handles the user clicking «Уже смотрел(а)» on a recommended movie.
   */
  public async markAlreadyWatched(
    telegramId: number,
    movieId: string
  ): Promise<{ watchedEntry: IWatchedEntry; movie: MovieCardData } | null> {
    const user = await this.users.findOrCreateUser({ telegramId });
    const movie = this.resolveKnownMovie(user, movieId);
    if (!movie) {
      return null;
    }

    // Remove from watchlist
    user.watchlist = user.watchlist.filter((w) => w.id !== movie.id);

    let entry = user.watched.find((w) => w.id === movie.id);
    if (!entry) {
      entry = {
        id: movie.id,
        title: movie.title,
        year: movie.year,
        letterboxdUri: movie.letterboxdUri,
        tmdbId: movie.tmdbId,
        reaction: null,
        watchedAt: new Date(),
      };
      user.watched.push(entry);
    }

    await user.save();
    return { watchedEntry: entry, movie };
  }

  /**
   * Adds a recommended movie to the user's personal Watchlist.
   */
  public async addToWatchlist(
    telegramId: number,
    movieId: string
  ): Promise<{ movie: MovieCardData; alreadyInWatchlist: boolean } | null> {
    const user = await this.users.findOrCreateUser({ telegramId });
    const movie = this.resolveKnownMovie(user, movieId);
    if (!movie) {
      return null;
    }

    const exists = user.watchlist.some((w) => w.id === movie.id);
    if (exists) {
      return { movie, alreadyInWatchlist: true };
    }

    user.watchlist.push({
      id: movie.id,
      title: movie.title,
      year: movie.year,
      letterboxdUri: movie.letterboxdUri,
      tmdbId: movie.tmdbId,
    });
    await user.save();

    return { movie, alreadyInWatchlist: false };
  }

  /**
   * Removes a movie from the user's personal Watchlist.
   */
  public async removeFromWatchlist(
    telegramId: number,
    movieId: string
  ): Promise<{ movie: MovieCardData; removed: boolean } | null> {
    const user = await this.users.findOrCreateUser({ telegramId });
    const movie = this.resolveKnownMovie(user, movieId);
    if (!movie) {
      return null;
    }

    const beforeLen = user.watchlist.length;
    user.watchlist = user.watchlist.filter((w) => w.id !== movie.id);
    const removed = user.watchlist.length < beforeLen;

    if (removed) {
      await user.save();
    }

    return { movie, removed };
  }
}

export const recommendationService = new RecommendationService();
