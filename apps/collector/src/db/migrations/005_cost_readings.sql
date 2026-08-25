-- What a language model read out of a description, kept apart from both the portal's
-- facts in `offers` and our own rule-based verdict in `classifications`.
--
-- Its own table for the same reason `classifications` is one. The reading is derived, it
-- is replaced wholesale when the prompt or the model changes, and `model` with
-- `prompt_version` records which run produced a row, so moving to a better model means
-- recomputing from stored descriptions rather than asking any portal for anything again.
--
-- Why this exists at all: two thirds of the descriptions that name utilities state the
-- amount in prose no pattern reaches ("prad oraz gaz wedlug zuzycia (ok 250zl
-- miesiecznie)", "oplata za wode i smieci - przy 2 osobach 200zl"). The reader in
-- cost.ts finds a figure in roughly one description in six; the rest were being priced
-- on the 400 PLN assumption alone.
create table cost_readings (
  offer_id integer primary key references offers (id) on delete cascade,

  -- Monthly PLN, and null means the advert did not state it. Nothing here is ever
  -- guessed. The one assumption this project makes about a missing fee stays in
  -- classify.ts, where the dashboard shows it in the reasons beside the total.
  rent_pln      integer,
  fee_pln       integer,
  utilities_pln integer,
  internet_pln  integer,
  -- One-off, not monthly. Collected because the portals leave `offers.deposit_pln` empty
  -- on almost every listing while the description states it plainly.
  deposit_pln   integer,

  -- "czynsz z mediami": the building fee already covers the supplies, so adding
  -- utilities on top of it would charge for them twice.
  fee_includes_utilities boolean not null default false,
  -- "prad wg zuzycia" with no figure beside it: a cost that exists and has no number.
  -- Worth separating from silence, because silence may mean the fee already covers it.
  utilities_metered boolean not null default false,

  -- "przy 2 osobach 200 zl": how many people the figures above are quoted for. Null
  -- means the advert did not say, not that it is quoted for one person.
  for_people integer,

  model          text        not null,
  prompt_version integer     not null,
  read_at        timestamptz not null,
  -- The model's answer as it arrived, so a change to how it is interpreted can be
  -- replayed over stored rows instead of running every description past the model again.
  -- Same reason `offers.raw` holds the portal payload.
  raw jsonb not null
);

-- The command asks for listings whose reading is missing or was made by an older prompt.
create index cost_readings_staleness_idx on cost_readings (prompt_version, model);

-- What one person pays, which is the figure the owner actually compares flats on: the
-- monthly total split across the people expected to share it. Nullable because a listing
-- with no rent has no total to split, and stored rather than computed in the dashboard so
-- the notifier and the page cannot drift apart on how it is worked out.
alter table classifications add column cost_per_person_pln integer;
