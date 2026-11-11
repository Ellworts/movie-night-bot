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
  buildLetterboxdUrl,
  escapeHtml,
  formatHistoryPageHtml,
  formatHistorySummaryHtml,
  formatWatchlistPageHtml,
  formatRateableMovieHtml,
} from '../formatters';

interface PendingRateEditState {
  type: 'watched' | 'liked' | 'disliked';
  page: number;
}

const pendingRateEdits = new Map<number, PendingRateEditState>();

export function buildHistoryKeyboard(): InlineKeyboardMarkup {
  return new SmartKeyboard()
    .callback('🎞 Мой Watchlist', 'hist:wl:1')
    .callback('⭐ Оценить фильмы', 'hist:rate:init')
    .row('center')
    .callback('🎯 Выбранные', 'hist:tab:selected:1')
    .callback('✅ Просмотренные', 'hist:tab:watched:1')
    .row('center')
    .callback('👍 Понравились', 'hist:tab:liked:1')
    .callback('👎 Не понравились', 'hist:tab:disliked:1')
    .row('center')
    .callback('⬅️ В меню', 'nav:menu')
    .toMarkup();
}

export function buildWatchlistPaginationKeyboard(
  page: number,
  totalPages: number
): InlineKeyboardMarkup {
  return new SmartKeyboard()
    .callback('⬅️ Назад', `hist:wl:${page - 1}`, { disabled: page <= 1 })
    .callback('Вперёд ➡️', `hist:wl:${page + 1}`, { disabled: page >= totalPages })
    .row('center')
    .callback('⬅️ История', 'hist:summary')
    .toMarkup();
}

export function buildHistoryTabPaginationKeyboard(
  type: HistoryCategory,
  page: number,
  totalPages: number,
  totalCount: number
): InlineKeyboardMarkup {
  const kb = new SmartKeyboard()
    .callback('⬅️ Назад', `hist:tab:${type}:${page - 1}`, { disabled: page <= 1 })
    .callback('Вперёд ➡️', `hist:tab:${type}:${page + 1}`, {
      disabled: page >= totalPages,
    });

  if (
    totalCount > 0 &&
    (type === 'watched' || type === 'liked' || type === 'disliked')
  ) {
    kb.row('center').callback(
      '✏️ Изменить оценку',
      `hist:edit_rate:${type}:${page}`
    );
  }

  kb.row('center').callback('⬅️ История', 'hist:summary');
  return kb.toMarkup();
}

