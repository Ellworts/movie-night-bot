import { Bot, Context } from 'grammy';
import { InlineKeyboardMarkup } from 'grammy/types';
import { SmartKeyboard } from '../uiKit';

export const TMDB_ATTRIBUTION_TEXT =
  'This product uses the TMDB API but is not endorsed or certified by TMDB.';

export function buildMainMenuKeyboard(): InlineKeyboardMarkup {
  return new SmartKeyboard()
    .callback('📋 Из Watchlist', 'rec:next')
    .callback('🎲 Случайный', 'rec:random')
    .row('center')
    .callback('⚙️ Настройки', 'set:main')
    .callback('📚 История', 'hist:summary')
    .row('center')
    .callback('📥 Импорт CSV', 'cmd:import_help')
    .toMarkup();
}

export function buildMainMenuText(firstName?: string): string {
  const greeting = firstName ? `, ${firstName}` : '';
  return [
    `🍿 <b>Movie Night Bot</b>`,
    `Привет${greeting}! Выбери режим подбора фильма или открой нужный раздел:`,
  ].join('\n\n');
}

export function registerStartHandlers(bot: Bot<Context>): void {
  bot.command('start', async (ctx) => {
    await ctx.reply(buildMainMenuText(ctx.from?.first_name), {
      parse_mode: 'HTML',
      reply_markup: buildMainMenuKeyboard(),
    });
  });

  bot.callbackQuery('nav:menu', async (ctx) => {
    await ctx.answerCallbackQuery();
    const text = buildMainMenuText(ctx.from?.first_name);
    const kb = buildMainMenuKeyboard();

    if (ctx.callbackQuery.message && 'text' in ctx.callbackQuery.message) {
      await ctx
        .editMessageText(text, { parse_mode: 'HTML', reply_markup: kb })
        .catch(() => ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb }));
    } else {
      await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
    }
  });

  bot.command('help', async (ctx) => {
    const text = [
      '📖 <b>Команды:</b>',
      '',
      '/recommend — Фильм из вашего Watchlist',
      '/random — Случайный фильм (TMDB)',
      '/settings — Настройки фильтров',
      '/history — История и оценки',
      '/import — Импорт CSV из Letterboxd',
      '/about — О боте',
    ].join('\n');

    const kb = new SmartKeyboard().callback('⬅️ В меню', 'nav:menu').toMarkup();
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
  });

  bot.command('about', async (ctx) => {
    const text = [
      '🎬 <b>Movie Night Bot</b>',
      '',
      'Подбор фильмов из Letterboxd Watchlist и случайный поиск по фильтрам.',
      '',
      `<i>${TMDB_ATTRIBUTION_TEXT}</i>`,
    ].join('\n');

    const kb = new SmartKeyboard().callback('⬅️ В меню', 'nav:menu').toMarkup();
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
  });
}
