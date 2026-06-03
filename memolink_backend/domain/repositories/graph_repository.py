"""
GraphRepository - Persistence layer for MemoGraph nodes and edges.

Tables
------
graph_nodes  - one row per unique entity within a workspace.
               Unique key: (user_id, workspace_id, node_type, label).
               Deduplication means the same person/topic mentioned in multiple notes
               maps to a single node rather than duplicates.

graph_edges  - directed relationships between nodes.
               Unique key: (source_node_id, target_node_id, relationship).
               Edges cascade-delete when either endpoint node is removed.

Key methods
-----------
upsert_node            - get-or-create a node; safe to call multiple times.
upsert_edge            - get-or-create an edge; safe to call multiple times.
get_graph              - returns {nodes, links} JSON consumed by the frontend canvas.
get_related_note_ids   - graph traversal used by ChatService for graph-enhanced RAG:
                         given a list of seed note IDs (from vector search), returns
                         IDs of OTHER notes that share entity nodes with the seeds.
                         Traversal: seed_note → (edge) → entity → (edge) → other_note.
clear                  - deletes all nodes for a workspace; edges cascade automatically.
"""

from typing import Optional
from sqlalchemy.orm import Session
from memolink_backend.domain.models.graph_node import GraphNode
from memolink_backend.domain.models.graph_edge import GraphEdge


class GraphRepository:
    def __init__(self, db: Session):
        self.db = db

    def upsert_node(
        self,
        user_id: int,
        workspace_id: Optional[int],
        node_type: str,
        label: str,
        source_id: Optional[int] = None,
    ) -> GraphNode:
        normalized = label.strip()[:500]
        existing = (
            self.db.query(GraphNode)
            .filter_by(user_id=user_id, workspace_id=workspace_id, node_type=node_type, label=normalized)
            .first()
        )
        if existing:
            return existing
        node = GraphNode(
            user_id=user_id,
            workspace_id=workspace_id,
            node_type=node_type,
            label=normalized,
            source_id=source_id,
        )
        self.db.add(node)
        self.db.flush()
        return node

    def upsert_edge(
        self,
        user_id: int,
        source_node_id: int,
        target_node_id: int,
        relationship: str,
    ) -> GraphEdge:
        existing = (
            self.db.query(GraphEdge)
            .filter_by(source_node_id=source_node_id, target_node_id=target_node_id, relationship=relationship)
            .first()
        )
        if existing:
            return existing
        edge = GraphEdge(
            user_id=user_id,
            source_node_id=source_node_id,
            target_node_id=target_node_id,
            relationship=relationship,
        )
        self.db.add(edge)
        self.db.flush()
        return edge

    def get_graph(self, user_id: int, workspace_id: Optional[int]) -> dict:
        nodes = (
            self.db.query(GraphNode)
            .filter_by(user_id=user_id, workspace_id=workspace_id)
            .all()
        )
        if not nodes:
            return {"nodes": [], "links": []}
        node_ids = {n.id for n in nodes}
        edges = (
            self.db.query(GraphEdge)
            .filter(
                GraphEdge.user_id == user_id,
                GraphEdge.source_node_id.in_(node_ids),
                GraphEdge.target_node_id.in_(node_ids),
            )
            .all()
        )
        return {
            "nodes": [
                {"id": n.id, "label": n.label, "type": n.node_type, "source_id": n.source_id}
                for n in nodes
            ],
            "links": [
                {"source": e.source_node_id, "target": e.target_node_id, "relationship": e.relationship}
                for e in edges
            ],
        }

    def get_related_note_ids(
        self,
        user_id: int,
        workspace_id: Optional[int],
        seed_note_ids: list[int],
        limit: int = 4,
    ) -> list[int]:
        """Return IDs of notes connected to the seed notes through shared entity nodes.

        Traversal: seed_note_node → (edge) → entity_node → (edge) → other_note_node.
        Only entity types (person, topic, project, etc.) bridge the connection -
        reminder nodes are excluded so we only follow meaningful knowledge links.
        """
        if not seed_note_ids:
            return []

        # Step 1 - find the graph node IDs for the seed notes
        seed_graph_ids_q = (
            self.db.query(GraphNode.id)
            .filter(
                GraphNode.user_id == user_id,
                GraphNode.workspace_id == workspace_id,
                GraphNode.node_type == "note",
                GraphNode.source_id.in_(seed_note_ids),
            )
        )

        # Step 2 - entity nodes these seed notes connect to (note → entity edges)
        entity_ids_q = (
            self.db.query(GraphEdge.target_node_id)
            .join(GraphNode, GraphNode.id == GraphEdge.target_node_id)
            .filter(
                GraphEdge.source_node_id.in_(seed_graph_ids_q),
                GraphNode.node_type.notin_(["note", "reminder"]),
            )
        )

        # Step 3 - other note nodes that point to those same entity nodes
        related = (
            self.db.query(GraphNode.source_id)
            .join(GraphEdge, GraphEdge.source_node_id == GraphNode.id)
            .filter(
                GraphEdge.target_node_id.in_(entity_ids_q),
                GraphNode.node_type == "note",
                GraphNode.source_id.isnot(None),
                GraphNode.source_id.notin_(seed_note_ids),
                GraphNode.user_id == user_id,
                GraphNode.workspace_id == workspace_id,
            )
            .distinct()
            .limit(limit)
            .all()
        )

        return [r[0] for r in related]

    def clear(self, user_id: int, workspace_id: Optional[int]) -> None:
        nodes = (
            self.db.query(GraphNode)
            .filter_by(user_id=user_id, workspace_id=workspace_id)
            .all()
        )
        node_ids = [n.id for n in nodes]
        if node_ids:
            self.db.query(GraphEdge).filter(
                GraphEdge.source_node_id.in_(node_ids)
            ).delete(synchronize_session=False)
            self.db.query(GraphNode).filter(
                GraphNode.id.in_(node_ids)
            ).delete(synchronize_session=False)
        self.db.commit()
