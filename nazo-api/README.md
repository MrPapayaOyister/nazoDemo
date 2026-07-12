# nazo-api — Phase 2 skeleton

FastAPI + SQLModel backend for the NAZO government-correspondence demo. Runs on an
NVIDIA DGX Spark (aarch64 Linux) and **reuses existing shared services** — it does
**not** start its own Postgres, Qdrant, or LLM.

| Dependency | Where | Isolation |
|------------|-------|-----------|
| Postgres   | `host.docker.internal:5432` | isolated db/role **`nazo`** (never touches videopro / aganeti / aganeti_genesis) |
| Qdrant     | `host.docker.internal:6333` | one isolated collection **`nazo_library`** (size 1024, Cosine) |
| vLLM       | `host.docker.internal:9000/v1` | model **`qwen2.5-32b`** (OpenAI-compatible) |
| Gotenberg  | compose service `gotenberg:3000` | new container with Arabic fonts |

The API publishes on host port **8200** (8000 is taken).

## What Phase 2 delivers

- `docker compose up --build` builds on arm64 (api + gotenberg only).
- On startup the app creates the `nazo` schema and ensures the `nazo_library`
  collection (degrading gracefully if Qdrant is momentarily unreachable).
- `python -m app.seed.reset` seeds the verbatim demo data.
- `GET /api/healthz` returns green when pg + qdrant + vllm + gotenberg are all ok.
- `GET /api/users` and `GET /api/bootstrap` return the exact frontend JSON.

AI actions, workflow transitions, DOCX rendering, and Gmail are intentionally
left as clearly-marked TODO stubs / forward-contract tables.

## DGX bring-up

```bash
# 1. Create the isolated nazo role + database on the shared Postgres server.
#    Idempotent; never drops anything. Set a real password.
NAZO_PASSWORD='a-strong-password' bash scripts/bootstrap_db.sh

# 2. Configure the app.
cp .env.example .env
#    Edit .env: set the DATABASE_URL password to match step 1.

# 3. Build + start the containers (api on :8200, gotenberg internal only).
docker compose up -d --build

# 4. Create tables + seed the demo data (verbatim users/templates/correspondences).
docker compose exec api python -m app.seed.reset

# 5. Verify health (expects HTTP 200 with every service ok).
curl -s http://localhost:8200/api/healthz | jq

# Optional: inspect the full store payload.
curl -s http://localhost:8200/api/bootstrap | jq
```

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/healthz` | Aggregate health; 200 if all ok, else 503. |
| GET | `/api/users` | The 6 switchable demo identities (camelCase). |
| GET | `/api/bootstrap` | `{users, templates, correspondences}` — exact frontend JSON. |

Identity for later write endpoints is selected via the `X-Demo-User` header
(missing → `u_admin`, unknown → 401).

## Reference numbers

`allocate_ref()` is backed by the `ref_counter` table. With `REF_START=31` the
first allocation yields **`EHCD/REQ/2026/031`** (zero-padded to 3). `corr_031`
(the live-demo reference) is deliberately **not** seeded.

## Safety notes

- **Postgres**: all writes go to the `nazo` database only. `app.seed.reset`
  TRUNCATEs **only** the tables this app declares (its own metadata allowlist) and
  never `DROP DATABASE`.
- **Qdrant**: the app only ever *creates/checks* the single `nazo_library`
  collection by name. It never lists, enumerates, or deletes collections, so other
  tenants' collections are untouched.
- **Secrets**: `.env.example` holds placeholders only. Put real credentials in
  `.env` (git-ignored) or mount them at runtime.

## Local development (without Docker)

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # point DATABASE_URL/QDRANT_URL at reachable hosts
python -m app.seed.reset
uvicorn app.main:app --host 0.0.0.0 --port 8200 --reload
```

## Layout

```
app/
  config.py          pydantic-settings BaseSettings
  db.py              engine + get_session + create_db_and_tables
  models.py          FULL SQLModel schema (contract for all phases)
  deps.py            get_session + get_current_user (X-Demo-User)
  llm/               LLMProvider Protocol + OpenAI/vLLM provider
  services/          refs (ref_counter), rag (qdrant), health (aggregate)
  routers/           health, users, bootstrap (+ serializers)
  seed/              data (verbatim seed) + reset (runnable, idempotent)
  main.py            FastAPI app, lifespan, CORS, optional SPA static mount
gotenberg/Dockerfile Gotenberg 8 + Arabic fonts
scripts/bootstrap_db.sh   isolated nazo role/db bootstrap (LF, idempotent)
```

## Serving the built frontend (optional)

The API mounts an SPA at `/` only if a directory exists at `STATIC_DIR`
(default `/app/static`; skipped silently otherwise). To serve the built
`nazo-ai` frontend from the container, `COPY` its `dist/` output to `/app/static`
in the Dockerfile, or bind-mount it and set `STATIC_DIR` accordingly. For local
dev, point `STATIC_DIR` at the on-disk `nazo-ai/dist` path.
