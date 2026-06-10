import { api } from "./client";

export interface CoreMemory {
  id: number;
  title: string | null;
  memory_type: string | null;
  sensitivity_level: string | null;
  masked_content: string | null;
  searchable_content: string | null;
  memory_source: string | null;
  memory_confidence: number | null;
  memory_last_used_at: string | null;
  is_encrypted: boolean | null;
  created_at: string | null;
  workspace_id: number | null;
}

export interface CoreMemoryUnlockResponse {
  unlock_token: string;
  expires_at: string;
}

const VAULT_TOKEN_KEY = "memolink_core_memory_unlock_token";
const VAULT_EXPIRY_KEY = "memolink_core_memory_unlock_expiry";

export interface CoreMemoryCreatePayload {
  title: string;
  memory_type?: string;
  sensitivity_level?: string;
  plaintext_value?: string | null;
  masked_display?: string | null;
  searchable_metadata?: string | null;
  workspace_id?: number | null;
}

export interface CoreMemoryUpdatePayload {
  title?: string | null;
  memory_type?: string | null;
  sensitivity_level?: string | null;
  masked_display?: string | null;
  searchable_metadata?: string | null;
}

export async function unlockVault(password: string): Promise<CoreMemoryUnlockResponse> {
  return (await api.post("/core-memory/unlock", { password })).data;
}

export function saveVaultSession(token: string, expiresAt: string): void {
  sessionStorage.setItem(VAULT_TOKEN_KEY, token);
  sessionStorage.setItem(VAULT_EXPIRY_KEY, expiresAt);
}

export function clearVaultSession(): void {
  sessionStorage.removeItem(VAULT_TOKEN_KEY);
  sessionStorage.removeItem(VAULT_EXPIRY_KEY);
}

export function getVaultSession(): { token: string; expiresAt: string } | null {
  const token = sessionStorage.getItem(VAULT_TOKEN_KEY);
  const expiresAt = sessionStorage.getItem(VAULT_EXPIRY_KEY);
  if (!token || !expiresAt) return null;
  if (new Date(expiresAt).getTime() <= Date.now()) {
    clearVaultSession();
    return null;
  }
  return { token, expiresAt };
}

export async function listCoreMemories(workspace_id?: number | null): Promise<CoreMemory[]> {
  const params = workspace_id != null ? { workspace_id } : {};
  return (await api.get("/core-memory", { params })).data;
}

export async function createCoreMemory(payload: CoreMemoryCreatePayload): Promise<CoreMemory> {
  return (await api.post("/core-memory", payload)).data;
}

export async function updateCoreMemory(id: number, payload: CoreMemoryUpdatePayload): Promise<CoreMemory> {
  return (await api.put(`/core-memory/${id}`, payload)).data;
}

export async function deleteCoreMemory(id: number): Promise<void> {
  await api.delete(`/core-memory/${id}`);
}

export async function revealCoreMemory(id: number, unlock_token: string): Promise<string> {
  const res = await api.post(`/core-memory/${id}/reveal`, { unlock_token });
  return res.data.plaintext;
}
