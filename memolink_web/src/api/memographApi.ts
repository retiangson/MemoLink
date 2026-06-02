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
