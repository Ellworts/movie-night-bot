import crypto from 'crypto';
import mongoose, { Schema, Document, Types } from 'mongoose';

export type ReactionType = 'like' | 'dislike';

export interface UserSettings {
  excludedGenres: string[];
  maxRuntime: number | null;
  releaseYearFrom: number | null;
  releaseYearTo: number | null;
  minRating: number | null;
  genreDiversity: boolean;
}

export interface IWatchlistEntry {
  id: string;
  title: string;
  year: number | null;
  letterboxdUri: string | null;
  tmdbId: number | null;
}

export interface IWatchedEntry {
  id: string;
  title: string;
  year: number | null;
  letterboxdUri: string | null;
  tmdbId: number | null;
  reaction: ReactionType | null;
  watchedAt: Date;
}

export interface ISelectedEntry {
  id: string;
  title: string;
  year: number | null;
  letterboxdUri: string | null;
  tmdbId: number | null;
  selectedAt: Date;
  notificationSent: boolean;
}

export interface IUser extends Document {
  _id: Types.ObjectId;
  telegramId: number;
  settings: UserSettings;
  watchlist: IWatchlistEntry[];
  watched: IWatchedEntry[];
  selected: ISelectedEntry[];
}

/**
 * Generates a compact deterministic 12-hex-char movie ID from title and year.
 */
export function buildMovieId(title: string, year: number | null | undefined): string {
  const normalized = `${title.trim().toLowerCase()}::${year ?? ''}`;
  return crypto.createHash('md5').update(normalized).digest('hex').slice(0, 12);
}

const UserSettingsSchema = new Schema<UserSettings>(
  {
    excludedGenres: { type: [String], default: [] },
    maxRuntime: { type: Number, default: null },
    releaseYearFrom: { type: Number, default: null },
    releaseYearTo: { type: Number, default: null },
    minRating: { type: Number, default: null },
    genreDiversity: { type: Boolean, default: true },
  },
  { _id: false }
);

const WatchlistEntrySchema = new Schema<IWatchlistEntry>(
  {
    id: { type: String, required: true },
    title: { type: String, required: true },
    year: { type: Number, default: null },
    letterboxdUri: { type: String, default: null },
    tmdbId: { type: Number, default: null },
  },
  { _id: false }
);

const WatchedEntrySchema = new Schema<IWatchedEntry>(
  {
    id: { type: String, required: true },
    title: { type: String, required: true },
    year: { type: Number, default: null },
    letterboxdUri: { type: String, default: null },
    tmdbId: { type: Number, default: null },
    reaction: { type: String, enum: ['like', 'dislike', null], default: null },
    watchedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const SelectedEntrySchema = new Schema<ISelectedEntry>(
  {
    id: { type: String, required: true },
    title: { type: String, required: true },
    year: { type: Number, default: null },
    letterboxdUri: { type: String, default: null },
    tmdbId: { type: Number, default: null },
    selectedAt: { type: Date, default: Date.now },
    notificationSent: { type: Boolean, default: false },
  },
  { _id: false }
);

const UserSchema = new Schema<IUser>(
  {
    telegramId: { type: Number, required: true, unique: true, index: true },
    settings: {
      type: UserSettingsSchema,
      default: () => ({
        excludedGenres: [],
        maxRuntime: null,
        releaseYearFrom: null,
        releaseYearTo: null,
        minRating: null,
        genreDiversity: true,
      }),
    },
    watchlist: { type: [WatchlistEntrySchema], default: [] },
    watched: { type: [WatchedEntrySchema], default: [] },
    selected: { type: [SelectedEntrySchema], default: [] },
  },
  { versionKey: false }
);

export const UserModel = mongoose.model<IUser>('User', UserSchema);
