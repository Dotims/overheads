import { divIcon, type LatLngBounds, type Marker as LeafletMarker, type PopupEvent } from 'leaflet';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet';
import { area, pln, rooms, since } from '../format.ts';
import { isNewSince } from '../seen.ts';
import type { Theme } from '../theme.ts';
import type { Mark, Offer } from '../types.ts';
import { MarkControls } from './MarkControls.tsx';

const KRAKOW: [number, number] = [50.0614, 19.9372];

// Esri's grey canvas: needs no key, and is cached down to level 16; Leaflet scales it past that.
const TILES: Record<Theme, string> = {
  dark: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
  light:
    'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
};
const TILES_NATIVE_MAX_ZOOM = 16;

/** Otodom pins a real address; OLX reports an area centre and the marker says so. */
function isExact(offer: Offer): boolean {
  return offer.coordsPrecision === 'exact';
}

function shortPrice(value: number | null): string {
  if (value === null) return '?';
  return `${Math.round(value / 100) / 10}k`;
}

/**
 * The price is what the user compares, so the price is the marker. A dot forces a hover
 * and a glance back at the list before it says anything. Colours come from the theme
 * tokens rather than literals, because this markup is built by hand and would otherwise
 * stay dark on a white map.
 */
function priceMarker(offer: Offer, active: boolean, selected: boolean, isNew: boolean) {
  const top = offer.tier === 'top';
  const borderColor =
    selected || active
      ? 'var(--color-signal-400)'
      : isNew
        ? 'var(--color-signal-500)'
        : top
          ? 'color-mix(in srgb, var(--color-signal-400) 55%, transparent)'
          : 'var(--color-line-strong)';

  // Both rings can be on at once, because being selected and being new say different
  // things and dropping one for the other is how an arrival goes unnoticed.
  const rings = [
    selected ? '0 0 0 3px color-mix(in srgb, var(--color-signal-400) 28%, transparent)' : null,
    isNew ? NEW_HALO : null,
  ].filter((ring) => ring !== null);

  const border = `border-color:${borderColor}${rings.length > 0 ? `;box-shadow:${rings.join(',')}` : ''}`;

  return divIcon({
    className: '',
    iconSize: [58, 24],
    iconAnchor: [29, 12],
    html: `<span style="
        display:flex;align-items:center;justify-content:center;gap:2px;
        width:58px;height:24px;border:1px solid;border-radius:9999px;
        background:${selected || active ? 'var(--color-graphite-800)' : 'color-mix(in srgb, var(--color-graphite-950) 92%, transparent)'};
        font:500 11px/1 ui-monospace,SFMono-Regular,Menlo,monospace;
        color:${top ? 'var(--color-signal-300)' : 'var(--color-ink-dim)'};letter-spacing:-.01em;${border}">
        ${isExact(offer) ? '' : '<span style="opacity:.5;font-size:9px">~</span>'}${shortPrice(offer.totalCostPln)}
      </span>`,
  });
}

/**
 * A stand-in for a listing whose price label had no room to be drawn. At 10px with a
 * hairline border these read as specks of tile noise rather than as listings, and they
 * are the majority of what the map draws once the centre fills up. 16px with a 2px
 * border and a ring of ground colour behind it survives both tile sets.
 */
const DOT = 16;

/**
 * What marks a listing that turned up since this browser last looked. A glow rather than
 * the word, because the word does not fit on a 58px price pill and a map at city zoom is
 * read by scanning rather than by reading. The word itself is on the card and in the
 * popup, where there is room for it.
 */
const NEW_HALO =
  '0 0 0 2px var(--color-signal-500),0 0 12px 2px color-mix(in srgb, var(--color-signal-500) 45%, transparent)';

function dotMarker(offer: Offer, active: boolean, selected: boolean, isNew: boolean) {
  const lit = active || selected || offer.tier === 'top' || isNew;
  // The ground ring stops a dot dissolving into a busy tile; the halo sits outside it.
  const ground = '0 0 0 1.5px color-mix(in srgb, var(--color-void) 65%, transparent)';

  return divIcon({
    className: '',
    iconSize: [DOT, DOT],
    iconAnchor: [DOT / 2, DOT / 2],
    html: `<span style="
      display:block;width:${DOT}px;height:${DOT}px;border-radius:9999px;
      border:2px solid ${lit ? 'var(--color-signal-400)' : 'var(--color-line-strong)'};
      background:${isNew ? 'var(--color-signal-500)' : lit ? 'color-mix(in srgb, var(--color-signal-500) 55%, transparent)' : 'var(--color-graphite-800)'};
      box-shadow:${isNew ? `${ground},${NEW_HALO}` : ground};
    "></span>`,
  });
}

