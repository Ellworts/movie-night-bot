import { Bot, Context } from 'grammy';
import { InlineKeyboardMarkup } from 'grammy/types';
import { env } from '../../config/env';
import {
  CsvImportService,
  csvImportService,
  CsvValidationError,
  MAX_CSV_FILE_SIZE_BYTES,
} from '../../services/csv.service';
import {
  LetterboxdError,
  LetterboxdService,
  letterboxdService,
  LetterboxdSyncResult,
} from '../../services/letterboxd.service';
import { UserService, userService } from '../../services/user.service';
import { SmartKeyboard } from '../uiKit';
import { escapeHtml } from '../formatters';
import { logger } from '../../utils/logger';

const awaitingLetterboxdProfile = new Set<number>();

export function buildLetterboxdConnectText(currentUsername?: string | null): string {
  const lines = ['🔗 <b>Привязка профиля Letterboxd</b>', ''];

  if (currentUsername) {
    const profileUrl = `https://letterboxd.com/${encodeURIComponent(currentUsername)}/`;
    lines.push(
      `Привязанный профиль: <a href="${escapeHtml(profileUrl)}"><b>@${escapeHtml(
        currentUsername
      )}</b></a>`,
      ''
    );
  }

  lines.push(
    'Отправьте в чат <b>ссылку на свой профиль Letterboxd</b> (например, <code>https://letterboxd.com/ваш_ник</code>) или просто ваш никнейм.',
    '',
    'Бот автоматически считает из вашего профиля:',
    '• <b>Letterboxd Watchlist</b> и объединит его с вашим <b>Bot Watchlist</b> (фильмами, добавленными внутри бота);',
    '• <b>Просмотренные фильмы и оценки</b> (≤ 2.5 ★ → 👎, > 2.5 ★ → 👍).'
  );

  return lines.join('\n');
}

export function buildLetterboxdConnectKeyboard(
  currentUsername?: string | null
): InlineKeyboardMarkup {
  const kb = new SmartKeyboard();
  if (currentUsername) {
    kb.callback(`🔄 Обновить из @${currentUsername}`, 'lb:sync').row('center');
  }
  kb.callback('⬅️ В меню', 'nav:menu');
  return kb.toMarkup();
}

export function formatSyncResultHtml(res: LetterboxdSyncResult): string {
  const profileUrl = `https://letterboxd.com/${encodeURIComponent(res.username)}/`;
  const lines = [
    `✅ <b>Профиль <a href="${escapeHtml(profileUrl)}">@${escapeHtml(
      res.username
    )}</a> синхронизирован!</b>\n`,
    `🎞 <b>Общий Watchlist:</b> <b>${res.totalWatchlistCount}</b> шт.`,
    `   • Из Letterboxd: <b>${res.letterboxdWatchlistCount}</b> (новых: +${res.newlyAddedToWatchlist})`,
    `   • Добавлено в боте: <b>${res.botWatchlistCount}</b>`,
  ];

  if (
    res.newlyWatchedCount > 0 ||
    res.ratedLikedCount > 0 ||
    res.ratedDislikedCount > 0
  ) {
    lines.push(
      `\n👁 <b>Просмотренные:</b> +<b>${res.newlyWatchedCount}</b> новых (👍 <b>${res.ratedLikedCount}</b> / 👎 <b>${res.ratedDislikedCount}</b>)`
    );
    if (res.movedFromWatchlistToWatched > 0) {
      lines.push(
        `   • Из них ушло из Watchlist → в просмотрено (без оценки): <b>${res.movedFromWatchlistToWatched}</b>`
      );
    }
  }

  return lines.join('\n');
}

