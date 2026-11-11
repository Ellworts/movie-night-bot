# Movie Night Bot 🍿

Публичный multi-user Telegram-бот для подбора фильмов из личного **Letterboxd Watchlist** с метаданными из **TMDB API** и отложенными уведомлениями через **BullMQ + Redis**.

## Стек технологий

- **TypeScript + Node.js** — строгая типизация и модульная архитектура
- **grammY** — Telegram Bot API фреймворк
- **MongoDB Atlas + Mongoose** — хранение пользователей, фильмов, Watchlist, истории и оценок
- **TMDB API** — постеры, YouTube-трейлеры, жанры, хронометраж, рейтинг и описания (с кэшированием в БД)
- **BullMQ + Redis** — персистентная очередь отложенных задач (вопрос о впечатлениях через 2 часа после выбора фильма)
- **Jest** — unit и integration тестирование

## Быстрый старт

### 1. Установка зависимостей

```bash
npm install
```

### 2. Настройка переменных окружения

Скопируйте `.env.example` в `.env` и заполните значения:

```bash
cp .env.example .env
```

- `BOT_TOKEN` — токен Telegram-бота от `@BotFather`
- `MONGODB_URI` — строка подключения к MongoDB Atlas (или локальной MongoDB)
- `REDIS_URL` — адрес Redis для очередей BullMQ (по умолчанию `redis://127.0.0.1:6379`)
- `TMDB_API_KEY` — API-ключ TMDB (v3 API Key или v4 Read Access Token)
- `TMDB_LANGUAGE` — язык метаданных TMDB (по умолчанию `ru-RU`)
- `FEEDBACK_DELAY_MS` — задержка перед отправкой вопроса о просмотре (по умолчанию `7200000` мс = 2 часа)

### 3. Запуск

Режим разработки:

```bash
npm run dev
```

Сборка и продакшн-запуск:

```bash
npm run build
npm start
```

### 4. Тестирование и проверка типов

```bash
npm run lint
npm test
```

## Команды бота

- `/start` — Регистрация и главное меню
- `/recommend` — Случайный фильм из вашего Watchlist с учётом настроек
- `/settings` — Настройка исключённых жанров, макс. хронометража, периода выпуска, мин. рейтинга и разнообразия жанров
- `/history` — Личная история (Предложенные, Выбранные, Просмотренные, Понравившиеся, Не понравившиеся) с датами событий
- `/pending` — Список выбранных, но ещё не оценённых фильмов (если пропустили уведомление)
- `/import` — Инструкция по загрузке `watchlist.csv` из Letterboxd
- `/about` — О проекте и атрибуция TMDB

---

*This product uses the TMDB API but is not endorsed or certified by TMDB.*

