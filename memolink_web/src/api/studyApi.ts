import { api } from "./client";

export interface FlashcardItem { question: string; answer: string; }
export interface FlashcardsResponse {
  cards: FlashcardItem[];
  note_title: string | null;
  source_count: number;
}

export interface DefinitionItem { term: string; definition: string; }
export interface ExamReviewResponse {
  key_concepts: string[];
  definitions: DefinitionItem[];
  important_facts: string[];
  likely_questions: string[];
  focus_topics: string[];
  overview: string;
}

export interface StudyPlanDay {
  day: number;
  label: string;
  focus: string;
  topics: string[];
  tasks: string[];
  note_titles: string[];
}
export interface StudyPlanResponse { overall_goal: string; plan: StudyPlanDay[]; }

export interface WeakTopic {
  topic: string;
  frequency: number;
  simple_explanation: string;
  study_tip: string;
}
export interface WeakTopicsResponse { topics: WeakTopic[]; message: string | null; }

export interface SummaryResponse {
  note_title: string;
  level: string;
  summary: string;
  bullet_points: string[] | null;
}

export async function generateFlashcards(workspace_id: number, note_id: number | null, count: number): Promise<FlashcardsResponse> {
  const res = await api.post("/study/flashcards", { workspace_id, note_id, count }, { timeout: 120000 });
  return res.data;
}

export async function generateExamReview(workspace_id: number, note_ids: number[]): Promise<ExamReviewResponse> {
  const res = await api.post("/study/exam-review", { workspace_id, note_ids });
  return res.data;
}

export async function generateStudyPlan(workspace_id: number, days: number, goal: string): Promise<StudyPlanResponse> {
  const res = await api.post("/study/plan", { workspace_id, days, goal });
  return res.data;
}

export async function detectWeakTopics(workspace_id: number): Promise<WeakTopicsResponse> {
  const res = await api.post("/study/weak-topics", { workspace_id });
  return res.data;
}

export interface QuizQuestion { id: number; type: "single" | "multi"; question: string; options: string[]; correct: number[]; explanation: string; }
export interface QuizData { title: string; questions: QuizQuestion[]; }

export async function generateQuiz(
  workspace_id: number,
  note_id: number | null,
  count: number,
  quiz_type: string = "default",
  custom_focus?: string,
): Promise<QuizData> {
  const res = await api.post(
    "/study/quiz",
    { workspace_id, note_id, count, quiz_type, custom_focus: custom_focus || null },
    { timeout: 120000 },
  );
  return res.data;
}

export async function summarizeNote(workspace_id: number, note_id: number, level: string): Promise<SummaryResponse> {
  const res = await api.post("/study/summary", { workspace_id, note_id, level });
  return res.data;
}
