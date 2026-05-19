import re
from openai import OpenAI
from memolink_backend.core.config import settings

client = OpenAI(api_key=settings.openai_api_key)

_HTML_TAG = re.compile(r"<[^>]+>")


def strip_html(text: str) -> str:
    """Remove HTML tags so embeddings are based on plain text."""
    return _HTML_TAG.sub(" ", text).strip()


class EmbeddingService:
    def __init__(self, model: str | None = None):
        self.model = model or settings.openai_embedding_model

    def embed_text(self, text: str) -> list[float]:
        plain = strip_html(text)
        # Fallback: if stripping removed everything (e.g. math/angle-bracket content), use raw text
        if not plain.strip():
            plain = re.sub(r"\s+", " ", text).strip()
        if not plain:
            raise ValueError("Cannot embed empty text")
        # text-embedding-3-small has an 8191-token limit (~32k chars); truncate to stay safe
        resp = client.embeddings.create(model=self.model, input=plain[:30000])
        return resp.data[0].embedding
