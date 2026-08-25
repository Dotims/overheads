export type Tier = 'top' | 'worth' | 'other';
export type CostCertainty = 'exact' | 'all_in' | 'estimated' | 'uncertain';

/** What the owner decided, as opposed to what the rules decided. */
export type Mark = 'favourite' | 'rejected';

/**
 * Mirrors `ClassifiedOffer` in the collector. Copied rather than imported: the packages
 * compile with different module settings. Drift throws on the collector side first.
 */
export interface Offer {
  id: number;
  source: string;
  url: string;
  title: string;
  district: string | null;
  areaM2: number | null;
  rooms: number | null;
  floor: string | null;
  pricePln: number | null;
  rentPln: number | null;
  totalCostPln: number | null;
  /** The total split across the rooms, which is what one person actually pays. */
  costPerPersonPln: number | null;
  tier: Tier;
  costCertainty: CostCertainty;
  reasons: string[];
  isPrivateOwner: boolean | null;
  lat: number | null;
  lng: number | null;
  coordsPrecision: string | null;
  createdAtSource: string | null;
  firstSeenAt: string;
  mark: Mark | null;
  /** The first photograph. The rest come from the detail endpoint, on demand. */
  photo: string | null;
  photoCount: number;
  /** The same flat advertised elsewhere. Kept out of the list, reachable from here. */
  alsoOn: { source: string; url: string }[];
}

/** When each portal was last collected, and whether that round worked. */
export interface SourceStatus {
  source: string;
  lastCollectedAt: string | null;
  ok: boolean | null;
  itemsSeen: number;
}

/** One listing in full, fetched only when a card or marker is opened. */
export interface OfferDetail {
  id: number;
  source: string;
  url: string;
  title: string;
  description: string | null;
  photos: string[];
}

export type SortKey = 'newest' | 'cheapest' | 'largest';
