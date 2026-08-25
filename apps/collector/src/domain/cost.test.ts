import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readDescriptionCosts, toPlainText } from './cost.ts';

/**
 * Every string below is a real fragment of an OLX description, kept as written, typos
 * and all. They exist because the first version of this parser read half of them wrong:
 * it counted the building fee as utilities, took a garage space for electricity and
 * found 1000 PLN of media in a description of the kitchen.
 */

test('reads an amount the description states plainly', () => {
  const reading = readDescriptionCosts('media w wysokości 650zł (ogrzewanie, prąd)');
  assert.equal(reading.utilitiesPln, 650);
});

test('reads an amount separated from the word by a few words', () => {
  const reading = readDescriptionCosts('prąd według zużycia około 120zł');
  assert.equal(reading.utilitiesPln, 120);
});

test('reads an amount that comes before the word', () => {
  const reading = readDescriptionCosts('najmu 2700 zł + ok. 850 zł opłat dodatkowych');
  assert.equal(reading.utilitiesPln, 850);
});

test('skips the building fee and takes the utilities that follow', () => {
  const reading = readDescriptionCosts(
    'opłaty administracyjne przy 2 osobach: 680 zł, zaliczka na prąd 70 zł',
  );
  assert.equal(reading.utilitiesPln, 70);
});

test('does not read the building fee as utilities', () => {
  // The portal reports this number separately, so counting it here would double it.
  const reading = readDescriptionCosts('czynsz administracyjny 1064 pln + prąd');
  assert.equal(reading.utilitiesPln, null);
});

test('does not read a parking space as utilities', () => {
  const reading = readDescriptionCosts(
    'miejsce parkingowe w garażu podziemnym za dodatkową opłata 400zł',
  );
  assert.equal(reading.utilitiesPln, null);
});

test('does not read kitchen equipment as utilities', () => {
  const reading = readDescriptionCosts('kuchnia wyposażona w kuchenkę gazową, meble za 1000 zł');
  assert.equal(reading.utilitiesPln, null);
});

test('reports metered utilities without a figure as a mention and no amount', () => {
  const reading = readDescriptionCosts('prąd według zużycia');
  assert.equal(reading.utilitiesPln, null);
  assert.equal(reading.mentionsUtilities, true);
});

test('recognises a description that says everything is included', () => {
  assert.equal(readDescriptionCosts('łaczna kwota 2790 zł już ze wszystkim').allIn, true);
  assert.equal(readDescriptionCosts('media wliczone w cenę').allIn, true);
});

test('silence about utilities is reported as silence, not as zero', () => {
  const reading = readDescriptionCosts('Przytulna kawalerka blisko centrum.');
  assert.equal(reading.utilitiesPln, null);
  assert.equal(reading.mentionsUtilities, false);
});

test('reads utilities stated after the building fee, in a sentence of their own', () => {
  // The veto used to look 40 characters back and step straight over the full stop, so the
  // word "czynsz" one sentence earlier disqualified a figure it had nothing to do with.
  assert.equal(readDescriptionCosts('Czynsz: 800 PLN. Media: 100 PLN.').utilitiesPln, 100);
});

test('reads utilities listed as the next item after the building fee', () => {
  const reading = readDescriptionCosts('czynsz administracyjny 800 zł, media 250 zł wg zużycia');
  assert.equal(reading.utilitiesPln, 250);
});

test('still refuses a figure the same clause calls a building fee', () => {
  assert.equal(readDescriptionCosts('opłaty administracyjne 680 zł').utilitiesPln, null);
});

test('still refuses a figure the sentence attaches to a garage', () => {
  assert.equal(readDescriptionCosts('do tego dochodzi garaż, opłata 400 zł').utilitiesPln, null);
});

test('recognises a description that rules out a building fee', () => {
  assert.equal(readDescriptionCosts('bez czynszu administracyjnego').noFee, true);
  assert.equal(readDescriptionCosts('brak czynszu').noFee, true);
  assert.equal(readDescriptionCosts('czynsz administracyjny 500 zł').noFee, false);
  assert.equal(readDescriptionCosts('czynsz 0 zł').noFee, true);
  // The zero inside the amount, not a zero fee. This read 38 listings as fee-free.
  assert.equal(readDescriptionCosts('Czynsz: 800 PLN').noFee, false);
  assert.equal(readDescriptionCosts('czynsz administracyjny 1000 zł').noFee, false);
});

test('a missing description reads as saying nothing rather than throwing', () => {
  const reading = readDescriptionCosts(null);
  assert.equal(reading.utilitiesPln, null);
  assert.equal(reading.allIn, false);
  assert.equal(reading.noFee, false);
});

test('rejects figures too small or too large to be utilities', () => {
  assert.equal(readDescriptionCosts('prąd 20 zł').utilitiesPln, null);
  assert.equal(readDescriptionCosts('media 3000 zł').utilitiesPln, null);
});

test('strips the HTML the portal wraps descriptions in', () => {
  const text = toPlainText('<strong>Opłaty</strong>&nbsp;<br />media 500 zł');
  assert.equal(text.includes('<'), false);
  assert.equal(text.includes('&nbsp;'), false);
  assert.equal(readDescriptionCosts('<strong>media</strong>&nbsp;500 zł').utilitiesPln, 500);
});
