import { RecommendationService } from '../src/services/recommendation.service';
import { buildMovieId, UserSettings } from '../src/models/User';
import { UserService } from '../src/services/user.service';

describe('RecommendationService', () => {
  const defaultSettings: UserSettings = {
    excludedGenres: [],
    maxRuntime: null,
    releaseYearFrom: null,
    releaseYearTo: null,
    minRating: null,
    genreDiversity: true,
  };

  describe('matchesSettings', () => {
    it('excludes movies containing an excluded genre (case-insensitive)', () => {
      const movie = {
        year: 2020,
        genres: ['Драма', 'Ужасы'],
        runtime: 110,
        tmdbRating: 7.4,
        tmdbStatus: 'matched' as const,
      };
      const settings: UserSettings = {
        ...defaultSettings,
        excludedGenres: ['ужасы'],
      };
      expect(RecommendationService.matchesSettings(movie, settings)).toBe(false);
    });

    it('enforces maxRuntime, release period, and minRating', () => {
      const movie = {
        year: 2015,
        genres: ['Фантастика'],
        runtime: 140,
        tmdbRating: 7.2,
        tmdbStatus: 'matched' as const,
      };

      expect(
        RecommendationService.matchesSettings(movie, {
          ...defaultSettings,
          maxRuntime: 120,
        })
      ).toBe(false);

      expect(
        RecommendationService.matchesSettings(movie, {
          ...defaultSettings,
          releaseYearFrom: 2018,
        })
      ).toBe(false);

      expect(
        RecommendationService.matchesSettings(movie, {
          ...defaultSettings,
          minRating: 7.5,
        })
      ).toBe(false);

      expect(
        RecommendationService.matchesSettings(movie, {
          ...defaultSettings,
          maxRuntime: 150,
          releaseYearFrom: 2010,
          releaseYearTo: 2020,
          minRating: 7.0,
        })
      ).toBe(true);
    });

    it('does not block movies without TMDB metadata when TMDB match was not found', () => {
      const unmatchedMovie = {
        year: 2021,
        genres: [],
        runtime: null,
        tmdbRating: null,
        tmdbStatus: 'not_found' as const,
      };

      expect(
        RecommendationService.matchesSettings(unmatchedMovie, {
          ...defaultSettings,
          excludedGenres: ['ужасы'],
          maxRuntime: 120,
          minRating: 7.0,
        })
      ).toBe(true);
    });
  });

  describe('filterForGenreDiversity', () => {
    it('prefers movies with non-overlapping genres from the previous recommendation', () => {
      const candidates = [
        { id: 1, genres: ['Драма', 'Криминал'] },
        { id: 2, genres: ['Комедия', 'Приключения'] },
        { id: 3, genres: ['Драма'] },
      ];

      const filtered = RecommendationService.filterForGenreDiversity(
        candidates,
        ['Драма'],
        true
      );

      expect(filtered).toHaveLength(1);
      expect(filtered[0].id).toBe(2);
    });
  });

  describe('getRecommendation session flow', () => {
    it('prevents repeating movies within the same session and reports session_exhausted when all shown', async () => {
      const m1Id = buildMovieId('Movie One', 2020);
      const m2Id = buildMovieId('Movie Two', 2021);

      const fakeUser: any = {
        telegramId: 42,
        settings: { ...defaultSettings },
        watchlist: [
          {
            id: m1Id,
            title: 'Movie One',
            year: 2020,
            letterboxdUri: null,
            tmdbId: null,
          },
          {
            id: m2Id,
            title: 'Movie Two',
            year: 2021,
            letterboxdUri: null,
            tmdbId: null,
          },
        ],
        watched: [],
        selected: [],
        save: jest.fn(),
      };

      const usrSvc = new UserService();
      jest.spyOn(usrSvc, 'findOrCreateUser').mockResolvedValue(fakeUser);

      const mockTmdbService: any = {
        resolveWatchlistMovie: jest.fn(async (entry: any) => ({
          id: entry.id,
          title: entry.title,
          originalTitle: entry.title,
          year: entry.year,
          letterboxdUri: entry.letterboxdUri,
          tmdbId: 100,
          overview: 'Test',
          genres: entry.id === m1Id ? ['Драма'] : ['Комедия'],
          runtime: 100,
          tmdbRating: 7.5,
          posterUrl: null,
          trailerUrl: null,
          tmdbStatus: 'matched',
        })),
      };

      const service = new RecommendationService(usrSvc, mockTmdbService);

      // 1st recommendation
      const r1 = await service.getRecommendation(42, () => 0);
      expect(r1.status).toBe('ok');
      if (r1.status === 'ok') {
        expect(r1.movie.title).toBe('Movie One');
      }

      // 2nd recommendation (Movie One is already in in-memory session)
      const r2 = await service.getRecommendation(42, () => 0);
      expect(r2.status).toBe('ok');
      if (r2.status === 'ok') {
        expect(r2.movie.title).toBe('Movie Two');
      }

      // 3rd recommendation (both shown -> session_exhausted)
      const r3 = await service.getRecommendation(42, () => 0);
      expect(r3).toEqual({
        status: 'session_exhausted',
        totalMatching: 2,
      });
    });
  });
});
