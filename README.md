# Overheads

Watches new rental listings in Kraków on OLX, Otodom and Gratka, drops the ones outside the
target area, works out the real monthly cost (rent + building fee + utilities mentioned
in the description) and pings Telegram when something lands in budget.

It exists because checking the same listings several times a day is a waste of time,
and the good ones in Kraków are gone within hours.

## Where it runs

Both portals are collected by GitHub Actions every fifteen minutes, writing to Neon.
Nothing here needs a computer to be awake.

OLX refused datacenter addresses for a week and the round asked for Otodom alone while a
local timer collected OLX from an ordinary connection. Measured again on 2026-08-16 it
answers 200 from the cloud, four times over two minutes, to the same User-Agent we have
always sent; what it still refuses from there is curl, over either protocol version. So
the refusal is about the shape of the client rather than about us, and it can return
without notice. The local timer (`deploy/`) and the phone (`docs/olx-from-a-phone.md`)
stay as standbys, and a refused round fails loudly rather than collecting nothing
quietly. `OVERHEADS_SOURCES` picks the portals for a round.

Both portals are read over HTTP/2. OLX stopped answering HTTP/1.1 on 2026-08-15, from
every address, and Node's `fetch` speaks nothing else.

## Status

Running. Both portals are collected, classified and deduplicated, the dashboard is
deployed, and listings that land in budget are announced on Telegram. The bot is
configured through `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`; with either unset a
collection round finishes quietly, which is how the cloud schedule runs.

`notify:seed` is run once, when a bot is first connected: it records everything currently
in budget as already announced, so switching notifications on does not replay a week of
collecting into a phone.

## Tiers

A listing is judged on two numbers. `worth` means the advertised rent alone is at or
below 2200 PLN. `top` means the full monthly cost, rent plus building fee plus utilities,
is at or below 2600 PLN. Districts outside the target area are rejected first, whatever
they cost.

The building fee and utilities are the awkward part. Portals report the fee as a number
when the advertiser bothers to fill it in, and describe utilities in prose when they
mention them at all. A listing that gives no fee is judged on an assumed 400 PLN, which
is roughly what a Kraków flat costs to run, unless the description says the price covers
everything or that there is no fee. Every verdict carries a `cost_certainty` saying
whether its total was read or assumed, and a list of reasons in plain words.

Prose is where the patterns run out. Two descriptions in three that mention utilities
state the amount in a form no regular expression reaches: `prad oraz gaz wedlug zuzycia
(ok 250zl miesiecznie)`, `oplata za wode i smieci - przy 2 osobach 200zl`. `read:costs`
puts those through a small language model running locally and stores what it read in
`cost_readings`, which the rules then consult for whatever the portal left blank. The
model only extracts; every judgement stays in `domain/classify.ts` where it can be
tested without a model running. It is optional: with no model configured, listings are
priced by the rules alone exactly as before.

Costs are also reported per person, the total split by room count, because that is the
figure two flats of different sizes can actually be compared on.

## How it works

All three portals serve structured JSON, so there is no HTML parsing and no headless
browser.

| Portal | Data source                     | What it gives                                                   |
| ------ | ------------------------------- | --------------------------------------------------------------- |
| OLX    | `/api/v1/offers/` (public API)  | price, building fee, district, description, blurred coordinates |
| Otodom | `/_next/data/<buildId>/...json` | price, building fee, street, district, advertiser type          |
| Otodom | listing page                    | exact coordinates (`radius: 0`), full description               |
| Gratka | `__NUXT_DATA__` in the page     | price, street, description, photographs, agency or owner        |

Otodom publishes no API. What it does publish is the data endpoint Next.js serves its
own pages from, which is the same payload without the HTML. The `buildId` in that path
changes on every deploy of theirs, so it is scraped from the search page and refreshed
when a request comes back 404.

Otodom search results carry no description and no coordinates, and both cost a request
per listing. They are fetched only for listings that could still reach a tier, which on
a normal run is a handful out of seventy.

Gratka ships its search results inside the page, as JSON, in the `__NUXT_DATA__` script
tag. `_payload.json` looks like the endpoint to ask instead and is a cached prerender of
page one that ignores `?page=` and `?sort=`. It gives no building fee, so every Gratka
listing meets the 400 PLN assumption, and no coordinates at all, so these have no pin;
the district is read from the advert's own URL, which carries it for four in five.
Measured before it was added: of 105 listings, half were already here from the other two
portals and the rest brought about five flats a day in budget that nothing else showed.

## Stack

Node 26 + TypeScript with no build step (Node runs `.ts` natively). Storage is Postgres
on Neon, reached through `postgres`, which is pure JavaScript: the project has no native
dependencies.

## Running it

```bash
pnpm install
cp .env.example .env                            # then put your Postgres connection string in it
pnpm --filter @overheads/collector migrate      # creates the schema
pnpm --filter @overheads/collector collect:olx     # fetches and stores OLX listings
pnpm --filter @overheads/collector collect:otodom # same for Otodom
pnpm --filter @overheads/collector collect:gratka # same for Gratka
pnpm --filter @overheads/collector classify     # judges what is stored, no network
pnpm --filter @overheads/collector status       # prints what is in the database
```

Reading costs out of descriptions needs a model. There are two ways to provide one and
the project does not care which:

A **hosted** one runs inside the collection round, so a listing is priced before it is
announced rather than corrected an hour later. Any OpenAI-compatible endpoint will do;
[Groq](https://console.groq.com) issues free keys without a card. Set `LLM_API_KEY`,
`LLM_BASE_URL` and `LLM_MODEL`, and the round reads up to fifteen new listings a time,
twelve seconds apart, because free tiers cap tokens per minute long before requests.

A **local** one is for backfills, where a hosted free tier would run out on the first
thousand. Install [Ollama](https://ollama.com), set `OLLAMA_MODEL`, and run it by hand:

```bash
ollama serve &
ollama pull qwen3:4b
pnpm --filter @overheads/collector read:costs 50     # roughly two minutes
pnpm --filter @overheads/collector read:costs 2000   # or the whole backlog
```

Two to four seconds a listing on a 6 GB card, and it reclassifies when it is done. The
queue is ordered by whether the reading could still change the verdict, so listings within
reach of the budget are read first and the rest are behind them rather than dropped.

Nothing else depends on any of this. With no model configured at all, listings are priced
by the rules alone and every other command works exactly as it did.

The dashboard needs two terminals: the API reads the database, the dev server serves the
page and proxies `/api` to it.

```bash
pnpm --filter @overheads/collector serve   # http://127.0.0.1:4317
pnpm --filter @overheads/web dev           # http://localhost:4318
```

Filters live in the browser: full monthly cost, minimum floor area, tier, district and
private advertisers only. The whole set is a few hundred rows, so it is sent once and
filtered in memory rather than queried per keystroke.

Quality gate before committing:

```bash
pnpm check   # prettier + eslint + tsc + tests
```

## Layout

```
server/               serverless functions for the deployed dashboard, bundled by
                      scripts/build-vercel.mjs into .vercel/output
apps/collector/       fetching, normalising, classifying, serving the API
  src/sources/        one folder per portal, each producing a NormalizedOffer
  src/domain/         the rules: districts, costs, tiers. No database, no network.
  src/db/             schema, migrations and checked row readers
  src/commands/       one exported function per job, side effects only when called
  src/cli.ts          the only entry point: `node src/cli.ts <command>`
apps/web/             the dashboard
```

## License

MIT
