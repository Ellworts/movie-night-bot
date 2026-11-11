import { parse } from 'csv-parse/sync';
import { buildMovieId, ReactionType } from '../models/User';
import { UserService, userService } from './user.service';

export const MAX_CSV_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

export interface ParsedWatchlistRow {
  id: string;
  title: string;
  year: number | null;
  letterboxdDate: string | null;
  letterboxdUri: string | null;
  letterboxdRating?: number;
  normalizedKey: string;
}

export interface CsvImportResult {
  totalRows: number;
  importedNew: number;
  alreadyInWatchlist: number;
  skippedInvalidOrDuplicateInFile: number;
}

export interface WatchedCsvImportResult {
  totalRows: number;
  newlyMarkedWatched: number;
  alreadyWatched: number;
  skippedInvalidOrDuplicateInFile: number;
  ratedLiked: number;
  ratedDisliked: number;
}

export class CsvValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CsvValidationError';
  }
}

export class CsvImportService {
  private readonly users: UserService;

  constructor(users: UserService = userService) {
    this.users = users;
  }

  /**
   * Parses and validates Letterboxd CSV content (watchlist.csv, watched.csv, or ratings.csv).
   */
  public parseWatchlistCsv(content: string | Buffer): ParsedWatchlistRow[] {
    const byteLength =
      typeof content === 'string' ? Buffer.byteLength(content, 'utf-8') : content.length;

    if (byteLength === 0) {
      throw new CsvValidationError(
        'Файл пуст. Пожалуйста, загрузите корректный CSV-файл из Letterboxd.'
      );
    }

    if (byteLength > MAX_CSV_FILE_SIZE_BYTES) {
      throw new CsvValidationError('Размер файла превышает допустимый лимит (5 МБ).');
    }

    const text = (typeof content === 'string' ? content : content.toString('utf-8')).replace(
      /^\uFEFF/,
      ''
    );

    let rawRecords: string[][];
    try {
      rawRecords = parse(text, {
        skip_empty_lines: true,
        relax_column_count: true,
        trim: true,
      });
    } catch {
      throw new CsvValidationError(
        'Некорректный формат CSV-файла. Убедитесь, что вы загружаете файл из экспорта Letterboxd.'
      );
    }

    if (!rawRecords || rawRecords.length === 0) {
      throw new CsvValidationError('CSV-файл не содержит данных.');
    }

    const headerRow = rawRecords[0].map((col) => col.trim());
    const headerMap = new Map<string, number>();
    headerRow.forEach((col, idx) => {
      headerMap.set(col.toLowerCase(), idx);
    });

    const nameIdx = headerMap.get('name');
    const yearIdx = headerMap.get('year');
    const dateIdx = headerMap.get('date');
    const uriIdx = headerMap.get('letterboxd uri');
    const ratingIdx = headerMap.get('rating');

    if (nameIdx === undefined || yearIdx === undefined) {
      throw new CsvValidationError(
        'Отсутствуют обязательные колонки Letterboxd (Name, Year). Проверьте формат CSV-файла.'
      );
    }

    if (rawRecords.length < 2) {
      throw new CsvValidationError('В файле нет ни одного фильма для импорта.');
    }

    const parsedRows: ParsedWatchlistRow[] = [];

    for (let i = 1; i < rawRecords.length; i++) {
      const row = rawRecords[i];
      const rawTitle = (row[nameIdx] ?? '').trim();
      if (!rawTitle) {
        continue;
      }

      const rawYear = yearIdx !== undefined ? (row[yearIdx] ?? '').trim() : '';
      let parsedYear: number | null = null;
      if (rawYear) {
        const numYear = Number(rawYear);
        if (Number.isInteger(numYear) && numYear >= 1880 && numYear <= 2100) {
          parsedYear = numYear;
        }
      }

      const rawDate = dateIdx !== undefined ? (row[dateIdx] ?? '').trim() || null : null;
      const rawUri = uriIdx !== undefined ? (row[uriIdx] ?? '').trim() || null : null;

      let parsedRating: number | null = null;
      if (ratingIdx !== undefined) {
        const rawRating = (row[ratingIdx] ?? '').trim();
        if (rawRating) {
          const numRating = Number(rawRating);
          if (!Number.isNaN(numRating) && numRating >= 0.5 && numRating <= 5) {
            parsedRating = numRating;
          }
        }
      }

      const cleanTitle = rawTitle.slice(0, 300);
      const normalizedKey = `${cleanTitle.toLowerCase()}::${parsedYear ?? ''}`;
      const rowObj: ParsedWatchlistRow = {
        id: buildMovieId(cleanTitle, parsedYear),
        title: cleanTitle,
        year: parsedYear,
        letterboxdDate: rawDate ? rawDate.slice(0, 50) : null,
        letterboxdUri: rawUri ? rawUri.slice(0, 300) : null,
        normalizedKey,
      };

      if (parsedRating !== null) {
        rowObj.letterboxdRating = parsedRating;
      }

      parsedRows.push(rowObj);
    }

    if (parsedRows.length === 0) {
      throw new CsvValidationError('Не удалось извлечь ни одного корректного фильма из CSV.');
    }

    return parsedRows;
  }