const LABEL_W = 62;
const LABEL_H = 28;

/**
 * Which listings get to show their price. Every label at once turns the centre into a
 * pile of overlapping pills, so the cheapest claims its space first and anything that
 * would land on top of an accepted label falls back to a dot. Zooming in frees room and
 * more prices appear, which is also how the portals do it.
 *
 * Projected at the current zoom rather than to screen coordinates, so panning does not
 * reshuffle the labels underneath the cursor.
 */
function useLabelled(offers: Offer[], keep: (number | null)[]): Set<number> {
  const map = useMap();
  const [zoom, setZoom] = useState(() => map.getZoom());

  useEffect(() => {
    const update = () => setZoom(map.getZoom());
    map.on('zoomend', update);
    return () => {
      map.off('zoomend', update);
    };
  }, [map]);

  return useMemo(() => {
    const ordered = [...offers].sort((a, b) => {
      const forced = (offer: Offer) => (keep.includes(offer.id) ? 0 : 1);
      if (forced(a) !== forced(b)) return forced(a) - forced(b);
      return (a.totalCostPln ?? Infinity) - (b.totalCostPln ?? Infinity);
    });

    const taken: { x: number; y: number }[] = [];
    const labelled = new Set<number>();

    for (const offer of ordered) {
      const point = map.project([offer.lat as number, offer.lng as number], zoom);
      const clear = taken.every(
        (other) => Math.abs(other.x - point.x) >= LABEL_W || Math.abs(other.y - point.y) >= LABEL_H,
      );

      if (clear) {
        taken.push({ x: point.x, y: point.y });
        labelled.add(offer.id);
      }
    }

    return labelled;
  }, [offers, keep, map, zoom]);
}

/**
 * How far past the edge of the window a listing still gets a pin, as a fraction of the
 * view. A fifth either way, so a short drag uncovers pins that are already drawn instead
 * of an empty margin waiting for the gesture to end.
 */
const VIEWPORT_MARGIN = 0.2;

/**
 * Only the listings on screen. Two thousand of them carry coordinates and drawing all of
 * them at once is what makes the map heavy: every pin is a DOM node, and Leaflet compares
 * icons by object identity, so one hover used to rebuild two thousand of them.
 *
 * The ones something is pointing at are kept whatever the view, because a selection can
 * fly to a pin that is currently off screen and the flight needs a marker to open when it
 * lands. `moveend` rather than `move`: recomputing mid-drag is the cost this avoids.
 */
function useVisible(offers: Offer[], keep: (number | null)[]): Offer[] {
  const map = useMap();
  const [bounds, setBounds] = useState<LatLngBounds>(() => map.getBounds().pad(VIEWPORT_MARGIN));

  useEffect(() => {
    const update = () => setBounds(map.getBounds().pad(VIEWPORT_MARGIN));

    map.on('moveend', update);
    map.on('resize', update);
    update();

    return () => {
      map.off('moveend', update);
      map.off('resize', update);
    };
  }, [map]);

  return useMemo(
    () =>
      offers.filter(
        (offer) =>
          keep.includes(offer.id) || bounds.contains([offer.lat as number, offer.lng as number]),
      ),
    [offers, keep, bounds],
  );
}

/** Leaflet measures the container on init, before the layout has given it a height. */
function FitToContainer() {
  const map = useMap();

  useEffect(() => {
    const remeasure = () => map.invalidateSize();
    const observer = new ResizeObserver(remeasure);
    observer.observe(map.getContainer());

    remeasure();
    const frame = requestAnimationFrame(remeasure);
    const settle = setTimeout(remeasure, 300);
    window.addEventListener('resize', remeasure);

    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      clearTimeout(settle);
      window.removeEventListener('resize', remeasure);
    };
  }, [map]);

  return null;
}

/** Portal searches for Kraków return the odd listing in Wieliczka or Skawina. */
const OUTLIER_TRIM = 0.03;
const TRIM_NEEDS_AT_LEAST = 20;

