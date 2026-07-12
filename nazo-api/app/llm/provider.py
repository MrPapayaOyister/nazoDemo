"""LLM provider Protocol. Concrete implementations live alongside (openai_provider)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, AsyncIterator, Protocol, runtime_checkable


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
        max_tokens: int = 700,
        **kwargs: Any,
    ) -> str:
        """Return the assistant message content for a chat completion."""
        ...

    def astream(
        self,
        messages: list[dict[str, Any]],
        *,
        temperature: float = 0.2,
        max_tokens: int = 700,
        **kwargs: Any,
    ) -> AsyncIterator[str]:
        """Yield assistant content token deltas as they stream from the model."""
        ...

    async def health(self) -> LLMHealth:
        """Report whether the configured model is reachable/served."""
        ...
