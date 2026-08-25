import type { Sql } from '../db/client.ts';
import { listOffersToRead, saveCostReading } from '../db/cost-readings.ts';
import { READING_BUDGET_PLN } from '../domain/classify.ts';
import { PROMPT_VERSION } from '../domain/cost-reading.ts';
import { readCostFromDescription } from '../model/read-cost.ts';
import { describeTarget, ModelError, modelTarget } from '../model/client.ts';
import { assertModelAvailable } from '../model/transport.ts';

/** Enough for a round's worth of new listings; a backfill passes its own number. */
const DEFAULT_LIMIT = 200;

/** Said out loud every so often, because a thousand listings is the better part of an hour. */
const PROGRESS_EVERY = 25;

export interface ReadCostsResult {
  read: number;
  failed: number;
}

/**
 * Reads the costs out of descriptions the model has not seen yet.
 *
 * Local only: this is the one command that needs a model running, and the cloud round
 * does not call it. A listing without a reading is not broken, it is priced by the rules
 * in classify.ts alone, so this catching up hours later costs nothing but accuracy in
 * the meantime.
 *
 * Deliberately not one transaction. Each listing is seconds of a graphics card, and
 * holding a connection open across a thousand of them would keep a pooled connection
 * busy for an hour to save writes that are cheap anyway. Committing as it goes also means
 * a run interrupted halfway keeps everything it read.
 */
export async function readCosts(sql: Sql, limit = DEFAULT_LIMIT): Promise<ReadCostsResult> {
  const target = modelTarget();
  if (target === null) {
    throw new ModelError(
      'No model is configured. Set LLM_API_KEY, LLM_BASE_URL and LLM_MODEL for a hosted ' +
        'one, or OLLAMA_MODEL for a local one. See .env.example.',
    );
  }
  await assertModelAvailable(target);

  const pending = await listOffersToRead(
    sql,
    target.model,
    PROMPT_VERSION,
    limit,
    READING_BUDGET_PLN,
  );
  if (pending.length === 0) {
    console.log('Every description has a current reading.');
    return { read: 0, failed: 0 };
  }

  console.log(`Reading ${String(pending.length)} description(s) with ${describeTarget(target)}.`);
  let read = 0;
  let failed = 0;
  let first = true;

  for (const offer of pending) {
    // Between requests rather than after them, so the last listing does not pay for a
    // wait nothing follows. Zero for a local model, which has no quota to respect.
    if (!first && target.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, target.delayMs));
    }
    first = false;

    try {
      const { reading, raw } = await readCostFromDescription(target, offer);
      await saveCostReading(sql, offer.id, reading, raw, target.model, PROMPT_VERSION);
      read++;
    } catch (error) {
      // One description the model chokes on must not cost the run the other nine hundred.
      // A server that has gone away, or a key that is refused, is different: every listing
      // after it fails the same way, so those stop the run rather than logging nine
      // hundred times and finishing with nothing read.
      const fatal =
        error instanceof ModelError &&
        (error.message.includes('No model server') ||
          error.message.includes('answered 401') ||
          error.message.includes('answered 403') ||
          error.message.includes('answered 404'));
      if (fatal) throw error;

      failed++;
      if (failed <= 3) console.warn(`Listing ${offer.id} unreadable: ${String(error)}`);
    }

    if ((read + failed) % PROGRESS_EVERY === 0) {
      console.log(`  ${read + failed}/${pending.length} done.`);
    }
  }

  console.log(`Read ${read} description(s) under prompt v${PROMPT_VERSION}, ${failed} failed.`);
  return { read, failed };
}
