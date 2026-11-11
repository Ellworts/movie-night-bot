import { FeedbackService } from '../src/services/feedback.service';
import { buildMovieId, UserModel } from '../src/models/User';
import { processFeedbackJob } from '../src/queues/feedback.queue';

describe('FeedbackService and Delayed Feedback Job', () => {
  let feedbackService: FeedbackService;

  beforeEach(() => {
    feedbackService = new FeedbackService();
  });

  it('sends the 2-hour feedback prompt once and prevents duplicate sends', async () => {
    const movieId = buildMovieId('Dune', 2021);
    const fakeUser: any = {
      telegramId: 777,
      watchlist: [],
      watched: [],
      selected: [
        {
          id: movieId,
          title: 'Dune',
          year: 2021,
          letterboxdUri: null,
          tmdbId: 438631,
          selectedAt: new Date(),
          notificationSent: false,
        },
      ],
      save: jest.fn(),
    };

    jest.spyOn(UserModel, 'findOne').mockResolvedValue(fakeUser);

    const mockTelegramApi = {
      sendMessage: jest.fn().mockResolvedValue({}),
    };

    const jobData = {
      telegramId: 777,
      movieId,
    };

    const firstSend = await processFeedbackJob(jobData, mockTelegramApi as any, feedbackService);
    expect(firstSend).toBe(true);
    expect(mockTelegramApi.sendMessage).toHaveBeenCalledTimes(1);
    expect(mockTelegramApi.sendMessage).toHaveBeenCalledWith(
      777,
      expect.stringContaining('Ну что? Понравился фильм?'),
      expect.any(Object)
    );

    // Second attempt for the same selection must be skipped because notificationSent is now true
    const secondSend = await processFeedbackJob(jobData, mockTelegramApi as any, feedbackService);
    expect(secondSend).toBe(false);
    expect(mockTelegramApi.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('records 👍 reaction, moves movie to watched, removes from watchlist/selected, and ignores duplicate button clicks', async () => {
    const movieId = buildMovieId('Dune', 2021);

    const fakeUser: any = {
      telegramId: 777,
      watchlist: [
        {
          id: movieId,
          title: 'Dune',
          year: 2021,
          letterboxdUri: null,
          tmdbId: 438631,
        },
      ],
      watched: [],
      selected: [
        {
          id: movieId,
          title: 'Dune',
          year: 2021,
          letterboxdUri: null,
          tmdbId: 438631,
          selectedAt: new Date(),
          notificationSent: true,
        },
      ],
      save: jest.fn(),
    };

    jest.spyOn(UserModel, 'findOne').mockResolvedValue(fakeUser);

    // First click on 👍
    const res1 = await feedbackService.submitFeedback(777, movieId, 'like');
    expect(res1.status).toBe('recorded');
    expect(fakeUser.watchlist).toHaveLength(0);
    expect(fakeUser.selected).toHaveLength(0);
    expect(fakeUser.watched).toHaveLength(1);
    expect(fakeUser.watched[0].reaction).toBe('like');

    // Repeated click on 👍 or 👎
    const res2 = await feedbackService.submitFeedback(777, movieId, 'dislike');
    expect(res2.status).toBe('already_answered');
    expect(fakeUser.watched[0].reaction).toBe('like');
  });
});
