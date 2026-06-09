from __future__ import annotations

import json
import logging
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor, as_completed

logger = logging.getLogger(__name__)

# ── Semantic Scholar ──────────────────────────────────────────────────────────
_SS_BASE = "https://api.semanticscholar.org/graph/v1"
_SS_FIELDS = "title,authors,abstract,year,citationCount,externalIds,openAccessPdf"
_SS_BACKOFF = (1, 2, 4)

# ── OpenAlex (fallback when no SS key) ───────────────────────────────────────
_OA_BASE = "https://api.openalex.org/works"
_OA_SELECT = "title,authorships,abstract_inverted_index,doi,cited_by_count,publication_year,open_access"
_MAILTO = "memolink-research@example.com"

# ── CORE ──────────────────────────────────────────────────────────────────────
_CORE_BASE = "https://api.core.ac.uk/v3/search/works"

# ── arXiv ─────────────────────────────────────────────────────────────────────
_ARXIV_BASE = "http://export.arxiv.org/api/query"
_ARXIV_NS = "http://www.w3.org/2005/Atom"


# ── Public API ────────────────────────────────────────────────────────────────


def paper_title_key(title: str | None) -> str:
    """Normalize a paper title to a stable deduplication key."""
    return (title or "").lower().strip()[:80]


def search_papers(
    query: str,
    limit: int = 5,
    api_key: str = "",
    core_api_key: str = "",
    include_arxiv: bool = True,
) -> list[dict]:
    """
    Search academic papers across all configured sources.
    - Semantic Scholar (best metadata + citation counts) when api_key set
    - CORE (full text of open-access papers) when core_api_key set
    - arXiv (CS/AI/Math preprints, free, no key) when include_arxiv=True
    - OpenAlex as fallback when no Semantic Scholar key

    Results are merged and deduplicated by title.
    """
    results: list[dict] = []
    seen: set[str] = set()

    def _add(papers: list[dict]) -> None:
        for p in papers:
            key = paper_title_key(p.get("title"))
            if key and key not in seen:
                seen.add(key)
                results.append(p)

    provider_calls: list[tuple[str, Callable[[], list[dict]]]] = []
    if api_key:
        provider_calls.append(
            ("semantic_scholar", lambda: _search_semantic_scholar(query, limit, api_key))
        )
    else:
        provider_calls.append(("openalex", lambda: _search_openalex(query, limit)))

    if core_api_key:
        provider_calls.append(
            ("core", lambda: _search_core(query, min(limit, 5), core_api_key))
        )

    if include_arxiv:
        provider_calls.append(("arxiv", lambda: _search_arxiv(query, min(limit, 5))))

    if not provider_calls:
        return []

    provider_results: dict[str, list[dict]] = {}
    with ThreadPoolExecutor(max_workers=min(len(provider_calls), 4)) as executor:
        futures = {
            executor.submit(fetch): provider_name
            for provider_name, fetch in provider_calls
        }
        for future in as_completed(futures):
            provider_name = futures[future]
            try:
                provider_results[provider_name] = future.result() or []
            except Exception as exc:
                logger.warning(
                    "Academic provider %s failed for %r: %s",
                    provider_name,
                    query,
                    exc,
                )
                provider_results[provider_name] = []

    for provider_name, _ in provider_calls:
        _add(provider_results.get(provider_name, []))

    return results


def search_papers_full_text(
    query: str,
    limit: int = 3,
    core_api_key: str = "",
) -> list[dict]:
    """
    Search specifically for papers with full text available (CORE only).
    Used to enrich cited papers with complete content before saving as notes.
    """
    if not core_api_key:
        return []
    return _search_core(query, limit, core_api_key)


