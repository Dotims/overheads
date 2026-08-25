import { backfillPhotos } from './commands/backfill-photos.ts';
import { classifyOffers } from './commands/classify.ts';
import { collectAll } from './commands/collect.ts';
import { collectGratka } from './commands/collect-gratka.ts';
import { collectOlx } from './commands/collect-olx.ts';
import { collectOtodom, type CollectOtodomOptions } from './commands/collect-otodom.ts';
import { dedupeOffers } from './commands/dedupe.ts';
import { notifyNewOffers, seedNotifications } from './commands/notify.ts';
import { readCosts } from './commands/read-costs.ts';
import { config } from './config.ts';
import { openDatabase, type Sql } from './db/client.ts';
import type { NotifyFilters } from './domain/notify-filters.ts';
import { migrate } from './db/migrate.ts';
import { startServer } from './server.ts';

/**
 * Every command is started from here, and nowhere else runs anything on import.
 *
 * Each command used to end with `if (process.argv[1] === import.meta.filename)`, which
 * holds only while every module is its own file. A bundler puts them all in one file,
 * the comparison starts coming out true for all of them at once, and importing the API
 * handlers ran a migration and a collection round before the request had been read. That
 * is what made every Vercel function that touches the collector die on invocation.
 */

/** A count from the command line. Absent or unreadable means the command's own default. */
function count(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

/** The notification bounds in one line, so a round says what it was working under. */
function describeFilters(filters: NotifyFilters): string {
  const parts = [
    filters.minCostPln === null ? null : `cost from ${filters.minCostPln}`,
    filters.maxCostPln === null ? null : `cost to ${filters.maxCostPln}`,
    filters.minAreaM2 === null ? null : `from ${filters.minAreaM2} m2`,
    filters.maxAreaM2 === null ? null : `to ${filters.maxAreaM2} m2`,
    filters.minRooms === null ? null : `from ${filters.minRooms} rooms`,
    filters.maxRooms === null ? null : `to ${filters.maxRooms} rooms`,
    filters.privateOnly ? 'private only' : null,
    filters.hiddenDistricts.length === 0
      ? null
      : `${filters.hiddenDistricts.length} district(s) hidden`,
  ].filter((part) => part !== null);

  return parts.length === 0 ? 'none, everything in budget is announced' : parts.join(', ');
}

/** The shape every command but the server takes: connect, migrate, work, disconnect. */
async function withDatabase(work: (sql: Sql) => Promise<unknown>): Promise<void> {
  const sql = openDatabase();
  try {
    await migrate(sql);
    await work(sql);
  } finally {
    await sql.end();
  }
}

const COMMANDS: Record<string, (args: string[]) => Promise<void>> = {
  migrate: async () => {
    const sql = openDatabase();
    try {
      const applied = await migrate(sql);
      console.log(
        applied.length === 0
          ? 'Database up to date, no migrations to apply.'
          : `Applied migrations: ${applied.join(', ')}`,
      );
    } finally {
      await sql.end();
    }
  },

  collect: () => collectAll(),

  'collect:olx': (args) => withDatabase((sql) => collectOlx(sql, count(args[0]) ?? 2)),

  // The backfill form. OLX stops paging at a thousand results per search, so reaching the
  // rest means asking band by band; see RENT_BANDS in commands/collect-olx.ts.
  'collect:olx:bands': (args) => withDatabase((sql) => collectOlx(sql, count(args[0]) ?? 20, true)),

  'collect:gratka': (args) => withDatabase((sql) => collectGratka(sql, count(args[0]) ?? 2)),

  'collect:otodom': (args) => {
    // Built up rather than passed as undefined: exactOptionalPropertyTypes means an
    // absent option and an option set to undefined are not the same thing.
    const options: CollectOtodomOptions = {};
    const pages = count(args[0]);
    const maxDetails = count(args[1]);
    if (pages !== undefined) options.pages = pages;
    if (maxDetails !== undefined) options.maxDetails = maxDetails;

    return withDatabase((sql) => collectOtodom(sql, options));
  },

  classify: () => withDatabase((sql) => classifyOffers(sql)),

  // Needs a model running, so it is never part of `collect`. See commands/read-costs.ts.
  'read:costs': (args) =>
    withDatabase(async (sql) => {
      await readCosts(sql, count(args[0]));
      // The verdicts were computed without these readings, so they are stale by definition.
      await classifyOffers(sql);
    }),

  dedupe: () =>
    withDatabase(async (sql) => {
      const { pairs, hidden } = await dedupeOffers(sql);
      console.log(`Matched ${pairs} pairs, hid ${hidden} listings.`);
    }),

  notify: () =>
    withDatabase(async (sql) => {
      const credentials = config.telegram();
      if (credentials === null) {
        throw new Error('TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are not set. Put them in .env.');
      }

      // Said out loud before the send: a bound that is not doing what the owner thinks
      // shows up as an empty round, which looks exactly like a quiet afternoon.
      const filters = config.notifyFilters();
      console.log(`Bounds: ${describeFilters(filters)}`);

      const sent = await notifyNewOffers(sql, credentials, filters);
      console.log(
        sent === 0 ? 'Nothing in budget left to announce.' : `Announced ${sent} listing(s).`,
      );
    }),

  // Run once, when the bot is first connected. See seedNotifications.
  'notify:seed': () =>
    withDatabase(async (sql) => {
      const marked = await seedNotifications(sql);
      console.log(`Recorded ${marked} listing(s) as already announced. Nothing was sent.`);
    }),

  'backfill:photos': () =>
    withDatabase(async (sql) => {
      const { read, filled } = await backfillPhotos(sql);
      console.log(`Read ${read} listings without photographs, filled ${filled}.`);
    }),

  serve: async () => {
    await startServer();
  },
};

const [name, ...args] = process.argv.slice(2);
const command = name === undefined ? undefined : COMMANDS[name];

if (command === undefined) {
  console.error(`Usage: node src/cli.ts <${Object.keys(COMMANDS).join(' | ')}> [args]`);
  process.exitCode = 1;
} else {
  await command(args);
}
