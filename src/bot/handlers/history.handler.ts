import { Bot, Context } from 'grammy';
import { InlineKeyboardMarkup } from 'grammy/types';
import { ReactionType } from '../../models/User';
import {
  HistoryCategory,
  HistoryService,
  historyService,
} from '../../services/history.service';
import { FeedbackService, feedbackService } from '../../services/feedback.service';
import { SmartKeyboard } from '../uiKit';
import {
  formatHistoryListHtml,
  formatHistorySummaryHtml,
  formatWatchlistPageHtml,
  formatRateableMovieHtml,
} from '../formatters';

export function buildHistoryKeyboard(activeTab?: HistoryCategory): InlineKeyboardMarkup {
  const kb = new SmartKeyboard();

  // Top row: Watchlist viewer + Rate watched movies
  kb.callback('🎞 Мой Watchlist', 'hist:wl:1')
    .callback('⭐ Оценить фильмы', 'hist:rate:init')
    .row('center');

  const tabs: Array<{ type: HistoryCategory; label: string }> = [
    { type: 'selected', label: '🎯 Выбранные' },
    { type: 'watched', label: '✅ Просмотренные' },
    { type: 'liked', label: '👍 Понравились' },
    { type: 'disliked', label: '👎 Не понравились' },
  ];

  tabs.forEach((tab, index) => {
    const isActive = activeTab === tab.type;
    const prefix = isActive ? '• ' : '';
    kb.callback(`${prefix}${tab.label}`, `hist:tab:${tab.type}`, {
      disabled: isActive,
    });
    if (index % 2 === 1) {
      kb.row('center');
    }
  });

  if (activeTab) {
    kb.callback('📊 К сводке', 'hist:summary');
  }
  kb.callback('⬅️ В меню', 'nav:menu');

  return kb.toMarkup();
}

export function buildWatchlistPaginationKeyboard(
  page: number,
  totalPages: number
): InlineKeyboardMarkup {
  return new SmartKeyboard()
    .callback('⬅️ Назад', `hist:wl:${page - 1}`, { disabled: page <= 1 })
    .callback('Вперёд ➡️', `hist:wl:${page + 1}`, { disabled: page >= totalPages })
    .row('center')
    .callback('↩️ Вернуться', 'hist:summary')
    .toMarkup();
}

export function buildRateableMovieKeyboard(
  movieId: string,
  index: number,
  totalCount: number,
  currentReaction: ReactionType | null
): InlineKeyboardMarkup {
  const likeLabel = currentReaction === 'like' ? '• 👍' : '👍';
  const dislikeLabel = currentReaction === 'dislike' ? '• 👎' : '👎';

  return new SmartKeyboard()
    .callback(likeLabel, `hist:rate:set:${index}:like:${movieId}`, {
      style: 'success',
    })
    .callback(dislikeLabel, `hist:rate:set:${index}:dislike:${movieId}`, {
      style: 'danger',
    })
    .row('center')
    .callback('⬅️ Назад', `hist:rate:view:${index - 1}`, { disabled: index <= 0 })
    .callback('Вперёд ➡️', `hist:rate:view:${index + 1}`, {
      disabled: index >= totalCount - 1,
    })
    .row('center')
    .callback('↩️ Вернуться', 'hist:summary')
    .toMarkup();
}

