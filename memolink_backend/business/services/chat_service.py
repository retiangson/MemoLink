from typing import List, Optional
from fastapi import UploadFile
from sqlalchemy.orm import Session
from openai import OpenAI
import re
import base64
import mimetypes

from memolink_backend.core.config import settings

_HTML_TAG = re.compile(r"<[^>]+>")
from memolink_backend.domain.repositories.conversation_repository import ConversationRepository
from memolink_backend.domain.repositories.note_repository import NoteRepository
from memolink_backend.domain.interfaces.i_conversation_repository import IConversationRepository
from memolink_backend.domain.interfaces.i_note_repository import INoteRepository
from memolink_backend.business.services.embedding_service import EmbeddingService
from memolink_backend.business.interfaces.i_chat_service import IChatService
from memolink_backend.utils.file_extractor import extract_text_local
from memolink_backend.contracts.chat_dtos import ChatResponseDTO, ChatAnswerSource, ChatRequestDTO, ChatAttachmentDTO

client = OpenAI(api_key=settings.openai_api_key)

IMAGE_EXTS = {"png", "jpg", "jpeg", "gif", "webp"}


def _is_image(filename: str, mime: str) -> bool:
    ext = filename.lower().rsplit(".", 1)[-1]
    return ext in IMAGE_EXTS or (bool(mime) and mime.startswith("image/"))


class ChatService(IChatService):
    def __init__(
        self,
        db: Optional[Session] = None,
        embedding_service: Optional[EmbeddingService] = None,
        conv_repo: Optional[IConversationRepository] = None,
        note_repo: Optional[INoteRepository] = None,
    ):
        if conv_repo is not None and note_repo is not None:
            self.repo_conv: IConversationRepository = conv_repo
            self.repo_notes: INoteRepository = note_repo
        else:
            if db is None:
                raise ValueError("Either repos or db must be provided.")
            self.repo_conv = ConversationRepository(db)
            self.repo_notes = NoteRepository(db)

        self.embedding = embedding_service or EmbeddingService()

    def ask(self, dto: ChatRequestDTO) -> ChatResponseDTO:
        user_text = (dto.prompt or "").strip()
        if not user_text:
            return ChatResponseDTO(answer="I didn't receive any message.", sources=[])

        if dto.conversation_id is None:
            title = user_text[:50]
            conv = self.repo_conv.create_conversation(dto.user_id, title)
            conversation_id = conv.id
        else:
            conversation_id = dto.conversation_id

        self.repo_conv.add_message(conversation_id, "user", user_text)

        # Load history ascending for GPT context
        history = self.repo_conv.get_messages_paginated(conversation_id, limit=50, before_id=None)
        history_asc = list(reversed(history))
        message_history = [{"role": m.role, "content": m.content} for m in history_asc]

        # RAG retrieval
        query_vec = self.embedding.embed_text(user_text)
        notes = self.repo_notes.search_by_vector(query_vec, top_k=dto.top_k)

        sources: List[ChatAnswerSource] = []
        rag_blocks: List[str] = []
        for n in notes:
            sources.append(ChatAnswerSource(note_id=n.id, title=n.title, snippet=n.content[:200] + "..."))
            plain_content = _HTML_TAG.sub(" ", n.content).strip()
            rag_blocks.append(f"[NOTE {n.id}: {n.title or 'Untitled'}]\n{plain_content}")

        system_msgs = [
            {
                "role": "system",
                "content": (
                    "You are MemoLink, a context-aware AI knowledge assistant. "
                    "Answer questions using the user's personal notes when relevant. "
                    "Always be concise, grounded, and cite note sources where possible.\n\n"
                    "NOTE EDITING RULE: When the user explicitly asks you to format, improve, rewrite, "
                    "proofread, restructure, or edit a note or piece of text, return the complete revised "
                    "content inside <note_edit> XML tags. "
                    "Format the revised content as a well-structured document: "
                    "use # for the document title, ## for major sections, ### for subsections, "
                    "**bold** for key terms, bullet lists (- item) or numbered lists for enumerations, "
                    "and markdown tables (| col | col |) for structured data where appropriate. "
                    "The output should read like a professional Word document, not a wall of plain text. "
                    "If you can identify exactly which note is being edited from the context "
                    "(look for [NOTE <id>: <title>] references), include the note_id attribute: "
                    "<note_edit note_id=\"42\">...full revised content...</note_edit>. "
                    "If the note id is unknown, omit the attribute: "
                    "<note_edit>...full revised content...</note_edit>. "
                    "You may add a brief explanation before or after the tags. "
                    "IMPORTANT: Only use <note_edit> tags when the user is explicitly requesting a note edit. "
                    "Never use them for regular questions or answers."
                ),
            }
        ]
        if rag_blocks:
            system_msgs.append({
                "role": "system",
                "content": "--- USER NOTES CONTEXT ---\n" + "\n\n".join(rag_blocks),
            })

        completion = client.chat.completions.create(
            model=settings.openai_chat_model,
            messages=system_msgs + message_history,
        )
        answer = completion.choices[0].message.content

        assistant_msg = self.repo_conv.add_message(conversation_id, "assistant", answer)

        return ChatResponseDTO(answer=answer, sources=sources, message_id=assistant_msg.id)

    async def handle_file_upload(
        self,
        conversation_id: int,
        prompt: str,
        files: List[UploadFile],
    ) -> ChatResponseDTO:
        prompt = prompt.strip() or "Please analyse the attached file(s) in detail."
        content_blocks: list = [{"type": "text", "text": prompt}]
        attachments: List[ChatAttachmentDTO] = []

        for file in files:
            filename = file.filename or "file"
            mime = file.content_type or mimetypes.guess_type(filename)[0] or "application/octet-stream"
            file_bytes = await file.read()

            attachments.append(ChatAttachmentDTO(filename=filename, content_type=mime, size=len(file_bytes)))

            if _is_image(filename, mime):
                b64 = base64.b64encode(file_bytes).decode()
                content_blocks.append({"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64}"}})
            elif filename.lower().endswith(".pdf"):
                uploaded = client.files.create(file=(filename, file_bytes, mime), purpose="vision")
                content_blocks.append({"type": "file", "file": {"file_id": uploaded.id}})
            else:
                extracted = extract_text_local(file_bytes, filename)
                content_blocks.append({"type": "text", "text": f"FILE: {filename}\n\n{extracted}"})

        attachment_label = "Attached: " + ", ".join(a.filename for a in attachments)
        self.repo_conv.add_message(conversation_id, "user", f"{attachment_label}\n\n{prompt}")

        completion = client.chat.completions.create(
            model=settings.openai_chat_model,
            messages=[
                {"role": "system", "content": "You are MemoLink. Analyse all attached files and answer the prompt."},
                {"role": "user", "content": content_blocks},
            ],
        )
        answer = completion.choices[0].message.content
        assistant_msg = self.repo_conv.add_message(conversation_id, "assistant", answer)

        return ChatResponseDTO(answer=answer, sources=[], attachments=attachments, message_id=assistant_msg.id)
