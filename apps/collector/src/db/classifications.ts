import type { Classification, CostCertainty, Tier } from '../domain/classify.ts';
import type { Queryable } from './client.ts';
import {
  readIso,
  readNullableBoolean,
  readNullableIso,
  readNullableNumber,
  readNullableString,
  readNumber,
  readString,
  readStringArray,
  type DbRow,
} from './rows.ts';

/** One verdict per listing, replaced when the rules change. `offers` keeps the facts. */
export async function saveClassification(
  sql: Queryable,
  offerId: number,
  classification: Classification,
  rulesVersion: number,
): Promise<void> {
  await sql`
    insert into classifications (
      offer_id, tier, total_cost_pln, cost_per_person_pln, cost_certainty, reasons,
      rules_version, classified_at
    ) values (
      ${offerId}, ${classification.tier}, ${classification.totalCostPln},
      ${classification.costPerPersonPln},
      -- sql.json, so this lands as an array rather than a JSON string holding one.
      ${classification.costCertainty}, ${sql.json(classification.reasons)},
      ${rulesVersion}, now()
    )
    on conflict (offer_id) do update set
      tier                = excluded.tier,
      total_cost_pln      = excluded.total_cost_pln,
      cost_per_person_pln = excluded.cost_per_person_pln,
      cost_certainty = excluded.cost_certainty,
      reasons        = excluded.reasons,
      rules_version  = excluded.rules_version,
      classified_at  = excluded.classified_at
  `;
}

/** Facts and verdict, joined. No description: it is HTML written by a stranger. */
export interface ClassifiedOffer {
  id: number;
  source: string;
  url: string;
  title: string;
  district: string | null;
  areaM2: number | null;
  rooms: number | null;
  floor: string | null;
  pricePln: number | null;
  rentPln: number | null;
  totalCostPln: number | null;
  /** The total split across the people expected to share it, so two flats compare fairly. */
  costPerPersonPln: number | null;
  tier: Tier;
  costCertainty: CostCertainty;
  reasons: string[];
  isPrivateOwner: boolean | null;
  lat: number | null;
  lng: number | null;
  coordsPrecision: string | null;
  createdAtSource: string | null;
  firstSeenAt: string;
  /**
   * The first photograph only. Sending all of them would roughly double a payload that
   * is already 2.8MB; the rest are one request away on the detail endpoint, made when
   * somebody actually looks past the first.
   */
  photo: string | null;
  /** How many there are in total, so a card knows whether there is a second to show. */
  photoCount: number;
  /** The same flat advertised elsewhere, hidden from the list but still reachable. */
  alsoOn: { source: string; url: string }[];
}

function toTier(value: string): Tier {
  if (value === 'top' || value === 'worth' || value === 'other') return value;
  throw new Error(`Unknown tier "${value}".`);
}

function toCertainty(value: string): CostCertainty {
  if (value === 'exact' || value === 'all_in' || value === 'estimated' || value === 'uncertain') {
    return value;
  }
  throw new Error(`Unknown cost certainty "${value}".`);
}

function toClassifiedOffer(row: DbRow): ClassifiedOffer {
  return {
    id: readNumber(row, 'id'),
    source: readString(row, 'source'),
    url: readString(row, 'url'),
    title: readString(row, 'title'),
    district: readNullableString(row, 'district'),
    areaM2: readNullableNumber(row, 'area_m2'),
    rooms: readNullableNumber(row, 'rooms'),
    floor: readNullableString(row, 'floor'),
    pricePln: readNullableNumber(row, 'price_pln'),
    rentPln: readNullableNumber(row, 'rent_pln'),
    totalCostPln: readNullableNumber(row, 'total_cost_pln'),
    costPerPersonPln: readNullableNumber(row, 'cost_per_person_pln'),
    tier: toTier(readString(row, 'tier')),
    costCertainty: toCertainty(readString(row, 'cost_certainty')),
    reasons: readStringArray(row, 'reasons'),
    isPrivateOwner: readNullableBoolean(row, 'is_private_owner'),
    lat: readNullableNumber(row, 'lat'),
    lng: readNullableNumber(row, 'lng'),
    coordsPrecision: readNullableString(row, 'coords_precision'),
    createdAtSource: readNullableIso(row, 'created_at_source'),
    firstSeenAt: readIso(row, 'first_seen_at'),
    photo: readNullableString(row, 'photo'),
    photoCount: readNumber(row, 'photo_count'),
    alsoOn: readAlsoOn(row),
  };
}

