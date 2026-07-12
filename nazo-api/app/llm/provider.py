"""LLM provider Protocol. Concrete implementations live alongside (openai_provider)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol, runtime_checkable


@dataclass
class LLMHealth:
    ok: bool
    detail: str


@runtime_checkable
class LLMProvider(Protocol):
    """Minimal contract every provider must satisfy."""

    async def complete(
        self,
        messages: list[dict[str, Any]],
        *,
        temperature: float = 0.2,
        max_tokens: int = 1024,
        **kwargs: Any,
    ) -> str:
        """Return the assistant message content for a chat completion."""
        ...

    async def health(self) -> LLMHealth:
        """Report whether the configured model is reachable/served."""
        ...
