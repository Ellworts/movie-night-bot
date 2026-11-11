import { Bot, Context } from 'grammy';
import { InlineKeyboardMarkup } from 'grammy/types';
import { UserSettings } from '../../models/User';
import { UserService, userService } from '../../services/user.service';
import { SmartKeyboard } from '../uiKit';
import { formatSettingsHtml } from '../formatters';

export const AVAILABLE_GENRES: string[] = [
  'ужасы',
  'драма',
  'комедия',
  'боевик',
  'триллер',
  'фантастика',
  'мелодрама',
  'мультфильм',
  'документальный',
  'криминал',
  'приключения',
  'фэнтези',
];

export function isDefaultSettings(settings: UserSettings): boolean {
  return (
    settings.excludedGenres.length === 0 &&
    settings.maxRuntime === null &&
    settings.releaseYearFrom === null &&
    settings.releaseYearTo === null &&
    settings.minRating === null &&
    settings.genreDiversity === true
  );
}

export function buildSettingsMainKeyboard(settings: UserSettings): InlineKeyboardMarkup {
  const diversityLabel = settings.genreDiversity
    ? 'Разнообразие: Вкл'
    : 'Разнообразие: Выкл';

  return new SmartKeyboard()
    .callback('🚫 Жанры', 'set:genres')
    .callback('⏱ Длительность', 'set:runtime')
    .row('center')
    .callback('📅 Годы', 'set:period')
    .callback('⭐ Рейтинг', 'set:rating')
    .row('center')
    .callback(diversityLabel, 'set:toggle_diversity')
    .callback('🔄 Сбросить', 'set:reset', {
      disabled: isDefaultSettings(settings),
    })
    .row('center')
    .callback('⬅️ В меню', 'nav:menu')
    .toMarkup();
}

export function buildGenresKeyboard(excludedGenres: string[]): InlineKeyboardMarkup {
  const kb = new SmartKeyboard();
  const excludedLower = new Set(excludedGenres.map((g) => g.toLowerCase()));

  AVAILABLE_GENRES.forEach((genre, idx) => {
    const isExcluded = excludedLower.has(genre.toLowerCase());
    const prefix = isExcluded ? '🚫 ' : '✅ ';
    kb.callback(`${prefix}${genre}`, `set:genre:${idx}`);
    if (idx % 2 === 1) {
      kb.row('center');
    }
  });

  kb.row('center')
    .callback('Разрешить все', 'set:genres_clear', {
      disabled: excludedGenres.length === 0,
    })
    .callback('⬅️ Назад', 'set:main');

  return kb.toMarkup();
}

export function buildRuntimeKeyboard(currentMaxRuntime: number | null): InlineKeyboardMarkup {
  const options: Array<{ label: string; val: number | null; code: string }> = [
    { label: 'До 90 мин.', val: 90, code: '90' },
    { label: 'До 120 мин.', val: 120, code: '120' },
    { label: 'До 150 мин.', val: 150, code: '150' },
    { label: 'До 180 мин.', val: 180, code: '180' },
  ];

  const kb = new SmartKeyboard();
  options.forEach((opt, idx) => {
    const isSelected = currentMaxRuntime === opt.val;
    kb.callback(
      isSelected ? `• ${opt.label}` : opt.label,
      `set:rt:${opt.code}`,
      { disabled: isSelected }
    );
    if (idx % 2 === 1) {
      kb.row('center');
    }
  });

  const isNone = currentMaxRuntime === null;
  kb.row('center')
    .callback(
      isNone ? '• Любая длительность' : 'Любая длительность',
      'set:rt:none',
      { disabled: isNone }
    )
    .callback('⬅️ Назад', 'set:main');

  return kb.toMarkup();
}

