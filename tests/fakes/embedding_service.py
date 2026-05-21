class FakeEmbeddingService:
    def __init__(self, vector=None):
        self.vector = vector or [0.1, 0.2, 0.3]

    def embed_text(self, text):
        if not text.strip():
            raise ValueError("Cannot embed empty text")
        return self.vector
