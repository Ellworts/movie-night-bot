import { connectDatabase, disconnectDatabase } from './config/database';
import { createBot } from './bot/bot';
import { feedbackQueueManager } from './queues/feedback.queue';
import { databaseCleanupService } from './services/cleanup.service';
import { keepAliveService } from './services/keepAlive.service';
import { logger } from './utils/logger';

async function bootstrap(): Promise<void> {
  // Start HTTP health server & self-ping immediately so Render binds the port fast
  keepAliveService.start();

  await connectDatabase();

  // Start automatic MongoDB compaction and orphan cleanup
  databaseCleanupService.startPeriodicCleanup();

  const bot = createBot();

  // Initialize delayed feedback scheduler (BullMQ if Redis configured, or persistent MongoDB poller)
  await feedbackQueueManager.init(bot.api);

  // Set Telegram bot commands menu
  await bot.api
    .setMyCommands([
      { command: 'start', description: 'Главное меню и начало работы' },
      { command: 'recommend', description: 'Случайный фильм из вашего Watchlist' },
      { command: 'random', description: 'Случайный фильм вне Watchlist (по фильтрам)' },
      { command: 'settings', description: 'Настройки подбора фильмов' },
      { command: 'history', description: 'Ваша история и просмотр Watchlist' },
      { command: 'pending', description: 'Оценить выбранные ранее фильмы' },
      { command: 'import', description: 'Как импортировать watchlist.csv из Letterboxd' },
      { command: 'about', description: 'О боте и атрибуция TMDB' },
    ])
    .catch((err) => {
      logger.warn({ err }, 'Could not set bot commands menu');
    });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down Movie Night Bot...');
    databaseCleanupService.stopPeriodicCleanup();
    await keepAliveService.stop();
    await bot.stop();
    await feedbackQueueManager.close();
    await disconnectDatabase();
    process.exit(0);
  };

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  logger.info('Starting Movie Night Bot polling...');
  await bot.start({
    onStart: (botInfo) => {
      logger.info({ username: botInfo.username }, 'Movie Night Bot is running');
    },
  });
}

bootstrap().catch((error) => {
  logger.fatal({ err: error }, 'Fatal error during bootstrap');
  process.exit(1);
});
