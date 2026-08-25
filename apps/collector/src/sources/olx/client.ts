import { fetchJson, sleep } from '../http.ts';
import type { OlxOffer, OlxOffersResponse } from './types.ts';

const API_URL = 'https://www.olx.pl/api/v1/offers/';

/** Real estate > Flats > Rental. */
export const CATEGORY_FLAT_RENT = 15;
export const CITY_KRAKOW = 8959;

/** The most OLX returns in a single request. */
const PAGE_SIZE = 50;

/** Pause between pages: there is no hurry, and the service is not ours. */
const PAGE_DELAY_MS = 1_000;

export interface FetchOlxOptions {
  pages?: number;
  cityId?: number;
  categoryId?: number;
  /** Rent bounds in PLN, inclusive. See the band sweep in commands/collect-olx.ts. */
  priceFrom?: number;
  priceTo?: number;
}

/**
 * How deep OLX will let anyone page into one search, measured 2026-08-25: it reports
 * `visible_total_count: 3706` for Kraków flat rentals and `total_elements: 1000`, and
 * offset 1000 is the end whatever the first number says.
 *
 * The cap is per query, not per account, so a narrower query reaches listings the broad
 * one cannot: asking for rent up to 2000 PLN returns 408 and all 408 are readable. That
 * is what the price bands are for.
 */
export const PAGINATION_CAP = 1_000;

/**
 * Fetches the newest listings first. We stay shallow on purpose: running every
 * ten to fifteen minutes, new listings fit on the first page anyway, and OLX cuts
 * pagination off somewhere around a thousand results.
 */
export async function fetchOlxOffers(options: FetchOlxOptions = {}): Promise<OlxOffer[]> {
  const { pages = 2, cityId = CITY_KRAKOW, categoryId = CATEGORY_FLAT_RENT } = options;
  const collected: OlxOffer[] = [];

  for (let page = 0; page < pages; page++) {
    const url = new URL(API_URL);
    url.searchParams.set('offset', String(page * PAGE_SIZE));
    url.searchParams.set('limit', String(PAGE_SIZE));
    url.searchParams.set('category_id', String(categoryId));
    url.searchParams.set('city_id', String(cityId));
    url.searchParams.set('sort_by', 'created_at:desc');
    // OLX names these two with a colon in the key, so they cannot be object properties
    // in a plain query builder without quoting. Set only when asked for, or an absent
    // bound becomes the string "undefined" and the search returns nothing.
    if (options.priceFrom !== undefined) {
      url.searchParams.set('filter_float_price:from', String(options.priceFrom));
    }
    if (options.priceTo !== undefined) {
      url.searchParams.set('filter_float_price:to', String(options.priceTo));
    }

    const response = await fetchJson<OlxOffersResponse>(url.toString());
    collected.push(...response.data);

    // A short page means there is nothing more to read.
    if (response.data.length < PAGE_SIZE) break;
    if (page < pages - 1) await sleep(PAGE_DELAY_MS);
  }

  return collected;
}
