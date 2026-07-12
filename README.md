# NAZO Demo

Semi-real, live-demo build of the NAZO AI government correspondence system,
deployed on an NVIDIA DGX Spark that **reuses** the box's existing
vLLM / Postgres / Qdrant rather than standing up duplicates.

## Structure
- `nazo-ai/`  — React 19 + Vite frontend (existing UI / routes preserved)
- `nazo-api/` — FastAPI + SQLModel backend: workflow engine, RAG, DOCX/PDF, Gmail *(in progress)*

## Deployment reuse (DGX Spark)
- **LLM:** resident vLLM `qwen2.5-32b` (OpenAI-compatible on :9000)
- **DB:** shared Postgres 15 → isolated `nazo` database
- **Vectors:** shared Qdrant → isolated `nazo_library` collection
- **Docs:** Gotenberg (added); api on host port **8200**
- Delivery: cloud VM (`enterprise-dashboard`) → Tailscale → Spark:8200

## Frontend dev
```bash
cd nazo-ai
npm ci
npm run dev   # http://localhost:5173
```
