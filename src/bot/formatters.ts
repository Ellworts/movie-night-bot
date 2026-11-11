import { UserSettings } from '../models/User';
import { MovieCardData } from '../services/tmdb.service';
import {
  HistoryCategory,
  HistoryPageResult,
  HistoryRecordItem,
  UserHistorySummary,
  WatchlistPageResult,
} from '../services/history.service';
import { RateableMovieView } from '../services/feedback.service';

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildLetterboxdUrl(item: {
  title: string;
  originalTitle?: string | null;
  year: number | null;
  letterboxdUri: string | null;
  tmdbId: number | null;
}): string {
  return (
    item.letterboxdUri ||
    (item.tmdbId
      ? `https://letterboxd.com/tmdb/${item.tmdbId}`
      : `https://letterboxd.com/search/${encodeURIComponent(
          `${item.originalTitle || item.title}${item.year ? ` ${item.year}` : ''}`
        )}/`)
  );
}

export function formatMovieCardHtml(
  movie: MovieCardData,
  includeTrailerLink: boolean = true
): string {
  const titleLine = movie.year
    ? `🎬 <b>${escapeHtml(movie.title)}</b> (${movie.year})`
    : `🎬 <b>${escapeHtml(movie.title)}</b>`;

  const lines: string[] = [titleLine];

  const metaParts: string[] = [];
  if (movie.genres && movie.genres.length > 0) {
    metaParts.push(`🎭 ${escapeHtml(movie.genres.join(', '))}`);
  }
  if (movie.runtime) {
    metaParts.push(`⏱ ${movie.runtime} мин.`);
  }
  if (movie.tmdbRating) {
    metaParts.push(`⭐ ${movie.tmdbRating}/10`);
  }

  if (metaParts.length > 0) {
    lines.push(metaParts.join(' • '));
  }

  if (movie.overview) {
    const maxOverviewLen = includeTrailerLink ? 550 : 650;
    const truncated =
      movie.overview.length > maxOverviewLen
        ? `${movie.overview.slice(0, maxOverviewLen).trim()}…`
        : movie.overview;
    lines.push(`\n${escapeHtml(truncated)}`);
  } else if (movie.tmdbStatus !== 'matched') {
    lines.push('\n<i>Описание из TMDB недоступно.</i>');
  }

  const links: string[] = [];
  if (includeTrailerLink && movie.trailerUrl) {
    links.push(`▶️ <a href="${escapeHtml(movie.trailerUrl)}">Трейлер</a>`);
  }

  const letterboxdUrl = buildLetterboxdUrl(movie);
  links.push(`🔗 <a href="${escapeHtml(letterboxdUrl)}">Letterboxd</a>`);
  lines.push(`\n${links.join('  •  ')}`);

  return lines.join('\n');
}

export function formatSettingsHtml(settings: UserSettings): string {
  const excluded =
    settings.excludedGenres.length > 0
      ? escapeHtml(settings.excludedGenres.join(', '))
      : 'Нет';
  const runtime = settings.maxRuntime ? `до ${settings.maxRuntime} мин.` : 'Любой';

  let period = 'Любой';
  if (settings.releaseYearFrom && settings.releaseYearTo) {
    period = `${settings.releaseYearFrom}–${settings.releaseYearTo}`;
  } else if (settings.releaseYearFrom) {
    period = `с ${settings.releaseYearFrom} г.`;
  } else if (settings.releaseYearTo) {
    period = `до ${settings.releaseYearTo} г.`;
  }

  const rating = settings.minRating ? `от ${settings.minRating}/10` : 'Любой';
  const diversity = settings.genreDiversity ? 'Вкл' : 'Выкл';
  const watchedDate = settings.showWatchedDate ? 'Вкл' : 'Выкл';

  return [
    '⚙️ <b>Настройки подбора</b>\n',
    `🚫 <b>Исключённые жанры:</b> ${excluded}`,
    `⏱ <b>Длительность:</b> ${runtime}`,
    `📅 <b>Годы выпуска:</b> ${period}`,
    `⭐ <b>Мин. рейтинг:</b> ${rating}`,
    `🎲 <b>Разнообразие жанров:</b> ${diversity}`,
    `📆 <b>Дата просмотра в истории:</b> ${watchedDate}`,
  ].join('\n');
}

