import { api, API_BASE } from "./client";
import { getToken } from "../utils/auth";

export type AnswerType = "likert" | "single" | "multi" | "short" | "long";

export interface SurveyQuestion {
  id: number;
  section: string;
  question_key: string;
  question_text: string;
  answer_type: AnswerType;
  options: string[];
  order_index: number;
  required: boolean;
  active: boolean;
}

export interface SurveySection {
  section: string;
  questions: SurveyQuestion[];
}

export interface ActiveSurvey {
  title: string;
  intro: string;
  consent_text: string;
  sections: SurveySection[];
}

export interface SurveyAnswerInput {
  question_key: string;
  answer_value: string | string[] | number;
}

// ── User ─────────────────────────────────────────────────────────────────────

export async function getActiveSurvey(): Promise<ActiveSurvey> {
  const res = await api.get("/survey");
  return res.data;
}

export async function submitSurvey(
  consent_confirmed: boolean,
  answers: SurveyAnswerInput[],
  workspace_id: number | null,
): Promise<{ ok: boolean; response_id: number; participant_code: string }> {
  const res = await api.post("/survey/submit", { consent_confirmed, answers, workspace_id });
  return res.data;
}

// ── Admin: questions ─────────────────────────────────────────────────────────

export interface QuestionUpsert {
  section: string;
  question_key?: string;
  question_text: string;
  answer_type: AnswerType;
  options: string[];
  order_index?: number | null;
  required: boolean;
  active: boolean;
}

export async function listQuestions(): Promise<SurveyQuestion[]> {
  const res = await api.get("/survey/admin/questions");
  return res.data;
}

export async function createQuestion(body: QuestionUpsert): Promise<SurveyQuestion> {
  const res = await api.post("/survey/admin/questions", body);
  return res.data;
}

export async function updateQuestion(id: number, body: QuestionUpsert): Promise<SurveyQuestion> {
  const res = await api.put(`/survey/admin/questions/${id}`, body);
  return res.data;
}

export async function deleteQuestion(id: number): Promise<void> {
  await api.delete(`/survey/admin/questions/${id}`);
}

export async function resetDefaultQuestions(): Promise<{ ok: boolean; added: number }> {
  const res = await api.post("/survey/admin/questions/reset", {});
  return res.data;
}

// ── Admin: reporting ─────────────────────────────────────────────────────────

export interface QuestionReport {
  question_key: string;
  question_text: string;
  section: string;
  answer_type: AnswerType;
  response_count: number;
  distribution: Record<string, number>;
  average: number | null;
  text_answers: string[];
}

export interface SurveyReport {
  total_responses: number;
  questions: QuestionReport[];
}

export async function getSurveyReport(): Promise<SurveyReport> {
  const res = await api.get("/survey/admin/report");
  return res.data;
}

export interface SurveyResponseRow {
  id: number;
  participant_code: string | null;
  role: string | null;
  ai_tool_usage_frequency: string | null;
  consent_confirmed: boolean;
  submitted_at: string | null;
  answers: Record<string, string | string[]>;
}

export async function getSurveyResponses(): Promise<{ total: number; responses: SurveyResponseRow[] }> {
  const res = await api.get("/survey/admin/responses");
  return res.data;
}

/** Triggers a CSV download using the auth token. */
export async function downloadSurveyCsv(): Promise<void> {
  const token = getToken();
  const res = await fetch(`${API_BASE}/survey/admin/export`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`Export failed: ${res.status}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "memolink_survey_results.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