/** Aggregated by the query below, and arriving as jsonb text from this driver. */
function readAlsoOn(row: DbRow): { source: string; url: string }[] {
  const raw = row['also_on'];
  if (raw === null || raw === undefined) return [];

  const parsed: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!Array.isArray(parsed)) throw new Error('Column "also_on" does not hold a list.');

  return parsed.map((entry) => {
    if (
      typeof entry !== 'object' ||
      entry === null ||
      typeof (entry as { source?: unknown }).source !== 'string' ||
      typeof (entry as { url?: unknown }).url !== 'string'
    ) {
      throw new Error('Column "also_on" holds something that is not a listing reference.');
    }
    return entry as { source: string; url: string };
  });
}

/**
 * How far above the owner's budget a listing may sit and still be sent to the page.
 *
 * A ceiling rather than the tiers, because the tiers are the verdict and this is only
 * about weight: 3500 is a third above the 2600 the flat has to come in under, so every
 * listing the dashboard's own filters could be widened to want is here, and the four
 * fifths of the market that are plainly out of reach are not. It halves a payload that
 * grew to 3.6MB when the archive was backfilled on 2026-08-25, and the map stops
 * plotting four thousand pins nobody looks at.
 *
 * A listing with no total is kept: that means no rent was stated, not that it is dear.
 */
const SENT_CEILING_PLN = 3_500;

/** How many the ceiling left behind, so the page can say so rather than quietly shrink. */
export async function countOmittedOffers(sql: Queryable): Promise<number> {
  const [row] = await sql<DbRow[]>`
    select count(*)::int as omitted
    from classifications c
    join offers o on o.id = c.offer_id
    where o.status = 'active' and o.duplicate_of is null
      and c.total_cost_pln > ${SENT_CEILING_PLN}
  `;

  return row === undefined ? 0 : readNumber(row, 'omitted');
}

/** Everything the dashboard shows, up to the ceiling above. Sent once and filtered there. */
export async function listClassifiedOffers(sql: Queryable): Promise<ClassifiedOffer[]> {
  const rows = await sql<DbRow[]>`
    select o.id, o.source, o.url, o.title, o.district, o.area_m2, o.rooms, o.floor,
           o.price_pln, o.rent_pln, o.is_private_owner, o.lat, o.lng, o.coords_precision,
           o.created_at_source, o.first_seen_at,
           -- ->> 0 is null on an empty array, which is exactly the "no photograph" case.
           o.photos ->> 0 as photo,
           -- The type is checked rather than assumed: jsonb_array_length raises on a
           -- scalar, which would take the whole endpoint down over a thumbnail.
           case when jsonb_typeof(o.photos) = 'array' then jsonb_array_length(o.photos)
                else 0 end as photo_count,
           c.tier, c.total_cost_pln, c.cost_per_person_pln, c.cost_certainty, c.reasons,
           coalesce(dupes.also_on, '[]'::jsonb) as also_on
    from classifications c
    join offers o on o.id = c.offer_id
    left join lateral (
      select jsonb_agg(jsonb_build_object('source', d.source, 'url', d.url)
                       order by d.source) as also_on
      from offers d
      where d.duplicate_of = o.id and d.status = 'active'
    ) dupes on true
    -- A listing marked as a repeat of another is reachable through that one's alsoOn.
    where o.status = 'active' and o.duplicate_of is null
      and (c.total_cost_pln is null or c.total_cost_pln <= ${SENT_CEILING_PLN})
    -- Tier first: on price alone, a cheap unknown outranks a pricier listing that fits.
    order by case c.tier when 'top' then 0 when 'worth' then 1 else 2 end, c.total_cost_pln
  `;

  return rows.map(toClassifiedOffer);
}
