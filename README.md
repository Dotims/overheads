<div align="center">

<img src="apps/web/public/favicon.svg" width="76" alt="Overheads logo: a roof over a head" />

# Overheads

**Watches new rental listings in Kraków on OLX, Otodom and Gratka, works out what each flat really costs a month, and pings Telegram when one lands in budget.**

[![CI](https://github.com/Dotims/overheads/actions/workflows/ci.yml/badge.svg)](https://github.com/Dotims/overheads/actions/workflows/ci.yml)
![Node 26](https://img.shields.io/badge/Node-26-5fa04e?logo=nodedotjs&logoColor=white)
![TypeScript strict](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white)
![React 19](https://img.shields.io/badge/React-19-61dafb?logo=react&logoColor=black)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169e1?logo=postgresql&logoColor=white)
[![License: MIT](https://img.shields.io/badge/License-MIT-ffb224.svg)](LICENSE)

<img src="docs/media/demo.gif" width="880" alt="The Overheads dashboard: hovering a listing lights its pin, picking one flies the map to the flat, raising the budget and unhiding two districts fills the map in, sorting by price, then switching to the light theme" />

</div>

---

Good flats in Kraków are gone within hours, and the advertised price is rarely what you
pay. The building fee is a separate field many advertisers leave empty, and utilities
hide in the description: `prad oraz gaz wedlug zuzycia (ok 250zl miesiecznie)`.

Overheads checks three portals every five minutes, prices every listing the way a
tenant would, and sends a message only when the full monthly cost fits. Everything
it has collected is on a map, filtered in the browser. The interface is in Polish, because
it was built for an actual flat hunt in Kraków.

## What it does

- **Collects** new listings from OLX, Otodom and Gratka every five minutes, from a GitHub
  Actions job, so no machine has to stay on.
- **Prices** each one as rent + building fee + utilities, and says how sure it is: read
  from the listing, all-inclusive, or assumed, with the reasons in plain words.
- **Reads costs out of prose** with a small language model when the description is the
  only place they appear. Optional, and it only extracts figures; every judgement is made
  by tested rules.
- **Recognises the same flat** advertised on two portals and shows it once, with a link to
  the other advert.
- **Notifies on Telegram** when a listing fits the budget, under the same bounds the
  dashboard filters on, at most two messages a round so a widened filter cannot flood the
  chat.
- **Maps everything** in a React dashboard: price pins, filters by cost, floor area, rooms
  and district, favourites and rejects, a "new since your last visit" badge, dark and light
  themes.

<img src="docs/media/dashboard-light.png" alt="The dashboard in the light theme: listings priced in full on the left, price pins across Kraków on the right" />

## How it works

```mermaid
flowchart LR
  subgraph Portals
    OLX["OLX<br/>public JSON API"]
    OTO["Otodom<br/>Next.js data route"]
    GRA["Gratka<br/>__NUXT_DATA__"]
  end

  subgraph Round["One round, every 5 min in GitHub Actions"]
    direction TB
    C["collect<br/>parse to NormalizedOffer"] --> L["read costs<br/>optional language model"]
    L --> K["classify<br/>rules, versioned"] --> D["dedupe"] --> N["notify"]
  end

  OLX & OTO & GRA --> C
  C <--> DB[("PostgreSQL<br/>offers, classifications,<br/>cost_readings, runs")]
  N --> TG["Telegram"]
  DB --> API["GET /api/offers<br/>Vercel function, CDN cached"] --> WEB["React dashboard<br/>Leaflet map, filters, marks"]
```

A round fetches two pages of the newest listings per portal, stores them, prices what
changed, folds duplicates together and announces whatever newly fits. Each step is its own
command, so any of them can be rerun alone: changing the rules means reclassifying what is
stored, never refetching it.

## Engineering notes

### JSON in, never HTML

All three portals serve structured data, so there is no HTML parsing and no headless
browser:

| Portal | Data source                     | What it gives                                                   |
| ------ | ------------------------------- | --------------------------------------------------------------- |
| OLX    | `/api/v1/offers/` (public API)  | price, building fee, district, description, blurred coordinates |
| Otodom | `/_next/data/<buildId>/...json` | price, building fee, street, district, advertiser type          |
| Otodom | listing page                    | exact coordinates, full description                             |
| Gratka | `__NUXT_DATA__` in the page     | price, street, description, photographs, agency or owner        |

Otodom publishes no API, but it does publish the data route Next.js renders its own pages
from. The `buildId` in that path changes with every deploy of theirs, so it is read from
the search page and refreshed when a request comes back 404. Listing pages cost a request
each, so they are fetched only for listings that could still reach a tier.

The client says who it is (`User-Agent: Overheads/0.1 (+repo)`), asks for one thing at a
time with a pause between pages, and keeps the recurring poll shallow. Going deeper is a
backfill run by hand. When OLX started refusing datacenter addresses the answer was a
standby collector on an ordinary connection, not a disguise.

### Facts and verdicts live apart

`offers` holds what the portal said, including the full payload in `raw`, so a parsing
change can be replayed over stored data. Overheads' own judgement lives in
`classifications`, stamped with a `rules_version`: when the thresholds move, everything is
reclassified locally in seconds.

Three dates are kept separate on purpose: when the portal says the advert was created,
when it was last bumped, and when Overheads first saw it. A month-old listing bumped
today is not a new flat. Coordinates carry their precision too: Otodom pins an address,
OLX only an area, so an approximate pin carries a `~` before its price rather than
putting a flat on a street it is not on.

### What a flat really costs

A listing is judged on two numbers: `worth` when the rent alone is at most 2200 PLN, `top`
when rent, building fee and utilities together are at most 2600 PLN. A missing building
fee is assumed to be 400 PLN, unless the description says the price covers everything,
and the verdict says so instead of pretending to know. A real verdict from the API:

```json
{
  "source": "otodom",
  "title": "Dużu pokój do wynajęcia ul. Skrajna - wspólna kuchnia i łazienka",
  "pricePln": 1100,
  "rentPln": 137,
  "totalCostPln": 1637,
  "tier": "top",
  "costCertainty": "exact",
  "reasons": [
    "The building fee is stated as 137 PLN.",
    "The description states utilities of 400 PLN.",
    "Total 1637 PLN is within the 2600 PLN limit."
  ]
}
```

Prose is where regular expressions run out: two descriptions in three that mention
utilities state the amount in a form none of them reaches. `read:costs` puts those through
a small model and stores what it read in `cost_readings`, which the rules consult for
whatever the portal left blank. The model only extracts. On listings checked by hand, the
local `qwen3:4b` beat `qwen2.5:7b` on both accuracy and speed and fits a 6 GB card; a
hosted OpenAI-compatible endpoint serves the unattended round.

### The same flat, twice

Rent, area and room count agreeing is not enough: across 3968 live listings that left 2744
candidate pairs. Trigram similarity on titles and descriptions splits them cleanly, so
text decides and a shared advertiser only lowers the bar for text that already half
agrees. Nothing is deleted: `duplicate_of` names the advert worth showing, and the
thresholds are recomputed from scratch on every run, so changing one needs no migration.

### Running unattended

GitHub drops scheduled workflow runs under load (asked for every 30 minutes, it delivered
gaps of two to four hours), so the five-minute cadence is a loop inside one long job and
the cron only queues the next job to take over. The database is a free Postgres tier, and
transfer is what runs out first, so `/api/offers` is cached at the CDN, sends only
listings within reach of the budget, and the page stops polling while its tab is hidden.

## Tech stack

| Area      | Choice                                                                                   |
| --------- | ---------------------------------------------------------------------------------------- |
| Collector | Node 26 running TypeScript natively (no build step), `postgres` client, `node:test`      |
| Storage   | PostgreSQL, migrations in plain SQL, rows read through checked mappers instead of casts  |
| Dashboard | React 19, Vite, Tailwind CSS 4, Radix Colors, Leaflet via react-leaflet                  |
| Hosting   | GitHub Actions for collection, Vercel functions for the API, Telegram Bot API for alerts |
| Quality   | TypeScript strict, ESLint, Prettier, 153 tests (7 against a real Postgres in CI)         |

The collector has no native dependencies: Node runs its TypeScript directly and the
database client is pure JavaScript.

## Running it locally

You need Node 26, pnpm and a Postgres. Docker gives you the last one in a line:

```bash
docker run -d --name overheads-pg -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:17

pnpm install
cp .env.example .env    # set DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres
pnpm collect            # migrates, then one round of OLX and Otodom: fetch, price, dedupe
```

The dashboard needs two terminals: the API reads the database, the dev server serves the
page and proxies `/api` to it.

```bash
pnpm serve                        # API on http://127.0.0.1:4317
pnpm --filter @overheads/web dev  # dashboard on http://localhost:4318
```

With no Telegram bot configured a round finishes quietly, and with no model configured
listings are priced by the rules alone. To read costs with a local model:

```bash
ollama serve &
ollama pull qwen3:4b
pnpm --filter @overheads/collector read:costs 50   # reads, then reclassifies
```

Before committing:

```bash
pnpm check   # prettier, eslint, tsc and the tests that need no database

# the database tests empty their tables, so give them a database of their own
docker exec overheads-pg createdb -U postgres overheads_test
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/overheads_test pnpm test
```

<details>
<summary><b>Configuration</b></summary>

Everything is read from `.env` locally and from the environment in CI and on Vercel.
`.env.example` documents each variable in full.

| Variable                                   | Purpose                                                                                               |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                             | Postgres connection string. The only one that is required.                                            |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`   | The bot and the chat it writes to. Both or neither.                                                   |
| `NOTIFY_*`                                 | Bounds on what is worth a message: cost, floor area, rooms, districts.                                |
| `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL` | A hosted OpenAI-compatible model for reading costs inside the round.                                  |
| `OLLAMA_MODEL`                             | A local model for backfills, through Ollama.                                                          |
| `OVERHEADS_SOURCES`                        | Portals a round asks, comma separated. OLX and Otodom when unset; the scheduled round asks all three. |
| `INGEST_TOKEN`                             | Guards the endpoint a standby collector posts OLX responses to.                                       |

</details>

## Layout

```
apps/collector/       fetching, normalising, classifying, serving the API
  src/sources/        one folder per portal, each producing a NormalizedOffer
  src/domain/         the rules: costs, tiers, duplicates. No database, no network.
  src/db/             schema, migrations and checked row readers
  src/commands/       one exported function per job, side effects only when called
  src/cli.ts          the only entry point: `node src/cli.ts <command>`
apps/web/             the dashboard
server/               the API as Vercel functions, bundled by scripts/build-vercel.mjs
.github/workflows/    CI, and the collection round
deploy/               systemd units for a standby collector on an ordinary connection
```

## License

[MIT](LICENSE)
