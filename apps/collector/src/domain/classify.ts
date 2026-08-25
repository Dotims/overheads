import { readDescriptionCosts } from './cost.ts';
import { monthlyExtras, sharedBy, type CostReading } from './cost-reading.ts';
import type { NormalizedOffer } from './offer.ts';

export type Tier = 'top' | 'worth' | 'other';

/** How complete `totalCostPln` is: read, claimed all-in, assumed, or uncomputable. */
export type CostCertainty = 'exact' | 'all_in' | 'estimated' | 'uncertain';

/** Bump on any rule change below; stored with every verdict so old ones get recomputed. */
// v5: cost.ts stopped reading a building fee as a zero fee, and stopped letting a fee word
// in the previous sentence veto utilities that were stated plainly.
// v6: a parking space advertised as a flat is judged as one no longer.
export const RULES_VERSION = 6;

/** Advertised rent alone. */
const WORTH_MAX_RENT_PLN = 2200;
/** Rent plus building fee plus utilities. */
const TOP_MAX_TOTAL_PLN = 2600;
/** Assumed when a listing gives no fee. Roughly what a Kraków flat costs to run. */
const ASSUMED_FEE_PLN = 400;

/**
 * The rent above which reading a description cannot rescue a listing, so the queue in
 * `read:costs` puts it last.
 *
 * Deliberately above the 2600 the tiers are drawn at (owner's call, 2026-08-26). A flat
 * advertised at 2750 is over budget on the rules alone, and the reading is exactly what
 * can change that: the fee may be nil, or the price may already cover the supplies. Below
 * this figure it is worth the request to find out; above it, it is not.
 */
export const READING_BUDGET_PLN = 2_800;

/**
 * What the advert is letting, when it is not a flat.
 *
 * Advertisers file these under flat rental themselves, so no portal field marks them and
 * the title is the only signal there is. Narrow on purpose: matched against 8281 stored
 * listings it caught the two garage platforms and nothing else, where a rule keyed on
 * floor area alone would have thrown out real studios with a mistyped one. The floor area
 * is still required, so "Kawalerka | Garaż + komórka" stays the flat it is.
 */
const NOT_A_FLAT =
  /platform\w* gara|hala gara|miejsce postojow|miejsce parkingow|^gara[zż]|stanowisko postojow|komórka lokatorska/i;

/** Somewhere nobody could live, and the smallest legal dwelling in Poland is above this. */
const NOT_A_FLAT_MAX_M2 = 20;

export interface Classification {
  tier: Tier;
  /** Rent + fee + stated utilities. Null only when no rent is stated. */
  totalCostPln: number | null;
  /** The total split across the people expected to share it. Null when there is no total. */
  costPerPersonPln: number | null;
  costCertainty: CostCertainty;
  reasons: string[];
}

/**
 * Whether a description could still rescue this listing. Asked by sources that pay a
 * request per description. District is deliberately not consulted: it is a dashboard
 * filter now, and gating here would leave uncovered districts with no pin and no text
 * the moment one is switched back on.
 */
export function mightQualify(offer: NormalizedOffer): boolean {
  if (offer.pricePln === null) return false;
  return offer.pricePln <= Math.max(TOP_MAX_TOTAL_PLN, WORTH_MAX_RENT_PLN);
}

/**
 * Turns one listing into a verdict. Pure: no database, no network, no clock.
 *
 * `reading` is what a language model made of the description, or null where none has been
 * taken. It is only ever consulted for what the portal left blank: a structured field the
 * portal filled in is a fact, and a figure read out of prose is a reading, so the fact
 * wins wherever the two could disagree. Everything the reading does contribute says so in
 * the reasons, which is what the dashboard shows under the total.
 */
