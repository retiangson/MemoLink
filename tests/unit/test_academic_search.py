import memolink_backend.utils.academic_search as academic_search


def test_search_papers_merges_parallel_sources_in_stable_priority_order(monkeypatch):
    monkeypatch.setattr(
        academic_search,
        "_search_semantic_scholar",
        lambda query, limit, api_key: [
            {"title": "Shared Paper", "source": "Semantic Scholar"},
            {"title": "Semantic Only", "source": "Semantic Scholar"},
        ],
    )
    monkeypatch.setattr(
        academic_search,
        "_search_core",
        lambda query, limit, api_key: [
            {"title": "Shared Paper", "source": "CORE"},
            {"title": "Core Only", "source": "CORE"},
        ],
    )
    monkeypatch.setattr(
        academic_search,
        "_search_arxiv",
        lambda query, limit: [
            {"title": "Arxiv Only", "source": "arXiv"},
        ],
    )

    papers = academic_search.search_papers(
        "context aware ai companion",
        limit=5,
        api_key="semantic-key",
        core_api_key="core-key",
        include_arxiv=True,
    )

    assert [paper["title"] for paper in papers] == [
        "Shared Paper",
        "Semantic Only",
        "Core Only",
        "Arxiv Only",
    ]
    assert papers[0]["source"] == "Semantic Scholar"


def test_paper_title_key_normalizes_long_titles_consistently():
    title = "A Very Long Paper Title About Context-Aware AI Companions and Retrieval Systems " * 2

    key = academic_search.paper_title_key(title)

    assert key == title.lower().strip()[:80]
