# nazo-api — FastAPI + SQLModel backend for the NAZO government-correspondence demo.
# Target box: NVIDIA DGX Spark (aarch64 Linux). Slim base builds cleanly on arm64;
# no torch / sentence-transformers / docxtpl / google wheels are required.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# System deps kept minimal; psycopg[binary] ships its own libpq, qdrant-client is
# pure-python. curl is handy for the container healthcheck against /api/healthz.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --upgrade pip && pip install -r requirements.txt

COPY . .

EXPOSE 8200

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8200"]
