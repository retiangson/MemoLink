"""
AutoPilot Model Routing Service
================================

Analyses each chat prompt and automatically selects the best AI model for the task,
balancing capability and cost — without requiring the user to think about model selection.

ROUTING RULES (evaluated in priority order)
-------------------------------------------
1. Translation      → gemini-2.5-flash      Gemini excels at language tasks; fast, cheap
2. Code / Debug     → deepseek-coder        Any language name mentioned, or ≥2 code keywords
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

# Any programming language name is a strong enough signal on its own
_LANGUAGE_RE = re.compile(
    r"\b("
    # Web / scripting
    r"python|javascript|typescript|php|ruby|perl|lua|r\b|"
    # Systems / compiled
    r"c\+\+|cpp|c#|csharp|c\b|java|kotlin|swift|rust|go\b|golang|scala|"
    r"haskell|ocaml|f#|fsharp|erlang|elixir|nim|zig|d\b|ada|fortran|cobol|"
    # JVM / .NET extras
    r"groovy|clojure|vala|crystal|"
    # Shell / scripting
    r"bash|zsh|powershell|shell|batch|vbscript|"
    # Data / ML
    r"julia|matlab|octave|sas|stata|"
    # Query
    r"sql|plsql|tsql|graphql|"
    # Markup / style (often asked with code questions)
    r"html|css|scss|sass|less|xml|json|yaml|toml|"
    # Mobile
    r"dart|flutter|"
    # Assembly / low-level
    r"assembly|asm|wasm|webassembly|"
    # Frameworks frequently named as the language
    r"react|vue|angular|svelte|nextjs|nuxt|django|flask|fastapi|laravel|"
    r"rails|spring|express|nestjs|"
    # Notebooks / data tools
    r"jupyter|pandas|numpy|tensorflow|pytorch|keras"
    r")\b",
    re.IGNORECASE,
)

_CODE_KEYWORDS = frozenset([
    "code", "function", "debug", "error", "bug", "exception", "traceback",
    "programming", "algorithm", "compile", "syntax", "class ", "sql ", "query",
    "regex", "endpoint", "api ", "component",
    "import ", "export ", "def ", "return ", "loop", "recursion", "async",
    "schema", "migration", "docker", "git ", "script",
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
    routing_reason is None when no routing was applied (default/fallthrough).
    AutoPilot always evaluates — the on/off switch is the autopilot_enabled feature flag.
    """
    text_lower = prompt.lower()
    word_count = len(prompt.split())

    # ── Rule 1: Translation ────────────────────────────────────────────────────
    if _TRANSLATION_RE.search(text_lower) and gemini_key:
        return "gemini-2.5-flash", "Translation"

    # ── Rule 2: Code / Debugging ───────────────────────────────────────────────
    # Any programming language mention OR ≥2 general code keywords → DeepSeek
    if deepseek_key and (
        _LANGUAGE_RE.search(text_lower)
        or sum(1 for kw in _CODE_KEYWORDS if kw in text_lower) >= 2
    ):
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
