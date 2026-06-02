import { api } from "./client";

export type InsightType = "missing_reminder" | "incomplete_actions" | "unreviewed_upload" | "urgency_signal";
export type InsightSeverity = "info" | "warning" | "urgent";

export interface ProactiveInsight {
  id: number;
  insight_type: InsightType;
  title: string;
  description: string | null;
  note_id: number | null;
  severity: InsightSeverity;
  created_at: string | null;
}

export async function getInsights(workspaceId: number): Promise<ProactiveInsight[]> {
  const r = await api.get(`/insights?workspace_id=${workspaceId}`);
  return r.data;
}

export async function analyzeInsights(workspaceId: number): Promise<ProactiveInsight[]> {
  const r = await api.post(`/insights/analyze?workspace_id=${workspaceId}`);
  return r.data;
}

export async function dismissInsight(insightId: number): Promise<void> {
  await api.delete(`/insights/${insightId}`);
}