  /**
   * Imports parsed rows directly into the user's watchlist array in the User document.
   */
  public async importWatchlistForUser(
    telegramId: number,
    content: string | Buffer
  ): Promise<CsvImportResult> {
    const rows = this.parseWatchlistCsv(content);

    const uniqueRowMap = new Map<string, ParsedWatchlistRow>();
    let skippedInvalidOrDuplicateInFile = 0;

    for (const row of rows) {
      if (uniqueRowMap.has(row.id)) {
        skippedInvalidOrDuplicateInFile++;
      } else {
        uniqueRowMap.set(row.id, row);
      }
    }

    const user = await this.users.findOrCreateUser({ telegramId });
    const existingWatchlistIds = new Set(user.watchlist.map((w) => w.id));
    const watchedIds = new Set(user.watched.map((w) => w.id));

    let importedNew = 0;
    let alreadyInWatchlist = 0;

    for (const row of uniqueRowMap.values()) {
      if (watchedIds.has(row.id)) {
        alreadyInWatchlist++;
        continue;
      }

      if (existingWatchlistIds.has(row.id)) {
        alreadyInWatchlist++;
      } else {
        user.watchlist.push({
          id: row.id,
          title: row.title,
          year: row.year,
          letterboxdUri: row.letterboxdUri,
          tmdbId: null,
        });
        existingWatchlistIds.add(row.id);
        importedNew++;
      }
    }

    if (importedNew > 0) {
      await user.save();
    }

    return {
      totalRows: rows.length,
      importedNew,
      alreadyInWatchlist,
      skippedInvalidOrDuplicateInFile,
    };
  }

  /**
   * Imports watched.csv or ratings.csv directly into the user's watched array in the User document.
   * Letterboxd ratings <= 2.5 become 'dislike' (👎), and > 2.5 become 'like' (👍).
   */
  public async importWatchedCsvForUser(
    telegramId: number,
    content: string | Buffer
  ): Promise<WatchedCsvImportResult> {
    const rows = this.parseWatchlistCsv(content);

    const uniqueRowMap = new Map<string, ParsedWatchlistRow>();
    let skippedInvalidOrDuplicateInFile = 0;

    for (const row of rows) {
      if (uniqueRowMap.has(row.id)) {
        skippedInvalidOrDuplicateInFile++;
      } else {
        uniqueRowMap.set(row.id, row);
      }
    }

    const user = await this.users.findOrCreateUser({ telegramId });
    const watchedMap = new Map(user.watched.map((w) => [w.id, w]));
    const importedIds = new Set<string>();

    let newlyMarkedWatched = 0;
    let alreadyWatched = 0;
    let ratedLiked = 0;
    let ratedDisliked = 0;

    const now = new Date();

    for (const row of uniqueRowMap.values()) {
      importedIds.add(row.id);

      let reaction: ReactionType | null = null;
      if (typeof row.letterboxdRating === 'number') {
        reaction = row.letterboxdRating <= 2.5 ? 'dislike' : 'like';
      }

      const existing = watchedMap.get(row.id);
      if (existing) {
        alreadyWatched++;
        if (reaction && existing.reaction !== reaction) {
          existing.reaction = reaction;
          if (reaction === 'like') ratedLiked++;
          if (reaction === 'dislike') ratedDisliked++;
        }
        continue;
      }

      const entry = {
        id: row.id,
        title: row.title,
        year: row.year,
        letterboxdUri: row.letterboxdUri,
        tmdbId: null,
        reaction,
        watchedAt: now,
      };
      user.watched.push(entry);
      watchedMap.set(row.id, entry);
      newlyMarkedWatched++;

      if (reaction === 'like') ratedLiked++;
      if (reaction === 'dislike') ratedDisliked++;
    }

    // Remove any watched movie from user's active watchlist
    user.watchlist = user.watchlist.filter((w) => !importedIds.has(w.id));

    await user.save();

    return {
      totalRows: rows.length,
      newlyMarkedWatched,
      alreadyWatched,
      skippedInvalidOrDuplicateInFile,
      ratedLiked,
      ratedDisliked,
    };
  }
}

export const csvImportService = new CsvImportService();
