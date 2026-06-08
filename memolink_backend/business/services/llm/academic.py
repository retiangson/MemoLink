"""Academic-writing helpers shared across chat and context engines."""

from __future__ import annotations

import re

_ACADEMIC_STOPWORDS = {
    "a", "about", "add", "all", "an", "and", "answer", "any", "assessment", "assignment",
    "brief", "can", "citation", "citations", "complete", "cover", "criteria", "detailed",
    "document", "draft", "entire", "essay", "every", "expect", "final", "follow", "for",
    "from", "full", "fulfill", "fulfil", "guide", "help", "i", "in", "include", "instructions",
    "into", "is", "it", "lets", "marking", "max", "maximum", "me", "minimum", "my", "need",
    "notes", "of", "on", "or", "our", "paper", "please", "project", "proposal", "references",
    "report", "requirements", "research", "response", "rubric", "section", "sections",
    "specific", "submission", "summary", "than", "that", "the", "this", "to", "topic",
    "use", "want", "with", "word", "words", "write", "writing",
}


def parse_word_targets(prompt: str) -> tuple[int, int]:
    text = prompt.lower()

    def _to_words(raw: str, has_k: bool) -> int:
        n = int(raw.replace(",", ""))
        return n * 1000 if has_k else n

    min_words = 0
    max_words = 0

    min_match = re.search(r"(?:minimum|min|at least)\s+(?:of\s+)?(\d[\d,]*)\s*(k)?\s*(?:word|words|w)?", text)
    if min_match:
        min_words = _to_words(min_match.group(1), bool(min_match.group(2)))

    max_match = re.search(r"(?:maximum|max|up to|no more than)\s+(?:of\s+)?(\d[\d,]*)\s*(k)?\s*(?:word|words|w)?", text)
    if max_match:
        max_words = _to_words(max_match.group(1), bool(max_match.group(2)))

    range_match = re.search(r"(\d[\d,]*)\s*(k)?\s*[-–]\s*(\d[\d,]*)\s*(k)?\s*(?:word|words|w)", text)
    if range_match:
        if not min_words:
            min_words = _to_words(range_match.group(1), bool(range_match.group(2)))
        if not max_words:
            max_words = _to_words(range_match.group(3), bool(range_match.group(4)))

    return min_words, max_words


def extract_course_codes(text: str) -> list[str]:
    seen: set[str] = set()
    codes: list[str] = []
    for match in re.findall(r"\b[A-Za-z]{2,}\d{2,}[A-Za-z0-9-]*\b", text or ""):
        code = match.upper()
        if code not in seen:
            seen.add(code)
            codes.append(code)
    return codes


def extract_topic_terms(text: str, *, limit: int = 8) -> list[str]:
    cleaned = re.sub(r"[^A-Za-z0-9\s-]+", " ", text or "").lower()
    seen: set[str] = set()
    terms: list[str] = []
    for raw in cleaned.split():
        token = raw.strip("-")
        if not token or token in seen:
            continue
        if token in _ACADEMIC_STOPWORDS or len(token) < 4 or token.isdigit():
            continue
        if re.fullmatch(r"[a-z]{2,}\d{2,}[a-z0-9-]*", token):
            continue
        seen.add(token)
        terms.append(token)
        if len(terms) >= limit:
            break
    return terms


def build_dynamic_academic_queries(
    prompt: str,
    smart_analysis: dict | None = None,
    note_titles: list[str] | None = None,
) -> list[str]:
    queries = [q.strip() for q in ((smart_analysis or {}).get("academic_search_queries", []) or []) if q and q.strip()]
    if queries:
        return queries[:2]

    topic_terms = extract_topic_terms(prompt, limit=10)
    for title in note_titles or []:
        for term in extract_topic_terms(title, limit=4):
            if term not in topic_terms:
                topic_terms.append(term)

    primary_terms = topic_terms[:4] or ["research", "topic"]
    secondary_terms = topic_terms[2:6] or topic_terms[:3] or ["case", "study"]
    primary = " ".join((primary_terms + ["study"])[:5])
    secondary = " ".join((secondary_terms + ["evaluation"])[:5])

    if primary == secondary:
        secondary = " ".join((secondary_terms + ["analysis"])[:5])
    return [primary, secondary]


def build_dynamic_academic_title(prompt: str) -> str:
    course_codes = extract_course_codes(prompt)
    assessment_match = re.search(
        r"\b(assessment|assignment|report|paper|essay|proposal|thesis|capstone)\s*(\d+)?\b",
        prompt,
        re.IGNORECASE,
    )
    topic_terms = extract_topic_terms(prompt, limit=6)

    parts: list[str] = []
    if course_codes:
        parts.append(course_codes[0])
    if assessment_match:
        label = assessment_match.group(1).title()
        if assessment_match.group(2):
            label = f"{label} {assessment_match.group(2)}"
        parts.append(label)

    title = " - ".join(parts) if parts else "Academic Draft"
    if topic_terms:
        title = f"{title}: {' '.join(term.title() for term in topic_terms[:4])}"
    return f"# {title}\n\n"
