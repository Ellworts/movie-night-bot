import { Bot, Context } from 'grammy';
import { InlineKeyboardMarkup } from 'grammy/types';
import { ReactionType } from '../../models/User';
import { MovieCardData } from '../../services/tmdb.service';
import {
  RecommendationMode,
  RecommendationService,
  recommendationService,
} from '../../services/recommendation.service';
import { FeedbackService, feedbackService } from '../../services/feedback.service';
import { UserService, userService } from '../../services/user.service';
import {
  FeedbackQueueManager,
  feedbackQueueManager,
} from '../../queues/feedback.queue';
import { SmartKeyboard } from '../uiKit';
import { escapeHtml, formatMovieCardHtml } from '../formatters';
import { logger } from '../../utils/logger';

export type CardActionState = 'active' | 'accepted' | 'watched';

export function buildRecommendationKeyboard(
  movie: { id: string },
  mode: RecommendationMode = 'watchlist',
  actionState: CardActionState = 'active',
  inWatchlist: boolean = mode === 'watchlist'
): InlineKeyboardMarkup {
  const movieId = movie.id;
  const nextCallback = mode === 'random' ? 'rec:random' : 'rec:next';
  const modeShort = mode === 'random' ? 'r' : 'w';

  const kb = new SmartKeyboard();

  if (actionState === 'accepted') {
    kb.disabled('✅ Выбрано на вечер')
      .callback('Что-то другое', nextCallback, { style: 'primary' })
      .row('center')
      .callback('⬅️ В меню', 'nav:menu');
    return kb.toMarkup();
  }

  if (actionState === 'watched') {
    kb.disabled('👁 Просмотрено')
      .callback('Что-то другое', nextCallback, { style: 'primary' })
      .row('center')
      .callback('⬅️ В меню', 'nav:menu');
    return kb.toMarkup();
  }

  // Row 1 (2 columns): А давай! | Что-то другое
  kb.callback('А давай!', `rec:accept:${movieId}`, { style: 'success' }).callback(
    'Что-то другое',
    nextCallback,
    { style: 'primary' }
  );

  // Row 2 (spanning full width): Уже смотрел(а)
  kb.row('center').callback('Уже смотрел(а)', `rec:watched:${modeShort}:${movieId}`, {
    style: 'danger',
  });

  // Row 3 (spanning full width): Добавить в Watchlist / Убрать из Watchlist
  if (inWatchlist) {
    kb.row('center').callback(
      '➖ Убрать из Watchlist',
      `rec:rem_wl:${modeShort}:${movieId}`
    );
  } else {
    kb.row('center').callback(
      '➕ Добавить в Watchlist',
      `rec:add_wl:${modeShort}:${movieId}`
    );
  }

  // Row 4 (spanning full width): ⬅️ В меню
  kb.row('center').callback('⬅️ В меню', 'nav:menu');

  return kb.toMarkup();
}

export function buildWatchedRateKeyboard(
  movieId: string,
  mode: RecommendationMode
): InlineKeyboardMarkup {
  const modeShort = mode === 'random' ? 'r' : 'w';
  return new SmartKeyboard()
    .callback('👍', `rec:rate:${modeShort}:like:${movieId}`, { style: 'success' })
    .callback('👎', `rec:rate:${modeShort}:dislike:${movieId}`, { style: 'danger' })
    .row('center')
    .callback('⬅️ В меню', 'nav:menu')
    .toMarkup();
}

export async function sendMovieRecommendationCard(
  ctx: Context,
  movie: MovieCardData,
  mode: RecommendationMode = 'watchlist'
): Promise<void> {
  const keyboard = buildRecommendationKeyboard(
    movie,
    mode,
    'active',
    mode === 'watchlist'
  );

  // 1. If a suitable YouTube trailer exists, send text with YouTube link preview enabled
  if (movie.trailerUrl) {
    const html = formatMovieCardHtml(movie, true);
    await ctx.reply(html, {
      parse_mode: 'HTML',
      link_preview_options: {
        is_disabled: false,
        url: movie.trailerUrl,
        prefer_large_media: true,
      },
      reply_markup: keyboard,
    });
    return;
  }

  // 2. If no trailer is available, use movie poster if present
  if (movie.posterUrl) {
    const caption = formatMovieCardHtml(movie, false);
    try {
      await ctx.replyWithPhoto(movie.posterUrl, {
        caption,
        parse_mode: 'HTML',
        reply_markup: keyboard,
      });
      return;
    } catch (err) {
      logger.warn(
        { err, posterUrl: movie.posterUrl, movieId: movie.id },
        'Failed to send photo poster; falling back to text message'
      );
    }
  }

  // 3. Fallback when neither trailer nor poster is available
  const fallbackHtml = formatMovieCardHtml(movie, false);
  await ctx.reply(fallbackHtml, {
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
    reply_markup: keyboard,
  });
}

