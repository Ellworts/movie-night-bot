import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  BOT_TOKEN: z.string().min(1, 'BOT_TOKEN is required'),
  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
  REDIS_URL: z.string().optional().default(''),
  TMDB_API_KEY: z.string().min(1, 'TMDB_API_KEY is required'),
  TMDB_LANGUAGE: z.string().default('ru-RU'),
  FEEDBACK_DELAY_MS: z.coerce.number().int().positive().default(2 * 60 * 60 * 1000), // 2 hours
  PORT: z.coerce.number().int().positive().default(3000),
  PUBLIC_URL: z.string().optional().default(''),
  RENDER_EXTERNAL_URL: z.string().optional().default(''),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

export type EnvConfig = z.infer<typeof envSchema>;

export function loadEnv(overrides?: Partial<Record<keyof EnvConfig, string>>): EnvConfig {
  const raw = {
    ...process.env,
    ...overrides,
  };
  return envSchema.parse(raw);
}

export const env: EnvConfig =
  process.env.NODE_ENV === 'test'
    ? {
        BOT_TOKEN: process.env.BOT_TOKEN || 'test-bot-token',
        MONGODB_URI: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/movie-night-test',
        REDIS_URL: process.env.REDIS_URL || '',
        TMDB_API_KEY: process.env.TMDB_API_KEY || 'test-tmdb-key',
        TMDB_LANGUAGE: process.env.TMDB_LANGUAGE || 'ru-RU',
        FEEDBACK_DELAY_MS: Number(process.env.FEEDBACK_DELAY_MS) || 7200000,
        PORT: Number(process.env.PORT) || 3000,
        PUBLIC_URL: process.env.PUBLIC_URL || '',
        RENDER_EXTERNAL_URL: process.env.RENDER_EXTERNAL_URL || '',
        LOG_LEVEL: 'silent',
        NODE_ENV: 'test',
      }
    : loadEnv();
