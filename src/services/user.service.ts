import { IUser, UserModel, UserSettings } from '../models/User';

export interface TelegramUserInput {
  telegramId: number;
}

export interface UserSessionState {
  shownIds: Set<string>;
  lastGenres: string[];
}

export class UserService {
  private readonly sessions = new Map<number, UserSessionState>();

  public getSession(telegramId: number): UserSessionState {
    let session = this.sessions.get(telegramId);
    if (!session) {
      session = { shownIds: new Set<string>(), lastGenres: [] };
      this.sessions.set(telegramId, session);
    }
    return session;
  }

  public recordShownInSession(
    telegramId: number,
    movieId: string,
    genres: string[]
  ): void {
    const session = this.getSession(telegramId);
    session.shownIds.add(movieId);
    session.lastGenres = genres;
  }

  /**
   * Automatically registers a user on first interaction using only their telegramId.
   */
  public async findOrCreateUser(input: TelegramUserInput): Promise<IUser> {
    const user = await UserModel.findOneAndUpdate(
      { telegramId: input.telegramId },
      {
        $setOnInsert: {
          telegramId: input.telegramId,
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

    return user;
  }

  public async getUser(telegramId: number): Promise<IUser | null> {
    return UserModel.findOne({ telegramId });
  }

  public async updateSettings(
    telegramId: number,
    updates: Partial<UserSettings>
  ): Promise<IUser | null> {
    const setFields: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) {
        setFields[`settings.${key}`] = value;
      }
    }

    return UserModel.findOneAndUpdate(
      { telegramId },
      { $set: setFields },
      { new: true }
    );
  }

  public async toggleExcludedGenre(telegramId: number, genre: string): Promise<IUser | null> {
    const user = await this.findOrCreateUser({ telegramId });
    const normalized = genre.trim();
    const exists = user.settings.excludedGenres.some(
      (g) => g.toLowerCase() === normalized.toLowerCase()
    );

    if (exists) {
      user.settings.excludedGenres = user.settings.excludedGenres.filter(
        (g) => g.toLowerCase() !== normalized.toLowerCase()
      );
    } else {
      user.settings.excludedGenres.push(normalized);
    }

    await user.save();
    return user;
  }

  public async resetSettings(telegramId: number): Promise<IUser | null> {
    return UserModel.findOneAndUpdate(
      { telegramId },
      {
        $set: {
          settings: {
            excludedGenres: [],
            maxRuntime: null,
            releaseYearFrom: null,
            releaseYearTo: null,
            minRating: null,
            genreDiversity: true,
            showWatchedDate: false,
          },
        },
      },
      { new: true }
    );
  }

  public async resetSession(telegramId: number): Promise<void> {
    this.sessions.set(telegramId, { shownIds: new Set<string>(), lastGenres: [] });
  }
}

export const userService = new UserService();
