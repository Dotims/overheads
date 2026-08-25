import { readDescriptionCosts } from './cost.ts';
import type { NormalizedOffer } from './offer.ts';

export type Tier = 'top' | 'worth' | 'other';

/** How complete `totalCostPln` is: read, claimed all-in, assumed, or uncomputable. */
export type CostCertainty = 'exact' | 'all_in' | 'estimated' | 'uncertain';

/** Bump on any rule change below; stored with every verdict so old ones get recomputed. */
// v5: cost.ts stopped reading a building fee as a zero fee, and stopped letting a fee word
// in the previous sentence veto utilities that were stated plainly.
export const RULES_VERSION = 5;

/** Advertised rent alone. */
const WORTH_MAX_RENT_PLN = 2200;
/** Rent plus building fee plus utilities. */
const TOP_MAX_TOTAL_PLN = 2600;
/** Assumed when a listing gives no fee. Roughly what a Kraków flat costs to run. */
const ASSUMED_FEE_PLN = 400;

export interface Classification {
  tier: Tier;
  /** Rent + fee + stated utilities. Null only when no rent is stated. */
  totalCostPln: number | null;
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

/** Turns one listing into a verdict. Pure: no database, no network, no clock. */
export function classify(offer: NormalizedOffer): Classification {
  const stated = readDescriptionCosts(offer.description);
  const reasons: string[] = [];

  if (offer.pricePln === null) {
    return {
      tier: 'other',
      totalCostPln: null,
      costCertainty: 'uncertain',
      reasons: ['The listing states no rent.'],
    };
  }

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
  } else if (stated.noFee) {
    fee = 0;
    costCertainty = 'exact';
    reasons.push('The description says there is no building fee.');
  } else {
    fee = ASSUMED_FEE_PLN;
    costCertainty = 'estimated';
    reasons.push(`No building fee is given, so ${ASSUMED_FEE_PLN} PLN is assumed.`);
  }

  const totalCostPln = offer.pricePln + fee + (stated.utilitiesPln ?? 0);

  if (stated.utilitiesPln !== null) {
    reasons.push(`The description states utilities of ${stated.utilitiesPln} PLN.`);
  } else if (stated.mentionsUtilities && !stated.allIn) {
    reasons.push('Utilities are mentioned without an amount and are not included above.');
  }

  if (totalCostPln <= TOP_MAX_TOTAL_PLN) {
    reasons.push(`Total ${totalCostPln} PLN is within the ${TOP_MAX_TOTAL_PLN} PLN limit.`);
    return { tier: 'top', totalCostPln, costCertainty, reasons };
  }

  if (offer.pricePln <= WORTH_MAX_RENT_PLN) {
    reasons.push(`Rent ${offer.pricePln} PLN is within the ${WORTH_MAX_RENT_PLN} PLN limit.`);
    return { tier: 'worth', totalCostPln, costCertainty, reasons };
  }

  reasons.push(`Rent ${offer.pricePln} PLN exceeds the ${WORTH_MAX_RENT_PLN} PLN limit.`);
  return { tier: 'other', totalCostPln, costCertainty, reasons };
}
