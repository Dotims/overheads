import { saveClassification } from '../db/classifications.ts';
import { readAllCostReadings } from '../db/cost-readings.ts';
import { listOffersToClassify } from '../db/offers.ts';
import type { Sql } from '../db/client.ts';
import { classify, RULES_VERSION, type Tier } from '../domain/classify.ts';

/** Judges every listing without a current verdict. Local: touches no portal. */
export async function classifyOffers(sql: Sql): Promise<Record<Tier, number>> {
  const counts: Record<Tier, number> = { top: 0, worth: 0, other: 0 };
  const pending = await listOffersToClassify(sql, RULES_VERSION);
  // One query rather than one per listing: there is at most a row per listing, and this
  // runs over every listing whose verdict is stale, which after a rules bump is all of them.
  const readings = await readAllCostReadings(sql);

  await sql.begin(async (tx) => {
    for (const offer of pending) {
      const verdict = classify(offer, readings.get(offer.id) ?? null);
      await saveClassification(tx, offer.id, verdict, RULES_VERSION);
      counts[verdict.tier]++;
    }
  });

  const withReading = pending.filter((offer) => readings.has(offer.id)).length;
  console.log(
    `Classified ${pending.length} offers under rules v${RULES_VERSION}: ` +
      `${counts.top} top, ${counts.worth} worth, ${counts.other} other ` +
      `(${withReading} priced with a description reading).`,
  );

  return counts;
}
