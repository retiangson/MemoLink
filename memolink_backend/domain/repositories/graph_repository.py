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
