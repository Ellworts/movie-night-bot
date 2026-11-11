import { IWatchlistEntry, ReactionType, UserModel } from '../models/User';

export type HistoryCategory = 'selected' | 'watched' | 'liked' | 'disliked';

export interface HistoryRecordItem {
  id: string;
  type: HistoryCategory;
  eventDate: Date;
  title: string;
  year: number | null;
  letterboxdUri: string | null;
  tmdbId: number | null;
  reaction: ReactionType | null;
}

export interface UserHistorySummary {
  watchlistCount: number;
  selectedCount: number;
  watchedCount: number;
  likedCount: number;
  dislikedCount: number;
  unratedCount: number;
}

export interface WatchlistPageResult {
  items: IWatchlistEntry[];
  totalCount: number;
  page: number;
  totalPages: number;
  pageSize: number;
}

export interface HistoryPageResult {
  type: HistoryCategory;
  items: HistoryRecordItem[];
  totalCount: number;
  page: number;
  totalPages: number;
  pageSize: number;
  showWatchedDate: boolean;
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
        unratedCount: 0,
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
    const unratedWatched = user.watched.filter((w) => w.reaction === null).length;
    const unratedSelected = user.selected.filter((s) => !watchedIds.has(s.id)).length;
    const selectedCount = user.selected.length;

    return {
      watchlistCount,
      selectedCount,
      watchedCount,
      likedCount,
      dislikedCount,
      unratedCount: unratedWatched + unratedSelected,
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

  private buildSortedHistoryItems(
    user: {
      selected: Array<{
        id: string;
        title: string;
        year: number | null;
        letterboxdUri: string | null;
        tmdbId: number | null;
        selectedAt: Date;
      }>;
      watched: Array<{
        id: string;
        title: string;
        year: number | null;
        letterboxdUri: string | null;
        tmdbId: number | null;
        reaction: ReactionType | null;
        watchedAt: Date;
      }>;
    },
    type: HistoryCategory
  ): HistoryRecordItem[] {
    if (type === 'selected') {
      return [...user.selected]
        .sort((a, b) => new Date(b.selectedAt).getTime() - new Date(a.selectedAt).getTime())
        .map((s) => ({
          id: s.id,
          type: 'selected',
          eventDate: new Date(s.selectedAt),
          title: s.title,
          year: s.year,
          letterboxdUri: s.letterboxdUri,
          tmdbId: s.tmdbId,
          reaction: null,
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
      .map((w) => ({
        id: w.id,
        type,
        eventDate: new Date(w.watchedAt),
        title: w.title,
        year: w.year,
        letterboxdUri: w.letterboxdUri,
        tmdbId: w.tmdbId,
        reaction: w.reaction,
      }));
  }

  /**
   * Returns a paginated page (15 items per page by default) of history items for a category.
   */
  public async getUserHistoryPage(
    telegramId: number,
    type: HistoryCategory,
    requestedPage: number = 1,
    pageSize: number = 15
  ): Promise<HistoryPageResult> {
    const user = await UserModel.findOne({ telegramId }).lean();
    if (!user) {
      return {
        type,
        items: [],
        totalCount: 0,
        page: 1,
        totalPages: 1,
        pageSize,
        showWatchedDate: false,
      };
    }

    const allItems = this.buildSortedHistoryItems(user, type);
    const totalCount = allItems.length;
    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
    const page = Math.min(Math.max(1, requestedPage), totalPages);
    const skip = (page - 1) * pageSize;
    const items = allItems.slice(skip, skip + pageSize);

    return {
      type,
      items,
      totalCount,
      page,
      totalPages,
      pageSize,
      showWatchedDate: Boolean(user.settings?.showWatchedDate),
    };
  }

  /**
   * Looks up a movie by its 1-based display number (`1..totalCount`) in a given history category.
   */
  public async getHistoryItemByNumber(
    telegramId: number,
    type: HistoryCategory,
    itemNumber: number
  ): Promise<{ item: HistoryRecordItem; totalCount: number } | null> {
    const user = await UserModel.findOne({ telegramId }).lean();
    if (!user) {
      return null;
    }

    const allItems = this.buildSortedHistoryItems(user, type);
    const totalCount = allItems.length;
    if (totalCount === 0) {
      return null;
    }

    const index = itemNumber - 1;
    if (!Number.isInteger(index) || index < 0 || index >= totalCount) {
      return null;
    }

    return {
      item: allItems[index],
      totalCount,
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
    const pageData = await this.getUserHistoryPage(telegramId, type, 1, limit);
    return pageData.items;
  }
}

export const historyService = new HistoryService();
