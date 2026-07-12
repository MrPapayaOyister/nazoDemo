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
import re
from typing import Any, AsyncIterator, Callable, Optional

import httpx

from app.config import settings
from app.llm.provider import LLMHealth


class StructuredOutputError(RuntimeError):
    """Raised when the model cannot be coerced into a valid JSON object even after
    the json_object fallback retry."""


def _parse_json_object(text: str) -> Optional[dict[str, Any]]:
    """Best-effort parse of the first balanced JSON object in a model reply.

    Strict json_schema mode returns a clean object, but the json_object fallback
    (and defensive paths) may wrap it in prose or markdown fences — this recovers
    the first balanced {...} and json.loads() it."""
    if not text:
        return None
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*", "", text).strip().rstrip("`").strip()
    try:
        obj = json.loads(text)
        return obj if isinstance(obj, dict) else None
    except json.JSONDecodeError:
        pass
    start = text.find("{")
    if start == -1:
        return None
    depth = 0
    for i in range(start, len(text)):
        c = text[i]
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                try:
                    obj = json.loads(text[start : i + 1])
                    return obj if isinstance(obj, dict) else None
                except json.JSONDecodeError:
                    return None
    return None


_JSON_TYPE_PY: dict[str, Any] = {
    "object": dict,
    "array": list,
    "string": str,
    "boolean": bool,
    "number": (int, float),
    "integer": int,
}


def _validate_against_schema(obj: Any, schema: dict[str, Any]) -> bool:
    """Minimal recursive JSON-Schema check (types, required keys, enums, nested
    objects/arrays). Used to re-validate the json_object FALLBACK output, where the
    server does not enforce the schema for us. Not a full validator — it covers the
    constructs these Step-6a schemas actually use so a hallucinated assignee,
    missing required key, or wrong type on the fallback path is rejected."""
    stype = schema.get("type")
    if stype:
        py = _JSON_TYPE_PY.get(stype)
        # bool is a subclass of int — guard so a boolean is not accepted as number.
        if stype in ("number", "integer") and isinstance(obj, bool):
            return False
        if py is not None and not isinstance(obj, py):
            return False
    enum = schema.get("enum")
    if enum is not None and obj not in enum:
        return False
    if stype == "object" or "properties" in schema:
        if not isinstance(obj, dict):
            return False
        for key in schema.get("required", []):
            if key not in obj:
                return False
        props = schema.get("properties", {})
        for key, sub in props.items():
            if key in obj and not _validate_against_schema(obj[key], sub):
                return False
    if stype == "array":
        if not isinstance(obj, list):
            return False
        item_schema = schema.get("items")
        if isinstance(item_schema, dict):
            for item in obj:
                if not _validate_against_schema(item, item_schema):
                    return False
    return True


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
        return await self._post_chat(payload)

    async def _post_chat(self, payload: dict[str, Any]) -> str:
        """POST /chat/completions (non-streaming) and return the message content."""
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.post(f"{self.base_url}/chat/completions", json=payload)
            resp.raise_for_status()
            data = resp.json()
        return data["choices"][0]["message"]["content"]

    async def complete_structured(
        self,
        messages: list[dict[str, Any]],
        schema: dict[str, Any],
        *,
        name: str = "out",
        temperature: float = 0.2,
        max_tokens: int = 1200,
        validator: Optional[Callable[[dict[str, Any]], bool]] = None,
        **opts: Any,
    ) -> dict[str, Any]:
        """VERIFIED structured-output call.

        Primary path uses vLLM's response_format json_schema with strict=True,
        which ENFORCES the schema (extra fields are dropped). If that call errors
        (transport/HTTP/empty choices) or the reply is not parseable, retry ONCE in
        json_object mode with the schema pasted into an instruction, then parse
        defensively. The primary path is server-enforced, but the json_object
        FALLBACK is NOT — so the fallback dict is re-validated against `schema`
        (plus an optional caller `validator`) before being returned. Raises
        StructuredOutputError if still invalid.
        """
        base: dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": False,
        }
        base.update(opts)

        # --- Primary: json_schema strict (schema-enforced) ------------------
        try:
            payload = dict(base)
            payload["response_format"] = {
                "type": "json_schema",
                "json_schema": {"name": name, "strict": True, "schema": schema},
            }
            content = await self._post_chat(payload)
            parsed = _parse_json_object(content)
            if parsed is not None:
                return parsed
        except (httpx.HTTPError, KeyError, IndexError, ValueError):
            # Empty/malformed choices or transport error — fall through to retry.
            pass

        # --- Fallback: json_object + schema-in-prompt (retry once) ----------
        retry_messages = list(messages) + [
            {
                "role": "system",
                "content": (
                    "Reply ONLY as a single JSON object matching this JSON Schema "
                    "(no markdown, no commentary):\n" + json.dumps(schema)
                ),
            }
        ]
        payload = dict(base)
        payload["messages"] = retry_messages
        payload["response_format"] = {"type": "json_object"}
        try:
            content = await self._post_chat(payload)
        except httpx.HTTPError as exc:  # noqa: BLE001 - surfaced as a clear error
            raise StructuredOutputError(
                f"structured call failed (json_object retry transport error): {exc}"
            ) from exc
        parsed = _parse_json_object(content)
        if parsed is None:
            raise StructuredOutputError(
                "model did not return a valid JSON object after json_object retry"
            )
        # The fallback path is NOT server-enforced — re-validate against the schema
        # (and any caller validator) so a hallucinated/missing/mistyped field on this
        # path is rejected rather than returned unfiltered.
        if not _validate_against_schema(parsed, schema):
            raise StructuredOutputError(
                "json_object fallback did not satisfy the required schema"
            )
        if validator is not None and not validator(parsed):
            raise StructuredOutputError(
                "json_object fallback failed the caller-supplied validator"
            )
        return parsed

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
