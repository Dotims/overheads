import { area, pln, pricePerM2, rooms, since } from '../format.ts';
import { CERTAINTY, TIER } from '../tiers.ts';
import type { Mark, Offer } from '../types.ts';
import { MarkControls } from './MarkControls.tsx';
import { OfferPhoto, type PhotoLayout } from './OfferPhoto.tsx';

export function OfferCard({
  offer,
  active,
  selected,
  layout,
  isNew,
  onHover,
  onSelect,
  onMark,
}: {
  offer: Offer;
  active: boolean;
  selected: boolean;
  /** A row in a list, or a tile in a grid. Only the photograph's place differs. */
  layout: PhotoLayout;
  /** Turned up since this browser last looked. */
  isNew: boolean;
  onHover: (id: number | null) => void;
  onSelect: () => void;
  onMark: (next: Mark | null) => void;
}) {
  const tier = TIER[offer.tier];
  const certainty = CERTAINTY[offer.costCertainty];

  return (
    <article
      onMouseEnter={() => onHover(offer.id)}
      onMouseLeave={() => onHover(null)}
      onClick={onSelect}
      // h-full so the card fills the grid row rather than setting its own height; the
      // parts inside then reserve their space so a one-line title cannot shrink it.
      // overflow-hidden so the photograph is clipped to the card's own corners.
      className={`rule @container relative flex h-full overflow-hidden rounded-xl bg-graphite-950 transition-colors duration-150 ${
        layout === 'row' ? 'flex-row' : 'flex-col'
      } ${offer.mark === 'rejected' ? 'opacity-55' : ''} ${
        selected
          ? 'border-signal-400/70 bg-graphite-900'
          : active
            ? 'border-signal-400/45 bg-graphite-900'
            : 'hover:border-line-strong'
      }`}
    >
      <OfferPhoto offer={offer} layout={layout} />

      {/* min-w-0 so the truncation inside actually happens: a flex child defaults to its
          content's width, and the district line would push the card wider instead. */}
      <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            {/* One line, never two: the tags are short and wrapping them moved the title. */}
            <div className="flex items-center gap-x-2 overflow-hidden text-nowrap">
              {/* Filled rather than outlined, and first in the row: this is the one label
                  here that answers "is there any point reading on", so it has to win
                  against a line of tags that all look alike. */}
              {isNew && (
                <span className="tag rounded-full bg-signal-500 px-1.5 py-0.5 text-on-signal">
                  nowe
                </span>
              )}
              <span className={`tag ${offer.tier === 'top' ? 'text-signal-400' : ''}`}>
                {tier.label}
              </span>
              <span className="tag">/ {offer.source}</span>
              {offer.isPrivateOwner === true && <span className="tag">/ prywatne</span>}
              {/* The same flat advertised twice. Hidden from the list, not from the owner. */}
              {offer.alsoOn.map((other) => (
                <a
                  key={other.url}
                  href={other.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  onClick={(event) => event.stopPropagation()}
                  title={`To samo mieszkanie wystawione również na ${other.source}`}
                  className="tag text-signal-400 underline-offset-4 hover:underline"
                >
                  / też na {other.source} ↗
                </a>
              ))}
            </div>

            {/* Two lines of room whether the title needs them or not. */}
            <a
              href={offer.url}
              target="_blank"
              rel="noreferrer noopener"
              onClick={(event) => event.stopPropagation()}
              title={offer.title}
              // No `block` here: it sets display and beats line-clamp's own, which is why
              // long titles were running to three lines and pushing the card taller.
              className="mt-2 line-clamp-2 min-h-[2.625rem] text-[0.95rem] leading-snug font-medium text-ink wrap-anywhere underline-offset-4 transition-colors hover:text-signal-300 hover:underline"
            >
              {offer.title}
            </a>
          </div>

          <div className="shrink-0 text-right">
            <div
              className={`num text-2xl leading-none ${offer.tier === 'top' ? 'lit-num' : 'text-ink'}`}
            >
              {pln(offer.totalCostPln)}
            </div>
            <div className="tag mt-1.5 normal-case" title={certainty.hint}>
              {certainty.label}
            </div>
            {/* Only where sharing changes the figure. On a one-room flat it would just be
                the number above again, printed twice. */}
            {offer.costPerPersonPln !== null && offer.costPerPersonPln !== offer.totalCostPln && (
              <div
                className="num mt-1 text-sm text-ink-dim"
                title={`Całość podzielona na ${String(offer.rooms ?? 1)} os.`}
              >
                {pln(offer.costPerPersonPln)} / os.
              </div>
            )}
          </div>
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-line pt-3 @lg:grid-cols-4">
          {[
            ['dzielnica', offer.district ?? 'brak'],
            ['metraż', area(offer.areaM2)],
            ['pokoje', rooms(offer.rooms)],
            ['najem/m²', pricePerM2(offer.pricePln, offer.areaM2)],
          ].map(([label, value]) => (
            <div key={label} className="min-w-0">
              <dt className="tag">{label}</dt>
              {/* One line each. "Łagiewniki-Borek Fałęcki" wrapped in a narrow column and
                took the whole card twenty pixels taller than its neighbour. */}
              <dd className="num mt-0.5 truncate text-sm text-ink-dim" title={value}>
                {value}
              </dd>
            </div>
          ))}
        </dl>

        {/* mt-auto so this sits on the floor of the card however tall the row makes it. */}
        <div className="mt-auto flex items-center justify-between gap-3 pt-3 text-xs">
          <span className="num text-ink-faint">
            {offer.rentPln === null
              ? `${pln(offer.pricePln)} · czynsz niepodany`
              : `${pln(offer.pricePln)} + ${pln(offer.rentPln)} czynszu`}
          </span>
          <div className="flex items-center gap-3">
            <span className="num text-ink-faint">{since(offer.createdAtSource)}</span>
            <MarkControls mark={offer.mark} onChange={onMark} />
          </div>
        </div>
      </div>
    </article>
  );
}
