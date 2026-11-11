import { Bot, Context } from 'grammy';
import { env } from '../config/env';
import { UserService, userService } from '../services/user.service';
import { registerStartHandlers } from './handlers/start.handler';
import { registerImportHandlers } from './handlers/import.handler';
import { registerRecommendHandlers } from './handlers/recommend.handler';
import { registerFeedbackHandlers } from './handlers/feedback.handler';
import { registerHistoryHandlers } from './handlers/history.handler';
import { registerSettingsHandlers } from './handlers/settings.handler';
import { logger } from '../utils/logger';

export function createBot(
  token: string = env.BOT_TOKEN,
  usrSvc: UserService = userService
): Bot<Context> {
  const bot = new Bot<Context>(token);
  const processedUpdateIds = new Set<number>();

  // Middleware: Update deduplication & automatic user registration
  bot.use(async (ctx, next) => {
    const updateId = ctx.update.update_id;
    if (processedUpdateIds.has(updateId)) {
      logger.debug({ updateId }, 'Duplicate Telegram update ignored (in-memory)');
      return;
    }
    processedUpdateIds.add(updateId);
    if (processedUpdateIds.size > 5000) {
      const oldest = processedUpdateIds.values().next().value;
      if (oldest !== undefined) {
        processedUpdateIds.delete(oldest);
      }
    }

    if (ctx.from) {
      await usrSvc.findOrCreateUser({ telegramId: ctx.from.id });
    }

    await next();
  });

  // Register modular handlers
  registerStartHandlers(bot);
  registerImportHandlers(bot);
  registerRecommendHandlers(bot);
  registerFeedbackHandlers(bot);
  registerHistoryHandlers(bot);
  registerSettingsHandlers(bot);

  // Global error handler
  bot.catch((err) => {
    const ctx = err.ctx;
    logger.error(
      {
        err: err.error,
        updateId: ctx.update.update_id,
        telegramId: ctx.from?.id,
      },
      'Unhandled error while processing Telegram update'
    );
  });

  return bot;
}