function at(sorted: number[], fraction: number): number {
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.round(fraction * (sorted.length - 1))),
  );
  return sorted[index] as number;
}

/**
 * The area worth looking at, which is not the same as the area covering every pin. A
 * single advert outside the city pulled the view out until Kraków was a smudge and no
 * price label had room, so the far edges are trimmed and can be reached by zooming out.
 */
function coreBounds(points: [number, number][]): [[number, number], [number, number]] {
  const lats = points.map(([lat]) => lat).sort((a, b) => a - b);
  const lngs = points.map(([, lng]) => lng).sort((a, b) => a - b);
  if (points.length < TRIM_NEEDS_AT_LEAST) {
    return [
      [at(lats, 0), at(lngs, 0)],
      [at(lats, 1), at(lngs, 1)],
    ];
  }

  return [
    [at(lats, OUTLIER_TRIM), at(lngs, OUTLIER_TRIM)],
    [at(lats, 1 - OUTLIER_TRIM), at(lngs, 1 - OUTLIER_TRIM)],
  ];
}

/**
 * Refits only when the set of listings changes. Keyed on array identity it refitted on
 * every render, so hovering a card threw away whatever the user had just zoomed to.
 */
function Recentre({ points, fingerprint }: { points: [number, number][]; fingerprint: string }) {
  const map = useMap();

  useEffect(() => {
    map.invalidateSize();
    if (points.length > 1) map.fitBounds(coreBounds(points), { padding: [40, 40], maxZoom: 15 });
    else if (points.length === 1 && points[0] !== undefined) map.setView(points[0], 15);
    // Deliberately keyed on the fingerprint, not on points: the array is rebuilt every
    // render, and depending on it is what threw away the user's zoom.
  }, [fingerprint, map]);

  return null;
}

/** Close enough to read the street. Only used when the view is currently wider. */
const CLOSE_ZOOM = 16;
const FLIGHT_SECONDS = 0.9;

/**
 * A click in the list is answered by the map itself, rather than by a panel drawn over
 * it: the view travels to the pin and opens its preview. Its own component because
 * `useMap` only works underneath `MapContainer`, and `OfferMap` sits above it.
 *
 * The popup waits for `moveend` instead of opening with the flight. Leaflet pans a popup
 * into view as it opens, which during a flight is a second animation fighting the first,
 * and the map arrived somewhere neither of them had chosen.
 */
function FlyToSelected({
  located,
  selectedId,
  markers,
}: {
  located: Offer[];
  selectedId: number | null;
  markers: RefObject<Map<number, LeafletMarker>>;
}) {
  const map = useMap();

  // Read through a ref rather than depended on: the listing set is rebuilt on every poll
  // and on every mark, and depending on it flew the map back to the selected pin each
  // time, throwing away wherever the reader had panned to in between.
  const latest = useRef(located);
  latest.current = located;

  useEffect(() => {
    if (selectedId === null) return;

    const offer = latest.current.find((candidate) => candidate.id === selectedId);
    if (offer === undefined || offer.lat === null || offer.lng === null) return;

    // Never zooms out. Picking a listing while reading one street should not throw the
    // whole city back on screen, so this only ever closes in.
    const target = Math.max(map.getZoom(), CLOSE_ZOOM);

    const reveal = () => markers.current.get(selectedId)?.openPopup();
    map.once('moveend', reveal);
    map.flyTo([offer.lat, offer.lng], target, { duration: FLIGHT_SECONDS });

    return () => {
      // The listener is `once`, but a selection changed mid-flight would otherwise open
      // the pin we were already leaving.
      map.off('moveend', reveal);
    };
  }, [selectedId, map, markers]);

  return null;
}

/**
 * The preview a pin opens. The list already carries the first photograph, so the popup
 * has its full height the moment it opens and Leaflet's autopan brings all of it on
 * screen; a photograph fetched afterwards grew the popup past the top of the map.
 */
