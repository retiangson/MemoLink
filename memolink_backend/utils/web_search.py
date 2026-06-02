import httpx
from memolink_backend.core.config import settings

_BRAVE_URL = "https://api.search.brave.com/res/v1/web/search"
_BRAVE_IMAGE_URL = "https://api.search.brave.com/res/v1/images/search"


def _headers(api_key: str) -> dict:
    return {
        "Accept": "application/json",
        "Accept-Encoding": "gzip",
        "X-Subscription-Token": api_key,
    }


def brave_search(query: str, count: int = 5) -> str:
    """Return a formatted block of web search results, or an empty string on failure."""
    api_key = settings.brave_search_api_key
    if not api_key:
        return ""

    try:
        resp = httpx.get(
            _BRAVE_URL,
            params={"q": query, "count": count, "text_decorations": "false"},
            headers=_headers(api_key),
            timeout=8.0,
        )
        resp.raise_for_status()
        data = resp.json()
        results = data.get("web", {}).get("results", [])
        if not results:
            return ""

        lines = [f'## Web Results for "{query}"']
        for i, r in enumerate(results, 1):
            title = r.get("title", "").strip()
            url = r.get("url", "").strip()
            desc = r.get("description", "").strip()
            lines.append(f"### {i}. {title}\n{url}\n\n{desc}")
        return "\n\n".join(lines)
    except Exception:
        return ""


def brave_image_search(query: str, count: int = 3) -> str:
    """Return Markdown image previews from Brave Image Search, or an empty string on failure."""
    api_key = settings.brave_search_api_key
    if not api_key:
        return ""

    try:
        resp = httpx.get(
            _BRAVE_IMAGE_URL,
            params={"q": query, "count": count},
            headers=_headers(api_key),
            timeout=8.0,
        )
        resp.raise_for_status()
        data = resp.json()
        results = data.get("results", [])
        if not results:
            return ""

        lines = ["## Image Previews"]
        for r in results[:count]:
            title = (r.get("title") or "Image result").strip()
            page_url = (r.get("url") or "").strip()
            thumbnail = r.get("thumbnail") or {}
            properties = r.get("properties") or {}
            image_url = (
                (thumbnail.get("src") or "").strip()
                or (properties.get("url") or "").strip()
            )
            if not image_url:
                continue
            safe_title = title.replace("\n", " ").replace("[", "(").replace("]", ")")
            lines.append(f"![{safe_title}]({image_url})")
            if page_url:
                lines.append(f"[Source: {safe_title}]({page_url})")
        return "\n\n".join(lines) if len(lines) > 1 else ""
    except Exception:
        return ""
