import asyncio
import logging
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from openai import AsyncOpenAI, RateLimitError, APIError
from memolink_backend.core.security import get_current_user
from memolink_backend.core.config import settings

router = APIRouter(prefix="/translate", tags=["translate"])
logger = logging.getLogger(__name__)

MAX_ROUNDS = 3          # 3 rounds max = at most 7 Gemini calls
TARGET_SCORE = 85
ROUND_DELAY_S = 1.2     # pause between rounds to avoid burst-rate detection
GEMINI_MODEL = "gemini-2.0-flash-lite"  # lighter model, softer burst thresholds

_MAORI_HINT = (
    "Te reo Māori is the indigenous language of New Zealand. "
    "Always use correct macrons (tohutō): ā ē ī ō ū — never substitute a plain vowel. "
    "Prefer natural, fluent Māori over literal word-for-word translation. "
    "Use common Māori loanwords where appropriate (e.g. kura for school, waka for vehicle, hōhonu for deep)."
)


class TranslateRequest(BaseModel):
    text: str
    target_language: str = "English"


def _gemini_client() -> AsyncOpenAI:
    return AsyncOpenAI(
        api_key=settings.gemini_api_key,
        base_url="https://generativelanguage.googleapis.com/v1beta/openai/",
    )


def _openai_client() -> AsyncOpenAI:
    return AsyncOpenAI(api_key=settings.openai_api_key)


def _is_maori(lang: str) -> bool:
    l = lang.lower().strip()
    return "māori" in l or "maori" in l or l == "mi"


async def _gpt_translate(client: AsyncOpenAI, text: str, target_language: str, hint: str = "") -> str:
    resp = await client.chat.completions.create(
        model=settings.openai_chat_model,
        messages=[
            {"role": "system", "content": f"Translate the following text to {target_language}. {hint} Return only the translated text with no commentary."},
            {"role": "user", "content": text},
        ],
        max_tokens=2000,
        temperature=0.3,
    )
    return (resp.choices[0].message.content or "").strip()


async def _gemini_translate(client: AsyncOpenAI, text: str, target_language: str, hint: str = "", feedback: str = "") -> str:
    system = (
        f"Translate the following text to {target_language}. "
        + (hint + " " if hint else "")
        + ("Previous attempt had these issues — fix them: " + feedback + " " if feedback else "")
        + "Return only the translated text with no additional commentary."
    )
    resp = await client.chat.completions.create(
        model=GEMINI_MODEL,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": text},
        ],
        max_tokens=2000,
        temperature=0.3,
    )
    return (resp.choices[0].message.content or "").strip()


async def _back_translate(client: AsyncOpenAI, translation: str, from_language: str, model: str = GEMINI_MODEL) -> str:
    resp = await client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": f"Translate the following {from_language} text to English. Return only the translation."},
            {"role": "user", "content": translation},
        ],
        max_tokens=2000,
        temperature=0.1,
    )
    return (resp.choices[0].message.content or "").strip()


async def _score_similarity(client: AsyncOpenAI, original: str, back_translation: str) -> int:
    """Returns 0-100 semantic similarity. Falls back to 50 on parse failure."""
    prompt = (
        f"Original:\n{original}\n\nBack-translated:\n{back_translation}\n\n"
        "Rate the semantic similarity 0-100 (100 = identical meaning). Return only the integer."
    )
    resp = await client.chat.completions.create(
        model=settings.openai_chat_model,
        messages=[
            {"role": "system", "content": "You are a translation quality evaluator. Respond with a single integer 0-100."},
            {"role": "user", "content": prompt},
        ],
        max_tokens=8,
        temperature=0.0,
    )
    raw = (resp.choices[0].message.content or "").strip()
    digits = "".join(c for c in raw if c.isdigit())[:3]
    try:
        return min(100, int(digits))
    except ValueError:
        return 50


async def _build_feedback(client: AsyncOpenAI, original: str, translation: str, back_translation: str, score: int) -> str:
    prompt = (
        f"Original: {original}\n"
        f"Translation: {translation}\n"
        f"Back-translation: {back_translation}\n"
        f"Similarity score: {score}/100\n\n"
        "In one sentence, describe the main translation errors to fix."
    )
    resp = await client.chat.completions.create(
        model=settings.openai_chat_model,
        messages=[{"role": "user", "content": prompt}],
        max_tokens=80,
        temperature=0.2,
    )
    return (resp.choices[0].message.content or "").strip()


async def _score_gpt_translation(gpt: AsyncOpenAI, original: str, translation: str, target_language: str) -> int | None:
    """Back-translate with GPT then score. Returns None on any failure."""
    try:
        back = await _back_translate(gpt, translation, target_language, model=settings.openai_chat_model)
        return await _score_similarity(gpt, original, back)
    except Exception:
        return None


@router.post("")
async def translate(req: TranslateRequest, _: int = Depends(get_current_user)):
    hint = _MAORI_HINT if _is_maori(req.target_language) else ""
    gpt = _openai_client()

    if not settings.gemini_api_key:
        translation = await _gpt_translate(gpt, req.text, req.target_language, hint)
        accuracy = await _score_gpt_translation(gpt, req.text, translation, req.target_language)
        return {"translation": translation, "accuracy": accuracy, "model": settings.openai_chat_model}

    gemini = _gemini_client()

    try:
        # Round 0 — initial Gemini translation
        translation = await _gemini_translate(gemini, req.text, req.target_language, hint)
        final_score: int | None = None

        for _ in range(MAX_ROUNDS):
            await asyncio.sleep(ROUND_DELAY_S)  # breather between rounds — avoids burst detection
            back = await _back_translate(gemini, translation, req.target_language)
            score = await _score_similarity(gpt, req.text, back)
            final_score = score

            if score >= TARGET_SCORE:
                break

            feedback = await _build_feedback(gpt, req.text, translation, back, score)
            await asyncio.sleep(ROUND_DELAY_S)
            translation = await _gemini_translate(gemini, req.text, req.target_language, hint, feedback)

        return {"translation": translation, "accuracy": final_score, "model": GEMINI_MODEL}

    except RateLimitError:
        logger.warning("Gemini rate limit hit for language=%s — falling back to GPT", req.target_language)
        translation = await _gpt_translate(gpt, req.text, req.target_language, hint)
        accuracy = await _score_gpt_translation(gpt, req.text, translation, req.target_language)
        return {"translation": translation, "accuracy": accuracy, "model": settings.openai_chat_model}

    except APIError as e:
        logger.error("Gemini API error: %s — falling back to GPT", e)
        translation = await _gpt_translate(gpt, req.text, req.target_language, hint)
        accuracy = await _score_gpt_translation(gpt, req.text, translation, req.target_language)
        return {"translation": translation, "accuracy": accuracy, "model": settings.openai_chat_model}

    except Exception as e:
        logger.error("Unexpected translation error: %s", e)
        raise HTTPException(status_code=500, detail="Translation failed. Please try again.")
