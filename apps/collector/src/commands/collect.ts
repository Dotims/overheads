import { config } from '../config.ts';
import { openDatabase } from '../db/client.ts';
import { migrate } from '../db/migrate.ts';
import { classifyOffers } from './classify.ts';
import { collectGratka } from './collect-gratka.ts';
import { collectOlx } from './collect-olx.ts';
import { collectOtodom } from './collect-otodom.ts';
import { dedupeOffers } from './dedupe.ts';
import { notifyNewOffers } from './notify.ts';
import { readCosts } from './read-costs.ts';

const COLLECTORS = { olx: collectOlx, otodom: collectOtodom, gratka: collectGratka } as const;
type SourceName = keyof typeof COLLECTORS;

/**
 * How many listings a round will put past the model.
 *
 * A cap rather than a target: a round brings about twenty new listings and only the ones
 * within reach of the budget are queued, so the real number is nearer seven. It exists so
 * that a round which finds a backlog - the first one after the schedule was down, say -
 * cannot spend an hour on it, or spend a whole day's worth of a free tier in one go.
 * Clearing a real backlog is a job for `read:costs` against a local model.
 */
const PER_ROUND_READINGS = 15;

/**
 * Which portals this round asks for. Unset means both, which is what the cloud schedule
 * now runs: OLX refused a datacenter address for a week and answers one again since
 * 2026-08-16, so the split that kept OLX on a home machine is a standby rather than the
 * arrangement. See the note in .github/workflows/collect.yml.
 */
function requestedSources(): SourceName[] {
  // Both names, because the old one is set in an installed systemd unit and in the
  // scheduled workflow. The unit sets it to olx alone, and losing it there would have a
  // standby round collecting Otodom in parallel with the cloud one.
  const raw = process.env.OVERHEADS_SOURCES ?? process.env.FLATRADAR_SOURCES;
  if (raw === undefined || raw.trim() === '') return ['olx', 'otodom'];

  return raw.split(',').map((name) => {
    const source = name.trim().toLowerCase();
    if (source in COLLECTORS) return source as SourceName;
    throw new Error(`Unknown source "${source}" in OVERHEADS_SOURCES.`);
  });
}

/** One full round: the requested portals, then the verdicts. */
export async function collectAll(): Promise<void> {
  const sql = openDatabase();
  const failures: string[] = [];

  try {
    await migrate(sql);

    for (const name of requestedSources()) {
      try {
        await COLLECTORS[name](sql);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        console.error(`${name} failed: ${reason}`);
        failures.push(name);
      }
    }

    // Before the verdicts, so a listing collected this round is priced on what its
    // description says rather than on the 400 PLN assumption, and Telegram announces the
    // figure the dashboard will show rather than one that changes under it an hour later.
    //
    // Best effort on purpose. There may be no model configured at all, the free tier may
    // be spent, and neither is a reason to lose a round of collecting: a listing without a
    // reading is priced by the rules, which is what this project did before any model.
    try {
      await readCosts(sql, PER_ROUND_READINGS);
    } catch (error) {
      console.warn(
        `cost reading skipped: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // Local, so both run even when fetching failed.
    await classifyOffers(sql);
    await dedupeOffers(sql);

    // Last, and after deduplication in particular: the same flat advertised on both
    // portals is one flat, and the owner should hear about it once.
    const credentials = config.telegram();
    if (credentials !== null) {
      try {
        const sent = await notifyNewOffers(sql, credentials, config.notifyFilters());
        if (sent > 0) console.log(`Announced ${sent} listing(s) on Telegram.`);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        console.error(`telegram failed: ${reason}`);
        failures.push('telegram');
      }
    }
  } finally {
    await sql.end();
  }

  // Non-zero exit, so a half-working round is not reported as a success.
  if (failures.length > 0) {
    throw new Error(`Collection failed for: ${failures.join(', ')}.`);
  }
}
