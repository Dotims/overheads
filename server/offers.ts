import type { VercelRequest, VercelResponse } from '@vercel/node';
import { readOffers } from '../apps/collector/src/api/handlers.ts';
import { openDatabase, type Sql } from '../apps/collector/src/db/client.ts';

/**
 * Long enough that a dashboard left open stops paying for a database read on every poll,
 * short enough that it can never hide a finished round: rounds are half an hour apart.
 *
 * The listing set is the heaviest thing this project reads, and it used to be read whole,
 * uncached, once per poll per open tab. That is what exhausted the database's monthly
 * transfer allowance on 2026-08-23. `max-age=0` keeps the browser revalidating, so the
 * cache lives on the CDN where every visitor shares one copy, not in one person's browser.
 */
const CACHE = 'public, max-age=0, s-maxage=120, stale-while-revalidate=600';

export default async function handler(
  request: VercelRequest,
  response: VercelResponse,
): Promise<void> {
  let sql: Sql | null = null;
  try {
    sql = openDatabase();
    const body = await readOffers(sql);

    // The dashboard asks for an uncached read straight after a manual sync, where a
    // two-minute-old answer would look as though the sync had found nothing.
    response.setHeader('Cache-Control', 'fresh' in request.query ? 'no-store' : CACHE);

    // So the next time transfer runs away we can see which endpoint spent it.
    const payload = JSON.stringify(body);
    console.log(`offers: ${body.offers.length} listings, ${payload.length} bytes`);
    response.setHeader('Content-Type', 'application/json');
    response.status(200).send(payload);
  } catch (error) {
    console.error(error);
    // A failure must never be cached: the next poll has to be able to find this working.
    response.setHeader('Cache-Control', 'no-store');
    response.status(500).json({ error: error instanceof Error ? error.message : 'Query failed.' });
  } finally {
    if (sql !== null) await sql.end();
  }
}
