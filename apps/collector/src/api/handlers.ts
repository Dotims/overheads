import type { Sql } from '../db/client.ts';
import {
  countOmittedOffers,
  listClassifiedOffers,
  type ClassifiedOffer,
} from '../db/classifications.ts';
import { upsertOffer } from '../db/offers.ts';
import { readOfferDetail, type OfferDetail } from '../db/offer-detail.ts';
import { listSourceStatus, type SourceStatus } from '../db/runs.ts';
import { classifyOffers } from '../commands/classify.ts';
import { collectOtodom } from '../commands/collect-otodom.ts';
import { dedupeOffers } from '../commands/dedupe.ts';
import { parseOlxOffer } from '../sources/olx/parse.ts';
import type { OlxOffer } from '../sources/olx/types.ts';

/**
 * Guards the write endpoint. Fails closed: with no token configured nothing may write,
 * which is the safe way round for something reachable from the internet.
 */
export function assertIngestAllowed(presented: string | null): void {
  const expected = process.env.INGEST_TOKEN;
  if (expected === undefined || expected === '') {
    throw new Error('INGEST_TOKEN is not set, so writing is refused.');
  }
  if (presented !== expected) {
    throw new Error('Wrong or missing ingest token.');
  }
}

/**
 * Reads the ingest token out of the request, under either name.
 *
 * The rename to Overheads could not reach the sender: OLX rounds are posted by a shortcut
 * on a phone, configured by hand and living nowhere in this repository. Dropping the old
 * header would have stopped OLX collection silently, and the dashboard would have gone on
 * looking healthy while its listings quietly aged. The old name goes once the shortcut has
 * been changed over.
 */
export function readIngestToken(
  headers: Record<string, string | string[] | undefined>,
): string | null {
  const presented = headers['x-overheads-token'] ?? headers['x-flatradar-token'];
  return typeof presented === 'string' ? presented : null;
}

export interface SyncResult {
  source: string;
  seen: number;
  added: number;
  tiers: Record<string, number>;
}

/**
 * Favourites and rejections are not here. The page is shared, so they are kept in each
 * visitor's own browser: a shared table would have meant one person's rejection taking a
 * flat off everybody else's list, and an unauthenticated write endpoint to do it with.
 */
export async function readOffers(
  sql: Sql,
): Promise<{ offers: ClassifiedOffer[]; sources: SourceStatus[]; omitted: number }> {
  // `omitted` is a count, not rows: it costs nothing to send and stops the ceiling in
  // listClassifiedOffers being a silent edit of what the page is looking at.
  const [offers, sources, omitted] = await Promise.all([
    listClassifiedOffers(sql),
    listSourceStatus(sql),
    countOmittedOffers(sql),
  ]);

  return { offers, sources, omitted };
}

/** One listing in full: description and photos, too heavy for the list payload. */
export async function readDetail(sql: Sql, id: number): Promise<OfferDetail | null> {
  return readOfferDetail(sql, id);
}

/** Otodom only: OLX refuses datacenter addresses, and this runs on one. */
export async function syncOtodom(sql: Sql): Promise<SyncResult> {
  const before = await countOffers(sql, 'otodom');
  await collectOtodom(sql);
  const after = await countOffers(sql, 'otodom');
  const tiers = await classifyOffers(sql);
  await dedupeOffers(sql);

  return { source: 'otodom', seen: after, added: after - before, tiers };
}

/**
 * Takes an OLX API response captured by a device on an ordinary connection, since the
 * portal will not answer this server. The device fetches, we parse and store.
 */
export async function ingestOlx(sql: Sql, body: unknown): Promise<SyncResult> {
  const offers = readOlxOffers(body);
  let added = 0;

  await sql.begin(async (tx) => {
    for (const offer of offers) {
      const result = await upsertOffer(tx, parseOlxOffer(offer));
      if (result.isNew) added++;
    }
  });

  const tiers = await classifyOffers(sql);
  await dedupeOffers(sql);
  return { source: 'olx', seen: offers.length, added, tiers };
}

function readOlxOffers(body: unknown): OlxOffer[] {
  if (typeof body !== 'object' || body === null || !('data' in body)) {
    throw new Error('Expected an OLX API response with a data array.');
  }

  const { data } = body as { data: unknown };
  if (!Array.isArray(data)) throw new Error('The data field is not an array.');

  for (const item of data) {
    if (typeof item !== 'object' || item === null || !('id' in item) || !('params' in item)) {
      throw new Error('An entry does not look like an OLX offer.');
    }
  }

  return data as OlxOffer[];
}

async function countOffers(sql: Sql, source: string): Promise<number> {
  const [row] = await sql<{ total: string }[]>`
    select count(*) as total from offers where source = ${source}
  `;
  return Number(row?.total ?? 0);
}
