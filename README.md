# IQOS Monitor

Long-term usage statistics and live status for IQOS ILUMA i ONE devices.
Two parts:

| Part | What it is | Where it runs |
|---|---|---|
| `agent/` | Lightweight Windows tray application (Python). Reads the device over USB HID (read-only), stores raw frames locally, uploads them to the server, streams live state every second while a device is plugged in. | Any Windows PC the IQOS gets plugged into |
| `server/` | Web application (Next.js + TypeScript) with SQLite in a single Docker container. Overview with live cards, statistics (day / week / month, averages per day), device detail with full-history download, user profiles. | Linux Docker host on the LAN |

Everything stays on the local network. No cloud, no login; users are simple
profiles that group devices.

Protocol notes and what is verified vs. experimental: [PROTOCOL.md](PROTOCOL.md).
The original standalone v0.5 tooling is kept in `IQOS-History/` for reference.

## Server

```bash
cd server
npm ci
npm test            # protocol decoders against test-vectors/, stats, ingest
npm run dev         # http://localhost:3000, SQLite in ~/IQOS Monitor/iqos.sqlite3
```

Environment: `DATABASE_PATH` (default `~/IQOS Monitor/iqos.sqlite3`; keep it outside the project tree, the dev watcher reloads on every write otherwise), `DISPLAY_TZ`
(default `Europe/Prague`), optional `AGENT_API_KEY` (a fixed key every agent may
use; otherwise generate keys in *Settings → Agents*). Language follows the
browser (`Accept-Language`), overridable in the header; English is the default,
Czech is included. To add a language, create `src/lib/i18n/<code>.ts` and
register it in `src/lib/i18n/index.ts`.

#Device images: `server/public/devices/*.png` are official IQOS product renders
(all six ILUMA i ONE finishes plus ILUMA i and ILUMA i PRIME). Pick the model
and finish per device in *Settings → Devices*; the chart colour is separate and
defaults to a readable palette slot. To add a finish, drop a transparent PNG
there and register it in `server/src/lib/variants.ts`.

## Docker

```bash
# on the Docker host
docker login ghcr.io                       # PAT with read:packages
GHCR_OWNER=<github-user> docker compose pull
GHCR_OWNER=<github-user> docker compose up -d
```

Data lives in the `iqos-data` volume. To build on the host instead of pulling:
`docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build`.

## Agent

```powershell
cd agent
py -3 -m pip install -r requirements.txt
py -3 run_tests.py
py -3 -m iqos_agent            # tray icon; first start opens Settings
py -3 -m iqos_agent --console  # debug mode, logs to stdout
.\build_agent.ps1              # dist\IQOS-Agent.exe (PyInstaller, no console)
```

**Windows 11 Smart App Control** blocks unsigned executables such as the
PyInstaller build. On such machines run the agent from source instead:
double-click `agent\run_agent.vbs` (starts the signed `pythonw.exe` without a
console; requires Python 3 and `pip install -r requirements.txt`). The
"Start with Windows" switch in the tray menu registers that launcher.

Settings are stored in `%APPDATA%\IQOS Agent\config.json` (server address,
API key, language, autostart). The local SQLite buffer defaults to
`Documents\IQOS History\history.sqlite3`, so archives downloaded by the old
tooling are uploaded automatically. Log: `%APPDATA%\IQOS Agent\agent.log`.

Behaviour: any IQOS (USB `2759:0003`) is accepted and registered on the server
as unassigned. On connect the agent takes a diagnostics snapshot, syncs the last
3 months of archive records (incrementally afterwards), and reads live state
every second. *Download full history* in the web UI queues a job the agent runs
in the background with progress reporting; unplugging keeps what was read.

## GitHub Actions

- `server.yml` – typecheck, lint, tests, then builds `ghcr.io/<owner>/iqos-monitor` (amd64).
- `agent.yml` – runs the Python tests on Windows and builds `IQOS-Agent.exe` (artifact; attached to `v*` releases).

## Read-only policy

The agent only issues commands captured from the official application or
classic register reads verified on two devices. No settings writes, no firmware,
no reset. Device configuration from the web UI is a planned later phase and
will require newly captured and verified commands.
