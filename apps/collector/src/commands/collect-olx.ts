import type { Sql } from '../db/client.ts';
import { upsertOffer } from '../db/offers.ts';
import { finishRun, startRun } from '../db/runs.ts';
import { fetchOlxOffers, PAGINATION_CAP } from '../sources/olx/client.ts';
import { parseOlxOffer } from '../sources/olx/parse.ts';
import { sleep } from '../sources/http.ts';
import type { OlxOffer } from '../sources/olx/types.ts';

/**
 * Rent bands, in PLN, for the deep sweep only.
 *
 * OLX stops paging at a thousand results per search whatever it says the total is, so the
 * newest-first sweep the schedule runs can never reach the older two thirds of the
 * market. Asking band by band is the same public search with a narrower question, and
 * each band comes back small enough to read to the end.
 *
 * They stop at 3500 because the dashboard does: above that a listing is out of reach and
 * the API would not send it anyway. Boundaries are close together where the market is
 * dense, and a band that still comes back at the cap says so in the log rather than
 * quietly losing its tail.
 */
const RENT_BANDS: [number | undefined, number | undefined][] = [
  [undefined, 1_500],
  [1_500, 1_800],
  [1_800, 2_000],
  [2_000, 2_200],
  [2_200, 2_400],
  [2_400, 2_600],
  [2_600, 2_900],
  [2_900, 3_200],
  [3_200, 3_500],
];

/** Between bands: this is nine searches rather than one, and the service is not ours. */
const BAND_DELAY_MS = 1_500;

/**
 * Every band, newest first within each. Run by hand as a backfill, never by the schedule:
 * see the note on the bands above and the politeness rule in CLAUDE.md.
 */
async function fetchEveryBand(pages: number): Promise<OlxOffer[]> {
  const collected: OlxOffer[] = [];
  const seen = new Set<string>();

  for (const [priceFrom, priceTo] of RENT_BANDS) {
    // Spread rather than passed as undefined: exactOptionalPropertyTypes means an absent
    // option and an option set to undefined are not the same thing.
    const options = {
      pages,
      ...(priceFrom === undefined ? {} : { priceFrom }),
      ...(priceTo === undefined ? {} : { priceTo }),
    };
    const band = await fetchOlxOffers(options);

    // Bands share their boundary, and a listing at exactly 2000 is in both neighbours.
    for (const offer of band) {
      const id = String(offer.id);
      if (seen.has(id)) continue;
      seen.add(id);
      collected.push(offer);
    }

    const label =
      priceFrom === undefined
        ? `up to ${String(priceTo)}`
        : `${String(priceFrom)}-${String(priceTo)}`;
    console.log(`OLX band ${label}: ${band.length} listings.`);
    if (band.length >= PAGINATION_CAP) {
      console.warn(`OLX band ${label} came back at the pagination cap; it needs splitting.`);
    }

    await sleep(BAND_DELAY_MS);
  }

  return collected;
}

export async function collectOlx(sql: Sql, pages = 2, bands = false): Promise<void> {
  const runId = await startRun(sql, 'olx');
  let seen = 0;
  let added = 0;
  let repriced = 0;

  try {
    const offers = bands ? await fetchEveryBand(pages) : await fetchOlxOffers({ pages });
    seen = offers.length;

    // One transaction: lands whole or not at all, and far faster than row by row.
    await sql.begin(async (tx) => {
      for (const raw of offers) {
        const result = await upsertOffer(tx, parseOlxOffer(raw));
        if (result.isNew) added++;
        if (result.priceChanged) repriced++;
      }
    });

    await finishRun(sql, runId, { itemsSeen: seen, itemsNew: added });
    console.log(`OLX: fetched ${seen}, new ${added}, price changed ${repriced}.`);
  } catch (error) {
    await finishRun(sql, runId, {
      itemsSeen: seen,
      itemsNew: added,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
