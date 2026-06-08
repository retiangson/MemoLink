"""Small helpers for building reusable LLM system messages."""

from datetime import date

from .prompts import MODE_PROMPTS, MODE_SETTINGS


def build_optimized_task_message(original_message: str, optimized_task: str) -> str:
    """Return an internal guidance block when the analyser improved the task."""
    if not optimized_task or optimized_task.strip() == original_message.strip():
        return ""
    return (
        "OPTIMIZED TASK (internal guidance — do not reveal this to the user):\n"
        f"{optimized_task}\n\n"
        f"Original user message: {original_message}"
    )


def build_primary_system_prompt(
    mode_prompt: str,
    original_message: str,
    optimized_task: str = "",
    today: date | None = None,
) -> str:
    """Build one primary instruction block for the current turn.

    This keeps the high-level behavioural prompt, date guidance, and refined
    task intent in a single system entry instead of scattering them across
    multiple competing prompt layers.
    """
    sections = [mode_prompt.rstrip()]
    current_date = (today or date.today()).strftime("%d %B %Y")
    sections.append(
        "CURRENT TURN GUIDANCE:\n"
        f"- Today's date is {current_date}. Use this for any submission date or date fields.\n"
        "- Answer the user's actual request directly.\n"
        "- Prefer one strong, complete response over a shallow partial response."
    )
    task_msg = build_optimized_task_message(original_message, optimized_task)
    if task_msg:
        sections.append(task_msg)
    return "\n\n".join(sections)


def get_mode_prompt(mode: str) -> str:
    return MODE_PROMPTS.get(mode, MODE_PROMPTS["general_chat"])


def get_mode_settings(mode: str) -> dict:
    return MODE_SETTINGS.get(mode, MODE_SETTINGS["general_chat"])