export function registerHistoryHandlers(
  bot: Bot<Context>,
  histSvc: HistoryService = historyService,
  feedbackSvc: FeedbackService = feedbackService
): void {
  async function renderRateableMovie(
    ctx: Context,
    telegramId: number,
    requestedIndex: number | null
  ): Promise<void> {
    const view = await feedbackSvc.getRateableMovieAt(telegramId, requestedIndex);
    if (!view) {
      const kb = new SmartKeyboard()
        .callback('↩️ Вернуться', 'hist:summary')
        .toMarkup();
      const emptyHtml =
        '⭐ <b>Оценка просмотренных</b>\n\n<i>У вас пока нет просмотренных или выбранных фильмов для оценки.</i>';
      if (ctx.callbackQuery?.message) {
        await ctx
          .editMessageText(emptyHtml, { parse_mode: 'HTML', reply_markup: kb })
          .catch(() => undefined);
      } else {
        await ctx.reply(emptyHtml, { parse_mode: 'HTML', reply_markup: kb });
      }
      return;
    }

    const html = formatRateableMovieHtml(view);
    const kb = buildRateableMovieKeyboard(
      view.entry.id,
      view.index,
      view.totalCount,
      view.entry.reaction
    );

    if (ctx.callbackQuery?.message) {
      await ctx
        .editMessageText(html, {
          parse_mode: 'HTML',
          link_preview_options: { is_disabled: true },
          reply_markup: kb,
        })
        .catch(() => undefined);
    } else {
      await ctx.reply(html, {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
        reply_markup: kb,
      });
    }
  }

  bot.command('history', async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) {
      return;
    }

    const summary = await histSvc.getUserHistorySummary(telegramId);
    const html = formatHistorySummaryHtml(summary);

    await ctx.reply(html, {
      parse_mode: 'HTML',
      reply_markup: buildHistoryKeyboard(),
    });
  });

  bot.callbackQuery('hist:summary', async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) {
      return;
    }

    await ctx.answerCallbackQuery();
    const summary = await histSvc.getUserHistorySummary(telegramId);
    const html = formatHistorySummaryHtml(summary);

    if (ctx.callbackQuery.message) {
      await ctx
        .editMessageText(html, {
          parse_mode: 'HTML',
          reply_markup: buildHistoryKeyboard(),
        })
        .catch(() =>
          ctx.reply(html, {
            parse_mode: 'HTML',
            reply_markup: buildHistoryKeyboard(),
          })
        );
    } else {
      await ctx.reply(html, {
        parse_mode: 'HTML',
        reply_markup: buildHistoryKeyboard(),
      });
    }
  });

  // Open interactive rating screen (jumps to first unrated movie if any)
  bot.callbackQuery('hist:rate:init', async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) {
      return;
    }

    await ctx.answerCallbackQuery();
    await renderRateableMovie(ctx, telegramId, null);
  });

  // Navigate between watched/selected movies in rating screen
  bot.callbackQuery(/^hist:rate:view:(-?\d+)$/, async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) {
      return;
    }

    const idx = Number(ctx.match[1]);
    await ctx.answerCallbackQuery();
    await renderRateableMovie(ctx, telegramId, idx);
  });

  // Set or change 👍 / 👎 rating on a movie and advance to next
  bot.callbackQuery(
    /^hist:rate:set:(\d+):(like|dislike):([a-fA-F0-9]{12})$/,
    async (ctx) => {
      const telegramId = ctx.from?.id;
      if (!telegramId) {
        return;
      }

      const currentIdx = Number(ctx.match[1]);
      const reaction = ctx.match[2] as ReactionType;
      const movieId = ctx.match[3];

      const updated = await feedbackSvc.setOrUpdateReaction(
        telegramId,
        movieId,
        reaction
      );

      if (!updated) {
        await ctx.answerCallbackQuery({
          text: 'Фильм не найден.',
          show_alert: true,
        });
        return;
      }

      const emoji = reaction === 'like' ? '👍' : '👎';
      await ctx.answerCallbackQuery({ text: `Оценка ${emoji} сохранена!` });

      // Automatically move to the next movie (or stay on current if at the end)
      await renderRateableMovie(ctx, telegramId, currentIdx + 1);
    }
  );

  // Paginated Watchlist view (20 movies per page)
  bot.callbackQuery(/^hist:wl:(\d+)$/, async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) {
      return;
    }

    const requestedPage = Number(ctx.match[1]) || 1;
    await ctx.answerCallbackQuery();

    const pageData = await histSvc.getUserWatchlistPage(telegramId, requestedPage, 20);
    const html = formatWatchlistPageHtml(pageData);
    const kb = buildWatchlistPaginationKeyboard(pageData.page, pageData.totalPages);

    if (ctx.callbackQuery.message) {
      await ctx
        .editMessageText(html, {
          parse_mode: 'HTML',
          reply_markup: kb,
        })
        .catch(() => undefined);
    } else {
      await ctx.reply(html, {
        parse_mode: 'HTML',
        reply_markup: kb,
      });
    }
  });

  bot.callbackQuery(
    /^hist:tab:(selected|watched|liked|disliked)$/,
    async (ctx) => {
      const telegramId = ctx.from?.id;
      if (!telegramId) {
        return;
      }

      const tabType = ctx.match[1] as HistoryCategory;
      await ctx.answerCallbackQuery();

      const items = await histSvc.getUserHistoryByType(telegramId, tabType, 15);
      const html = formatHistoryListHtml(tabType, items);

      if (ctx.callbackQuery.message) {
        await ctx
          .editMessageText(html, {
            parse_mode: 'HTML',
            reply_markup: buildHistoryKeyboard(tabType),
          })
          .catch(() => undefined);
      } else {
        await ctx.reply(html, {
          parse_mode: 'HTML',
          reply_markup: buildHistoryKeyboard(tabType),
        });
      }
    }
  );
}
