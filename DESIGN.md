# Overheads design system

Recorded from the built dashboard, not from intentions. Tokens live in
`apps/web/src/index.css` under `@theme`; everything below describes what shipped.

## The idea this surface owns

A flat search is a pipeline with a verdict at the end. The page opens on that pipeline
drawn as a graph rather than on the row of stat tiles a dashboard usually leads with.
Sources on the left, the rules lit in the middle, verdicts on the right, connected by
1px lines with two of them traced in moving light.

## Ground and colour

True black is the page. Anything raised off it is graphite, separated by a hairline
rather than a shadow: there are no drop shadows anywhere in this interface.

| Token                     | Value                 | Used for                                                        |
| ------------------------- | --------------------- | --------------------------------------------------------------- |
| `--color-void`            | `#000000`             | page ground, and text on the accent button                      |
| `--color-graphite-950`    | `#0a0a0b`             | offer cards                                                     |
| `--color-graphite-900`    | `#121214`             | graph nodes, map ground                                         |
| `--color-line`            | `#232327`             | every 1px border and divider                                    |
| `--color-line-strong`     | `#33333a`             | graph connectors, hover borders                                 |
| `--color-ink`             | `#f5f5f6`             | primary text                                                    |
| `--color-ink-dim`         | `#a1a1aa`             | secondary text                                                  |
| `--color-ink-faint`       | `#8b8b95`             | tags and captions (4.5:1 on black; it was `#6b6b75` and failed) |
| `--color-signal-300..600` | `#fde68a` → `#ea8c0b` | the single accent                                               |

One accent, warm, and it only ever marks what has been decided: the sync action, an
active filter, the rules node, a listing that fits the budget. Nothing decorative is
warm. Restrained strategy on purpose, because the visitor came to operate.

## Type

System sans for prose, system mono for everything measured. The split is strict rather
than stylistic: monospace means this is data.

- `.num` - every amount, count, area and price per m², with `tabular-nums`.
- `.tag` - 11px mono, uppercase, `0.08em` tracking, for labels, sources, parameters
  and the rules version.
- Prose (headings, listing titles, help text) is sans and never monospace.

`.lit` is the glowing highlight: signal-300, italic, an 18px accent halo. It marks one
word in the wordmark. `.lit-num` is the same glow without the italic, because tabular
figures should not slant; it marks the total on a listing that fits.

## Components

- **Card** - `rounded-xl`, 1px `--color-line`, graphite ground, no shadow. The `rule`
  utility carries the border so it is one decision in one place.
- **Pill** - full-radius, 1px border, mono uppercase label. Off: faint text, line
  border. On: signal border, 10% signal ground, signal-300 text. Every filter is a pill.
- **Accent button** - full-radius, `signal-400 → signal-600` gradient, black label.
  Exactly one per screen.
- **Graph node** - a card with a 1px system mark, a mono count and a unit. Marks are
  drawn as 16px SVG paths with 1.25 stroke: `feed` for a portal, `rules` for the
  classifier, and `pass` / `partial` / `reject` for the three verdicts, so the tier is
  legible from the glyph alone. Tier nodes are buttons that toggle the matching filter.

## Layout

Content is capped at `100rem` with a `15rem` filter rail on the left from `lg` up,
sticky, and the results column beside it. Offers are one column, two from `xl`.
Section rhythm is `mt-12` on mobile, `mt-16` from `lg`, and headings always carry more
space above than below.

The graph is a real graph only from `lg` up: an absolutely positioned SVG whose
connector endpoints and node positions read from one shared percentage table, so lines
meet boxes at any width. Below `lg` the same six nodes stack into a chain with short
vertical connectors.

## Motion

One authored moment, not scattered hovers: two of the five connectors carry a dashed
stroke animated along their length under a Gaussian blur, and the rules node breathes a
soft accent halo. Everything else moves only on interaction, at 150ms. The whole set is
disabled under `prefers-reduced-motion`.

## Map

Esri's dark and light grey canvas tiles rather than light OSM tiles pushed through a CSS
invert; the filtered version left rows of tiles unpainted and looked like a rendering
fault. They need no key, which is why they replaced CARTO's, which do now.
Otodom pins a real address and draws a filled point, glowing when the listing fits the
budget. OLX reports the centre of an area and draws a hollow circle instead. The
distinction is deliberate: presenting a blurred area as an address would put flats on
streets they are not on.

## What this system refuses

- Drop shadows. Separation is a hairline or a change of ground.
- A second accent colour.
- Monospace on prose, or a proportional face on a number.
- Icon fonts. Marks are inline SVG in the same 1px grammar as the borders.
