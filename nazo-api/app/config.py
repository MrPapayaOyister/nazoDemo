"""Application settings (pydantic-settings). Values are read from the environment
and/or a local .env file. No secrets are hard-coded here — see .env.example."""

from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # --- Postgres (isolated db/role "nazo"; psycopg v3 driver) ---
    database_url: str = "postgresql+psycopg://nazo:CHANGEME@host.docker.internal:5432/nazo"

    # --- Qdrant (single isolated collection) ---
    qdrant_url: str = "http://host.docker.internal:6333"
    qdrant_collection: str = "nazo_library"
    qdrant_vector_size: int = 1024
    qdrant_distance: str = "Cosine"

    # --- vLLM (OpenAI-compatible) ---
    llm_base_url: str = "http://host.docker.internal:9000/v1"
    llm_model: str = "qwen2.5-32b"

    # --- Gotenberg ---
    gotenberg_url: str = "http://gotenberg:3000"

    # --- API ---
    api_port: int = 8200

    # --- Reference number allocation (EHCD/REQ/2026/031 first) ---
    ref_prefix: str = "EHCD/REQ"
    ref_year: int = 2026
    ref_start: int = 31

    # --- Embeddings (later phases) ---
    embed_model: str = "BAAI/bge-m3"

    # --- Gmail (later phases) ---
    gmail_credentials: str = "/secrets/credentials.json"
    gmail_token: str = "/secrets/token.json"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