export function buildRateableMovieKeyboard(
  movieId: string,
  index: number,
  totalCount: number
): InlineKeyboardMarkup {
  return new SmartKeyboard()
    .callback('👍', `hist:rate:set:${index}:like:${movieId}`, {
      style: 'success',
    })
    .callback('👎', `hist:rate:set:${index}:dislike:${movieId}`, {
      style: 'danger',
    })
    .row('center')
    .callback('⬅️ Назад', `hist:rate:view:${index - 1}`, { disabled: index <= 0 })
    .callback('Вперёд ➡️', `hist:rate:view:${index + 1}`, {
      disabled: index >= totalCount - 1,
    })
    .row('center')
    .callback('⬅️ История', 'hist:summary')
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
    pendingRateEdits.delete(telegramId);
    const view = await feedbackSvc.getRateableMovieAt(telegramId, requestedIndex);
    if (!view) {
      const kb = new SmartKeyboard()
        .callback('⬅️ История', 'hist:summary')
        .toMarkup();
      const emptyHtml =
        '⭐ <b>Фильмы без оценки</b>\n\n<i>У вас нет неоценённых просмотренных фильмов — все фильмы уже оценены!</i>';
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
      view.totalCount
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

  async function renderHistoryTabPage(
    ctx: Context,
    telegramId: number,
    tabType: HistoryCategory,
    requestedPage: number
  ): Promise<void> {
    pendingRateEdits.delete(telegramId);
    const pageData = await histSvc.getUserHistoryPage(
      telegramId,
      tabType,
      requestedPage,
      15
    );
    const html = formatHistoryPageHtml(pageData);
    const kb = buildHistoryTabPaginationKeyboard(
      tabType,
      pageData.page,
      pageData.totalPages,
      pageData.totalCount
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

    pendingRateEdits.delete(telegramId);
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

    pendingRateEdits.delete(telegramId);
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

  // Open interactive rating screen (shows ONLY unrated movies)
  bot.callbackQuery('hist:rate:init', async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) {
      return;
    }

    await ctx.answerCallbackQuery();
    await renderRateableMovie(ctx, telegramId, 0);
  });

  // Navigate between unrated movies in rating screen
  bot.callbackQuery(/^hist:rate:view:(-?\d+)$/, async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) {
      return;
    }

    const idx = Number(ctx.match[1]);
    await ctx.answerCallbackQuery();
    await renderRateableMovie(ctx, telegramId, idx);
  });

  // Rate an unrated movie -> it leaves the unrated list, so render the next unrated at currentIdx
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

      // Since the rated movie is no longer unrated, `currentIdx` now points to the next unrated movie
      await renderRateableMovie(ctx, telegramId, currentIdx);
    }
  );

  // Paginated Watchlist view (20 movies per page)
  bot.callbackQuery(/^hist:wl:(\d+)$/, async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) {
      return;
    }

    pendingRateEdits.delete(telegramId);
    const requestedPage = Number(ctx.match[1]) || 1;
    await ctx.answerCallbackQuery();

    const pageData = await histSvc.getUserWatchlistPage(telegramId, requestedPage, 20);
    const html = formatWatchlistPageHtml(pageData);
    const kb = buildWatchlistPaginationKeyboard(pageData.page, pageData.totalPages);

    if (ctx.callbackQuery.message) {
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
  });

  // Paginated history tabs (15 movies per page)
  bot.callbackQuery(
    /^hist:tab:(selected|watched|liked|disliked)(?::(\d+))?$/,
    async (ctx) => {
      const telegramId = ctx.from?.id;
      if (!telegramId) {
        return;
      }

      const tabType = ctx.match[1] as HistoryCategory;
      const requestedPage = Number(ctx.match[2]) || 1;
      await ctx.answerCallbackQuery();

      await renderHistoryTabPage(ctx, telegramId, tabType, requestedPage);
    }
  );

  // Button «✏️ Изменить оценку» inside watched / liked / disliked tabs
  bot.callbackQuery(
    /^hist:edit_rate:(watched|liked|disliked):(\d+)$/,
    async (ctx) => {
      const telegramId = ctx.from?.id;
      if (!telegramId) {
        return;
      }

      const tabType = ctx.match[1] as 'watched' | 'liked' | 'disliked';
      const page = Number(ctx.match[2]) || 1;

      const pageData = await histSvc.getUserHistoryPage(telegramId, tabType, page, 15);
      if (pageData.totalCount === 0) {
        await ctx.answerCallbackQuery({
          text: 'Список пуст.',
          show_alert: true,
        });
        return;
      }

      pendingRateEdits.set(telegramId, { type: tabType, page });
      await ctx.answerCallbackQuery();

      const kb = new SmartKeyboard()
        .callback('⬅️ Назад к списку', `hist:tab:${tabType}:${page}`)
        .toMarkup();

      await ctx.reply(
        `✏️ <b>Изменение оценки</b>\n\nОтправьте в чат <b>номер фильма</b> из списка (от <b>1</b> до <b>${pageData.totalCount}</b>), оценку которого хотите изменить:`,
        {
          parse_mode: 'HTML',
          reply_markup: kb,
        }
      );
    }
  );

  // Handle user choosing new 👍 / 👎 rating for the movie selected by number
  bot.callbackQuery(
    /^hist:edit_set:(watched|liked|disliked):(\d+):(like|dislike):([a-fA-F0-9]{12})$/,
    async (ctx) => {
      const telegramId = ctx.from?.id;
      if (!telegramId) {
        return;
      }

      const tabType = ctx.match[1] as HistoryCategory;
      const page = Number(ctx.match[2]) || 1;
      const reaction = ctx.match[3] as ReactionType;
      const movieId = ctx.match[4];

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
      await ctx.answerCallbackQuery({ text: `Оценка изменена на ${emoji}!` });

      await renderHistoryTabPage(ctx, telegramId, tabType, page);
    }
  );

  // Text handler for entering movie number when «✏️ Изменить оценку» is active
  bot.on('message:text', async (ctx, next) => {
    const telegramId = ctx.from?.id;
    if (!telegramId || !pendingRateEdits.has(telegramId)) {
      await next();
      return;
    }

    const text = ctx.message.text.trim();
    if (text.startsWith('/')) {
      pendingRateEdits.delete(telegramId);
      await next();
      return;
    }

    const state = pendingRateEdits.get(telegramId)!;
    const itemNumber = Number(text);

    const found = await histSvc.getHistoryItemByNumber(
      telegramId,
      state.type,
      itemNumber
    );

    if (!found) {
      const kb = new SmartKeyboard()
        .callback('⬅️ Назад к списку', `hist:tab:${state.type}:${state.page}`)
        .toMarkup();
      await ctx.reply(
        `⚠️ Фильм с таким номером не найден. Введите число от 1 до количества фильмов в списке или вернитесь назад:`,
        { reply_markup: kb }
      );
      return;
    }

    pendingRateEdits.delete(telegramId);
    const { item } = found;
    const yearStr = item.year ? ` (${item.year})` : '';
    const url = buildLetterboxdUrl(item);

    let currentLabel = '⚪️ Нет оценки';
    if (item.reaction === 'like') {
      currentLabel = '👍 Понравился';
    } else if (item.reaction === 'dislike') {
      currentLabel = '👎 Не понравился';
    }

    const likeLabel = item.reaction === 'like' ? '• 👍' : '👍';
    const dislikeLabel = item.reaction === 'dislike' ? '• 👎' : '👎';

    const kb = new SmartKeyboard()
      .callback(
        likeLabel,
        `hist:edit_set:${state.type}:${state.page}:like:${item.id}`,
        { style: 'success' }
      )
      .callback(
        dislikeLabel,
        `hist:edit_set:${state.type}:${state.page}:dislike:${item.id}`,
        { style: 'danger' }
      )
      .row('center')
      .callback('⬅️ Назад к списку', `hist:tab:${state.type}:${state.page}`)
      .toMarkup();

    await ctx.reply(
      [
        `🎬 <b>${itemNumber}. <a href="${escapeHtml(url)}">${escapeHtml(item.title)}</a></b>${yearStr}`,
        `Текущая оценка: <b>${currentLabel}</b>\n`,
        `Выберите новую оценку:`,
      ].join('\n'),
      {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
        reply_markup: kb,
      }
    );
  });
}
