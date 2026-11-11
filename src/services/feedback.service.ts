import {
  ISelectedEntry,
  IWatchedEntry,
  ReactionType,
  UserModel,
} from '../models/User';

export type SubmitFeedbackOutcome =
  | { status: 'recorded'; entry: IWatchedEntry }
  | { status: 'already_answered'; entry: IWatchedEntry }
  | { status: 'not_found' };

export interface RateableMovieView {
  entry: IWatchedEntry;
  index: number;
  totalCount: number;
  unratedCount: number;
}

export class FeedbackService {
  /**
   * Claims the right to send the 2-hour follow-up notification for a selected movie.
   * Prevents duplicate notifications across restarts or retries.
   */
  public async claimNotificationSend(
    telegramId: number,
    movieId: string
  ): Promise<ISelectedEntry | null> {
    const user = await UserModel.findOne({ telegramId });
    if (!user) {
      return null;
    }

    const alreadyWatched = user.watched.find(
      (w) => w.id === movieId && w.reaction !== null
    );
    if (alreadyWatched) {
      user.selected = user.selected.filter((s) => s.id !== movieId);
      await user.save();
      return null;
    }

    const sel = user.selected.find((s) => s.id === movieId && !s.notificationSent);
    if (!sel) {
      return null;
    }

    sel.notificationSent = true;
    await user.save();
    return sel;
  }

  /**
   * Reverts notificationSent flag if sending the Telegram message failed due to a transient error.
   */
  public async revertNotificationClaim(
    telegramId: number,
    movieId: string
  ): Promise<void> {
    const user = await UserModel.findOne({ telegramId });
    if (!user) {
      return;
    }

    const sel = user.selected.find((s) => s.id === movieId);
    if (sel) {
      sel.notificationSent = false;
      await user.save();
    }
  }

  /**
   * Records user's 👍 or 👎 reaction to a selected or watched movie.
   * Moves movie from `selected` / `watchlist` into `watched` and handles duplicate clicks idempotently.
   */
  public async submitFeedback(
    telegramId: number,
    movieId: string,
    reaction: ReactionType
  ): Promise<SubmitFeedbackOutcome> {
    const user = await UserModel.findOne({ telegramId });
    if (!user) {
      return { status: 'not_found' };
    }

    const existingWatched = user.watched.find((w) => w.id === movieId);
    const existingSelected = user.selected.find((s) => s.id === movieId);

    if (!existingWatched && !existingSelected) {
      return { status: 'not_found' };
    }

    // Ensure movie is removed from active Watchlist and pending Selected list
    user.watchlist = user.watchlist.filter((w) => w.id !== movieId);
    user.selected = user.selected.filter((s) => s.id !== movieId);

    if (existingWatched && existingWatched.reaction !== null) {
      await user.save();
      return {
        status: 'already_answered',
        entry: existingWatched,
      };
    }

    if (existingWatched) {
      existingWatched.reaction = reaction;
      await user.save();
      return {
        status: 'recorded',
        entry: existingWatched,
      };
    }

    const newWatched: IWatchedEntry = {
      id: existingSelected!.id,
      title: existingSelected!.title,
      year: existingSelected!.year,
      letterboxdUri: existingSelected!.letterboxdUri,
      tmdbId: existingSelected!.tmdbId,
      reaction,
      watchedAt: new Date(),
    };
    user.watched.push(newWatched);
    await user.save();

    return {
      status: 'recorded',
      entry: newWatched,
    };
  }

  /**
   * Sets or updates the user's 👍 / 👎 rating on any watched or selected movie.
   * Allows rating previously unrated watched movies (e.g. from watched.csv) or changing a rating.
   */
  public async setOrUpdateReaction(
    telegramId: number,
    movieId: string,
    reaction: ReactionType
  ): Promise<IWatchedEntry | null> {
    const user = await UserModel.findOne({ telegramId });
    if (!user) {
      return null;
    }

    let watchedEntry = user.watched.find((w) => w.id === movieId);
    const selectedEntry = user.selected.find((s) => s.id === movieId);

    if (!watchedEntry && !selectedEntry) {
      return null;
    }

    user.watchlist = user.watchlist.filter((w) => w.id !== movieId);
    user.selected = user.selected.filter((s) => s.id !== movieId);

    if (watchedEntry) {
      watchedEntry.reaction = reaction;
    } else if (selectedEntry) {
      watchedEntry = {
        id: selectedEntry.id,
        title: selectedEntry.title,
        year: selectedEntry.year,
        letterboxdUri: selectedEntry.letterboxdUri,
        tmdbId: selectedEntry.tmdbId,
        reaction,
        watchedAt: new Date(),
      };
      user.watched.push(watchedEntry);
    }

    await user.save();
    return watchedEntry!;
  }

  private buildRateableList(user: {
    watched: IWatchedEntry[];
    selected: ISelectedEntry[];
  }): IWatchedEntry[] {
    const watchedIds = new Set(user.watched.map((w) => w.id));
    const pendingFromSelected: IWatchedEntry[] = user.selected
      .filter((s) => !watchedIds.has(s.id))
      .map((s) => ({
        id: s.id,
        title: s.title,
        year: s.year,
        letterboxdUri: s.letterboxdUri,
        tmdbId: s.tmdbId,
        reaction: null,
        watchedAt: s.selectedAt,
      }))
      .reverse();

    const watchedReversed = [...user.watched].reverse();
    return [...pendingFromSelected, ...watchedReversed];
  }

  /**
   * Returns a single watched/selected movie at `requestedIndex` for interactive rating.
   * If `requestedIndex` is null, jumps to the first unrated movie (or 0 if all are rated).
   */
  public async getRateableMovieAt(
    telegramId: number,
    requestedIndex: number | null = null
  ): Promise<RateableMovieView | null> {
    const user = await UserModel.findOne({ telegramId }).lean();
    if (!user) {
      return null;
    }

    const list = this.buildRateableList(user);
    const totalCount = list.length;
    if (totalCount === 0) {
      return null;
    }

    const unratedCount = list.filter((item) => item.reaction === null).length;

    let index = requestedIndex ?? 0;
    if (requestedIndex === null && unratedCount > 0) {
      const firstUnratedIdx = list.findIndex((item) => item.reaction === null);
      if (firstUnratedIdx >= 0) {
        index = firstUnratedIdx;
      }
    }

    index = Math.min(Math.max(0, index), totalCount - 1);

    return {
      entry: list[index],
      index,
      totalCount,
      unratedCount,
    };
  }

  /**
   * Returns unanswered movie selections for a user so missed notifications can be rated anytime.
   */
  public async getPendingSelections(
    telegramId: number,
    limit: number = 10
  ): Promise<IWatchedEntry[]> {
    const user = await UserModel.findOne({ telegramId }).lean();
    if (!user) {
      return [];
    }

    const list = this.buildRateableList(user).filter((item) => item.reaction === null);
    return list.slice(0, limit);
  }
}

export const feedbackService = new FeedbackService();
