import json
import logging
import time
import urllib.error
import urllib.parse
import urllib.request

logger = logging.getLogger(__name__)

# ── Semantic Scholar ──────────────────────────────────────────────────────────
_SS_BASE = "https://api.semanticscholar.org/graph/v1"
_SS_FIELDS = "title,authors,abstract,year,citationCount,externalIds,openAccessPdf"
_SS_BACKOFF = (1, 2, 4)  # exponential backoff delays in seconds on 429

# ── OpenAlex (fallback when no SS key) ───────────────────────────────────────
_OA_BASE = "https://api.openalex.org/works"
_OA_SELECT = "title,authorships,abstract_inverted_index,doi,cited_by_count,publication_year,open_access"
_MAILTO = "memolink-research@example.com"  # OpenAlex polite-pool identifier


def search_papers(query: str, limit: int = 5, api_key: str = "") -> list[dict]:
    """
    Search academic papers.
    Uses Semantic Scholar when api_key is provided (with exponential backoff on 429).
    Falls back to OpenAlex (free, no key, no rate limit) when no key is set.
    Always returns [] on permanent failure so the research flow continues.
    """
    if api_key:
        return _search_semantic_scholar(query, limit, api_key)
    return _search_openalex(query, limit)


# ── Semantic Scholar ──────────────────────────────────────────────────────────

def _search_semantic_scholar(query: str, limit: int, api_key: str) -> list[dict]:
    url = (
        f"{_SS_BASE}/paper/search"
        f"?query={urllib.parse.quote(query)}"
        f"&limit={limit}"
        f"&fields={_SS_FIELDS}"
    )
    headers = {
        "User-Agent": "MemoLink-Research/1.0",
        "x-api-key": api_key,
    }

    last_exc: Exception | None = None
    for attempt, delay in enumerate(_SS_BACKOFF + (None,)):
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=12) as resp:
                return _parse_ss(json.loads(resp.read()))
        except urllib.error.HTTPError as exc:
            last_exc = exc
            if exc.code == 429 and delay is not None:
                logger.debug(
                    "Semantic Scholar 429 on attempt %d — backing off %ds", attempt + 1, delay
                )
                time.sleep(delay)
                continue
            break
        except Exception as exc:
            last_exc = exc
            break

    logger.warning("Semantic Scholar search failed for %r: %s", query, last_exc)
    return _search_openalex(query, 5)  # transparent fallback to OpenAlex


def _parse_ss(data: dict) -> list[dict]:
    papers = []
    for p in data.get("data", []):
        author_list = p.get("authors") or []
        authors = ", ".join(a.get("name", "") for a in author_list[:3])
        if len(author_list) > 3:
            authors += " et al."
        ext_ids = p.get("externalIds") or {}
        pdf = (p.get("openAccessPdf") or {}).get("url")
        abstract = (p.get("abstract") or "").strip()
        papers.append({
            "title": (p.get("title") or "Untitled").strip(),
            "authors": authors,
            "year": p.get("year"),
            "abstract": abstract[:350] + ("…" if len(abstract) > 350 else ""),
            "doi": ext_ids.get("DOI"),
            "pdf_url": pdf,
            "citations": p.get("citationCount", 0),
        })
    return papers


# ── OpenAlex ──────────────────────────────────────────────────────────────────

def _search_openalex(query: str, limit: int) -> list[dict]:
    try:
        params = urllib.parse.urlencode({
            "search": query,
            "per-page": limit,
            "filter": "has_abstract:true",
            "select": _OA_SELECT,
            "mailto": _MAILTO,
        })
        req = urllib.request.Request(
            f"{_OA_BASE}?{params}",
            headers={"User-Agent": "MemoLink-Research/1.0"},
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            return _parse_oa(json.loads(resp.read()))
    except Exception as exc:
        logger.warning("OpenAlex search failed for %r: %s", query, exc)
        return []


def _rebuild_abstract(inverted: dict | None) -> str:
    if not inverted:
        return ""
    pairs = [(pos, word) for word, positions in inverted.items() for pos in positions]
    return " ".join(word for _, word in sorted(pairs))


def _parse_oa(data: dict) -> list[dict]:
    papers = []
    for work in data.get("results", []):
        authorships = work.get("authorships") or []
        names = [a.get("author", {}).get("display_name", "") for a in authorships[:3]]
        authors = ", ".join(n for n in names if n)
        if len(authorships) > 3:
            authors += " et al."
        abstract = _rebuild_abstract(work.get("abstract_inverted_index"))
        abstract = abstract[:350] + ("…" if len(abstract) > 350 else "")
        doi = (work.get("doi") or "").replace("https://doi.org/", "")
        pdf_url = (work.get("open_access") or {}).get("oa_url")
        papers.append({
            "title": (work.get("title") or "Untitled").strip(),
            "authors": authors,
            "year": work.get("publication_year"),
            "abstract": abstract,
            "doi": doi or None,
            "pdf_url": pdf_url,
            "citations": work.get("cited_by_count", 0),
        })
    return papers


# ── Shared formatter ──────────────────────────────────────────────────────────

def format_papers_context(papers: list[dict]) -> str:
    if not papers:
        return ""
    lines = ["[ACADEMIC SOURCES]"]
    for i, p in enumerate(papers, 1):
        line = f"{i}. **{p['title']}**"
        if p["authors"]:
            line += f" — {p['authors']}"
        if p["year"]:
            line += f" ({p['year']})"
        if p["citations"]:
            line += f" [{p['citations']:,} citations]"
        lines.append(line)
        if p["abstract"]:
            lines.append(f"   Abstract: {p['abstract']}")
        ref_parts = []
        if p["doi"]:
            ref_parts.append(f"DOI: {p['doi']}")
        if p["pdf_url"]:
            ref_parts.append(f"PDF: {p['pdf_url']}")
        if ref_parts:
            lines.append("   " + " | ".join(ref_parts))
    return "\n".join(lines)