def extract_cited_papers(draft: str, papers: list[dict]) -> list[dict]:
    """
    Find which papers from the fetched list were actually cited in the draft.
    Matches on first-author last name appearing in the draft near a year.
    """
    cited: list[dict] = []
    for paper in papers:
        authors_str = (paper.get("authors") or "").strip()
        if not authors_str:
            continue
        # Get first author last name
        first_author_full = authors_str.split(",")[0].strip()
        last_name = first_author_full.split()[-1] if first_author_full else ""
        if not last_name or len(last_name) < 3:
            continue
        year = str(paper.get("year") or "")
        # Match: Smith (2024), Smith et al. (2024), (Smith, 2024), (Smith & Jones, 2024)
        pattern = rf'\b{re.escape(last_name)}\b.{{0,30}}{year}' if year else rf'\b{re.escape(last_name)}\b'
        if re.search(pattern, draft, re.IGNORECASE):
            cited.append(paper)
    return cited


def format_paper_as_note(paper: dict) -> str:
    """Format a paper dict as rich note content for saving to MemoLink."""
    lines: list[str] = []
    if paper.get("authors"):
        lines.append(f"**Authors:** {paper['authors']}")
    if paper.get("year"):
        lines.append(f"**Year:** {paper['year']}")
    if paper.get("citations"):
        lines.append(f"**Citations:** {paper['citations']:,}")
    if paper.get("doi"):
        lines.append(f"**DOI:** {paper['doi']}")
    if paper.get("pdf_url"):
        lines.append(f"**PDF:** {paper['pdf_url']}")
    if paper.get("source"):
        lines.append(f"**Source:** {paper['source']}")
    if paper.get("abstract"):
        lines.append(f"\n**Abstract:**\n{paper['abstract']}")
    if paper.get("full_text"):
        # Cap full text to avoid enormous notes
        ft = paper["full_text"].strip()
        lines.append(f"\n**Full Text:**\n{ft[:8000]}{'…' if len(ft) > 8000 else ''}")
    return "\n".join(lines)


# ── Semantic Scholar ──────────────────────────────────────────────────────────

def _search_semantic_scholar(query: str, limit: int, api_key: str) -> list[dict]:
    url = (
        f"{_SS_BASE}/paper/search"
        f"?query={urllib.parse.quote(query)}"
        f"&limit={limit}"
        f"&fields={_SS_FIELDS}"
    )
    headers = {"User-Agent": "MemoLink-Research/1.0", "x-api-key": api_key}
    last_exc: Exception | None = None
    for attempt, delay in enumerate(_SS_BACKOFF + (None,)):
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=12) as resp:
                return _parse_ss(json.loads(resp.read()))
        except urllib.error.HTTPError as exc:
            last_exc = exc
            if exc.code == 429 and delay is not None:
                time.sleep(delay)
                continue
            break
        except Exception as exc:
            last_exc = exc
            break
    logger.warning("Semantic Scholar search failed for %r: %s", query, last_exc)
    return _search_openalex(query, 5)


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
            "abstract": abstract[:500] + ("…" if len(abstract) > 500 else ""),
            "doi": ext_ids.get("DOI"),
            "pdf_url": pdf,
            "citations": p.get("citationCount", 0),
            "source": "Semantic Scholar",
            "full_text": "",
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
        abstract = abstract[:500] + ("…" if len(abstract) > 500 else "")
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
            "source": "OpenAlex",
            "full_text": "",
        })
    return papers


# ── CORE ──────────────────────────────────────────────────────────────────────

