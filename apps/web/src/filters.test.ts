import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyFilters,
  availableDistricts,
  DEFAULT_FILTERS,
  DEFAULT_HIDDEN_DISTRICTS,
  NO_DISTRICT,
} from './filters.ts';
import type { Offer } from './types.ts';

function offer(overrides: Partial<Offer> = {}): Offer {
  return {
    id: 1,
    source: 'olx',
    url: 'https://www.olx.pl/d/oferta/1',
    title: 'Mieszkanie',
    district: 'Dębniki',
    areaM2: 40,
    rooms: 2,
    floor: null,
    pricePln: 2000,
    rentPln: 300,
    totalCostPln: 2300,
    costPerPersonPln: 1150,
    tier: 'top',
    costCertainty: 'exact',
    reasons: [],
    isPrivateOwner: true,
    lat: null,
    lng: null,
    coordsPrecision: null,
    createdAtSource: null,
    firstSeenAt: '2026-08-08T00:00:00.000Z',
    mark: null,
    photo: null,
    photoCount: 0,
    alsoOn: [],
    ...overrides,
  };
}

/** No bounds at all, so each case states only the one it is about. */
const OPEN = {
  ...DEFAULT_FILTERS,
  maxCostPln: null,
  hiddenDistricts: [],
};

test('keeps a listing that satisfies every filter', () => {
  assert.equal(applyFilters([offer()], DEFAULT_FILTERS).length, 1);
});

test('drops a listing above the cost limit', () => {
  assert.equal(
    applyFilters([offer({ totalCostPln: 2700 })], { ...OPEN, maxCostPln: 2600 }).length,
    0,
  );
});

test('drops a listing below the cost floor', () => {
  assert.equal(
    applyFilters([offer({ totalCostPln: 1200 })], { ...OPEN, minCostPln: 1500 }).length,
    0,
  );
});

test('the cost range keeps what sits inside it', () => {
  const offers = [offer({ totalCostPln: 2300 })];
  assert.equal(applyFilters(offers, { ...OPEN, minCostPln: 2000, maxCostPln: 2600 }).length, 1);
});

test('the tier no longer decides anything', () => {
  // The verdict is still computed and still shown; it stopped being a filter because
  // "w budżecie" is measured on rent alone and read as arbitrary.
  const offers = [offer({ tier: 'other', totalCostPln: 2400 })];
  assert.equal(applyFilters(offers, { ...OPEN, maxCostPln: 2600 }).length, 1);
});

test('area and room counts are ranges too', () => {
  const offers = [offer({ areaM2: 25, rooms: 1 })];
  assert.equal(applyFilters(offers, { ...OPEN, minAreaM2: 35 }).length, 0);
  assert.equal(applyFilters(offers, { ...OPEN, maxAreaM2: 20 }).length, 0);
  assert.equal(applyFilters(offers, { ...OPEN, minAreaM2: 20, maxAreaM2: 30 }).length, 1);
  assert.equal(applyFilters(offers, { ...OPEN, minRooms: 2 }).length, 0);
  assert.equal(applyFilters(offers, { ...OPEN, maxRooms: 2 }).length, 1);
});

test('a value the portal never stated is never a reason to drop a listing', () => {
  const blank = offer({ areaM2: null, totalCostPln: null, rooms: null });
  const bounded = { ...OPEN, minAreaM2: 35, maxCostPln: 1000, minRooms: 3 };
  assert.equal(applyFilters([blank], bounded).length, 1);
});

test('hidden districts are the ones removed', () => {
  const offers = [offer({ district: 'Podgórze' }), offer({ id: 2, district: 'Krowodrza' })];
  const kept = applyFilters(offers, { ...OPEN, hiddenDistricts: ['Krowodrza'] });
  assert.deepEqual(
    kept.map((item) => item.id),
    [1],
  );
});

test('the shipped defaults hide the districts the owner ruled out', () => {
  assert.ok(DEFAULT_HIDDEN_DISTRICTS.includes('Krowodrza'));
  assert.equal(applyFilters([offer({ district: 'Krowodrza' })], DEFAULT_FILTERS).length, 0);
  assert.equal(applyFilters([offer({ district: 'Podgórze' })], DEFAULT_FILTERS).length, 1);
});

test('a listing with no district survives the default view', () => {
  // Advertisers leave the field blank often enough that hiding these would cost real offers.
  assert.equal(applyFilters([offer({ district: null })], DEFAULT_FILTERS).length, 1);
  const hidden = { ...OPEN, hiddenDistricts: [NO_DISTRICT] };
  assert.equal(applyFilters([offer({ district: null })], hidden).length, 0);
});

test('the private filter drops agency listings but keeps unknown ones', () => {
  const offers = [
    offer({ isPrivateOwner: false }),
    offer({ id: 2, isPrivateOwner: null }),
    offer({ id: 3, isPrivateOwner: true }),
  ];
  const kept = applyFilters(offers, { ...OPEN, privateOnly: true });
  assert.deepEqual(
    kept.map((item) => item.id),
    [2, 3],
  );
});

test('a rejected listing is gone until it is asked for', () => {
  const offers = [offer({ mark: 'rejected' })];
  assert.equal(applyFilters(offers, OPEN).length, 0);
  assert.equal(applyFilters(offers, { ...OPEN, showRejected: true }).length, 1);
});

test('a favourite survives bounds it no longer fits', () => {
  // Keeping a flat is a decision about that flat, so a later change of budget must not
  // quietly take it away.
  const kept = offer({ mark: 'favourite', totalCostPln: 4000, district: 'Krowodrza' });
  assert.equal(applyFilters([kept], DEFAULT_FILTERS).length, 1);
});

test('a rejected listing stays gone even when favourites are asked for', () => {
  const offers = [offer({ mark: 'rejected' }), offer({ id: 2, mark: 'favourite' })];
  const kept = applyFilters(offers, { ...OPEN, favouritesOnly: true });
  assert.deepEqual(
    kept.map((item) => item.id),
    [2],
  );
});

test('favourites only hides everything unmarked', () => {
  const offers = [offer({ id: 1 }), offer({ id: 2, mark: 'favourite' })];
  assert.equal(applyFilters(offers, { ...OPEN, favouritesOnly: true }).length, 1);
});

test('district options are sorted and deduplicated', () => {
  const offers = [
    offer({ district: 'Podgórze' }),
    offer({ id: 2, district: 'Dębniki' }),
    offer({ id: 3, district: 'Dębniki' }),
    offer({ id: 4, district: null }),
  ];
  assert.deepEqual(availableDistricts(offers), [NO_DISTRICT, 'Dębniki', 'Podgórze']);
});
