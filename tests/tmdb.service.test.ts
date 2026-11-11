import { buildMovieId } from '../src/models/User';
import { TmdbService } from '../src/services/tmdb.service';

describe('TmdbService', () => {
  describe('selectYoutubeTrailer', () => {
    it('selects official YouTube trailer first', () => {
      const videos = [
        { key: 'teaser1', site: 'YouTube', type: 'Teaser', official: true },
        { key: 'trailer_unoff', site: 'YouTube', type: 'Trailer', official: false },
        { key: 'trailer_off', site: 'YouTube', type: 'Trailer', official: true },
      ];

      expect(TmdbService.selectYoutubeTrailer(videos)).toBe(
        'https://www.youtube.com/watch?v=trailer_off'
      );
    });

    it('returns null when only non-YouTube videos exist', () => {
      const videos = [{ key: '12345', site: 'Vimeo', type: 'Trailer', official: true }];
      expect(TmdbService.selectYoutubeTrailer(videos)).toBeNull();
    });
  });

  describe('fetchMetadata & caching', () => {
    it('fetches movie metadata and extracts poster, trailer, genres, runtime, and rating', async () => {
      const mockFetch = jest
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            results: [{ id: 550, title: 'Fight Club', release_date: '1999-10-15' }],
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            id: 550,
            overview: 'An insomniac office worker and a devil-may-care soapmaker...',
            runtime: 139,
            vote_average: 8.43,
            poster_path: '/pB8BM7pdSp6B6Ih7QZ4DrQ3PmJK.jpg',
            genres: [{ id: 18, name: 'Драма' }],
            videos: {
              results: [
                {
                  key: 'SUXWAEX2jlg',
                  site: 'YouTube',
                  type: 'Trailer',
                  official: true,
                },
              ],
            },
          }),
        });

      const tmdb = new TmdbService('test-api-key', 'ru-RU', mockFetch as any);
      const metadata = await tmdb.fetchMetadata('Fight Club', 1999);

      expect(metadata).toEqual({
        tmdbId: 550,
        overview: 'An insomniac office worker and a devil-may-care soapmaker...',
        genres: ['Драма'],
        runtime: 139,
        tmdbRating: 8.4,
        posterUrl: 'https://image.tmdb.org/t/p/w500/pB8BM7pdSp6B6Ih7QZ4DrQ3PmJK.jpg',
        trailerUrl: 'https://www.youtube.com/watch?v=SUXWAEX2jlg',
      });
    });

    it('uses in-memory cache without calling TMDB API again on subsequent resolveWatchlistMovie calls', async () => {
      const mockFetch = jest
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            results: [{ id: 550, title: 'Fight Club', release_date: '1999-10-15' }],
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            id: 550,
            overview: 'Test',
            runtime: 139,
            vote_average: 8.4,
            poster_path: null,
            genres: [{ id: 18, name: 'Драма' }],
            videos: { results: [] },
          }),
        });

      const tmdb = new TmdbService('test-api-key', 'ru-RU', mockFetch as any);

      const entry = {
        id: buildMovieId('Fight Club', 1999),
        title: 'Fight Club',
        year: 1999,
        letterboxdUri: 'https://boxd.it/2a9q',
        tmdbId: null,
      };

      const first = await tmdb.resolveWatchlistMovie(entry);
      const second = await tmdb.resolveWatchlistMovie(entry);

      expect(first.tmdbId).toBe(550);
      expect(second.tmdbId).toBe(550);
      expect(mockFetch).toHaveBeenCalledTimes(2); // only once for search + once for details
    });
  });
});
