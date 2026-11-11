import { Bot, Context } from 'grammy';
import { ReactionType } from '../../models/User';
import { FeedbackService, feedbackService } from '../../services/feedback.service';
import { buildFeedbackKeyboard } from '../../queues/feedback.queue';
import { escapeHtml } from '../formatters';

export function registerFeedbackHandlers(
  bot: Bot<Context>,
  feedbackSvc: FeedbackService = feedbackService
): void {
  bot.callbackQuery(/^fb:(like|dislike):([a-fA-F0-9]{12})$/, async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) {
      return;
    }

    const reaction = ctx.match[1] as ReactionType;
    const movieId = ctx.match[2];

    const outcome = await feedbackSvc.submitFeedback(telegramId, movieId, reaction);

    if (outcome.status === 'not_found') {
      await ctx.answerCallbackQuery({
        text: 'Запись о выборе фильма не найдена.',
        show_alert: true,
      });
      return;
    }

    const movieTitle = outcome.entry.title || 'Фильм';
    const yearSuffix = outcome.entry.year ? ` (${outcome.entry.year})` : '';

    if (outcome.status === 'already_answered') {
      const existingReaction = outcome.entry.reaction || reaction;
      const existingReactionLabel =
        existingReaction === 'like' ? '👍 Понравился' : '👎 Не понравился';
      await ctx.answerCallbackQuery({
        text: `Оценка уже сохранена: ${existingReactionLabel}`,
      });
      if (ctx.callbackQuery.message) {
        await ctx
          .editMessageText(
            `🎬 Фильм <b>«${escapeHtml(movieTitle)}»${yearSuffix}</b> уже отмечен как просмотренный.\nВаша оценка: <b>${existingReactionLabel}</b>`,
            {
              parse_mode: 'HTML',
              reply_markup: buildFeedbackKeyboard(movieId, existingReaction),
            }
          )
          .catch(() => undefined);
      }
      return;
    }

    const reactionLabel = reaction === 'like' ? '👍 Понравился' : '👎 Не понравился';
    await ctx.answerCallbackQuery({
      text: 'Спасибо! Ваша оценка сохранена.',
    });

    if (ctx.callbackQuery.message) {
      await ctx
        .editMessageText(
          `✅ <b>Отмечено как просмотренное!</b>\n\n🎬 Фильм: <b>«${escapeHtml(movieTitle)}»${yearSuffix}</b>\nВаша оценка: <b>${reactionLabel}</b>`,
          {
            parse_mode: 'HTML',
            reply_markup: buildFeedbackKeyboard(movieId, reaction),
          }
        )
        .catch(() => undefined);
    } else {
      await ctx.reply(
        `✅ Фильм <b>«${escapeHtml(movieTitle)}»${yearSuffix}</b> отмечен как просмотренный (${reactionLabel}).`,
        {
          parse_mode: 'HTML',
          reply_markup: buildFeedbackKeyboard(movieId, reaction),
        }
      );
    }
  });

  // Command to view and rate previously selected movies if a notification was missed
  bot.command('pending', async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) {
      return;
    }

    const pendingItems = await feedbackSvc.getPendingSelections(telegramId, 5);
    if (pendingItems.length === 0) {
      await ctx.reply(
        '✨ У вас нет выбранных фильмов, ожидающих оценки. Все выбранные фильмы уже оценены!'
      );
      return;
    }

    await ctx.reply(
      `⏳ <b>Фильмы, которые вы выбирали, но ещё не оценили (${pendingItems.length}):</b>`,
      { parse_mode: 'HTML' }
    );

    for (const item of pendingItems) {
      const yearStr = item.year ? ` (${item.year})` : '';
      await ctx.reply(
        `🎬 <b>«${escapeHtml(item.title)}»${yearStr}</b>\nНу что? Понравился фильм?`,
        {
          parse_mode: 'HTML',
          reply_markup: buildFeedbackKeyboard(item.id),
        }
      );
    }
  });
}
