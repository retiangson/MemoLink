import pytest

from memolink_backend.business.services.embedding_service import strip_html
from tests.fakes.embedding_service import FakeEmbeddingService


def test_strip_html_removes_tags_and_keeps_text():
    assert strip_html("<h1>Hello</h1><p>World</p>") == "Hello  World"


def test_fake_embedding_service_rejects_empty_text():
    service = FakeEmbeddingService()

    with pytest.raises(ValueError):
        service.embed_text("   ")