function PopupBody({
  offer,
  isNew,
  onMark,
}: {
  offer: Offer;
  isNew: boolean;
  onMark: (next: Mark | null) => void;
}) {
  return (
    <a
      href={offer.url}
      target="_blank"
      rel="noreferrer noopener"
      className="block w-64 no-underline"
    >
      {offer.photo !== null && (
        <img
          src={offer.photo}
          alt=""
          className="mb-2.5 aspect-[4/3] w-full rounded-lg bg-graphite-900 object-cover"
        />
      )}

      {isNew && (
        <span className="tag mb-1.5 inline-block rounded-full bg-signal-500 px-1.5 py-0.5 text-on-signal">
          nowe
        </span>
      )}

      <div className="flex items-baseline justify-between gap-2">
        <span className={`num text-lg ${offer.tier === 'top' ? 'text-signal-300' : 'text-ink'}`}>
          {pln(offer.totalCostPln)}
        </span>
        <span className="num text-sm text-ink-dim">{area(offer.areaM2)}</span>
      </div>

      <p className="mt-1 line-clamp-2 text-xs leading-snug text-ink-dim">{offer.title}</p>

      <div className="tag mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
        <span>{offer.district ?? 'bez dzielnicy'}</span>
        <span className="text-ink-mute">·</span>
        <span>{rooms(offer.rooms)}</span>
        <span className="text-ink-mute">·</span>
        <span>{since(offer.createdAtSource)}</span>
      </div>

      <div className="mt-2.5 flex items-center justify-between gap-2">
        <span className="tag text-signal-400">otwórz na {offer.source} ↗</span>
        <MarkControls mark={offer.mark} onChange={onMark} />
      </div>
    </a>
  );
}

/**
 * One listing on the map, kept out of `Pins` so React can skip it.
 *
 * Memoised on purpose. Everything a pin draws is derived from four flags, and hovering a
 * card in the list changes them for two pins at most; without this, react-leaflet was
 * handed a freshly built icon for every pin on the map and rebuilt all of their markup.
 */
const Pin = memo(function Pin({
  offer,
  active,
  selected,
  showPrice,
  isNew,
  markers,
  onHover,
  onMark,
  onOpenChange,
}: {
  offer: Offer;
  active: boolean;
  selected: boolean;
  showPrice: boolean;
  isNew: boolean;
  markers: RefObject<Map<number, LeafletMarker>>;
  onHover: (id: number | null) => void;
  onMark: (id: number, next: Mark | null) => void;
  onOpenChange: (id: number, open: boolean) => void;
}) {
  const position = useMemo(
    () => [offer.lat as number, offer.lng as number] as [number, number],
    [offer.lat, offer.lng],
  );

  const icon = useMemo(
    () =>
      showPrice
        ? priceMarker(offer, active, selected, isNew)
        : dotMarker(offer, active, selected, isNew),
    [offer, active, selected, isNew, showPrice],
  );

  // The registry is what lets a card open this pin's popup once the flight lands. Block
  // body on purpose: React 19 treats a returned value as the cleanup function, and
  // Map.set returns the map.
  const register = useCallback(
    (instance: LeafletMarker | null) => {
      if (instance === null) markers.current.delete(offer.id);
      else markers.current.set(offer.id, instance);
    },
    [markers, offer.id],
  );

  const handlers = useMemo(
    () => ({
      mouseover: () => onHover(offer.id),
      mouseout: () => onHover(null),
      popupopen: (event: PopupEvent) => {
        onOpenChange(offer.id, true);

        // Leaflet re-runs the popup's autopan at the end of every content update, and
        // react-leaflet updates the content on every render of this pin. Zoom out, drag
        // away, brush a pin on the way, and the map was dragged back to the open popup.
        // Only the pan that brings the popup on screen is wanted, and it is the one run
        // once react-leaflet has drawn the content in, which can land after the next
        // frame. So the switch waits until the content is there, then one frame more.
        const popup = event.popup;
        const settle = () => {
          if (popup.getElement()?.querySelector('.leaflet-popup-content')?.hasChildNodes()) {
            requestAnimationFrame(() => {
              popup.options.autoPan = false;
            });
          } else if (popup.isOpen()) {
            requestAnimationFrame(settle);
          }
        };
        requestAnimationFrame(settle);
      },
      popupclose: (event: PopupEvent) => {
        onOpenChange(offer.id, false);
        event.popup.options.autoPan = true;
      },
    }),
    [offer.id, onHover, onOpenChange],
  );

  const handleMark = useCallback((next: Mark | null) => onMark(offer.id, next), [onMark, offer.id]);

  return (
    <Marker
      position={position}
      ref={register}
      icon={icon}
      // Labels still touch at the edges; the one being pointed at comes to the front.
      zIndexOffset={selected ? 2000 : active ? 1000 : showPrice ? 500 : 0}
      title={`${isNew ? '[NOWE] ' : ''}${offer.title}${isExact(offer) ? '' : ' - przybliżona okolica'}`}
      // No click handler: the pin opens its own preview and nothing else. Wiring
      // selection here as well opened the side panel on top of the popup.
      eventHandlers={handlers}
    >
      <Popup autoPan closeButton minWidth={256} maxWidth={256}>
        <PopupBody offer={offer} isNew={isNew} onMark={handleMark} />
      </Popup>
    </Marker>
  );
});

