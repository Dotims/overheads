import type { CostReading } from '../domain/cost-reading.ts';
import type { PortalFacts } from '../model/read-cost.ts';
import type { Queryable } from './client.ts';
import { readNullableNumber, readNumber, type DbRow } from './rows.ts';

/** A listing still to be read, carrying everything the model is shown. */
export interface OfferToRead extends PortalFacts {
  id: number;
}

/**
 * Listings whose reading is missing or was made by an older prompt or another model.
 *
 * Only listings that are still active and have something to read: there is no point
 * spending seconds of a graphics card on a flat that has already gone.
 *
 * The order is the whole difference between a useful run and a wasted one. A backfill
 * leaves thousands queued and each takes seconds, so what gets read first has to be what
 * the reading can still change: a flat whose rent alone is already double the budget is
 * out of reach whatever the description says about the fees. Rent within `budgetPln`
 * comes first, and newest first within that, so a run cut short has read the listings
 * still on the market. Everything else is behind them rather than dropped, because the
 * budget can be widened and a stored reading is then already there.
 */
export async function listOffersToRead(
  sql: Queryable,
  model: string,
  promptVersion: number,
  limit: number,
  budgetPln: number,
): Promise<OfferToRead[]> {
  const rows = await sql<DbRow[]>`
    select o.id, o.title, o.description, o.price_pln, o.rent_pln, o.area_m2, o.rooms
    from offers o
    left join cost_readings r on r.offer_id = o.id
    where o.status = 'active'
      and o.description is not null
      and length(o.description) > 120
      and (r.offer_id is null or r.prompt_version <> ${promptVersion} or r.model <> ${model})
    order by (o.price_pln is not null and o.price_pln <= ${budgetPln}) desc,
             o.first_seen_at desc
    limit ${limit}
  `;

  return rows.map((row) => ({
    id: readNumber(row, 'id'),
    title: String(row['title'] ?? ''),
    description: String(row['description'] ?? ''),
    pricePln: readNullableNumber(row, 'price_pln'),
    rentPln: readNullableNumber(row, 'rent_pln'),
    areaM2: readNullableNumber(row, 'area_m2'),
    rooms: readNullableNumber(row, 'rooms'),
  }));
}

/** One reading, replacing whatever was there. Same shape as saveClassification. */
export async function saveCostReading(
  sql: Queryable,
  offerId: number,
  reading: CostReading,
  raw: unknown,
  model: string,
  promptVersion: number,
): Promise<void> {
  await sql`
    insert into cost_readings (
      offer_id, rent_pln, fee_pln, utilities_pln, internet_pln, deposit_pln,
      fee_includes_utilities, utilities_metered, for_people,
      model, prompt_version, read_at, raw
    ) values (
      ${offerId}, ${reading.rentPln}, ${reading.feePln}, ${reading.utilitiesPln},
      ${reading.internetPln}, ${reading.depositPln},
      ${reading.feeIncludesUtilities}, ${reading.utilitiesMetered},
      ${reading.forPeople},
      -- sql.json, or the driver stores the answer as a JSON string holding JSON.
      ${model}, ${promptVersion}, now(), ${sql.json(raw as never)}
    )
    on conflict (offer_id) do update set
      rent_pln               = excluded.rent_pln,
      fee_pln                = excluded.fee_pln,
      utilities_pln          = excluded.utilities_pln,
      internet_pln           = excluded.internet_pln,
      deposit_pln            = excluded.deposit_pln,
      fee_includes_utilities = excluded.fee_includes_utilities,
      utilities_metered      = excluded.utilities_metered,
      for_people             = excluded.for_people,
      model                  = excluded.model,
      prompt_version         = excluded.prompt_version,
      read_at                = excluded.read_at,
      raw                    = excluded.raw
  `;
}

function toCostReading(row: DbRow): CostReading {
  return {
    rentPln: readNullableNumber(row, 'rent_pln'),
    feePln: readNullableNumber(row, 'fee_pln'),
    utilitiesPln: readNullableNumber(row, 'utilities_pln'),
    internetPln: readNullableNumber(row, 'internet_pln'),
    depositPln: readNullableNumber(row, 'deposit_pln'),
    feeIncludesUtilities: row['fee_includes_utilities'] === true,
    utilitiesMetered: row['utilities_metered'] === true,
    forPeople: readNullableNumber(row, 'for_people'),
  };
}

/**
 * Every stored reading, by listing id. Classification walks the whole table anyway, so
 * one query beats a lookup per listing, and there is one row per listing at most.
 */
export async function readAllCostReadings(sql: Queryable): Promise<Map<number, CostReading>> {
  const rows = await sql<DbRow[]>`
    select offer_id, rent_pln, fee_pln, utilities_pln, internet_pln, deposit_pln,
           fee_includes_utilities, utilities_metered, for_people
    from cost_readings
  `;

  return new Map(rows.map((row) => [readNumber(row, 'offer_id'), toCostReading(row)]));
}