export function buildPeriodKeyboard(
  currentFrom: number | null,
  currentTo: number | null
): InlineKeyboardMarkup {
  const periods: Array<{
    label: string;
    from: number | null;
    to: number | null;
    code: string;
  }> = [
    { label: 'До 1980', from: null, to: 1979, code: '0:1979' },
    { label: '1980–1999', from: 1980, to: 1999, code: '1980:1999' },
    { label: '2000–2009', from: 2000, to: 2009, code: '2000:2009' },
    { label: '2010–2019', from: 2010, to: 2019, code: '2010:2019' },
    { label: 'С 2020', from: 2020, to: null, code: '2020:0' },
    { label: 'С 2000', from: 2000, to: null, code: '2000:0' },
  ];

  const kb = new SmartKeyboard();
  periods.forEach((p, idx) => {
    const isSelected = currentFrom === p.from && currentTo === p.to;
    kb.callback(
      isSelected ? `• ${p.label}` : p.label,
      `set:yr:${p.code}`,
      { disabled: isSelected }
    );
    if (idx % 2 === 1) {
      kb.row('center');
    }
  });

  const isAny = currentFrom === null && currentTo === null;
  kb.row('center')
    .callback(
      isAny ? '• Любой год' : 'Любой год',
      'set:yr:none:none',
      { disabled: isAny }
    )
    .callback('⬅️ Назад', 'set:main');

  return kb.toMarkup();
}

export function buildRatingKeyboard(currentMinRating: number | null): InlineKeyboardMarkup {
  const ratings: Array<{ label: string; val: number }> = [
    { label: '⭐ 6.0+', val: 6 },
    { label: '⭐ 6.5+', val: 6.5 },
    { label: '⭐ 7.0+', val: 7 },
    { label: '⭐ 7.5+', val: 7.5 },
    { label: '⭐ 8.0+', val: 8 },
  ];

  const kb = new SmartKeyboard();
  ratings.forEach((r, idx) => {
    const isSelected = currentMinRating === r.val;
    kb.callback(
      isSelected ? `• ${r.label}` : r.label,
      `set:rat:${r.val}`,
      { disabled: isSelected }
    );
    if (idx % 2 === 1) {
      kb.row('center');
    }
  });

  const isNone = currentMinRating === null;
  kb.callback(
    isNone ? '• Любой рейтинг' : 'Любой рейтинг',
    'set:rat:none',
    { disabled: isNone }
  )
    .row('center')
    .callback('⬅️ Назад', 'set:main');

  return kb.toMarkup();
}

