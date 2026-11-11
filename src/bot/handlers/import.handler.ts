import { Bot, Context } from 'grammy';
import { env } from '../../config/env';
import {
  CsvImportService,
  csvImportService,
  CsvValidationError,
  MAX_CSV_FILE_SIZE_BYTES,
} from '../../services/csv.service';
import { SmartKeyboard } from '../uiKit';
import { logger } from '../../utils/logger';

const IMPORT_INSTRUCTIONS_HTML = [
  '📥 <b>Импорт списков из Letterboxd</b>',
  '',
  '1. В настройках Letterboxd выберите <b>Settings → Import & Export → Export Your Data</b>.',
  '2. Распакуйте ZIP-архив и отправьте нужный CSV-файл в этот чат:',
  '',
  '• <code>watchlist.csv</code> — ваш список к просмотру.',
  '• <code>watched.csv</code> или <code>ratings.csv</code> — просмотренные фильмы и оценки (исключаются из рекомендаций).',
].join('\n');

export function registerImportHandlers(
  bot: Bot<Context>,
  importSvc: CsvImportService = csvImportService,
  fetchFn: typeof fetch = global.fetch
): void {
  bot.command('import', async (ctx) => {
    const kb = new SmartKeyboard().callback('⬅️ В меню', 'nav:menu').toMarkup();
    await ctx.reply(IMPORT_INSTRUCTIONS_HTML, {
      parse_mode: 'HTML',
      reply_markup: kb,
    });
  });

  bot.callbackQuery('cmd:import_help', async (ctx) => {
    await ctx.answerCallbackQuery();
    const kb = new SmartKeyboard().callback('⬅️ В меню', 'nav:menu').toMarkup();
    if (ctx.callbackQuery.message && 'text' in ctx.callbackQuery.message) {
      await ctx
        .editMessageText(IMPORT_INSTRUCTIONS_HTML, {
          parse_mode: 'HTML',
          reply_markup: kb,
        })
        .catch(() =>
          ctx.reply(IMPORT_INSTRUCTIONS_HTML, {
            parse_mode: 'HTML',
            reply_markup: kb,
          })
        );
    } else {
      await ctx.reply(IMPORT_INSTRUCTIONS_HTML, {
        parse_mode: 'HTML',
        reply_markup: kb,
      });
    }
  });

  bot.on('message:document', async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) {
      return;
    }

    const doc = ctx.message.document;
    const fileName = doc.file_name || '';
    const lowerName = fileName.toLowerCase();

    if (!lowerName.endsWith('.csv')) {
      await ctx.reply(
        '⚠️ Пожалуйста, отправьте файл в формате <code>.csv</code> (<code>watchlist.csv</code>, <code>watched.csv</code> или <code>ratings.csv</code>).',
        { parse_mode: 'HTML' }
      );
      return;
    }

    if (doc.file_size && doc.file_size > MAX_CSV_FILE_SIZE_BYTES) {
      await ctx.reply('⚠️ Файл слишком большой (максимум 5 МБ).');
      return;
    }

    const isWatchedOrRatingsFile =
      lowerName.includes('watched') ||
      lowerName.includes('ratings') ||
      lowerName.includes('diary');

    const statusMsg = await ctx.reply(
      isWatchedOrRatingsFile
        ? '⏳ Импортирую список просмотренных фильмов…'
        : '⏳ Импортирую ваш Watchlist…'
    );

    try {
      const fileInfo = await ctx.api.getFile(doc.file_id);
      if (!fileInfo.file_path) {
        throw new Error('Could not retrieve file_path from Telegram API');
      }

      const fileUrl = `https://api.telegram.org/file/bot${env.BOT_TOKEN}/${fileInfo.file_path}`;
      const response = await fetchFn(fileUrl);
      if (!response.ok) {
        throw new Error(`Failed to download file from Telegram: ${response.status}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const firstLine = buffer.toString('utf-8', 0, 256).split(/\r?\n/)[0] || '';
      const hasRatingHeader = /\brating\b/i.test(firstLine);

      if (isWatchedOrRatingsFile || hasRatingHeader) {
        const watchedResult = await importSvc.importWatchedCsvForUser(telegramId, buffer);

        const summaryLines = [
          '✅ <b>Импорт просмотренных завершён!</b>\n',
          `👁 Добавлено новых: <b>${watchedResult.newlyMarkedWatched}</b> (уже были: <b>${watchedResult.alreadyWatched}</b>)`,
        ];

        if (watchedResult.ratedLiked > 0 || watchedResult.ratedDisliked > 0) {
          summaryLines.push(
            `⭐ Оценки: 👍 <b>${watchedResult.ratedLiked}</b> / 👎 <b>${watchedResult.ratedDisliked}</b>`
          );
        }

        const keyboard = new SmartKeyboard()
          .callback('📋 Из Watchlist', 'rec:next')
          .callback('🎲 Случайный', 'rec:random')
          .row('center')
          .callback('⬅️ В меню', 'nav:menu')
          .toMarkup();

        await ctx.api.editMessageText(
          ctx.chat.id,
          statusMsg.message_id,
          summaryLines.join('\n'),
          {
            parse_mode: 'HTML',
            reply_markup: keyboard,
          }
        );
        return;
      }

      const result = await importSvc.importWatchlistForUser(telegramId, buffer);

      const summaryLines = [
        '✅ <b>Watchlist обновлён!</b>\n',
        `🆕 Добавлено: <b>${result.importedNew}</b> (уже были: <b>${result.alreadyInWatchlist}</b>)`,
      ];

      const keyboard = new SmartKeyboard()
        .callback('📋 Из Watchlist', 'rec:next')
        .callback('🎲 Случайный', 'rec:random')
        .row('center')
        .callback('⬅️ В меню', 'nav:menu')
        .toMarkup();

      await ctx.api.editMessageText(
        ctx.chat.id,
        statusMsg.message_id,
        summaryLines.join('\n'),
        {
          parse_mode: 'HTML',
          reply_markup: keyboard,
        }
      );
    } catch (error) {
      if (error instanceof CsvValidationError) {
        await ctx.api.editMessageText(
          ctx.chat.id,
          statusMsg.message_id,
          `❌ <b>Ошибка CSV:</b>\n${error.message}`,
          { parse_mode: 'HTML' }
        );
        return;
      }

      logger.error({ err: error, telegramId }, 'Failed to import CSV');
      await ctx.api.editMessageText(
        ctx.chat.id,
        statusMsg.message_id,
        '❌ Произошла ошибка при обработке файла.'
      );
    }
  });
}
