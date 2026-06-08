"""Shared provider-client helpers for LLM-backed MemoLink services."""

from openai import OpenAI

from memolink_backend.core.config import settings

GEMINI_MODELS = {"gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.5-pro"}
DEEPSEEK_MODELS = {"deepseek-chat", "deepseek-reasoner", "deepseek-coder"}
GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/"
DEEPSEEK_BASE_URL = "https://api.deepseek.com/v1"
MODEL_ALIASES = {
    "gemini-2.0-flash": "gemini-2.5-flash",
    "gemini-2.0-flash-lite": "gemini-2.5-flash-lite",
    "gemini-1.5-flash-8b": "gemini-2.5-flash-lite",
    "gemini-1.5-pro": "gemini-2.5-pro",
}


def canonical_model(model: str) -> str:
    return MODEL_ALIASES.get(model, model)


def get_client(model: str, user_keys: dict | None = None) -> OpenAI:
    model = canonical_model(model)
    keys = user_keys or {}
    if model in keys:
        cfg = keys[model]
        return OpenAI(api_key=cfg["key"], base_url=cfg.get("base_url") or None)
    if model in GEMINI_MODELS:
        return OpenAI(api_key=settings.gemini_api_key, base_url=GEMINI_BASE_URL)
    if model in DEEPSEEK_MODELS:
        return OpenAI(api_key=settings.deepseek_api_key, base_url=DEEPSEEK_BASE_URL)
    return OpenAI(api_key=settings.openai_api_key)
