"""
AutoPilot Model Routing Service
================================

Analyses each chat prompt and automatically selects the best AI model for the task,
balancing capability and cost — without requiring the user to think about model selection.

ROUTING RULES (evaluated in priority order)
-------------------------------------------
1. Translation      → gemini-2.5-flash      Gemini excels at language tasks; fast, cheap
2. Code / Debug     → deepseek-coder        Code-specialised model; strongest for programming
3. Deep Research    → gpt-4o                Maximum reasoning for analysis and research tasks
4. Long Context     → gemini-2.5-flash      1M token context window handles large note sets
5. Simple Query     → gpt-4o-mini           Short questions need no heavy model; saves cost
6. Default          → server default        Falls through to user/admin configured model

ACTIVATION RULES
----------------
- AutoPilot only activates when the request is using the server default model
  (i.e. the user has not explicitly changed their model in Settings).
- If the required API key for the best model is not configured, routing falls through
  to the next rule or the default.
- Image generation and slash commands are handled elsewhere and are never routed here.

RETURNED VALUE
--------------
route(prompt, selected_model, default_model, settings)
  → (model_id: str, routing_reason: str | None)

routing_reason is None when no routing was applied (user chose explicitly, or default
was already the best choice). A non-None reason means AutoPilot made a decision.
"""

import re
from typing import Optional

# ── Signal patterns ────────────────────────────────────────────────────────────

_TRANSLATION_RE = re.compile(
    r"\b(translate|translation|translating)\b"
    r"|(?:^|\s)(in|to|into)\s+"
    r"(french|spanish|german|japanese|chinese|mandarin|maori|arabic|hindi|"
    r"korean|italian|portuguese|russian|tagalog|dutch|swedish|greek|turkish|"
    r"vietnamese|thai|indonesian|malay)\b",
    re.IGNORECASE,
)

_CODE_KEYWORDS = frozenset([
    "code", "function", "debug", "error", "bug", "exception", "traceback",
    "python", "javascript", "typescript", "java", "kotlin", "swift", "rust",
    "programming", "algorithm", "compile", "syntax", "class ", "sql ", "query",
    "regex", "endpoint", "api ", "html", "css", "react", "component",
    "import ", "export ", "def ", "return ", "loop", "recursion", "async",
    "database", "schema", "migration", "docker", "git ", "bash", "script",
])

_RESEARCH_KEYWORDS = frozenset([
    "research", "analyze", "analyse", "analysis", "compare", "comparison",
    "comprehensive", "in depth", "in-depth", "detailed analysis", "explain why",
    "how does", "implications", "evaluate", "critique", "critically", "assessment",
    "discuss", "elaborate", "literature", "methodology", "hypothesis", "evidence",
    "argument", "perspective", "summarize all", "summarise all", "overview of",
    "what are the", "what is the difference", "pros and cons", "advantages",
])

_SIMPLE_EXCLUDE = frozenset([
    "explain", "analyze", "analyse", "why", "how", "what if", "difference",
    "compare", "summary", "summarize", "summarise", "describe", "define",
    "research", "elaborate",
])

_LONG_CONTEXT_WORD_THRESHOLD = 250
_SIMPLE_WORD_THRESHOLD = 12


# ── Main routing function ──────────────────────────────────────────────────────

def route(
    prompt: str,
    selected_model: str,
    default_model: str,
    gemini_key: str,
    deepseek_key: str,
    openai_key: str,
) -> tuple[str, Optional[str]]:
    """
    Returns (model_to_use, routing_reason).
    routing_reason is None when no routing was applied.

    AutoPilot only activates when selected_model == default_model, meaning the user
    has not explicitly overridden the model. User choice always takes priority.
    """
    if selected_model != default_model:
        return selected_model, None

    text_lower = prompt.lower()
    word_count = len(prompt.split())

    # ── Rule 1: Translation ────────────────────────────────────────────────────
    if _TRANSLATION_RE.search(text_lower) and gemini_key:
        return "gemini-2.5-flash", "Translation"

    # ── Rule 2: Code / Debugging ───────────────────────────────────────────────
    code_hits = sum(1 for kw in _CODE_KEYWORDS if kw in text_lower)
    if code_hits >= 2 and deepseek_key:
        return "deepseek-coder", "Code"

    # ── Rule 3: Deep Research / Complex Analysis ───────────────────────────────
    if any(kw in text_lower for kw in _RESEARCH_KEYWORDS) and openai_key:
        return "gpt-4o", "Deep Research"

    # ── Rule 4: Long Context ───────────────────────────────────────────────────
    if word_count > _LONG_CONTEXT_WORD_THRESHOLD and gemini_key:
        return "gemini-2.5-flash", "Long Context"

    # ── Rule 5: Simple / Short Query ───────────────────────────────────────────
    if word_count <= _SIMPLE_WORD_THRESHOLD and not any(kw in text_lower for kw in _SIMPLE_EXCLUDE):
        # Default model (gpt-4o-mini) is already optimal — signal this explicitly
        return default_model, "Simple Query"

    # ── No specific routing — use default ─────────────────────────────────────
    return default_model, None
