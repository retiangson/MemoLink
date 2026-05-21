from memolink_backend.api.v1.suggest_controller import _normalize_date, _normalize_time, _word_overlap


def test_normalize_date_accepts_iso_and_day_first_formats():
    assert _normalize_date("2026-05-21") == "2026-05-21"
    assert _normalize_date("21/05/2026") == "2026-05-21"
    assert _normalize_date("21-5-2026") == "2026-05-21"
    assert _normalize_date("next week") is None


def test_normalize_time_accepts_common_formats():
    assert _normalize_time("23:00") == "23:00"
    assert _normalize_time("23:00:59") == "23:00"
    assert _normalize_time("2:30 PM") == "14:30"
    assert _normalize_time("12 AM") == "00:00"


def test_word_overlap_scores_duplicate_reminders():
    assert _word_overlap("update ra document", "update the ra document") >= 0.8
    assert _word_overlap("call doctor", "buy milk") == 0
