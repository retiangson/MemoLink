import asyncio
import json

from memolink_backend.business.services import whatsapp_service


class _FakeMessage:
    content = json.dumps({"replies": ["Formal reply", "Casual reply", "Brief reply"]})


class _FakeChoice:
    message = _FakeMessage()


class _FakeCompletionResponse:
    choices = [_FakeChoice()]


class _FakeCompletions:
    def create(self, **_kwargs):
        return _FakeCompletionResponse()


class _FakeChat:
    completions = _FakeCompletions()


class _FakeOpenAI:
    def __init__(self, **_kwargs):
        self.chat = _FakeChat()


class _FakeHttpResponse:
    def __init__(self, payload, status_code=200):
        self.payload = payload
        self.status_code = status_code

    def raise_for_status(self):
        return None

    def json(self):
        return self.payload


class _RecordingAsyncClient:
    last_json = None

    def __init__(self, **_kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return None

    async def post(self, _url, json):
        self.__class__.last_json = json
        return _FakeHttpResponse({"ok": True})


class _ListChatsAsyncClient:
    def __init__(self, **_kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return None

    async def get(self, url, params=None):
        if url.endswith("/chats"):
            return _FakeHttpResponse({
                "chats": [
                    {"id": "with-count@s.whatsapp.net", "name": "Has count", "messageCount": 2},
                    {"id": "empty-count@s.whatsapp.net", "name": "Empty count", "messageCount": 0},
                    {"id": "probe-hit@s.whatsapp.net", "name": "Probe hit"},
                    {"id": "probe-empty@s.whatsapp.net", "name": "Probe empty"},
                ]
            })
        chat_id = (params or {}).get("chatId")
        if chat_id == "probe-hit@s.whatsapp.net":
            return _FakeHttpResponse({"messages": [{"id": "m1"}], "total": 1})
        return _FakeHttpResponse({"messages": [], "total": 0})


class _ProfilePictureAsyncClient:
    last_params = None

    def __init__(self, **_kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return None

    async def get(self, _url, params=None):
        self.__class__.last_params = params
        return _FakeHttpResponse({
            "url": "https://example.test/avatar.jpg",
            "data_url": "data:image/jpeg;base64,abc",
        })


def test_suggest_reply_reads_messages_from_bridge_envelope(monkeypatch):
    async def fake_get_messages(chat_id, limit=20, offset=0):
        assert chat_id == "chat-1"
        assert limit == 10
        return {
            "messages": [
                {"fromMe": False, "from": "Alice", "body": "Can you send the update?"},
                {"fromMe": True, "from": "me", "body": "Yes, after lunch."},
            ],
            "total": 2,
        }

    monkeypatch.setattr(whatsapp_service, "get_messages", fake_get_messages)
    monkeypatch.setattr(whatsapp_service, "OpenAI", _FakeOpenAI)

    replies = asyncio.run(whatsapp_service.suggest_reply("chat-1"))

    assert replies == ["Formal reply", "Casual reply", "Brief reply"]


def test_normalize_chat_id_accepts_phone_number_and_existing_jid():
    assert whatsapp_service.normalize_chat_id("64204718827") == "64204718827@s.whatsapp.net"
    assert whatsapp_service.normalize_chat_id("+64 20 471 8827") == "64204718827@s.whatsapp.net"
    assert whatsapp_service.normalize_chat_id("64204718827@s.whatsapp.net") == "64204718827@s.whatsapp.net"
    assert whatsapp_service.normalize_chat_id("186677163225175@lid") == "186677163225175@lid"


def test_delete_message_preserves_selected_chat_jid(monkeypatch):
    _RecordingAsyncClient.last_json = None
    monkeypatch.setattr(whatsapp_service.httpx, "AsyncClient", _RecordingAsyncClient)

    result = asyncio.run(whatsapp_service.delete_message("186677163225175@lid", "msg-1"))

    assert result == {"ok": True}
    assert _RecordingAsyncClient.last_json == {
        "chatId": "186677163225175@lid",
        "msgId": "msg-1",
    }


def test_delete_chat_preserves_selected_chat_jid(monkeypatch):
    _RecordingAsyncClient.last_json = None
    monkeypatch.setattr(whatsapp_service.httpx, "AsyncClient", _RecordingAsyncClient)

    result = asyncio.run(whatsapp_service.delete_chat("186677163225175@lid"))

    assert result == {"ok": True}
    assert _RecordingAsyncClient.last_json == {"chatId": "186677163225175@lid"}


def test_list_chats_filters_empty_shell_conversations(monkeypatch):
    monkeypatch.setattr(whatsapp_service.httpx, "AsyncClient", _ListChatsAsyncClient)

    chats = asyncio.run(whatsapp_service.list_chats())

    assert [chat["id"] for chat in chats] == [
        "with-count@s.whatsapp.net",
        "probe-hit@s.whatsapp.net",
    ]


def test_get_profile_picture_preserves_selected_chat_jid(monkeypatch):
    _ProfilePictureAsyncClient.last_params = None
    monkeypatch.setattr(whatsapp_service.httpx, "AsyncClient", _ProfilePictureAsyncClient)

    result = asyncio.run(whatsapp_service.get_profile_picture("186677163225175@lid"))

    assert result == {
        "url": "https://example.test/avatar.jpg",
        "data_url": "data:image/jpeg;base64,abc",
    }
    assert _ProfilePictureAsyncClient.last_params == {"chatId": "186677163225175@lid"}


def test_suggest_reply_ignores_empty_or_malformed_message_payload(monkeypatch):
    async def fake_get_messages(_chat_id, limit=20, offset=0):
        return {"messages": [{"fromMe": False}, "not-a-message"], "total": 2}

    monkeypatch.setattr(whatsapp_service, "get_messages", fake_get_messages)

    assert asyncio.run(whatsapp_service.suggest_reply("chat-1")) == []
