import { IWatchlistEntry, UserModel } from '../models/User';

export type HistoryCategory = 'selected' | 'watched' | 'liked' | 'disliked';

export interface HistoryRecordItem {
  id: string;
  type: HistoryCategory;
  eventDate: Date;
  title: string;
  year: number | null;
  letterboxdUri: string | null;
  tmdbId: number | null;
}

export interface UserHistorySummary {
  watchlistCount: number;
  selectedCount: number;
  watchedCount: number;
  likedCount: number;
  dislikedCount: number;
}

export interface WatchlistPageResult {
  items: IWatchlistEntry[];
  totalCount: number;
  page: number;
  totalPages: number;
  pageSize: number;
}

export class HistoryService {
  /**
   * Returns summary counts for all history categories of a user directly from their User document.
   * Also cleans up any watched movies that might still be lingering in the user's Watchlist.
   */
  public async getUserHistorySummary(telegramId: number): Promise<UserHistorySummary> {
    const user = await UserModel.findOne({ telegramId });
    if (!user) {
      return {
        watchlistCount: 0,
        selectedCount: 0,
        watchedCount: 0,
        likedCount: 0,
        dislikedCount: 0,
      };
    }

    const watchedIds = new Set(user.watched.map((w) => w.id));
    if (watchedIds.size > 0) {
      const beforeLen = user.watchlist.length;
      user.watchlist = user.watchlist.filter((w) => !watchedIds.has(w.id));
      if (user.watchlist.length !== beforeLen) {
        await user.save();
      }
    }

    const watchlistCount = user.watchlist.length;
    const watchedCount = user.watched.length;
    const likedCount = user.watched.filter((w) => w.reaction === 'like').length;
    const dislikedCount = user.watched.filter((w) => w.reaction === 'dislike').length;
    const selectedCount = user.selected.length;

    return {
      watchlistCount,
      selectedCount,
      watchedCount,
      likedCount,
      dislikedCount,
    };
  }

  /**
   * Returns a paginated slice of the user's Watchlist (default: 20 movies per page, newest first).
   */
  public async getUserWatchlistPage(
    telegramId: number,
    requestedPage: number = 1,
    pageSize: number = 20
  ): Promise<WatchlistPageResult> {
    const user = await UserModel.findOne({ telegramId }).lean();
    const allItems = user ? [...user.watchlist].reverse() : [];
    const totalCount = allItems.length;
    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
    const page = Math.min(Math.max(1, requestedPage), totalPages);
    const skip = (page - 1) * pageSize;

    const items = allItems.slice(skip, skip + pageSize);

    return {
      items,
      totalCount,
      page,
      totalPages,
      pageSize,
    };
  }

  /**
   * Returns history items for a user and category ordered by most recent date.
   */
  public async getUserHistoryByType(
    telegramId: number,
    type: HistoryCategory,
    limit: number = 15
  ): Promise<HistoryRecordItem[]> {
    const user = await UserModel.findOne({ telegramId }).lean();
    if (!user) {
      return [];
    }

    if (type === 'selected') {
      return [...user.selected]
        .sort((a, b) => new Date(b.selectedAt).getTime() - new Date(a.selectedAt).getTime())
        .slice(0, limit)
        .map((s) => ({
          id: s.id,
          type: 'selected',
          eventDate: new Date(s.selectedAt),
          title: s.title,
          year: s.year,
          letterboxdUri: s.letterboxdUri,
          tmdbId: s.tmdbId,
        }));
    }

    const filtered = user.watched.filter((w) => {
      if (type === 'liked') {
        return w.reaction === 'like';
      }
      if (type === 'disliked') {
        return w.reaction === 'dislike';
      }
      return true;
    });

    return [...filtered]
      .sort((a, b) => new Date(b.watchedAt).getTime() - new Date(a.watchedAt).getTime())
      .slice(0, limit)
      .map((w) => ({
        id: w.id,
        type,
        eventDate: new Date(w.watchedAt),
        title: w.title,
        year: w.year,
        letterboxdUri: w.letterboxdUri,
        tmdbId: w.tmdbId,
      }));
  }
}

export const historyService = new HistoryService();
