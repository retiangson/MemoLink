import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from memolink_backend.core.security import get_current_user
from memolink_backend.business.services import whatsapp_service

router = APIRouter(prefix="/whatsapp", tags=["whatsapp"])


def _bridge_error_detail(resp: httpx.Response) -> str:
    try:
        data = resp.json()
        if isinstance(data, dict):
            return str(data.get("error") or data.get("detail") or resp.text[:200] or "WhatsApp bridge request failed")
    except ValueError:
        pass
    return resp.text[:200] or "WhatsApp bridge request failed"


class SendRequest(BaseModel):
    chat_id: str
    text: str


class DeleteRequest(BaseModel):
    chat_id: str
    msg_id: str


class DeleteChatRequest(BaseModel):
    chat_id: str


class SuggestRequest(BaseModel):
    chat_id: str
    note_context: str = ""
    draft_reply: str = ""


@router.post("/start")
def start_whatsapp(user_id: int = Depends(get_current_user)):
    try:
        return whatsapp_service.start_bridge(user_id)
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.delete("/stop")
def stop_whatsapp(user_id: int = Depends(get_current_user)):
    return whatsapp_service.stop_bridge(user_id)


@router.get("/status")
def get_status(_user_id: int = Depends(get_current_user)):
    return whatsapp_service.get_status()


@router.get("/chats")
async def list_chats(_user_id: int = Depends(get_current_user)):
    chats = await whatsapp_service.list_chats()
    return {"chats": chats}


@router.get("/messages")
async def get_messages(
    chat_id: str,
    limit: int = 20,
    offset: int = 0,
    _user_id: int = Depends(get_current_user),
):
    result = await whatsapp_service.get_messages(chat_id, limit=limit, offset=offset)
    return result  # already {messages: [...], total: N}


@router.get("/profile-picture")
async def get_profile_picture(
    chat_id: str,
    _user_id: int = Depends(get_current_user),
):
    result = await whatsapp_service.get_profile_picture(chat_id)
    if not result:
        raise HTTPException(status_code=404, detail="Profile picture not available")
    return result


@router.post("/send")
async def send_message(
    req: SendRequest,
    _user_id: int = Depends(get_current_user),
):
    if not req.text.strip():
        raise HTTPException(status_code=400, detail="Message text is required")
    try:
        return await whatsapp_service.send_message(req.chat_id, req.text.strip())
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.post("/delete")
async def delete_message(
    req: DeleteRequest,
    _user_id: int = Depends(get_current_user),
):
    if not req.msg_id.strip():
        raise HTTPException(status_code=400, detail="Message id is required")
    try:
        return await whatsapp_service.delete_message(req.chat_id, req.msg_id.strip())
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except httpx.HTTPStatusError as e:
        status = e.response.status_code
        detail = _bridge_error_detail(e.response)
        raise HTTPException(status_code=status, detail=detail)
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.post("/delete-chat")
async def delete_chat(
    req: DeleteChatRequest,
    _user_id: int = Depends(get_current_user),
):
    try:
        return await whatsapp_service.delete_chat(req.chat_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except httpx.HTTPStatusError as e:
        status = e.response.status_code
        detail = _bridge_error_detail(e.response)
        raise HTTPException(status_code=status, detail=detail)
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.get("/media")
async def get_media(
    chat_id: str,
    msg_id: str,
    _user_id: int = Depends(get_current_user),
):
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(
                f"{whatsapp_service.BRIDGE_URL}/media",
                params={"chatId": chat_id, "msgId": msg_id},
            )
        if resp.status_code == 404:
            raise HTTPException(status_code=404, detail="Media not in cache — reconnect WhatsApp to re-sync")
        if resp.status_code != 200:
            raise HTTPException(status_code=resp.status_code, detail=resp.text[:200])
        return resp.json()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.post("/suggest-reply")
async def suggest_reply(
    req: SuggestRequest,
    _user_id: int = Depends(get_current_user),
):
    replies = await whatsapp_service.suggest_reply(req.chat_id, req.note_context, req.draft_reply)
    return {"replies": replies}


@router.post("/reset-session")
def reset_session(user_id: int = Depends(get_current_user)):
    """Kill any running bridge and wipe saved session so the next connect shows a fresh QR."""
    whatsapp_service.stop_bridge(user_id)
    return {"reset": True}