export function registerImportHandlers(
  bot: Bot<Context>,
  importSvc: CsvImportService = csvImportService,
  fetchFn: typeof fetch = global.fetch,
  lbSvc: LetterboxdService = letterboxdService,
  usrSvc: UserService = userService
): void {
  async function showLetterboxdPrompt(ctx: Context, edit: boolean): Promise<void> {
    const telegramId = ctx.from?.id;
    if (!telegramId) {
      return;
    }

    awaitingLetterboxdProfile.add(telegramId);
    const user = await usrSvc.findOrCreateUser({ telegramId });
    const text = buildLetterboxdConnectText(user.letterboxdUsername);
    const kb = buildLetterboxdConnectKeyboard(user.letterboxdUsername);

    if (edit && ctx.callbackQuery?.message && 'text' in ctx.callbackQuery.message) {
      await ctx
        .editMessageText(text, {
          parse_mode: 'HTML',
          link_preview_options: { is_disabled: true },
          reply_markup: kb,
        })
        .catch(() =>
          ctx.reply(text, {
            parse_mode: 'HTML',
            link_preview_options: { is_disabled: true },
            reply_markup: kb,
          })
        );
    } else {
      await ctx.reply(text, {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
        reply_markup: kb,
      });
    }
  }

  async function runProfileSync(
    ctx: Context,
    telegramId: number,
    input: string,
    allowPlainUsername: boolean
  ): Promise<void> {
    awaitingLetterboxdProfile.delete(telegramId);
    const statusMsg = await ctx.reply(
      '⏳ Считываю ваш Watchlist и оценки из профиля Letterboxd…'
    );

    try {
      const result = await lbSvc.syncUserProfile(
        telegramId,
        input,
        allowPlainUsername
      );
      const html = formatSyncResultHtml(result);
      const kb = new SmartKeyboard()
        .callback('📋 Из Watchlist', 'rec:next')
        .callback('🎲 Случайный', 'rec:random')
        .row('center')
        .callback('🔄 Обновить ещё раз', 'lb:sync')
        .row('center')
        .callback('⬅️ В меню', 'nav:menu')
        .toMarkup();

      await ctx.api.editMessageText(ctx.chat!.id, statusMsg.message_id, html, {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
        reply_markup: kb,
      });
    } catch (error) {
      const kb = new SmartKeyboard().callback('⬅️ В меню', 'nav:menu').toMarkup();
      if (error instanceof LetterboxdError) {
        await ctx.api.editMessageText(
          ctx.chat!.id,
          statusMsg.message_id,
          `❌ <b>Ошибка синхронизации:</b>\n${error.message}`,
          { parse_mode: 'HTML', reply_markup: kb }
        );
        return;
      }

      logger.error({ err: error, telegramId, input }, 'Failed to sync Letterboxd profile');
      await ctx.api.editMessageText(
        ctx.chat!.id,
        statusMsg.message_id,
        '❌ Не удалось подключиться к Letterboxd. Проверьте ссылку на профиль и попробуйте ещё раз.',
        { reply_markup: kb }
      );
    }
  }

  bot.command('import', async (ctx) => {
    await showLetterboxdPrompt(ctx, false);
  });

  bot.command('sync', async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) {
      return;
    }

    const arg = (ctx.match || '').trim();
    if (arg) {
      await runProfileSync(ctx, telegramId, arg, true);
      return;
    }

    const user = await usrSvc.findOrCreateUser({ telegramId });
    if (!user.letterboxdUsername) {
      await showLetterboxdPrompt(ctx, false);
      return;
    }

    await runProfileSync(ctx, telegramId, user.letterboxdUsername, true);
  });

  bot.callbackQuery('cmd:import_help', async (ctx) => {
    await ctx.answerCallbackQuery();
    await showLetterboxdPrompt(ctx, true);
  });

  bot.callbackQuery('lb:sync', async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) {
      return;
    }

    const user = await usrSvc.findOrCreateUser({ telegramId });
    if (!user.letterboxdUsername) {
      await ctx.answerCallbackQuery({
        text: 'Сначала отправьте ссылку на ваш профиль Letterboxd.',
        show_alert: true,
      });
      return;
    }

    await ctx.answerCallbackQuery({ text: 'Обновляю список из Letterboxd…' });
    await runProfileSync(ctx, telegramId, user.letterboxdUsername, true);
  });

  // Listen for Letterboxd profile URLs (anywhere) or plain username (when in Letterboxd connect view)
  bot.on('message:text', async (ctx, next) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) {
      await next();
      return;
    }

    const text = ctx.message.text.trim();
    if (text.startsWith('/')) {
      awaitingLetterboxdProfile.delete(telegramId);
      await next();
      return;
    }

    const isAwaiting = awaitingLetterboxdProfile.has(telegramId);
    const extractedFromUrl = LetterboxdService.extractUsername(text, false);

    if (extractedFromUrl) {
      await runProfileSync(ctx, telegramId, extractedFromUrl, true);
      return;
    }

    if (isAwaiting) {
      const extractedPlain = LetterboxdService.extractUsername(text, true);
      if (extractedPlain) {
        await runProfileSync(ctx, telegramId, extractedPlain, true);
        return;
      }
    }

    await next();
  });

  // Keep optional CSV file upload support if a user sends a .csv document directly
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
        '⚠️ Отправьте <b>ссылку на ваш профиль Letterboxd</b> (например, <code>https://letterboxd.com/ваш_ник</code>) или файл <code>.csv</code>.',
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
