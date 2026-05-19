from fastapi import APIRouter, Depends
from pydantic import BaseModel
from openai import OpenAI
from memolink_backend.core.security import get_current_user
from memolink_backend.core.config import settings

router = APIRouter(prefix="/translate", tags=["translate"])


class TranslateRequest(BaseModel):
    text: str
    target_language: str = "English"


@router.post("")
async def translate(req: TranslateRequest, _: int = Depends(get_current_user)):
    client = OpenAI(api_key=settings.openai_api_key)
    response = client.chat.completions.create(
        model=settings.openai_chat_model,
        messages=[
            {
                "role": "system",
                "content": (
                    f"Translate the following text to {req.target_language}. "
                    "Return only the translated text with no additional commentary."
                ),
            },
            {"role": "user", "content": req.text},
        ],
        max_tokens=2000,
        temperature=0.3,
    )
    return {"translation": response.choices[0].message.content}