function Pins({
  located,
  activeId,
  selectedId,
  markers,
  lastSeen,
  onHover,
  onMark,
}: {
  located: Offer[];
  activeId: number | null;
  selectedId: number | null;
  markers: RefObject<Map<number, LeafletMarker>>;
  /** When this browser last looked, so arrivals since then can be picked out. */
  lastSeen: string | null;
  onHover: (id: number | null) => void;
  onMark: (id: number, next: Mark | null) => void;
}) {
  const [openId, setOpenId] = useState<number | null>(null);
  const keep = useMemo(() => [activeId, selectedId, openId], [activeId, selectedId, openId]);

  // Culled first, so the label collision test below runs over what is on screen rather
  // than over every listing in Kraków.
  const shown = useVisible(located, keep);
  const labelled = useLabelled(shown, keep);

  const onOpenChange = useCallback((id: number, open: boolean) => {
    setOpenId((current) => (open ? id : current === id ? null : current));
  }, []);

  return (
    <>
      {shown.map((offer) => (
        <Pin
          key={offer.id}
          offer={offer}
          active={offer.id === activeId}
          selected={offer.id === selectedId}
          showPrice={labelled.has(offer.id)}
          isNew={isNewSince(offer, lastSeen)}
          markers={markers}
          onHover={onHover}
          onMark={onMark}
          onOpenChange={onOpenChange}
        />
      ))}
    </>
  );
}

export function OfferMap({
  offers,
  activeId,
  selectedId,
  theme,
  lastSeen,
  onHover,
  onMark,
}: {
  offers: Offer[];
  activeId: number | null;
  selectedId: number | null;
  theme: Theme;
  /** When this browser last looked. Null on a first visit, when nothing counts as new. */
  lastSeen: string | null;
  onHover: (id: number | null) => void;
  onMark: (id: number, next: Mark | null) => void;
}) {
  const located = useMemo(
    () => offers.filter((offer) => offer.lat !== null && offer.lng !== null),
    [offers],
  );

  const fingerprint = useMemo(() => located.map((offer) => offer.id).join(','), [located]);

  const points = useMemo(
    () => located.map((offer) => [offer.lat as number, offer.lng as number] as [number, number]),
    [located],
  );

  /** Live Leaflet markers by offer id, so a selection can open the one it flew to. */
  const markers = useRef(new Map<number, LeafletMarker>());

  return (
    // No border or radius of its own: the map fills a column now, and the column draws
    // the one line between it and the listings.
    <div className="h-full overflow-hidden">
      <MapContainer
        center={KRAKOW}
        zoom={12}
        scrollWheelZoom
        /*
          Leaflet's default step is a whole zoom level, which doubles the scale in one
          press and overshoots the district you were reading. Halving both the snap and
          the step keeps every rung on offer, and the wheel needs more than twice the
          default 60px per level so a single notch is a nudge rather than a jump.
        */
        zoomSnap={0.5}
        zoomDelta={0.5}
        wheelPxPerZoomLevel={150}
        style={{ height: '100%', width: '100%' }}
        attributionControl
      >
        <TileLayer
          key={theme}
          url={TILES[theme]}
          attribution='&copy; <a href="https://www.esri.com">Esri</a>, HERE, Garmin, &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          maxNativeZoom={TILES_NATIVE_MAX_ZOOM}
          maxZoom={20}
        />
        <FitToContainer />
        <Recentre points={points} fingerprint={fingerprint} />
        <Pins
          located={located}
          activeId={activeId}
          selectedId={selectedId}
          markers={markers}
          lastSeen={lastSeen}
          onHover={onHover}
          onMark={onMark}
        />
        {/* After Pins, so the markers it flies to are registered by the time it runs. */}
        <FlyToSelected located={located} selectedId={selectedId} markers={markers} />
      </MapContainer>
    </div>
  );
}
