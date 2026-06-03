import { api, API_BASE } from "./client";
import { getToken } from "../utils/auth";

// ── User ─────────────────────────────────────────────────────────────────────

export interface StartSessionBody {
  consent_confirmed: boolean;
  participant_code?: string;
  role?: string;
  ai_tool_usage_frequency?: string;
  device_type?: string;
  browser?: string;
  operating_system?: string;
  workspace_id?: number | null;
}

export async function startSession(body: StartSessionBody): Promise<{ session_id: number; participant_code: string }> {
  const res = await api.post("/evaluation/session/start", body);
  return res.data;
}

export async function endSession(session_id: number, completed = true): Promise<void> {
  await api.post("/evaluation/session/end", { session_id, completed });
}

export async function startTask(
  session_id: number, task_key: string, task_name: string, feature_name?: string, workspace_id?: number | null,
): Promise<{ task_id: number }> {
  const res = await api.post("/evaluation/task/start", { session_id, task_key, task_name, feature_name, workspace_id });
  return res.data;
}

export async function completeTask(
  task_id: number,
  opts: { success?: boolean; time_taken_ms?: number; created_object_type?: string; created_object_id?: number; notes?: string } = {},
): Promise<void> {
  await api.post("/evaluation/task/complete", { task_id, ...opts });
}

export interface RatingBody {
  session_id?: number;
  message_id?: number;
  task_id?: number;
  rating_type: string;
  rating_value: number;
  choice_value?: string;
  comment?: string;
}

export async function recordRating(body: RatingBody): Promise<void> {
  // Fire-and-forget — analytics must never block the UI.
  try { await api.post("/evaluation/rating", body); } catch { /* ignore */ }
}

export type MessageRating = Record<string, number | string>;   // rating_type → value | choice

export async function getMyRatings(): Promise<Record<string, MessageRating>> {
  try {
    const res = await api.get("/evaluation/my-ratings");
    return res.data.ratings ?? {};
  } catch {
    return {};
  }
}

export async function recordEvent(body: Record<string, unknown>): Promise<void> {
  try { await api.post("/evaluation/event", body); } catch { /* ignore */ }
}

// ── Active-time budget (heartbeat) ────────────────────────────────────────────

export interface BudgetStatus {
  consumed_seconds: number;
  budget_seconds: number;
  remaining_seconds: number;
  exhausted: boolean;
  recording: boolean;
}

export async function getBudget(): Promise<BudgetStatus> {
  const res = await api.get("/evaluation/budget");
  return res.data;
}

export async function sendHeartbeat(delta_seconds: number): Promise<BudgetStatus> {
  const res = await api.post("/evaluation/heartbeat", { delta_seconds });
  return res.data;
}

/** Flush on page hide/unload using keepalive so the active time isn't lost. */
export function sendHeartbeatBeacon(delta_seconds: number): void {
  const token = getToken();
  try {
    fetch(`${API_BASE}/evaluation/heartbeat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ delta_seconds }),
      keepalive: true,
    });
  } catch { /* ignore */ }
}

export async function resetEvaluationBudget(user_id?: number | null, wipe = false): Promise<void> {
  await api.post("/evaluation/admin/reset", { user_id: user_id ?? null, wipe });
}

export interface ParticipantBudget {
  user_id: number;
  email: string | null;
  participant_code: string | null;
  consumed_seconds: number;
  budget_seconds: number;
  remaining_seconds: number;
  exhausted: boolean;
}

export interface ParticipantBudgetList {
  default_budget_minutes: number;
  participants: ParticipantBudget[];
}

export async function getEvaluationParticipants(): Promise<ParticipantBudgetList> {
  const res = await api.get("/evaluation/admin/participants");
  return res.data;
}

export async function setUserBudget(user_id: number, budget_minutes: number | null): Promise<void> {
  await api.post("/evaluation/admin/budget", { user_id, budget_minutes });
}

// ── Admin ────────────────────────────────────────────────────────────────────

export interface ConfidenceAlignmentRow {
  confidence_level: string;
  count: number;
  avg_trust: number | null;
  avg_relevance: number | null;
}

export interface EvaluationSummary {
  total_participants: number;
  total_sessions: number;
  completed_sessions: number;
  avg_session_time_seconds: number | null;
  task_completion_rate: number | null;
  total_tasks: number;
  completed_tasks: number;
  avg_response_time_ms: number | null;
  avg_first_token_latency_ms: number | null;
  avg_relevance_rating: number | null;
  avg_citation_rating: number | null;
  avg_trust_rating: number | null;
  fallback_rate: number | null;
  ai_metric_count: number;
  confidence_alignment: ConfidenceAlignmentRow[];
  ratings_by_type: Record<string, number>;
  supported_by_notes: Record<string, number>;
  response_time_by_feature: Record<string, number>;
  feature_usage: Record<string, number>;
}

export async function getEvaluationSummary(): Promise<EvaluationSummary> {
  const res = await api.get("/evaluation/admin/summary");
  return res.data;
}

export async function getEvaluationReport(): Promise<{ markdown: string; summary: EvaluationSummary }> {
  const res = await api.get("/evaluation/admin/report");
  return res.data;
}

export async function downloadEvaluationCsv(): Promise<void> {
  const token = getToken();
  const res = await fetch(`${API_BASE}/evaluation/admin/export/csv`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`Export failed: ${res.status}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "memolink_evaluation_data.zip";
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

export async function downloadEvaluationJson(): Promise<void> {
  const token = getToken();
  const res = await fetch(`${API_BASE}/evaluation/admin/export/json`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`Export failed: ${res.status}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "memolink_evaluation_report.json";
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}
