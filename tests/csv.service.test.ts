import { CsvImportService, CsvValidationError } from '../src/services/csv.service';
import { buildMovieId, UserModel } from '../src/models/User';

describe('CsvImportService', () => {
  let service: CsvImportService;

  beforeEach(() => {
    service = new CsvImportService();
  });

  describe('parseWatchlistCsv', () => {
    it('parses valid Letterboxd watchlist.csv content', () => {
      const csv = [
        'Date,Name,Year,Letterboxd URI',
        '2025-01-10,Inception,2010,https://boxd.it/1skk',
        '2025-01-11,"The Matrix",1999,https://boxd.it/2a1m',
      ].join('\n');

      const rows = service.parseWatchlistCsv(csv);
      expect(rows).toHaveLength(2);
      expect(rows[0]).toEqual({
        id: buildMovieId('Inception', 2010),
        title: 'Inception',
        year: 2010,
        letterboxdDate: '2025-01-10',
        letterboxdUri: 'https://boxd.it/1skk',
        normalizedKey: 'inception::2010',
      });
      expect(rows[1]).toEqual({
        id: buildMovieId('The Matrix', 1999),
        title: 'The Matrix',
        year: 1999,
        letterboxdDate: '2025-01-11',
        letterboxdUri: 'https://boxd.it/2a1m',
        normalizedKey: 'the matrix::1999',
      });
    });

    it('parses ratings.csv with Rating column', () => {
      const csv = [
        'Date,Name,Year,Letterboxd URI,Rating',
        '2025-01-10,Inception,2010,https://boxd.it/1skk,4.5',
      ].join('\n');

      const rows = service.parseWatchlistCsv(csv);
      expect(rows).toHaveLength(1);
      expect(rows[0].letterboxdRating).toBe(4.5);
    });

    it('throws CsvValidationError when file is empty', () => {
      expect(() => service.parseWatchlistCsv('')).toThrow(CsvValidationError);
    });

    it('throws CsvValidationError when required columns (Name, Year) are missing', () => {
      const invalidCsv = 'Title,ReleaseDate\nInterstellar,2014';
      expect(() => service.parseWatchlistCsv(invalidCsv)).toThrow(
        /Отсутствуют обязательные колонки/
      );
    });

    it('throws CsvValidationError when CSV has headers but no movies', () => {
      const headerOnlyCsv = 'Date,Name,Year,Letterboxd URI\n';
      expect(() => service.parseWatchlistCsv(headerOnlyCsv)).toThrow(CsvValidationError);
    });
  });

  describe('importWatchlistForUser', () => {
    it('deduplicates rows within CSV and handles re-imports without duplicating watchlist items on User', async () => {
      const csv = [
        'Date,Name,Year,Letterboxd URI',
        '2025-01-10,Parasite,2019,https://boxd.it/hTha',
        '2025-01-12,Parasite,2019,https://boxd.it/hTha',
        '2025-01-15,Whiplash,2014,https://boxd.it/7bQA',
      ].join('\n');

      const fakeUser: any = {
        telegramId: 1001,
        watchlist: [],
        watched: [],
        selected: [],
        save: jest.fn(),
      };

      jest.spyOn(UserModel, 'findOneAndUpdate').mockResolvedValue(fakeUser);

      const firstResult = await service.importWatchlistForUser(1001, csv);
      expect(firstResult.totalRows).toBe(3);
      expect(firstResult.importedNew).toBe(2);
      expect(firstResult.alreadyInWatchlist).toBe(0);
      expect(firstResult.skippedInvalidOrDuplicateInFile).toBe(1);
      expect(fakeUser.watchlist).toHaveLength(2);

      const secondResult = await service.importWatchlistForUser(1001, csv);
      expect(secondResult.importedNew).toBe(0);
      expect(secondResult.alreadyInWatchlist).toBe(2);
      expect(fakeUser.watchlist).toHaveLength(2);
    });
  });

  describe('importWatchedCsvForUser', () => {
    it('imports watched/ratings CSV and marks movies as watched with reactions (<=2.5 dislike, >2.5 like)', async () => {
      const ratingsCsv = [
        'Date,Name,Year,Letterboxd URI,Rating',
        '2024-05-01,Arrival,2016,https://boxd.it/a1,4.5',
        '2024-05-02,Bad Movie,2020,https://boxd.it/b2,2.5',
      ].join('\n');

      const fakeUser: any = {
        telegramId: 1001,
        watchlist: [
          {
            id: buildMovieId('Arrival', 2016),
            title: 'Arrival',
            year: 2016,
            letterboxdUri: 'https://boxd.it/a1',
            tmdbId: null,
          },
        ],
        watched: [],
        selected: [],
        save: jest.fn(),
      };

      jest.spyOn(UserModel, 'findOneAndUpdate').mockResolvedValue(fakeUser);

      const result = await service.importWatchedCsvForUser(1001, ratingsCsv);
      expect(result.newlyMarkedWatched).toBe(2);
      expect(result.ratedLiked).toBe(1);
      expect(result.ratedDisliked).toBe(1);
      expect(fakeUser.watched).toHaveLength(2);
      expect(fakeUser.watchlist).toHaveLength(0);
    });
  });
});
