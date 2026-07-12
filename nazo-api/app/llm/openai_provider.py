"""OpenAI-compatible provider talking to the shared vLLM server.

Endpoints used:
  GET  {base}/models            -> health (configured model must be listed)
  POST {base}/chat/completions  -> complete / astream

The served model is config-driven (settings.llm_model). Swapping to a newer Qwen
(or any other OpenAI-compatible model the shared vLLM serves) is a single env var
change (LLM_MODEL) — no code change here.
"""

from __future__ import annotations

import json
from typing import Any, AsyncIterator

import httpx

from app.config import settings
from app.llm.provider import LLMHealth


class OpenAIProvider:
    def __init__(
        self,
        base_url: str | None = None,
        model: str | None = None,
        timeout: float = 60.0,
    ) -> None:
        self.base_url = (base_url or settings.llm_base_url).rstrip("/")
        self.model = model or settings.llm_model
        self.timeout = timeout

    async def complete(
        self,
        messages: list[dict[str, Any]],
        *,
        temperature: float = 0.2,
        max_tokens: int = 700,
        **kwargs: Any,
    ) -> str:
        """Non-streaming chat-completions call. Returns the message content."""
        payload: dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": False,
        }
        payload.update(kwargs)
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.post(f"{self.base_url}/chat/completions", json=payload)
            resp.raise_for_status()
            data = resp.json()
        return data["choices"][0]["message"]["content"]

    async def astream(
        self,
        messages: list[dict[str, Any]],
        *,
        temperature: float = 0.2,
        max_tokens: int = 700,
        **kwargs: Any,
    ) -> AsyncIterator[str]:
        """Stream token deltas from vLLM.

        POSTs with stream=true, parses the OpenAI-style Server-Sent-Event body
        ("data: {json}\\n\\n" lines), and yields each content delta as it arrives.
        Terminates on the sentinel "data: [DONE]". Malformed/keepalive lines are
        skipped defensively so a stray chunk never aborts a hero call.
        """
        payload: dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": True,
        }
        payload.update(kwargs)
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            async with client.stream(
                "POST", f"{self.base_url}/chat/completions", json=payload
            ) as resp:
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    if not line:
                        continue
                    line = line.strip()
                    if not line.startswith("data:"):
                        continue
                    data = line[len("data:"):].strip()
                    if data == "[DONE]":
                        break
                    try:
                        chunk = json.loads(data)
                    except json.JSONDecodeError:
                        continue
                    choices = chunk.get("choices") or []
                    if not choices:
                        continue
                    delta = choices[0].get("delta") or {}
                    content = delta.get("content")
                    if content:
                        yield content

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
