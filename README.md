# Take-Home

A self-contained slice of the eBOM (engineering Bill of Materials) Explorer:
React frontend + FastAPI backend + PostgreSQL 17, seeded with fake data.
Runs **entirely locally with Docker**

## Run it

```bash
docker compose up --build
```

| Service  | URL                                    | Notes                          |
|----------|----------------------------------------|--------------------------------|
| Frontend | http://localhost:3000                  | SPA, no login                  |
| API docs | http://localhost:8000/api/docs         | Swagger UI                     |
| Postgres | `localhost:5433` (user/pass/db `ebom`) | seeded on first boot           |

Stop with `docker compose down` (add `-v` to also wipe the database volume and
re-seed on the next start).

## Explore the data

Search for either root part number and open it:

- **900007-191 A.1**
- **900009-217 A.1**

Each is a 3-level assembly (root → children → grandchildren). Try the tree,
flattened-leaves, and statistics views; drill into a sub-assembly; and change
the **as-of date** to see history (some parts have superseded/"closed" records).

## Layout

```
interview/
├── docker-compose.yml      # postgres:17 + backend + frontend
├── backend/                # FastAPI app (copied as-is, see "Changes" below)
│   ├── Dockerfile
│   └── app/                # routers, services, schemas
├── frontend/               # Vite + React + TS SPA (SSO removed)
│   ├── Dockerfile          # builds, served by nginx on :3000
│   └── src/
└── db/initdb/              # auto-run by postgres on first boot, in order
    ├── 01_schema.sql       # tables (the "physicalid" schema the backend uses)
    └── 02_seed.sql         # anonymized data for two BOM trees
```

## About the seed data

Two real BOM trees were extracted, trimmed to the top two levels, and
**anonymized**: part numbers, descriptions, masses, costs, and IDs are
scrambled. **Preserved**: the tree structure, the SCD2 time intervals (so
time-travel and "closed" historical records still work), and categorical
attributes (source, mfgclass, maturity, design intent, product type) so the
filters and charts behave realistically. The generator is
`scripts/build_interview_seed.py` (one level up — a build-time tool, not part of
this deliverable).

## Local development

The backend mounts `./backend/app` and runs `uv run uvicorn --reload`, so backend edits
hot-reload. For frontend hot-reload, run it outside Docker against the
containerized backend:

```bash
cd frontend && npm install && npm run dev   # http://localhost:5174 (proxies /api → :8000)
```

## What I built

**Problem 1: MFG Class Chart (frontend)**

Added MFG Class Distribution chart to the dashboard that counts the BOM's parts by manufacturing class and parts that have no class go to "(none)" so they aren't silently dropped. I wired this into the existing filter behavior (used by the "Source" chart) so clicking a bar filters the dashboard by manufacturing class.

**Problem 2: Where-Used Feature (backend + frontend)**

On the backend, I made a new `GET /bom/where-used` endpoint to return the direct parent assemblies that consume the part we're looking at. On the frontend side, I made a "Parent Assemblies" table at the bottom of the dashboard to display the results. I also included a clean empty state for the root / parts with no parents.

## Key decisions made

Overall, I spent most of my time reading through the codebase and then extending it/matching it. The majority of the code was already there, I just reused the existing structures wherever possible and adjusted them for the new functionalities.

- **Problem 1:** For the MFG class chart, I mirrored the existing Source chart's data flow and structure.
- **Problem 2:** I built the Where-Used endpoint to match the flow of the existing router/service/schema layering.
- I queried `bom_relationships` for where-used instead of `bom_forest` that the forward queries used. The where-used feature only needs direct parents, so I found this table simpler and sufficient for this use case.
- I used the existing `check_time` filtering to keep the where-used results consistent with the selected date.

## If I had more time

- **UI:** I tilted the current MFG class chart x-axis to fit the longer names. For more/longer category names or narrower screens, I'd implement truncation, tooltips, or a more responsive layout strategy.
- **Code maintenance:** The source and MFG class distribution charts are very similar now, so I'd consider extracting a shared chart component to reduce the duplicated logic.
- **Feature:** The assignment mentioned a compare revisions mode but I couldn't find an active compare workflow in this app. If such a view existed, I'd integrate the MFG class chart into it using the same pattern as the existing distribution chart.
- **Where-used:** I'd enhance the Where-Used table to have sorting, filtering, etc. to match the Hierarchical BOM table more and make it more useful for exploring.