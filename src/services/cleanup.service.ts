import mongoose from 'mongoose';
import {
  buildMovieId,
  ISelectedEntry,
  IWatchedEntry,
  IWatchlistEntry,
  ReactionType,
  UserModel,
} from '../models/User';
import { logger } from '../utils/logger';

const ABANDONED_SELECTION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000; // Every 6 hours

export const OBSOLETE_COLLECTIONS = [
  'movies',
  'watchlistitems',
  'movieselections',
  'historyevents',
] as const;

export interface CleanupReport {
  droppedCollections: string[];
  prunedAbandonedSelections: number;
}

export class DatabaseCleanupService {
  private timer: NodeJS.Timeout | null = null;

  /**
   * Starts automatic background cleanup on startup and every 6 hours.
   */
  public startPeriodicCleanup(): void {
    void this.runCleanup();
    this.timer = setInterval(() => {
      void this.runCleanup();
    }, CLEANUP_INTERVAL_MS);
  }

  public stopPeriodicCleanup(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * 1. If legacy collections (`movies`, `watchlistitems`, `movieselections`) still exist,
   *    migrates user watchlist/watched/selected data into `users` before dropping them.
   * 2. Drops obsolete MongoDB collections (`movies`, `watchlistitems`, `movieselections`, `historyevents`).
   * 3. Strips any legacy fields (`username`, `firstName`, `lastName`, `sessionShownMovieIds`, etc.) from `users`.
   * 4. Prunes abandoned `selected` entries older than 7 days.
   */
  public async runCleanup(): Promise<CleanupReport> {
    const droppedCollections: string[] = [];
    let prunedAbandonedSelections = 0;

    try {
      const db = mongoose.connection.db;
      if (db) {
        const existingCols = await db.listCollections().toArray();
        const existingNames = new Set(existingCols.map((c) => c.name));

        // Migrate any existing data from legacy collections before dropping them
        if (
          existingNames.has('movies') &&
          (existingNames.has('watchlistitems') || existingNames.has('movieselections'))
        ) {
          await this.migrateLegacyCollections(db, existingNames);
        }

        for (const colName of OBSOLETE_COLLECTIONS) {
          if (existingNames.has(colName)) {
            await db.dropCollection(colName);
            droppedCollections.push(colName);
          }
        }
      }

      // Strip legacy fields from existing user documents
      await UserModel.collection.updateMany(
        {},
        {
          $unset: {
            username: '',
            firstName: '',
            lastName: '',
            sessionShownMovieIds: '',
            lastRecommendedGenres: '',
            lastProcessedUpdateId: '',
            createdAt: '',
            updatedAt: '',
            __v: '',
          },
        }
      );

      // Prune abandoned selected entries older than 7 days
      const abandonedCutoff = new Date(Date.now() - ABANDONED_SELECTION_TTL_MS);
      const res = await UserModel.updateMany(
        {
          selected: {
            $elemMatch: {
              notificationSent: true,
              selectedAt: { $lt: abandonedCutoff },
            },
          },
        },
        {
          $pull: {
            selected: {
              notificationSent: true,
              selectedAt: { $lt: abandonedCutoff },
            },
          },
        }
      );
      prunedAbandonedSelections = res.modifiedCount || 0;

      if (droppedCollections.length > 0 || prunedAbandonedSelections > 0) {
        logger.info(
          { droppedCollections, prunedAbandonedSelections },
          'MongoDB cleanup completed'
        );
      }
    } catch (err) {
      logger.error({ err }, 'Error during MongoDB cleanup');
    }

    return {
      droppedCollections,
      prunedAbandonedSelections,
    };
  }

  private async migrateLegacyCollections(
    db: mongoose.mongo.Db,
    existingNames: Set<string>
  ): Promise<void> {
    const rawMovies = await db.collection('movies').find({}).toArray();
    const movieById = new Map<
      string,
      {
        id: string;
        title: string;
        year: number | null;
        letterboxdUri: string | null;
        tmdbId: number | null;
      }
    >();

    for (const m of rawMovies) {
      const title = typeof m.title === 'string' ? m.title : '';
      if (!title) continue;
      const year = typeof m.year === 'number' ? m.year : null;
      movieById.set(String(m._id), {
        id: buildMovieId(title, year),
        title,
        year,
        letterboxdUri: typeof m.letterboxdUri === 'string' ? m.letterboxdUri : null,
        tmdbId: typeof m.tmdbId === 'number' ? m.tmdbId : null,
      });
    }

    const users = await UserModel.find({});
    for (const user of users) {
      const watchedMap = new Map<string, IWatchedEntry>();
      for (const w of user.watched || []) {
        watchedMap.set(w.id, w);
      }

      const selectedMap = new Map<string, ISelectedEntry>();
      for (const s of user.selected || []) {
        selectedMap.set(s.id, s);
      }

      if (existingNames.has('movieselections')) {
        const rawSelections = await db
          .collection('movieselections')
          .find({ telegramId: user.telegramId })
          .toArray();

        for (const sel of rawSelections) {
          const m = movieById.get(String(sel.movieId));
          if (!m) continue;

          if (sel.watched) {
            const reaction: ReactionType | null =
              sel.reaction === 'like' || sel.reaction === 'dislike'
                ? sel.reaction
                : null;
            watchedMap.set(m.id, {
              id: m.id,
              title: m.title,
              year: m.year,
              letterboxdUri: m.letterboxdUri,
              tmdbId: m.tmdbId,
              reaction,
              watchedAt: sel.watchedAt ? new Date(sel.watchedAt) : new Date(),
            });
          } else {
            selectedMap.set(m.id, {
              id: m.id,
              title: m.title,
              year: m.year,
              letterboxdUri: m.letterboxdUri,
              tmdbId: m.tmdbId,
              selectedAt: sel.selectedAt ? new Date(sel.selectedAt) : new Date(),
              notificationSent: Boolean(sel.notificationSent),
            });
          }
        }
      }

      const watchlistMap = new Map<string, IWatchlistEntry>();
      for (const w of user.watchlist || []) {
        if (!watchedMap.has(w.id)) {
          watchlistMap.set(w.id, w);
        }
      }

      if (existingNames.has('watchlistitems')) {
        const rawWl = await db
          .collection('watchlistitems')
          .find({ telegramId: user.telegramId })
          .toArray();

        for (const wl of rawWl) {
          const m = movieById.get(String(wl.movieId));
          if (!m || watchedMap.has(m.id)) continue;
          watchlistMap.set(m.id, {
            id: m.id,
            title: m.title,
            year: m.year,
            letterboxdUri:
              typeof wl.letterboxdUri === 'string' ? wl.letterboxdUri : m.letterboxdUri,
            tmdbId: m.tmdbId,
          });
        }
      }

      user.watched = Array.from(watchedMap.values());
      user.selected = Array.from(selectedMap.values()).filter(
        (s) => !watchedMap.has(s.id)
      );
      user.watchlist = Array.from(watchlistMap.values());
      await user.save();
    }
  }
}

export const databaseCleanupService = new DatabaseCleanupService();
