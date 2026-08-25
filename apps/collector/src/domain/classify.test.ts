import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classify } from './classify.ts';
import type { NormalizedOffer } from './offer.ts';

/** A listing that passes every rule, so each test can break exactly one thing. */
function offer(overrides: Partial<NormalizedOffer> = {}): NormalizedOffer {
  return {
    source: 'olx',
    sourceId: '1',
    url: 'https://www.olx.pl/d/oferta/1',
    title: 'Mieszkanie',
    description: 'media wliczone w cenę',
    pricePln: 2000,
    rentPln: 300,
    depositPln: null,
    areaM2: 35,
    rooms: 2,
    floor: null,
    city: 'Kraków',
    district: 'Nowa Huta',
    subdistrict: null,
    street: null,
    lat: null,
    lng: null,
    coordsPrecision: null,
    isPrivateOwner: true,
    advertiser: null,
    status: 'active',
    createdAtSource: null,
    pushedUpAt: null,
    photos: [],
    raw: {},
    ...overrides,
  };
}

test('a cheap flat in the right district is top', () => {
  const result = classify(offer());
  assert.equal(result.tier, 'top');
  assert.equal(result.totalCostPln, 2300);
});

test('the district does not change the verdict', () => {
  // Districts moved to the dashboard, where they are a filter the owner can lift.
  // A verdict is about money; leaving the district in here would bake one afternoon's
  // preference into stored rows and need a recompute every time it changed.
  const result = classify(offer({ district: 'Krowodrza', pricePln: 900, rentPln: 0 }));
  assert.equal(result.tier, 'top');
});

test('a listing with no district set is classified like any other', () => {
  assert.equal(classify(offer({ district: null })).tier, 'top');
});

test('a missing building fee is assumed rather than treated as zero', () => {
  const result = classify(offer({ rentPln: null, description: 'Przytulna kawalerka.' }));
  assert.equal(result.costCertainty, 'estimated');
  assert.equal(result.totalCostPln, 2400);
  assert.ok(result.reasons.some((reason) => reason.includes('400 PLN is assumed')));
});

test('a description that rules out a building fee beats the assumption', () => {
  const result = classify(offer({ rentPln: null, description: 'bez czynszu administracyjnego' }));
  assert.equal(result.costCertainty, 'exact');
  assert.equal(result.totalCostPln, 2000);
});

test('a stated building fee beats the assumption', () => {
  const result = classify(offer({ rentPln: 700, description: 'Przytulna kawalerka.' }));
  assert.equal(result.costCertainty, 'exact');
  assert.equal(result.totalCostPln, 2700);
});

test('stated utilities are added on top of the fee', () => {
  const result = classify(offer({ description: 'media 400 zł miesięcznie' }));
  assert.equal(result.totalCostPln, 2700);
  // Over the all-in limit, but the rent alone still qualifies.
  assert.equal(result.tier, 'worth');
});

test('utilities listed after the building fee are counted once, not lost', () => {
  // This used to come out at 2300 with the utilities dropped. The reader refused any
  // figure with the word "czynsz" nearby, so a price list naming both in one sentence
  // lost the second half of it. The fee is still not double counted: 300 comes from the
  // portal field, and the 300 in the text is not added to it.
  const result = classify(offer({ description: 'czynsz 300 zł, media 400 zł' }));
  assert.equal(result.totalCostPln, 2700);
  assert.equal(result.costCertainty, 'exact');
});

test('an estimated total can still reach the priority tier', () => {
  // The whole point of assuming a fee: a silent listing gets judged on a realistic
  // figure instead of sitting in a tier nobody reads.
  const result = classify(offer({ pricePln: 2100, rentPln: null, description: 'Kawalerka.' }));
  assert.equal(result.tier, 'top');
  assert.equal(result.costCertainty, 'estimated');
});

test('rent above the lower limit still reaches top when the total fits', () => {
  const result = classify(offer({ pricePln: 2400, rentPln: 150 }));
  assert.equal(result.tier, 'top');
  assert.equal(result.totalCostPln, 2550);
});

test('an expensive flat with an expensive fee is rejected outright', () => {
  const result = classify(offer({ pricePln: 2500, rentPln: 800 }));
  assert.equal(result.tier, 'other');
});

test('both limits are inclusive', () => {
  assert.equal(classify(offer({ pricePln: 2300, rentPln: 300 })).tier, 'top');
  assert.equal(classify(offer({ pricePln: 2200, rentPln: 900 })).tier, 'worth');
});

test('a listing with no rent stated cannot be judged', () => {
  const result = classify(offer({ pricePln: null }));
  assert.equal(result.tier, 'other');
  assert.equal(result.totalCostPln, null);
  assert.equal(result.costCertainty, 'uncertain');
});

test('every verdict explains itself', () => {
  for (const sample of [offer(), offer({ district: 'Czyżyny' }), offer({ pricePln: null })]) {
    assert.ok(classify(sample).reasons.length > 0);
  }
});

test('a parking space advertised as a flat is not judged as one', () => {
  const result = classify(
    offer({ title: 'platforma garażowa na poziomie nr -2', areaM2: 12, pricePln: 350 }),
  );
  assert.equal(result.tier, 'other');
  assert.equal(result.totalCostPln, null);
});

test('a flat that comes with a garage is still a flat', () => {
  const result = classify(
    offer({ title: 'Jasna kawalerka | Garaż + komórka lokatorska', areaM2: 28 }),
  );
  assert.notEqual(result.totalCostPln, null);
});
