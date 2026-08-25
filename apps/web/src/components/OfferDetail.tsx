import { useEffect, useState } from 'react';
import { area, pln, rooms, since } from '../format.ts';
import { CERTAINTY, TIER } from '../tiers.ts';
import type { Mark, Offer, OfferDetail as Detail } from '../types.ts';
import { MarkControls } from './MarkControls.tsx';

/**
 * Descriptions are portal HTML written by strangers. It is flattened to text and
 * rendered as text; nothing here ever reaches innerHTML.
 */
function toText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function OfferDetail({
  offer,
  onClose,
  onMark,
}: {
  offer: Offer;
  onClose: () => void;
  onMark: (next: Mark | null) => void;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [failed, setFailed] = useState(false);
  const [photo, setPhoto] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setDetail(null);
    setFailed(false);
    setPhoto(0);

    fetch(`/api/offers/${offer.id}`, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status));
        return response.json() as Promise<Detail>;
      })
      .then(setDetail)
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });

    return () => controller.abort();
  }, [offer.id]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const photos = detail?.photos ?? [];
  const current = photos[photo];

  return (
    <aside
      aria-label="Szczegóły oferty"
      className="rule flex h-full flex-col overflow-hidden rounded-xl bg-graphite-950"
    >
      <header className="flex items-start justify-between gap-3 border-b border-line p-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2">
            <span className={`tag ${offer.tier === 'top' ? 'text-signal-400' : ''}`}>
              {TIER[offer.tier].label}
            </span>
            <span className="tag text-ink-faint">/ {offer.source}</span>
          </div>
          <h3 className="mt-1 text-sm leading-snug font-medium text-ink">{offer.title}</h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Zamknij szczegóły"
          className="tag shrink-0 rounded-full border border-line px-2.5 py-1 normal-case transition-colors hover:border-line-strong hover:text-ink-dim"
        >
          zamknij
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {current !== undefined && (
          <div className="relative">
            <img
              src={current}
              alt={`Zdjęcie ${photo + 1} z ${photos.length}`}
              loading="lazy"
              className="aspect-[4/3] w-full bg-graphite-900 object-cover"
            />
            {/* A photograph brings its own ground, so this strip stays dark in both themes. */}
            {photos.length > 1 && (
              <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-scrim/90 to-transparent p-2">
                <button
                  type="button"
                  onClick={() => setPhoto((index) => (index - 1 + photos.length) % photos.length)}
                  className="tag rounded-full border border-white/25 bg-scrim/70 px-2.5 py-1 text-white/80 normal-case"
                >
                  ‹
                </button>
                <span className="num text-[0.7rem] text-white/80">
                  {photo + 1} / {photos.length}
                </span>
                <button
                  type="button"
                  onClick={() => setPhoto((index) => (index + 1) % photos.length)}
                  className="tag rounded-full border border-white/25 bg-scrim/70 px-2.5 py-1 text-white/80 normal-case"
                >
                  ›
                </button>
              </div>
            )}
          </div>
        )}

        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 p-4">
          {[
            ['razem', pln(offer.totalCostPln)],
            ['na osobę', pln(offer.costPerPersonPln)],
            ['skąd kwota', CERTAINTY[offer.costCertainty].label],
            ['najem', pln(offer.pricePln)],
            ['czynsz', offer.rentPln === null ? 'niepodany' : pln(offer.rentPln)],
            ['dzielnica', offer.district ?? 'brak'],
            ['metraż', area(offer.areaM2)],
            ['pokoje', rooms(offer.rooms)],
            ['dodane', since(offer.createdAtSource)],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="tag">{label}</dt>
              <dd className="num mt-0.5 text-sm text-ink-dim">{value}</dd>
            </div>
          ))}
        </dl>

        {offer.reasons.length > 0 && (
          <div className="border-t border-line p-4">
            <span className="tag">jak policzono</span>
            <ul className="mt-2 grid gap-1.5">
              {offer.reasons.map((reason) => (
                <li key={reason} className="text-xs leading-relaxed text-ink-dim">
                  {reason}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="border-t border-line p-4">
          <span className="tag">opis</span>
          {failed ? (
            <p className="mt-2 text-xs text-danger">Nie udało się pobrać szczegółów.</p>
          ) : detail === null ? (
            <p className="tag mt-2 animate-drift normal-case">wczytuję…</p>
          ) : detail.description === null ? (
            <p className="mt-2 text-xs text-ink-faint">Ogłoszenie nie ma opisu.</p>
          ) : (
            <p className="mt-2 text-xs leading-relaxed whitespace-pre-line text-ink-dim">
              {toText(detail.description)}
            </p>
          )}
        </div>
      </div>

      <footer className="flex items-center gap-3 border-t border-line p-4">
        <MarkControls mark={offer.mark} onChange={onMark} />
        <a
          href={offer.url}
          target="_blank"
          rel="noreferrer noopener"
          className="block flex-1 rounded-full bg-gradient-to-r from-signal-400 to-signal-600 px-4 py-2 text-center font-mono text-[0.6875rem] tracking-[0.08em] text-on-signal uppercase transition-opacity hover:opacity-90"
        >
          otwórz na {offer.source}
        </a>
      </footer>
    </aside>
  );
}
