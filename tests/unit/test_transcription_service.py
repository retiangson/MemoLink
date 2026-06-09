from memolink_backend.business.services import transcription_service as transcription_module


def test_transcription_service_transcribe_upload_returns_cleaned_metadata(monkeypatch):
    service = transcription_module.TranscriptionService()

    monkeypatch.setattr(
        transcription_module,
        "transcribe_audio_detailed",
        lambda *args, **kwargs: {
            "text": "hello   world",
            "service_used": "whisper",
            "fallback_used": False,
        },
    )

    result = service.transcribe_upload(
        file_bytes=b"abc",
        filename="lecture.webm",
        language="en",
        backend="auto",
        mode="lecture",
        prompt_context="prior",
    )

    assert result["text"] == "hello   world"
    assert result["cleaned_text"] == "hello world"
    assert result["service_used"] == "whisper"
    assert result["mode"] == "lecture"


def test_transcription_service_finalize_lecture_falls_back_when_llm_fails(monkeypatch):
    service = transcription_module.TranscriptionService()

    class BrokenClient:
        def __init__(self, *args, **kwargs):
            raise RuntimeError("boom")

    monkeypatch.setattr(transcription_module, "OpenAI", BrokenClient)

    result = service.finalize_lecture("First line.\n\nSecond line with action item.")

    assert result["cleaned_transcript"] == "First line.\n\nSecond line with action item."
    assert result["summary"] == ""
    assert result["action_items"] == []
    assert result["title_suggestion"] == "Lecture Notes"
