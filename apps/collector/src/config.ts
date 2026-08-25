import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readNotifyFilters } from './domain/notify-filters.ts';
import type { TelegramCredentials } from './notify/telegram.ts';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Read from .env via `node --env-file`, or from the environment in CI and on Vercel. */
function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL is not set. Put the Postgres connection string in .env.');
  }
  return url;
}

/**
 * Both halves or nothing. Absent is not an error: the same collector runs in GitHub
 * Actions, where there is no bot configured and a round is expected to stay quiet, and
 * failing there would turn "nothing to announce" into a red build every fifteen minutes.
 */
function telegram(): TelegramCredentials | null {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (botToken === undefined || botToken === '') return null;
  if (chatId === undefined || chatId === '') return null;

  return { botToken, chatId };
}

export const config = {
  databaseUrl,
  telegram,
  notifyFilters: () => readNotifyFilters(process.env),
  migrationsDir: resolve(packageRoot, 'src/db/migrations'),
} as const;
