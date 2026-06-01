import { api } from "./client";

export type AccessLevel = "regular" | "plus" | "pro";

export interface FeedbackItem {
  id: number;
  user_id: number | null;
  user_email: string | null;
  type: "bug" | "suggestion";
  title: string;
  message: string;
  status: "open" | "read" | "resolved";
  created_at: string;
}

export interface AdminUser {
  id: number;
  email: string;
  is_admin: boolean;
  access_level: AccessLevel;
}

export type FeatureFlags = {
  web_search_enabled: boolean;
  agent_mode_enabled: boolean;
  model_selection_enabled: boolean;
  image_generation_enabled: boolean;
  translation_enabled: boolean;
  file_upload_enabled: boolean;
  research_mode_enabled: boolean;
  model_attribution_enabled: boolean;
  default_model: string;
  default_language: string;
  web_search_min_level: AccessLevel;
  agent_mode_min_level: AccessLevel;
  model_selection_min_level: AccessLevel;
  image_generation_min_level: AccessLevel;
  translation_min_level: AccessLevel;
  file_upload_min_level: AccessLevel;
  research_mode_min_level: AccessLevel;
  model_attribution_min_level: AccessLevel;
};

export function parseFlags(raw: Record<string, string>): FeatureFlags {
  return {
    web_search_enabled: raw.web_search_enabled !== "false",
    agent_mode_enabled: raw.agent_mode_enabled !== "false",
    model_selection_enabled: raw.model_selection_enabled !== "false",
    image_generation_enabled: raw.image_generation_enabled !== "false",
    translation_enabled: raw.translation_enabled !== "false",
    file_upload_enabled: raw.file_upload_enabled !== "false",
    research_mode_enabled: raw.research_mode_enabled !== "false",
    model_attribution_enabled: raw.model_attribution_enabled !== "false",
    default_model: raw.default_model ?? "gpt-4o-mini",
    default_language: raw.default_language ?? "English",
    web_search_min_level: (raw.web_search_min_level ?? "regular") as AccessLevel,
    agent_mode_min_level: (raw.agent_mode_min_level ?? "regular") as AccessLevel,
    model_selection_min_level: (raw.model_selection_min_level ?? "regular") as AccessLevel,
    image_generation_min_level: (raw.image_generation_min_level ?? "regular") as AccessLevel,
    translation_min_level: (raw.translation_min_level ?? "regular") as AccessLevel,
    file_upload_min_level: (raw.file_upload_min_level ?? "regular") as AccessLevel,
    research_mode_min_level: (raw.research_mode_min_level ?? "regular") as AccessLevel,
    model_attribution_min_level: (raw.model_attribution_min_level ?? "regular") as AccessLevel,
  };
}

export async function fetchAdminFeedback(type = "all", status = "all"): Promise<FeedbackItem[]> {
  const res = await api.get(`/admin/feedback?type=${type}&status=${status}`);
  return res.data.items;
}

export async function updateFeedbackStatus(id: number, status: string): Promise<void> {
  await api.patch(`/admin/feedback/${id}`, { status });
}

export async function fetchAdminUsers(): Promise<AdminUser[]> {
  const res = await api.get("/admin/users");
  return res.data.users;
}

export async function updateUserRole(userId: number, isAdmin: boolean): Promise<void> {
  await api.patch(`/admin/users/${userId}/role`, { is_admin: isAdmin });
}

export async function updateUserLevel(userId: number, level: AccessLevel): Promise<void> {
  await api.patch(`/admin/users/${userId}/level`, { level });
}

export async function fetchAdminFeatures(): Promise<FeatureFlags> {
  const res = await api.get("/admin/features");
  return parseFlags(res.data.flags);
}

export async function updateAdminFeatures(flags: FeatureFlags): Promise<FeatureFlags> {
  const raw: Record<string, string> = {
    web_search_enabled: String(flags.web_search_enabled),
    agent_mode_enabled: String(flags.agent_mode_enabled),
    model_selection_enabled: String(flags.model_selection_enabled),
    image_generation_enabled: String(flags.image_generation_enabled),
    translation_enabled: String(flags.translation_enabled),
    file_upload_enabled: String(flags.file_upload_enabled),
    research_mode_enabled: String(flags.research_mode_enabled),
    model_attribution_enabled: String(flags.model_attribution_enabled),
    default_model: flags.default_model,
    default_language: flags.default_language,
    web_search_min_level: flags.web_search_min_level,
    agent_mode_min_level: flags.agent_mode_min_level,
    model_selection_min_level: flags.model_selection_min_level,
    image_generation_min_level: flags.image_generation_min_level,
    translation_min_level: flags.translation_min_level,
    file_upload_min_level: flags.file_upload_min_level,
    research_mode_min_level: flags.research_mode_min_level,
    model_attribution_min_level: flags.model_attribution_min_level,
  };
  const res = await api.put("/admin/features", { flags: raw });
  return parseFlags(res.data.flags);
}

export async function fetchFeatureFlags(): Promise<FeatureFlags> {
  const res = await api.get("/features");
  return parseFlags(res.data.flags);
}

export interface SystemLogItem {
  id: number;
  created_at: string;
  level: "INFO" | "WARNING" | "ERROR";
  source: string;
  message: string;
  details: Record<string, unknown> | null;
  user_id: number | null;
}

export interface SystemLogsResponse {
  items: SystemLogItem[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
}

export async function fetchSystemLogs(
  level?: string,
  source?: string,
  page = 1,
  pageSize = 50,
): Promise<SystemLogsResponse> {
  const params = new URLSearchParams();
  if (level) params.set("level", level);
  if (source) params.set("source", source);
  params.set("page", String(page));
  params.set("page_size", String(pageSize));
  const res = await api.get(`/admin/logs?${params}`);
  return res.data;
}

export async function clearSystemLogs(): Promise<{ deleted: number }> {
  const res = await api.delete("/admin/logs/clear");
  return res.data;
}
