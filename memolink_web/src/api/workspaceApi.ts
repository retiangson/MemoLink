import { api } from "./client";
import type { Workspace } from "../types";

export async function listWorkspaces(): Promise<Workspace[]> {
  return (await api.post("/workspaces/list")).data;
}

export async function getActiveWorkspace(): Promise<Workspace> {
  return (await api.post("/workspaces/active")).data;
}

export async function createWorkspace(name: string, type: string, description?: string | null): Promise<Workspace> {
  return (await api.post("/workspaces", { name, type, description: description ?? null })).data;
}

export async function updateWorkspace(id: number, fields: { name?: string; type?: string; description?: string | null }): Promise<Workspace> {
  return (await api.post("/workspaces/update", { workspace_id: id, ...fields })).data;
}

export async function setActiveWorkspace(id: number): Promise<void> {
  await api.post("/workspaces/set-active", { workspace_id: id });
}

export async function deleteWorkspace(id: number): Promise<void> {
  await api.post("/workspaces/delete", { workspace_id: id });
}
