import { Queue, Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { Api, GrammyError } from 'grammy';
import { InlineKeyboardMarkup } from 'grammy/types';
import { env } from '../config/env';
import { ReactionType, UserModel } from '../models/User';
import { FeedbackService, feedbackService } from '../services/feedback.service';
import { SmartKeyboard } from '../bot/uiKit';
import { logger } from '../utils/logger';

export const FEEDBACK_QUEUE_NAME = 'watch-feedback-queue';

export interface FeedbackJobData {
  telegramId: number;
  movieId: string;
}

export function buildFeedbackMessageText(movieTitle: string, movieYear: number | null): string {
  const yearSuffix = movieYear ? ` (${movieYear})` : '';
  return `🎬 Вы выбрали фильм «${movieTitle}»${yearSuffix}.\n\nНу что? Понравился фильм?`;
}

export function buildFeedbackKeyboard(
  movieId: string,
  answeredReaction?: ReactionType | null
): InlineKeyboardMarkup {
  const kb = new SmartKeyboard();
  if (answeredReaction) {
    kb.disabled(answeredReaction === 'like' ? '✅ 👍' : '✅ 👎').callback(
      '⬅️ В меню',
      'nav:menu'
    );
    return kb.toMarkup();
  }

  return kb
    .callback('👍', `fb:like:${movieId}`, { style: 'success' })
    .callback('👎', `fb:dislike:${movieId}`, { style: 'danger' })
    .row('center')
    .callback('⬅️ В меню', 'nav:menu')
    .toMarkup();
}

/**
 * Processes a single delayed feedback job.
 */
export async function processFeedbackJob(
  data: FeedbackJobData,
  telegramApi: Pick<Api, 'sendMessage'>,
  feedbackSvc: FeedbackService = feedbackService
): Promise<boolean> {
  const claimed = await feedbackSvc.claimNotificationSend(data.telegramId, data.movieId);
  if (!claimed) {
    return false;
  }

  const text = buildFeedbackMessageText(claimed.title, claimed.year);
  const keyboard = buildFeedbackKeyboard(data.movieId);

  try {
    await telegramApi.sendMessage(data.telegramId, text, {
      reply_markup: keyboard,
    });
    logger.info(
      { movieId: data.movieId, telegramId: data.telegramId, movie: claimed.title },
      'Sent 2-hour watch feedback prompt'
    );
    return true;
  } catch (error) {
    if (error instanceof GrammyError && (error.error_code === 403 || error.error_code === 400)) {
      logger.warn(
        { err: error, telegramId: data.telegramId, movieId: data.movieId },
        'Permanent Telegram API error when sending feedback prompt'
      );
      return false;
    }

    await feedbackSvc.revertNotificationClaim(data.telegramId, data.movieId);
    logger.error(
      { err: error, telegramId: data.telegramId, movieId: data.movieId },
      'Transient error sending feedback prompt; will retry'
    );
    throw error;
  }
}

export class FeedbackQueueManager {
  private connection: IORedis | null = null;
  private queue: Queue<FeedbackJobData> | null = null;
  private worker: Worker<FeedbackJobData> | null = null;
  private fallbackInterval: NodeJS.Timeout | null = null;
  private telegramApi: Pick<Api, 'sendMessage'> | null = null;
  private redisAvailable: boolean = false;

  public async init(
    telegramApi: Pick<Api, 'sendMessage'>,
    redisUrl: string = env.REDIS_URL
  ): Promise<void> {
    this.telegramApi = telegramApi;

    const trimmedUrl = redisUrl.trim();
    if (trimmedUrl) {
      const probe = new IORedis(trimmedUrl, {
        maxRetriesPerRequest: 1,
        connectTimeout: 2000,
        retryStrategy: () => null,
        lazyConnect: true,
      });
      probe.on('error', () => undefined);

      try {
        await probe.connect();
        await probe.ping();
        await probe.quit();
        this.redisAvailable = true;
      } catch {
        this.redisAvailable = false;
        probe.disconnect();
      }
    }

    if (this.redisAvailable && trimmedUrl) {
      this.connection = new IORedis(trimmedUrl, {
        maxRetriesPerRequest: null,
      });
      this.connection.on('error', (err) => {
        logger.warn({ err: err.message }, 'Redis connection error');
      });

      this.queue = new Queue<FeedbackJobData>(FEEDBACK_QUEUE_NAME, {
        connection: this.connection,
      });

      this.worker = new Worker<FeedbackJobData>(
        FEEDBACK_QUEUE_NAME,
        async (job: Job<FeedbackJobData>) => {
          await processFeedbackJob(job.data, telegramApi, feedbackService);
        },
        {
          connection: this.connection,
        }
      );

      this.worker.on('failed', (job, err) => {
        logger.error({ jobId: job?.id, err }, 'Feedback job failed');
      });

      logger.info('Connected to Redis and initialized BullMQ feedback queue');
    } else {
      logger.info('Initialized persistent MongoDB scheduler for delayed feedback notifications');
    }

    // Run a periodic sweep for due notifications persisted in MongoDB
    void this.sweepDueSelections();
    this.fallbackInterval = setInterval(() => {
      void this.sweepDueSelections();
    }, 30_000);
  }

  private async sweepDueSelections(): Promise<void> {
    if (!this.telegramApi) {
      return;
    }
    try {
      const cutoff = new Date(Date.now() - env.FEEDBACK_DELAY_MS);
      const usersWithDue = await UserModel.find({
        selected: {
          $elemMatch: {
            notificationSent: false,
            selectedAt: { $lte: cutoff },
          },
        },
      })
        .select('telegramId selected')
        .limit(20)
        .lean();

      for (const usr of usersWithDue) {
        for (const sel of usr.selected) {
          if (!sel.notificationSent && new Date(sel.selectedAt) <= cutoff) {
            await processFeedbackJob(
              {
                telegramId: usr.telegramId,
                movieId: sel.id,
              },
              this.telegramApi,
              feedbackService
            ).catch(() => undefined);
          }
        }
      }
    } catch (err) {
      logger.error({ err }, 'Error sweeping due selections');
    }
  }

  /**
   * Schedules a delayed feedback notification (default: 2 hours after movie selection).
   */
  public async scheduleFeedbackPrompt(
    data: FeedbackJobData,
    delayMs: number = env.FEEDBACK_DELAY_MS
  ): Promise<void> {
    if (!this.queue || !this.redisAvailable) {
      return;
    }

    const jobId = `feedback-${data.telegramId}-${data.movieId}`;
    await this.queue.add('send-feedback-prompt', data, {
      jobId,
      delay: delayMs,
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000,
      },
      removeOnComplete: true,
      removeOnFail: false,
    });
  }

  public async close(): Promise<void> {
    if (this.fallbackInterval) {
      clearInterval(this.fallbackInterval);
      this.fallbackInterval = null;
    }
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
    if (this.queue) {
      await this.queue.close();
      this.queue = null;
    }
    if (this.connection) {
      await this.connection.quit();
      this.connection = null;
    }
  }
}

export const feedbackQueueManager = new FeedbackQueueManager();