export function registerRecommendHandlers(
  bot: Bot<Context>,
  recSvc: RecommendationService = recommendationService,
  usrSvc: UserService = userService,
  queueMgr: FeedbackQueueManager = feedbackQueueManager,
  feedbackSvc: FeedbackService = feedbackService
): void {
  async function handleWatchlistRecommend(ctx: Context): Promise<void> {
    const telegramId = ctx.from?.id;
    if (!telegramId) {
      return;
    }

    const outcome = await recSvc.getRecommendation(telegramId);

    if (outcome.status === 'empty_watchlist') {
      const kb = new SmartKeyboard()
        .callback('🎲 Случайный фильм', 'rec:random')
        .callback('📥 Импорт CSV', 'cmd:import_help')
        .row('center')
        .callback('⬅️ В меню', 'nav:menu')
        .toMarkup();
      await ctx.reply(
        '📭 Ваш Watchlist пуст.\n\nОтправьте файл <code>watchlist.csv</code> из Letterboxd или попробуйте случайный подбор:',
        { parse_mode: 'HTML', reply_markup: kb }
      );
      return;
    }

    if (outcome.status === 'no_matching_movies') {
      const kb = new SmartKeyboard()
        .callback('🎲 Случайный фильм', 'rec:random')
        .callback('⚙️ Настройки', 'set:main')
        .row('center')
        .callback('⬅️ В меню', 'nav:menu')
        .toMarkup();
      await ctx.reply(
        '🔍 В Watchlist не нашлось фильмов под текущие фильтры.\n\nПопробуйте изменить настройки или выбрать случайный фильм:',
        { parse_mode: 'HTML', reply_markup: kb }
      );
      return;
    }

    if (outcome.status === 'session_exhausted') {
      const kb = new SmartKeyboard()
        .callback('🔄 Начать заново', 'rec:reset_session')
        .callback('🎲 Случайный', 'rec:random')
        .row('center')
        .callback('⬅️ В меню', 'nav:menu')
        .toMarkup();
      await ctx.reply(
        `🏁 В этой сессии показаны все подходящие фильмы из Watchlist (${outcome.totalMatching} шт.).`,
        { parse_mode: 'HTML', reply_markup: kb }
      );
      return;
    }

    await sendMovieRecommendationCard(ctx, outcome.movie, 'watchlist');
  }

  async function handleRandomRecommend(ctx: Context): Promise<void> {
    const telegramId = ctx.from?.id;
    if (!telegramId) {
      return;
    }

    try {
      const outcome = await recSvc.getDiscoverRecommendation(telegramId);

      if (outcome.status !== 'ok') {
        const kb = new SmartKeyboard()
          .callback('🔄 Сбросить сессию', 'rec:reset_session')
          .callback('⚙️ Настройки', 'set:main')
          .row('center')
          .callback('⬅️ В меню', 'nav:menu')
          .toMarkup();
        await ctx.reply(
          '🔍 Не удалось найти случайные фильмы под текущие фильтры.',
          { parse_mode: 'HTML', reply_markup: kb }
        );
        return;
      }

      await sendMovieRecommendationCard(ctx, outcome.movie, 'random');
    } catch (err) {
      logger.error({ err, telegramId }, 'Failed to get random discover recommendation');
      await ctx.reply(
        '⚠️ Не удалось получить случайную рекомендацию из TMDB. Попробуйте ещё раз.'
      );
    }
  }

  bot.command('recommend', async (ctx) => {
    await handleWatchlistRecommend(ctx);
  });

  bot.command('random', async (ctx) => {
    await handleRandomRecommend(ctx);
  });

  bot.callbackQuery('rec:next', async (ctx) => {
    await ctx.answerCallbackQuery();
    await handleWatchlistRecommend(ctx);
  });

  bot.callbackQuery('rec:random', async (ctx) => {
    await ctx.answerCallbackQuery();
    await handleRandomRecommend(ctx);
  });

  bot.callbackQuery('rec:reset_session', async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) {
      return;
    }
    usrSvc.resetSession(telegramId);
    await ctx.answerCallbackQuery({ text: 'Сессия обновлена' });
    await handleWatchlistRecommend(ctx);
  });

  // Button «➕ Добавить в Watchlist»
  bot.callbackQuery(/^rec:add_wl:(w|r):([a-fA-F0-9]{12})$/, async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) {
      return;
    }

    const mode: RecommendationMode = ctx.match[1] === 'r' ? 'random' : 'watchlist';
    const movieId = ctx.match[2];
    const res = await recSvc.addToWatchlist(telegramId, movieId);
    if (!res) {
      await ctx.answerCallbackQuery({
        text: 'Фильм не найден.',
        show_alert: true,
      });
      return;
    }

    await ctx.answerCallbackQuery({
      text: res.alreadyInWatchlist
        ? 'Фильм уже в вашем Watchlist'
        : '✅ Добавлено в ваш Watchlist!',
    });

    if (ctx.callbackQuery.message) {
      await ctx
        .editMessageReplyMarkup({
          reply_markup: buildRecommendationKeyboard(res.movie, mode, 'active', true),
        })
        .catch(() => undefined);
    }
  });

  // Button «➖ Убрать из Watchlist»
  bot.callbackQuery(/^rec:rem_wl:(w|r):([a-fA-F0-9]{12})$/, async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) {
      return;
    }

    const mode: RecommendationMode = ctx.match[1] === 'r' ? 'random' : 'watchlist';
    const movieId = ctx.match[2];
    const res = await recSvc.removeFromWatchlist(telegramId, movieId);
    if (!res) {
      await ctx.answerCallbackQuery({
        text: 'Фильм не найден.',
        show_alert: true,
      });
      return;
    }

    await ctx.answerCallbackQuery({
      text: res.removed ? '🗑 Удалено из вашего Watchlist' : 'Уже удалено из Watchlist',
    });

    if (ctx.callbackQuery.message) {
      await ctx
        .editMessageReplyMarkup({
          reply_markup: buildRecommendationKeyboard(res.movie, mode, 'active', false),
        })
        .catch(() => undefined);
    }
  });

  // Button «Уже смотрел(а)» -> marks watched and asks 👍 / 👎
  bot.callbackQuery(/^rec:watched:(w|r):([a-fA-F0-9]{12})$/, async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) {
      return;
    }

    const modeShort = ctx.match[1];
    const mode: RecommendationMode = modeShort === 'r' ? 'random' : 'watchlist';
    const movieId = ctx.match[2];

    const res = await recSvc.markAlreadyWatched(telegramId, movieId);
    if (!res) {
      await ctx.answerCallbackQuery({
        text: 'Фильм не найден.',
        show_alert: true,
      });
      return;
    }

    const { watchedEntry, movie } = res;
    const yearStr = movie.year ? ` (${movie.year})` : '';

    await ctx.answerCallbackQuery();

    if (ctx.callbackQuery.message) {
      await ctx
        .editMessageReplyMarkup({
          reply_markup: buildRecommendationKeyboard(movie, mode, 'watched'),
        })
        .catch(() => undefined);
    }

    await ctx.reply(
      `🎬 <b>«${escapeHtml(movie.title)}»${yearStr}</b>\nПонравился фильм?`,
      {
        parse_mode: 'HTML',
        reply_markup: buildWatchedRateKeyboard(watchedEntry.id, mode),
      }
    );
  });

  // Rating 👍 / 👎 right after «Уже смотрел(а)» -> saves rating and sends next movie
  bot.callbackQuery(/^rec:rate:(w|r):(like|dislike):([a-fA-F0-9]{12})$/, async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) {
      return;
    }

    const modeShort = ctx.match[1];
    const reaction = ctx.match[2] as ReactionType;
    const movieId = ctx.match[3];

    const outcome = await feedbackSvc.submitFeedback(telegramId, movieId, reaction);
    const emoji = reaction === 'like' ? '👍' : '👎';

    await ctx.answerCallbackQuery({ text: `Оценка ${emoji} сохранена!` });

    if (ctx.callbackQuery.message) {
      const movieTitle =
        outcome.status !== 'not_found' ? outcome.entry.title : 'Фильм';
      await ctx
        .editMessageText(
          `✅ <b>«${escapeHtml(movieTitle)}»</b> — оценено на ${emoji}`,
          { parse_mode: 'HTML' }
        )
        .catch(() => undefined);
    }

    if (modeShort === 'r') {
      await handleRandomRecommend(ctx);
    } else {
      await handleWatchlistRecommend(ctx);
    }
  });

  bot.callbackQuery(/^rec:accept:([a-fA-F0-9]{12})$/, async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) {
      return;
    }

    const movieId = ctx.match[1];
    const result = await recSvc.acceptRecommendation(telegramId, movieId);

    if (!result) {
      await ctx.answerCallbackQuery({
        text: 'Фильм не найден.',
        show_alert: true,
      });
      return;
    }

    const { selection, movie } = result;

    try {
      await queueMgr.scheduleFeedbackPrompt({
        telegramId,
        movieId: selection.id,
      });
    } catch (err) {
      logger.error(
        { err, movieId: selection.id, telegramId },
        'Failed to schedule delayed feedback job'
      );
    }

    await ctx.answerCallbackQuery({ text: 'Приятного просмотра! 🍿' });

    if (ctx.callbackQuery.message) {
      await ctx
        .editMessageReplyMarkup({
          reply_markup: buildRecommendationKeyboard(movie, 'watchlist', 'accepted'),
        })
        .catch(() => undefined);
    }

    const yearStr = movie.year ? ` (${movie.year})` : '';
    const kb = new SmartKeyboard().callback('⬅️ В меню', 'nav:menu').toMarkup();

    await ctx.reply(
      `🍿 <b>Отличный выбор!</b>\n\nВы остановились на фильме <b>«${escapeHtml(movie.title)}»${yearStr}</b>.\nПриятного просмотра! Через 2 часа я спрошу о впечатлениях.`,
      {
        parse_mode: 'HTML',
        reply_markup: kb,
      }
    );
  });
}