def _search_core(query: str, limit: int, api_key: str) -> list[dict]:
    try:
        params = urllib.parse.urlencode({"q": query, "limit": limit})
        req = urllib.request.Request(
            f"{_CORE_BASE}?{params}",
            headers={
                "User-Agent": "MemoLink-Research/1.0",
                "Authorization": f"Bearer {api_key}",
            },
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            return _parse_core(json.loads(resp.read()))
    except Exception as exc:
        logger.warning("CORE search failed for %r: %s", query, exc)
        return []


def _parse_core(data: dict) -> list[dict]:
    papers = []
    for work in data.get("results", []):
        author_list = work.get("authors") or []
        names = [a.get("name", "") for a in author_list[:3] if a.get("name")]
        authors = ", ".join(names)
        if len(author_list) > 3:
            authors += " et al."
        abstract = (work.get("abstract") or "").strip()
        full_text = (work.get("fullText") or "").strip()
        doi = (work.get("doi") or "").replace("https://doi.org/", "")
        papers.append({
            "title": (work.get("title") or "Untitled").strip(),
            "authors": authors,
            "year": work.get("yearPublished"),
            "abstract": abstract[:500] + ("…" if len(abstract) > 500 else ""),
            "doi": doi or None,
            "pdf_url": work.get("downloadUrl"),
            "citations": 0,
            "source": "CORE",
            "full_text": full_text[:10000] if full_text else "",
        })
    return papers


# ── arXiv ─────────────────────────────────────────────────────────────────────

def _search_arxiv(query: str, limit: int) -> list[dict]:
    try:
        params = urllib.parse.urlencode({
            "search_query": f"all:{query}",
            "max_results": limit,
            "sortBy": "relevance",
        })
        req = urllib.request.Request(
            f"{_ARXIV_BASE}?{params}",
            headers={"User-Agent": "MemoLink-Research/1.0"},
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            return _parse_arxiv(resp.read())
    except Exception as exc:
        logger.warning("arXiv search failed for %r: %s", query, exc)
        return []


def _parse_arxiv(xml_bytes: bytes) -> list[dict]:
    papers = []
    try:
        root = ET.fromstring(xml_bytes)
        ns = {"atom": _ARXIV_NS}
        for entry in root.findall("atom:entry", ns):
            title_el = entry.find("atom:title", ns)
            summary_el = entry.find("atom:summary", ns)
            title = (title_el.text or "").strip().replace("\n", " ") if title_el is not None else "Untitled"
            abstract = (summary_el.text or "").strip().replace("\n", " ") if summary_el is not None else ""
            authors = []
            for author_el in entry.findall("atom:author", ns)[:3]:
                name_el = author_el.find("atom:name", ns)
                if name_el is not None and name_el.text:
                    authors.append(name_el.text.strip())
            authors_str = ", ".join(authors)
            if len(entry.findall("atom:author", ns)) > 3:
                authors_str += " et al."
            # Published year
            pub_el = entry.find("atom:published", ns)
            year = None
            if pub_el is not None and pub_el.text:
                year_match = re.match(r"(\d{4})", pub_el.text)
                if year_match:
                    year = int(year_match.group(1))
            # arXiv ID and PDF link
            arxiv_id = ""
            pdf_url = ""
            for link_el in entry.findall("atom:link", ns):
                if link_el.get("type") == "application/pdf":
                    pdf_url = link_el.get("href", "")
                elif link_el.get("rel") == "alternate":
                    arxiv_id = link_el.get("href", "")
            papers.append({
                "title": title,
                "authors": authors_str,
                "year": year,
                "abstract": abstract[:500] + ("…" if len(abstract) > 500 else ""),
                "doi": None,
                "pdf_url": pdf_url or arxiv_id or None,
                "citations": 0,
                "source": "arXiv",
                "full_text": "",
            })
    except Exception as exc:
        logger.warning("arXiv XML parse failed: %s", exc)
    return papers


# ── Shared formatter ──────────────────────────────────────────────────────────

def format_papers_context(papers: list[dict]) -> str:
    if not papers:
        return ""
    lines = ["[ACADEMIC SOURCES]"]
    for i, p in enumerate(papers, 1):
        line = f"{i}. **{p['title']}**"
        if p.get("authors"):
            line += f" - {p['authors']}"
        if p.get("year"):
            line += f" ({p['year']})"
        if p.get("citations"):
            line += f" [{p['citations']:,} citations]"
        if p.get("source"):
            line += f" [{p['source']}]"
        lines.append(line)
        if p.get("abstract"):
            lines.append(f"   Abstract: {p['abstract']}")
        if p.get("full_text"):
            # Include a snippet of full text in the context for richer citations
            snippet = p["full_text"][:600].replace("\n", " ").strip()
            lines.append(f"   Full text excerpt: {snippet}…")
        ref_parts = []
        if p.get("doi"):
            ref_parts.append(f"DOI: {p['doi']}")
        if p.get("pdf_url"):
            ref_parts.append(f"PDF: {p['pdf_url']}")
        if ref_parts:
            lines.append("   " + " | ".join(ref_parts))
    return "\n".join(lines)
