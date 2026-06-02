import json
import re
from typing import Optional
from openai import OpenAI
from memolink_backend.core.config import settings
from memolink_backend.domain.repositories.graph_repository import GraphRepository
from memolink_backend.domain.repositories.note_repository import NoteRepository


def _strip_html(html: str) -> str:
    text = re.sub(r"<style[^>]*>.*?</style>", "", html or "", flags=re.DOTALL)
    text = re.sub(r"<script[^>]*>.*?</script>", "", text, flags=re.DOTALL)
    text = re.sub(r"<[^>]+>", " ", text)
    return re.sub(r"\s+", " ", text).strip()


# Maps GPT output field → (node_type, relationship_label)
_ENTITY_MAP = {
    "people":       ("person",      "mentions"),
    "topics":       ("topic",       "covers"),
    "projects":     ("project",     "relates_to"),
    "deadlines":    ("deadline",    "has_deadline"),
    "decisions":    ("decision",    "records"),
    "action_items": ("action_item", "contains"),
    "questions":    ("question",    "raises"),
    "themes":       ("theme",       "exhibits"),
}

_BATCH_SIZE = 5  # notes per GPT call


def _extract_entities_batch(notes_batch: list[dict]) -> list[dict]:
    """Send up to _BATCH_SIZE notes to GPT in one call; return entity dicts indexed by note_index."""
    if not notes_batch:
        return []

    items = "\n\n".join(
        f"NOTE {i + 1} (id={n['id']}, title={n['title']!r}):\n{n['text'][:600]}"
        for i, n in enumerate(notes_batch)
    )
    prompt = (
        "Extract structured entities from each note below.\n"
        "Return ONLY a JSON array — one object per note:\n"
        "[\n"
        '  {"note_index": 1, "people": [], "topics": [], "projects": [],\n'
        '   "deadlines": [], "decisions": [], "action_items": [],\n'
        '   "questions": [], "themes": []},\n'
        "  ...\n"
        "]\n"
        "Rules:\n"
        "- Keep every item under 60 characters.\n"
        "- Use empty arrays if nothing found.\n"
        "- Do NOT return markdown, only raw JSON.\n\n"
        + items
    )
    try:
        client = OpenAI(api_key=settings.openai_api_key)
        resp = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            temperature=0,
            max_tokens=1200,
        )
        content = resp.choices[0].message.content.strip()
        match = re.search(r"\[.*\]", content, re.DOTALL)
        if match:
            parsed = json.loads(match.group())
            if isinstance(parsed, list):
                return parsed
    except Exception:
        pass
    # Fallback: empty results for each note
    return [{"note_index": i + 1} for i in range(len(notes_batch))]


class MemographService:
    def __init__(self, graph_repo: GraphRepository, note_repo: NoteRepository):
        self.graph_repo = graph_repo
        self.note_repo = note_repo

    def build(self, user_id: int, workspace_id: int, db) -> dict:
        """Extract entities from all workspace notes and build the knowledge graph."""
        # Start fresh — clear previous graph
        self.graph_repo.clear(user_id, workspace_id)

        notes = self.note_repo.get_for_user(user_id, workspace_id)
        if not notes:
            return {"nodes": 0, "edges": 0}

        # Create note nodes (one per note, deduped by title)
        note_nodes: dict[int, object] = {}
        for note in notes:
            node = self.graph_repo.upsert_node(
                user_id=user_id,
                workspace_id=workspace_id,
                node_type="note",
                label=(note.title or "Untitled")[:200],
                source_id=note.id,
            )
            note_nodes[note.id] = node

        # Create reminder nodes for active reminders in this workspace
        from memolink_backend.domain.models.reminder import Reminder
        reminders = (
            db.query(Reminder)
            .filter(
                Reminder.user_id == user_id,
                Reminder.workspace_id == workspace_id,
                Reminder.done == False,
            )
            .all()
        )
        for r in reminders:
            self.graph_repo.upsert_node(
                user_id=user_id,
                workspace_id=workspace_id,
                node_type="reminder",
                label=r.text[:200],
                source_id=r.id,
            )

        db.flush()

        # entity_node_id → list of note_node_ids (for cross-note linking)
        entity_to_notes: dict[int, list[int]] = {}

        # Process notes in batches
        for batch_start in range(0, len(notes), _BATCH_SIZE):
            batch = notes[batch_start: batch_start + _BATCH_SIZE]
            batch_data = [
                {
                    "id": n.id,
                    "title": n.title or "Untitled",
                    "text": _strip_html(n.content or ""),
                }
                for n in batch
            ]

            results = _extract_entities_batch(batch_data)

            for i, note in enumerate(batch):
                note_node = note_nodes.get(note.id)
                if not note_node:
                    continue

                # Find matching result by note_index
                result = next((r for r in results if r.get("note_index") == i + 1), {})

                for field, (entity_type, relationship) in _ENTITY_MAP.items():
                    for item in result.get(field, []):
                        item = (item or "").strip()
                        if not item:
                            continue
                        entity_node = self.graph_repo.upsert_node(
                            user_id=user_id,
                            workspace_id=workspace_id,
                            node_type=entity_type,
                            label=item[:200],
                        )
                        self.graph_repo.upsert_edge(
                            user_id=user_id,
                            source_node_id=note_node.id,
                            target_node_id=entity_node.id,
                            relationship=relationship,
                        )
                        entity_to_notes.setdefault(entity_node.id, []).append(note_node.id)

        db.flush()

        # Link notes that share the same entity (≥2 notes share an entity → related_to edge)
        seen_pairs: set[tuple[int, int]] = set()
        for note_node_ids in entity_to_notes.values():
            if len(note_node_ids) < 2:
                continue
            for j in range(len(note_node_ids)):
                for k in range(j + 1, len(note_node_ids)):
                    a, b = note_node_ids[j], note_node_ids[k]
                    pair = (min(a, b), max(a, b))
                    if pair not in seen_pairs:
                        seen_pairs.add(pair)
                        self.graph_repo.upsert_edge(
                            user_id=user_id,
                            source_node_id=pair[0],
                            target_node_id=pair[1],
                            relationship="related_to",
                        )

        db.commit()

        graph = self.graph_repo.get_graph(user_id, workspace_id)
        return {"nodes": len(graph["nodes"]), "edges": len(graph["links"])}

    def get_graph(self, user_id: int, workspace_id: Optional[int]) -> dict:
        return self.graph_repo.get_graph(user_id, workspace_id)

    def clear(self, user_id: int, workspace_id: int, db) -> None:
        self.graph_repo.clear(user_id, workspace_id)