export function registerSettingsHandlers(
  bot: Bot<Context>,
  usrSvc: UserService = userService
): void {
  async function renderMainSettings(ctx: Context, edit: boolean): Promise<void> {
    const telegramId = ctx.from?.id;
    if (!telegramId) {
      return;
    }

    const user = await usrSvc.findOrCreateUser({ telegramId });
    const html = formatSettingsHtml(user.settings);
    const kb = buildSettingsMainKeyboard(user.settings);

    if (edit && ctx.callbackQuery?.message) {
      await ctx
        .editMessageText(html, { parse_mode: 'HTML', reply_markup: kb })
        .catch(() => ctx.reply(html, { parse_mode: 'HTML', reply_markup: kb }));
    } else {
      await ctx.reply(html, { parse_mode: 'HTML', reply_markup: kb });
    }
  }

  bot.command('settings', async (ctx) => {
    await renderMainSettings(ctx, false);
  });

  bot.callbackQuery('set:main', async (ctx) => {
    await ctx.answerCallbackQuery();
    await renderMainSettings(ctx, true);
  });

  bot.callbackQuery('set:toggle_diversity', async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) {
      return;
    }

    const user = await usrSvc.findOrCreateUser({ telegramId });
    await usrSvc.updateSettings(telegramId, {
      genreDiversity: !user.settings.genreDiversity,
    });
    await ctx.answerCallbackQuery();
    await renderMainSettings(ctx, true);
  });

  bot.callbackQuery('set:reset', async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) {
      return;
    }

    await usrSvc.resetSettings(telegramId);
    await ctx.answerCallbackQuery({ text: 'Настройки сброшены' });
    await renderMainSettings(ctx, true);
  });

  bot.callbackQuery('set:genres', async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) {
      return;
    }

    await ctx.answerCallbackQuery();
    const user = await usrSvc.findOrCreateUser({ telegramId });
    const text =
      '🚫 <b>Жанры</b>\n\nНажмите на жанр, чтобы исключить (🚫) или разрешить (✅):';
    await ctx
      .editMessageText(text, {
        parse_mode: 'HTML',
        reply_markup: buildGenresKeyboard(user.settings.excludedGenres),
      })
      .catch(() => undefined);
  });

  bot.callbackQuery(/^set:genre:(\d+)$/, async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) {
      return;
    }

    const idx = Number(ctx.match[1]);
    const genre = AVAILABLE_GENRES[idx];
    if (!genre) {
      await ctx.answerCallbackQuery();
      return;
    }

    const updatedUser = await usrSvc.toggleExcludedGenre(telegramId, genre);
    await ctx.answerCallbackQuery();

    if (updatedUser) {
      const text =
        '🚫 <b>Жанры</b>\n\nНажмите на жанр, чтобы исключить (🚫) или разрешить (✅):';
      await ctx
        .editMessageText(text, {
          parse_mode: 'HTML',
          reply_markup: buildGenresKeyboard(updatedUser.settings.excludedGenres),
        })
        .catch(() => undefined);
    }
  });

  bot.callbackQuery('set:genres_clear', async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) {
      return;
    }

    const updatedUser = await usrSvc.updateSettings(telegramId, { excludedGenres: [] });
    await ctx.answerCallbackQuery({ text: 'Все жанры разрешены' });

    if (updatedUser) {
      const text =
        '🚫 <b>Жанры</b>\n\nНажмите на жанр, чтобы исключить (🚫) или разрешить (✅):';
      await ctx
        .editMessageText(text, {
          parse_mode: 'HTML',
          reply_markup: buildGenresKeyboard(updatedUser.settings.excludedGenres),
        })
        .catch(() => undefined);
    }
  });

  bot.callbackQuery('set:runtime', async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) {
      return;
    }
    await ctx.answerCallbackQuery();
    const user = await usrSvc.findOrCreateUser({ telegramId });
    await ctx
      .editMessageText('⏱ <b>Максимальная длительность фильма:</b>', {
        parse_mode: 'HTML',
        reply_markup: buildRuntimeKeyboard(user.settings.maxRuntime),
      })
      .catch(() => undefined);
  });

  bot.callbackQuery(/^set:rt:(90|120|150|180|none)$/, async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) {
      return;
    }

    const raw = ctx.match[1];
    const maxRuntime = raw === 'none' ? null : Number(raw);
    await usrSvc.updateSettings(telegramId, { maxRuntime });
    await ctx.answerCallbackQuery();
    await renderMainSettings(ctx, true);
  });

  bot.callbackQuery('set:period', async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) {
      return;
    }
    await ctx.answerCallbackQuery();
    const user = await usrSvc.findOrCreateUser({ telegramId });
    await ctx
      .editMessageText('📅 <b>Годы выпуска:</b>', {
        parse_mode: 'HTML',
        reply_markup: buildPeriodKeyboard(
          user.settings.releaseYearFrom,
          user.settings.releaseYearTo
        ),
      })
      .catch(() => undefined);
  });

  bot.callbackQuery(/^set:yr:(\d+|none):(\d+|none)$/, async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) {
      return;
    }

    const rawFrom = ctx.match[1];
    const rawTo = ctx.match[2];

    const releaseYearFrom =
      rawFrom === 'none' || rawFrom === '0' ? null : Number(rawFrom);
    const releaseYearTo =
      rawTo === 'none' || rawTo === '0' ? null : Number(rawTo);

    await usrSvc.updateSettings(telegramId, { releaseYearFrom, releaseYearTo });
    await ctx.answerCallbackQuery();
    await renderMainSettings(ctx, true);
  });

  bot.callbackQuery('set:rating', async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) {
      return;
    }
    await ctx.answerCallbackQuery();
    const user = await usrSvc.findOrCreateUser({ telegramId });
    await ctx
      .editMessageText('⭐ <b>Минимальный рейтинг (TMDB):</b>', {
        parse_mode: 'HTML',
        reply_markup: buildRatingKeyboard(user.settings.minRating),
      })
      .catch(() => undefined);
  });

  bot.callbackQuery(/^set:rat:(6|6\.5|7|7\.5|8|none)$/, async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) {
      return;
    }

    const raw = ctx.match[1];
    const minRating = raw === 'none' ? null : Number(raw);
    await usrSvc.updateSettings(telegramId, { minRating });
    await ctx.answerCallbackQuery();
    await renderMainSettings(ctx, true);
  });
}
