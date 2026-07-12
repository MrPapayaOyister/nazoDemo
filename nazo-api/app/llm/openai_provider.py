"""OpenAI-compatible provider talking to the shared vLLM server.

Endpoints used:
  GET  {base}/models            -> health (configured model must be listed)
  POST {base}/chat/completions  -> complete
"""

from __future__ import annotations

from typing import Any

import httpx

from app.config import settings
from app.llm.provider import LLMHealth


class OpenAIProvider:
    def __init__(
        self,
        base_url: str | None = None,
        model: str | None = None,
        timeout: float = 30.0,
    ) -> None:
        self.base_url = (base_url or settings.llm_base_url).rstrip("/")
        self.model = model or settings.llm_model
        self.timeout = timeout

    async def complete(
        self,
        messages: list[dict[str, Any]],
        *,
        temperature: float = 0.2,
        max_tokens: int = 1024,
        **kwargs: Any,
    ) -> str:
        """Minimal working chat-completions call.

        Phase-2 note: no AI action wires this in yet, but the transport is real so
        later phases can call it directly.
        """
        payload: dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        payload.update(kwargs)
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.post(f"{self.base_url}/chat/completions", json=payload)
            resp.raise_for_status()
            data = resp.json()
        return data["choices"][0]["message"]["content"]

    async def health(self) -> LLMHealth:
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(f"{self.base_url}/models")
                resp.raise_for_status()
                data = resp.json()
        except Exception as exc:  # noqa: BLE001 - health must never raise
            return LLMHealth(ok=False, detail=f"unreachable: {exc}")

        ids = {m.get("id") for m in data.get("data", [])}
        if self.model in ids:
            return LLMHealth(ok=True, detail=f"model '{self.model}' served")
        return LLMHealth(
            ok=False,
            detail=f"model '{self.model}' not in served models {sorted(i for i in ids if i)}",
        )


def get_provider() -> OpenAIProvider:
    return OpenAIProvider()
