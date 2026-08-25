# Running Overheads unattended

Four systemd user units. Since 2026-08-16 both portals are collected by GitHub Actions,
so the collection timer here is a standby: it exists for the day OLX goes back to
refusing datacenter addresses, and it is left disabled meanwhile. Running it alongside
the cloud round means two rounds racing over the same listings and, worse, two rounds
deciding at once what to announce.

The API unit is a different matter and stays on: it serves the dashboard's data on
loopback for local work.

The other two are the language model that `read:costs` uses and the timer that runs it.
Those are local by nature rather than by accident: the model needs a graphics card, the
cloud round has none, and reading costs out of prose is the one job here that can wait
for a machine to be switched on. A listing with no reading is priced by the rules alone,
so the timer catching up hours later costs accuracy and nothing else.

User units rather than system ones: this reads a hosted database and serves a page on
loopback, so it has no business running as root or before anyone has logged in.

Both assume the repo is at `~/Desktop/projects/overheads`. If it lives elsewhere, edit
`WorkingDirectory` in the two `.service` files.

## Install

```bash
mkdir -p ~/.config/systemd/user
cp deploy/*.service deploy/*.timer ~/.config/systemd/user/
systemctl --user daemon-reload

systemctl --user enable --now overheads-api.service     # keep the dashboard's API up

# Only when the cloud round can no longer reach OLX. Set OVERHEADS_SOURCES in the unit
# to the portals the cloud is failing on, so the two schedules do not collect the same
# portal at the same time.
systemctl --user enable --now overheads-collect.timer   # a round every 15 minutes

# The local model, and the hourly pass that reads new descriptions with it. Pull the
# model named in .env once before enabling the timer:
#   ~/.local/ollama/bin/ollama pull qwen3:4b
systemctl --user enable --now overheads-model.service
systemctl --user enable --now overheads-read-costs.timer
```

Collection stops when you log out unless lingering is on:

```bash
sudo loginctl enable-linger "$USER"
```

## Check on it

```bash
systemctl --user list-timers overheads-collect.timer   # when it last ran and runs next
systemctl --user status overheads-collect.service      # how the last round went
journalctl --user -u overheads-collect.service -n 50   # what it printed
```

A round that fails is left failed on purpose, so `status` shows a problem rather than a
silence. One portal failing does not stop the other, and classification runs either way.

## Run one round by hand

```bash
systemctl --user start overheads-collect.service
# or, without systemd in the way:
pnpm collect
```

## Stop it

```bash
systemctl --user disable --now overheads-collect.timer overheads-api.service
```
