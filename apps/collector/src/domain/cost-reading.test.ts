import assert from 'node:assert/strict';
import { test } from 'node:test';
import { monthlyExtras, readModelAnswer, sharedBy } from './cost-reading.ts';

/** The shape the model is asked for, so each test can spoil exactly one field. */
function answer(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    rentPln: 2400,
    feePln: 500,
    utilitiesPln: 200,
    internetPln: 60,
    depositPln: 2400,
    feeIncludesUtilities: false,
    utilitiesMetered: false,
    forPeople: null,
    ...overrides,
  };
}

test('reads the figures the model reported', () => {
  const reading = readModelAnswer(answer());
  assert.equal(reading.rentPln, 2400);
  assert.equal(reading.feePln, 500);
  assert.equal(reading.utilitiesPln, 200);
});

test('drops a figure of the wrong magnitude rather than believing it', () => {
  // The failure a small model actually produces: the right shape, the wrong size.
  assert.equal(readModelAnswer(answer({ utilitiesPln: 250_000 })).utilitiesPln, null);
  assert.equal(readModelAnswer(answer({ rentPln: 12 })).rentPln, null);
  assert.equal(readModelAnswer(answer({ internetPln: 9_000 })).internetPln, null);
});

test('drops a building fee repeated from the rent', () => {
  const reading = readModelAnswer(answer({ rentPln: 2400, feePln: 2400 }));
  assert.equal(reading.rentPln, 2400);
  assert.equal(reading.feePln, null);
});

test('an unusable answer reads as a listing that said nothing, not a crash', () => {
  for (const nonsense of [null, undefined, 'nope', 42, []]) {
    const reading = readModelAnswer(nonsense);
    assert.equal(reading.rentPln, null);
    assert.equal(reading.feeIncludesUtilities, false);
  }
});

test('a missing boolean is false rather than true', () => {
  const reading = readModelAnswer({ rentPln: 2400 });
  assert.equal(reading.utilitiesMetered, false);
  assert.equal(reading.feeIncludesUtilities, false);
});

test('a fee that covers the supplies contributes no utilities on top', () => {
  const reading = readModelAnswer(answer({ feeIncludesUtilities: true, utilitiesPln: 200 }));
  assert.equal(monthlyExtras(reading).utilitiesPln, 0);
  // The internet is priced separately from the fee, so it survives.
  assert.equal(monthlyExtras(reading).internetPln, 60);
});

test('the total is split by room count', () => {
  assert.equal(sharedBy(readModelAnswer(answer()), 2), 2);
  assert.equal(sharedBy(readModelAnswer(answer()), 1), 1);
});

test('a flat with more rooms than a household is capped rather than divided by', () => {
  // Otherwise a nine room listing prints the cheapest figure on the page.
  assert.equal(sharedBy(readModelAnswer(answer()), 9), 6);
});

test('what the fees are quoted for is used only when no room count exists', () => {
  const reading = readModelAnswer(answer({ forPeople: 2 }));
  assert.equal(sharedBy(reading, null), 2);
  // A one-room flat quoted for two people is still one room.
  assert.equal(sharedBy(reading, 1), 1);
});

test('no reading and no room count is one person, not zero', () => {
  assert.equal(sharedBy(null, null), 1);
});
