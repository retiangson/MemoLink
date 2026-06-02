from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, UniqueConstraint, func
from memolink_backend.core.db import Base


class GraphNode(Base):
    __tablename__ = "graph_nodes"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    workspace_id = Column(Integer, ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=True, index=True)
    node_type = Column(String(50), nullable=False)   # note|reminder|person|topic|project|deadline|decision|action_item|question|theme
    label = Column(String(500), nullable=False)
    source_id = Column(Integer, nullable=True)        # notes.id or reminders.id for first-class nodes
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("user_id", "workspace_id", "node_type", "label", name="uq_graph_node"),
    )