export function classify(
  offer: NormalizedOffer,
  reading: CostReading | null = null,
): Classification {
  const stated = readDescriptionCosts(offer.description);
  const reasons: string[] = [];

  if (NOT_A_FLAT.test(offer.title) && (offer.areaM2 === null || offer.areaM2 < NOT_A_FLAT_MAX_M2)) {
    return {
      tier: 'other',
      totalCostPln: null,
      costPerPersonPln: null,
      costCertainty: 'uncertain',
      reasons: ['The advert is letting a parking space or a storage room, not a flat.'],
    };
  }

  if (offer.pricePln === null) {
    return {
      tier: 'other',
      totalCostPln: null,
      costPerPersonPln: null,
      costCertainty: 'uncertain',
      reasons: ['The listing states no rent.'],
    };
  }

  // "czynsz z mediami": the fee already covers the supplies. Read from the description
  // either way, because it decides whether adding utilities charges for them twice.
  const feeCoversUtilities = stated.allIn || reading?.feeIncludesUtilities === true;

  let fee: number;
  let costCertainty: CostCertainty;

  if (stated.allIn) {
    fee = offer.rentPln ?? 0;
    costCertainty = 'all_in';
    reasons.push('The description says the price covers everything.');
  } else if (offer.rentPln !== null) {
    fee = offer.rentPln;
    costCertainty = 'exact';
    reasons.push(`The building fee is stated as ${fee} PLN.`);
  } else if (reading !== null && reading.feePln !== null) {
    fee = reading.feePln;
    costCertainty = 'exact';
    reasons.push(`The portal gives no fee; the description puts it at ${fee} PLN.`);
  } else if (stated.noFee) {
    fee = 0;
    costCertainty = 'exact';
    reasons.push('The description says there is no building fee.');
  } else {
    fee = ASSUMED_FEE_PLN;
    costCertainty = 'estimated';
    reasons.push(`No building fee is given, so ${ASSUMED_FEE_PLN} PLN is assumed.`);
  }

  const extras = reading === null ? null : monthlyExtras(reading);

  // The reading first: the patterns in cost.ts find a figure in about one description in
  // six, and where they do not, this is the whole of what is known about the supplies.
  const utilities = feeCoversUtilities ? 0 : (extras?.utilitiesPln ?? stated.utilitiesPln ?? 0);
  const internet = feeCoversUtilities ? 0 : (extras?.internetPln ?? 0);

  const totalCostPln = offer.pricePln + fee + utilities + internet;

  if (utilities > 0) {
    reasons.push(`The description states utilities of ${utilities} PLN.`);
  } else if (feeCoversUtilities && !stated.allIn) {
    reasons.push('The building fee already covers the supplies, so nothing is added for them.');
  } else if (
    (reading?.utilitiesMetered === true || stated.mentionsUtilities) &&
    !feeCoversUtilities
  ) {
    reasons.push('Utilities are mentioned without an amount and are not included above.');
  }

  if (internet > 0) reasons.push(`Internet is priced separately at ${internet} PLN.`);

  const people = sharedBy(reading, offer.rooms);
  const costPerPersonPln = Math.round(totalCostPln / people);
  if (people > 1) {
    reasons.push(`Split ${people} ways that is ${costPerPersonPln} PLN each.`);
  }

  if (totalCostPln <= TOP_MAX_TOTAL_PLN) {
    reasons.push(`Total ${totalCostPln} PLN is within the ${TOP_MAX_TOTAL_PLN} PLN limit.`);
    return { tier: 'top', totalCostPln, costPerPersonPln, costCertainty, reasons };
  }

  if (offer.pricePln <= WORTH_MAX_RENT_PLN) {
    reasons.push(`Rent ${offer.pricePln} PLN is within the ${WORTH_MAX_RENT_PLN} PLN limit.`);
    return { tier: 'worth', totalCostPln, costPerPersonPln, costCertainty, reasons };
  }

  reasons.push(`Rent ${offer.pricePln} PLN exceeds the ${WORTH_MAX_RENT_PLN} PLN limit.`);
  return { tier: 'other', totalCostPln, costPerPersonPln, costCertainty, reasons };
}