const HISTORY_TITLES: Record<HistoryCategory, string> = {
  selected: '🎯 Выбранные фильмы',
  watched: '✅ Просмотренные фильмы',
  liked: '👍 Понравившиеся фильмы',
  disliked: '👎 Не понравившиеся фильмы',
};

export function formatHistoryDate(date: Date): string {
  const d = new Date(date);
  const day = String(d.getUTCDate()).padStart(2, '0');
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const year = d.getUTCFullYear();
  return `${day}.${month}.${year}`;
}

export function formatHistorySummaryHtml(summary: UserHistorySummary): string {
  return [
    '📚 <b>Ваша история</b>\n',
    `🎞 В Watchlist: <b>${summary.watchlistCount}</b>`,
    `🎯 Выбрано на вечер: <b>${summary.selectedCount}</b>`,
    `✅ Просмотрено: <b>${summary.watchedCount}</b> (👍 <b>${summary.likedCount}</b> / 👎 <b>${summary.dislikedCount}</b> • без оценки: <b>${summary.unratedCount}</b>)`,
  ].join('\n');
}

export function formatHistoryPageHtml(pageData: HistoryPageResult): string {
  const title = HISTORY_TITLES[pageData.type];
  if (pageData.totalCount === 0 || pageData.items.length === 0) {
    return `<b>${title}</b>\n\n<i>Пока пусто.</i>`;
  }

  const startIndex = (pageData.page - 1) * pageData.pageSize;
  const header = `<b>${title}</b> (стр. ${pageData.page} из ${pageData.totalPages}, всего: ${pageData.totalCount})\n`;

  const lines = pageData.items.map((item, idx) => {
    const num = startIndex + idx + 1;
    const yearStr = item.year ? ` (${item.year})` : '';
    const url = buildLetterboxdUrl(item);
    const titleLink = `<a href="${escapeHtml(url)}"><b>${escapeHtml(item.title)}</b></a>`;

    let ratingPrefix = '';
    if (pageData.type === 'watched' && item.reaction) {
      ratingPrefix = item.reaction === 'like' ? '👍 ' : '👎 ';
    }

    const dateSuffix = pageData.showWatchedDate
      ? ` — <i>${formatHistoryDate(item.eventDate)}</i>`
      : '';

    return `${num}. ${ratingPrefix}${titleLink}${yearStr}${dateSuffix}`;
  });

  return `${header}\n${lines.join('\n')}`;
}

export function formatHistoryListHtml(
  type: HistoryCategory,
  items: HistoryRecordItem[],
  showWatchedDate: boolean = false
): string {
  return formatHistoryPageHtml({
    type,
    items,
    totalCount: items.length,
    page: 1,
    totalPages: 1,
    pageSize: Math.max(15, items.length),
    showWatchedDate,
  });
}

export function formatWatchlistPageHtml(pageData: WatchlistPageResult): string {
  if (pageData.totalCount === 0 || pageData.items.length === 0) {
    return '🎞 <b>Ваш Watchlist</b>\n\n<i>Ваш список пока пуст.</i>';
  }

  const startIndex = (pageData.page - 1) * pageData.pageSize;
  const header = `🎞 <b>Ваш Watchlist</b> (стр. ${pageData.page} из ${pageData.totalPages}, всего: ${pageData.totalCount})\n`;

  const lines = pageData.items.map((movie, idx) => {
    const num = startIndex + idx + 1;
    const yearStr = movie.year ? ` (${movie.year})` : '';
    const url = buildLetterboxdUrl(movie);
    return `${num}. <a href="${escapeHtml(url)}"><b>${escapeHtml(movie.title)}</b></a>${yearStr}`;
  });

  return `${header}\n${lines.join('\n')}`;
}

export function formatRateableMovieHtml(view: RateableMovieView): string {
  const { entry, index, totalCount } = view;
  const yearStr = entry.year ? ` (${entry.year})` : '';
  const letterboxdUrl = buildLetterboxdUrl(entry);

  return [
    `⭐ <b>Фильмы без оценки</b> (${index + 1} из ${totalCount})\n`,
    `🎬 <a href="${escapeHtml(letterboxdUrl)}"><b>${escapeHtml(entry.title)}</b></a>${yearStr}`,
    `\nОцените просмотренный фильм:`,
  ].join('\n');
}
