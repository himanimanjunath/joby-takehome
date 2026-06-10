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
