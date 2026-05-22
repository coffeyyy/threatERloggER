"""OpenAI embeddings wrapper with retry/backoff."""
import os
from openai import OpenAI
from tenacity import retry, stop_after_attempt, wait_exponential

EMBED_MODEL = "gemini-embedding-001"  # 1536 dims, matches our schema

_client: OpenAI | None = None


def get_client() -> OpenAI:
    global _client
    if _client is None:
        _client = OpenAI(
            api_key=os.getenv("GEMINI_API_KEY"),
            base_url="https://generativelanguage.googleapis.com/v1beta/openai/",
        )
    return _client


@retry(
    stop=stop_after_attempt(6),
    wait=wait_exponential(multiplier=2, min=10, max=60),
)
def embed_batch(texts: list[str]) -> list[list[float]]:
    """Embed a batch of texts. Returns one vector per input."""
    if not texts:
        return []
    response = get_client().embeddings.create(
        model=EMBED_MODEL,
        input=texts,
        dimensions=1536,
    )
    return [item.embedding for item in response.data]


def embed_one(text: str) -> list[float]:
    """Convenience wrapper for a single text."""
    result = embed_batch([text])
    return result[0]
