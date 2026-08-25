/**
 * Reads monthly costs out of the listing description. Reports only what a description
 * states; deciding what a silence is worth belongs in classify.ts.
 */

export interface DescriptionCosts {
  /** Utilities on top of rent and building fee, in whole PLN. */
  utilitiesPln: number | null;
  allIn: boolean;
  noFee: boolean;
  mentionsUtilities: boolean;
}

/** For matching only. The dashboard must escape the original text itself. */
export function toPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/[ \t]+/g, ' ')
    .toLowerCase();
}

/** "wszystko w cenie", "media wliczone", "już ze wszystkim". */
const ALL_IN_PATTERNS = [
  /(?:media|mediami|opłat\w*|wszystk\w*|liczniki)[^.\n]{0,30}?(?:w cenie|wliczon\w*|w czynszu)/,
  /(?:w cenie|wliczon\w*)[^.\n]{0,30}?(?:media|mediami|opłat\w*|wszystk\w*)/,
  /ze wszystkim/,
  /bez dodatkowych opłat/,
];

const UTILITY_MENTION = /\b(?:media|mediów|mediami|prąd\w*|gaz\w*|wod[ayę]|liczniki|zużyci\w*)\b/;

/** "bez czynszu", "brak czynszu administracyjnego". */
const NO_FEE_PATTERNS = [
  /(?:bez|brak|nie ma|zero)\s+(?:opłat\w*\s+)?czynsz\w*/,
  // The zero must stand alone. As a bare alternative it matched the last digit of
  // "czynsz: 800 pln", and 38 listings were being told they had no building fee at all.
  /czynsz\w*[^.\n]{0,15}?(?:(?<!\d)0(?!\d)|brak|zero)\s*(?:zł|zl|pln)?\b/,
];

const MONEY = String.raw`(\d{1,2}[\s.]?\d{3}|\d{2,4})\s*(?:zł|zl|pln)`;

// No "gaz" or "woda": they match "kuchenka gazowa" and "ciepła woda z sieci miejskiej".
const AMOUNT_WORD = String.raw`(?:media|mediów|mediami|prąd\w*|opłat\w*)`;

/** "media 650 zł", "zaliczka na prąd 70 zł". */
const AMOUNT_AFTER_WORD = new RegExp(`${AMOUNT_WORD}[^.\\n]{0,25}?${MONEY}`, 'g');
/** "850 zł opłat dodatkowych". Only "opłat" may follow, or the building fee gets counted. */
const AMOUNT_BEFORE_WORD = new RegExp(`${MONEY}[^.\\n]{0,10}?opłat\\w*`, 'g');

// A figure surrounded by these is not utilities. "najem" is deliberately absent: it
// blocked "cena najmu 2700 zł + ok. 850 zł opłat dodatkowych".
//
// Split by how far a word reaches. A fee word names a separate line item, and a line item
// ends at the comma: reading past it made "czynsz administracyjny 800 zł, media 250 zł"
// throw away a figure that was plainly stated, which is most of why two thirds of the
// listings naming utilities yielded no amount at all. An object word names what the money
// buys and sits further from it, so those still reach across the whole sentence.
const FEE_WORDS = /czynsz|administracyjn|eksploatacyjn|spółdziel/;
const OBJECT_WORDS = /kaucj|garaż|gazraż|parking|postojow|piwnic/;

// Reaches further back than forward: Polish puts the qualifier first.
const CONTEXT_BEFORE = 40;
const CONTEXT_AFTER = 20;

/** The last full stop, which the matching patterns above already refuse to cross. */
const SENTENCE_START = /[.\n][^.\n]*$/;
/** The last item separator. A price list puts one line item per comma or plus sign. */
const CLAUSE_START = /[.,;+\n][^.,;+\n]*$/;

/** Everything after the last match of `pattern`, or all of `text` when it does not match. */
function tail(text: string, pattern: RegExp): string {
  return text.slice(text.search(pattern) + 1);
}

/** Whether the words around a figure say it is something other than utilities. */
function vetoed(text: string, start: number, end: number): boolean {
  const before = text.slice(Math.max(0, start - CONTEXT_BEFORE), start);
  const figure = text.slice(start, end);
  const after = text.slice(end, end + CONTEXT_AFTER);

  const sentenceAfter = after.split(/[.\n]/)[0] ?? '';
  if (OBJECT_WORDS.test(tail(before, SENTENCE_START) + figure + sentenceAfter)) return true;

  return FEE_WORDS.test(tail(before, CLAUSE_START) + figure);
}

// Below this is an internet add-on, above it is the rent standing next to the word.
const MIN_UTILITIES_PLN = 30;
const MAX_UTILITIES_PLN = 1_500;

function toAmount(digits: string): number | null {
  const value = Number(digits.replace(/[\s.]/g, ''));
  if (!Number.isFinite(value)) return null;
  if (value < MIN_UTILITIES_PLN || value > MAX_UTILITIES_PLN) return null;

  return value;
}

// Walks every match: the fee is often listed before the utilities, so the first hit is
// frequently the wrong number.
function firstUsableAmount(text: string, pattern: RegExp): number | null {
  for (const match of text.matchAll(pattern)) {
    const digits = match[1];
    if (digits === undefined) continue;

    if (vetoed(text, match.index, match.index + match[0].length)) continue;

    const amount = toAmount(digits);
    if (amount !== null) return amount;
  }

  return null;
}

export function readDescriptionCosts(description: string | null): DescriptionCosts {
  if (description === null) {
    return { utilitiesPln: null, allIn: false, noFee: false, mentionsUtilities: false };
  }

  const text = toPlainText(description);
  const mentionsUtilities = UTILITY_MENTION.test(text);

  if (ALL_IN_PATTERNS.some((pattern) => pattern.test(text))) {
    return { utilitiesPln: null, allIn: true, noFee: false, mentionsUtilities };
  }

  const utilitiesPln =
    firstUsableAmount(text, AMOUNT_AFTER_WORD) ?? firstUsableAmount(text, AMOUNT_BEFORE_WORD);

  return {
    utilitiesPln,
    allIn: false,
    noFee: NO_FEE_PATTERNS.some((pattern) => pattern.test(text)),
    mentionsUtilities,
  };
}
