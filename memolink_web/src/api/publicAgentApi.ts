import { api } from "./client";

export interface PublicAgent {
  id: number;
  name: string;
  token: string;
  workspace_id: number;
  description: string | null;
  system_prompt: string | null;
  public_enabled: boolean;
  allowed_domains: string | null;
  created_by: number;
  created_at: string | null;
  updated_at: string | null;
}

export interface PublicAgentCreateInput {
  name: string;
  workspace_id: number;
  description?: string | null;
  system_prompt?: string | null;
  public_enabled?: boolean;
  allowed_domains?: string | null;
}

export interface PublicAgentUpdateInput {
  name?: string;
  description?: string | null;
  system_prompt?: string | null;
  public_enabled?: boolean;
  allowed_domains?: string | null;
  workspace_id?: number;
}

export async function createPublicAgent(input: PublicAgentCreateInput): Promise<PublicAgent> {
  return (await api.post("/public-agents", input)).data;
}

export async function listPublicAgents(): Promise<PublicAgent[]> {
  return (await api.post("/public-agents/list")).data;
}

export async function getPublicAgent(agentId: number): Promise<PublicAgent> {
  return (await api.post("/public-agents/get", { agent_id: agentId })).data;
}

export async function updatePublicAgent(agentId: number, fields: PublicAgentUpdateInput): Promise<PublicAgent> {
  return (await api.post("/public-agents/update", { agent_id: agentId, ...fields })).data;
}

export async function enablePublicAgent(agentId: number): Promise<PublicAgent> {
  return (await api.post("/public-agents/enable", { agent_id: agentId })).data;
}

export async function disablePublicAgent(agentId: number): Promise<PublicAgent> {
  return (await api.post("/public-agents/disable", { agent_id: agentId })).data;
}

export async function regeneratePublicAgentToken(agentId: number): Promise<PublicAgent> {
  return (await api.post("/public-agents/regenerate-token", { agent_id: agentId })).data;
}

export async function deletePublicAgent(agentId: number): Promise<{ ok: boolean }> {
  return (await api.post("/public-agents/delete", { agent_id: agentId })).data;
}
