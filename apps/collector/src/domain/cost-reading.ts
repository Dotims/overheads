/**
 * What a language model read out of one description, and the arithmetic on top of it.
 *
 * The model's only job is extraction: report the figures the advert states. Every
 * judgement stays here, in code that can be tested without a model running, because a
 * 4B model asked to reason about budgets will happily invent a number that looks
 * plausible and no test would ever catch it.
 */

/** One reading. Every figure is monthly PLN unless it says otherwise; null means unstated. */
export interface CostReading {
  rentPln: number | null;
  feePln: number | null;
  utilitiesPln: number | null;
  internetPln: number | null;
  /** One-off, not monthly. Kept out of every total below. */
  depositPln: number | null;
  /** "czynsz z mediami": adding utilities on top would charge for them twice. */
  feeIncludesUtilities: boolean;
  /** "prąd wg zużycia" with no figure: a cost that exists and has no number. */
  utilitiesMetered: boolean;
  /** How many people the figures are quoted for, when the advert says. */
  forPeople: number | null;
}

/** Bump when the prompt changes, so stored readings are recomputed rather than trusted. */
// v2: dropped isRoomOnly. The model read a quarter of all "kawalerka" adverts as a room
// let on its own, and the field could only ever have mattered for the 0.6% of listings
// where the portal gives no room count. Do not ask a model what the data already says.
// v3: the model is shown the portal's own fields alongside the text, so it can tell the
// rent from the building fee instead of guessing which of two figures is which.
export const PROMPT_VERSION = 3;

/**
 * What a figure has to be inside to be believed.
 *
 * A small model does not hallucinate often, but when it does it produces a number of the
 * right shape and the wrong magnitude - 250000 PLN of electricity, a fee equal to the
 * rent. Bounds turn that from a silently wrong total into a missing field, which the
 * rules already know how to handle.
 */
const BOUNDS = {
  rentPln: [400, 30_000],
  feePln: [0, 4_000],
  utilitiesPln: [0, 2_000],
  internetPln: [0, 400],
  depositPln: [0, 60_000],
  forPeople: [1, 8],
} as const;

function bounded(value: unknown, field: keyof typeof BOUNDS): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;

  const rounded = Math.round(value);
  const [min, max] = BOUNDS[field];
  return rounded < min || rounded > max ? null : rounded;
}

function flag(value: unknown): boolean {
  return value === true;
}

/**
 * Turns the model's answer into a reading. Never throws: an unusable answer is a listing
 * with no reading, not a round that dies on one bad description.
 */
export function readModelAnswer(answer: unknown): CostReading {
  const source =
    typeof answer === 'object' && answer !== null ? (answer as Record<string, unknown>) : {};

  const rentPln = bounded(source['rentPln'], 'rentPln');
  let feePln = bounded(source['feePln'], 'feePln');

  // A model that finds only one figure tends to report it twice. The building fee is the
  // smaller of the two in every real advert, so an equal pair is the duplicate, not a flat
  // whose fee happens to match its rent.
  if (feePln !== null && rentPln !== null && feePln >= rentPln) feePln = null;

  return {
    rentPln,
    feePln,
    utilitiesPln: bounded(source['utilitiesPln'], 'utilitiesPln'),
    internetPln: bounded(source['internetPln'], 'internetPln'),
    depositPln: bounded(source['depositPln'], 'depositPln'),
    feeIncludesUtilities: flag(source['feeIncludesUtilities']),
    utilitiesMetered: flag(source['utilitiesMetered']),
    forPeople: bounded(source['forPeople'], 'forPeople'),
  };
}

/**
 * How many people the monthly total is split between.
 *
 * Room count first, because that is how a flat is actually shared here, every portal
 * reports it, and it is a fact rather than a reading: only 0.6% of listings arrive
 * without one. What the advert quotes its fees for ("przy 2 osobach") is the fallback for
 * those: it describes the figures rather than the household, so it is a weaker answer
 * than the room count and a better one than nothing.
 *
 * Capped at six. A flat advertised with more rooms than that is a hostel or a typo, and
 * either way dividing by it would make the cheapest listing on the page a fiction.
 */
export function sharedBy(reading: CostReading | null, rooms: number | null): number {
  if (rooms !== null && rooms >= 1) return Math.min(rooms, 6);

  return reading?.forPeople ?? 1;
}

/** The monthly figures a reading contributes, with anything double counted removed. */
export function monthlyExtras(reading: CostReading): { utilitiesPln: number; internetPln: number } {
  return {
    // The fee covering the supplies is exactly the case where adding them charges twice.
    utilitiesPln: reading.feeIncludesUtilities ? 0 : (reading.utilitiesPln ?? 0),
    internetPln: reading.internetPln ?? 0,
  };
}
