import httpx
from memolink_backend.core.config import settings

_BRAVE_URL = "https://api.search.brave.com/res/v1/web/search"


def brave_search(query: str, count: int = 5) -> str:
    """Return a formatted block of web search results, or an empty string on failure."""
    api_key = settings.brave_search_api_key
    if not api_key:
        return ""

    try:
        resp = httpx.get(
            _BRAVE_URL,
            params={"q": query, "count": count, "text_decorations": "false"},
            headers={
                "Accept": "application/json",
                "Accept-Encoding": "gzip",
                "X-Subscription-Token": api_key,
            },
            timeout=8.0,
        )
        resp.raise_for_status()
        data = resp.json()
        results = data.get("web", {}).get("results", [])
        if not results:
            return ""

        lines = [f'--- WEB SEARCH RESULTS for "{query}" ---']
        for i, r in enumerate(results, 1):
            title = r.get("title", "").strip()
            url = r.get("url", "").strip()
            desc = r.get("description", "").strip()
            lines.append(f"[{i}] {title}\n    {url}\n    {desc}")
        return "\n\n".join(lines)
    except Exception:
        return ""
