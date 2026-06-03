/**
 * MemoGraph API client
 *
 * Wraps the three MemoGraph backend endpoints:
 *   GET    /api/memograph?workspace_id=   - fetch stored graph data
 *   POST   /api/memograph/build           - trigger entity extraction + graph build
 *   DELETE /api/memograph                 - clear graph for workspace
 *
 * GraphNode types: note | reminder | person | topic | project |
 *                  deadline | decision | action_item | question | theme
 *
 * GraphLink.relationship examples:
 *   note → person      "mentions"
 *   note → topic       "covers"
 *   note → project     "relates_to"
 *   note → deadline    "has_deadline"
 *   note → decision    "records"
 *   note → action_item "contains"
 *   note → question    "raises"
 *   note → theme       "exhibits"
 *   note → note        "related_to"  (notes sharing ≥2 entity nodes)
 */
import { api } from "./client";

export interface GraphNode {
  id: number;
  label: string;
  type: string;       // note | reminder | person | topic | project | deadline | decision | action_item | question | theme
  source_id: number | null;
}

export interface GraphLink {
  source: number;
  target: number;
  relationship: string;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

export interface BuildResult {
  nodes: number;
  edges: number;
}

export async function getGraph(workspaceId: number): Promise<GraphData> {
  const r = await api.get(`/memograph?workspace_id=${workspaceId}`);
  return r.data;
}

export async function buildGraph(workspaceId: number): Promise<BuildResult> {
  const r = await api.post(`/memograph/build?workspace_id=${workspaceId}`);
  return r.data;
}

export async function clearGraph(workspaceId: number): Promise<void> {
  await api.delete(`/memograph?workspace_id=${workspaceId}`);
}
