import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readMarks, withMarks, writeMarks, type MarkStorage } from './marks.ts';
import type { Mark, Offer } from './types.ts';

function storage(initial: string | null = null): MarkStorage & { value: string | null } {
  return {
    value: initial,
    getItem() {
      return this.value;
    },
    setItem(_key: string, value: string) {
      this.value = value;
    },
  };
}

function offer(id: number): Offer {
  return {
    id,
    source: 'olx',
    url: `https://www.olx.pl/d/oferta/${id}`,
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
  };
}

test('a mark survives a write and a read', () => {
  const store = storage();
  writeMarks(store, new Map<number, Mark>([[7, 'favourite']]));
  assert.deepEqual([...readMarks(store)], [[7, 'favourite']]);
});

test('an empty store reads as no marks', () => {
  assert.equal(readMarks(storage()).size, 0);
});

test('a corrupt store costs the marks, not the page', () => {
  // Local storage is editable by hand, so this is a case rather than an impossibility.
  assert.equal(readMarks(storage('{not json')).size, 0);
  assert.equal(readMarks(storage('[1,2,3]')).size, 0);
  assert.equal(readMarks(storage('"favourite"')).size, 0);
});

test('entries that are not marks are dropped one by one', () => {
  const store = storage('{"1":"favourite","2":"deleted","abc":"rejected","3":null}');
  assert.deepEqual([...readMarks(store)], [[1, 'favourite']]);
});

test('the list arrives unmarked and is stamped on the way in', () => {
  const marks = new Map<number, Mark>([
    [1, 'favourite'],
    [2, 'rejected'],
  ]);
  const stamped = withMarks([offer(1), offer(2), offer(3)], marks);
  assert.deepEqual(
    stamped.map((item) => item.mark),
    ['favourite', 'rejected', null],
  );
});
