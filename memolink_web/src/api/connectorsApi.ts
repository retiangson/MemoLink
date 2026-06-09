import { api } from "./client";

export interface ConnectorSummary {
  id: "email" | "teams" | "github" | "jira";
  label: string;
  kind: "oauth" | "token";
  description: string;
  connected: boolean;
  summary?: string | null;
  config?: Record<string, unknown>;
}

export interface GitHubConnectorPayload {
  token: string;
  owner: string;
  repo: string;
  base_url?: string;
  branch?: string;
}

export interface JiraConnectorPayload {
  site_url: string;
  email: string;
  token: string;
  project_key: string;
  issue_type?: string;
}

export async function listConnectors(): Promise<ConnectorSummary[]> {
  return (await api.get("/connectors")).data.connectors;
}

export async function saveGitHubConnector(payload: GitHubConnectorPayload): Promise<void> {
  await api.put("/connectors/github", payload);
}

export async function deleteGitHubConnector(): Promise<void> {
  await api.delete("/connectors/github");
}

export async function saveJiraConnector(payload: JiraConnectorPayload): Promise<void> {
  await api.put("/connectors/jira", payload);
}

export async function deleteJiraConnector(): Promise<void> {
  await api.delete("/connectors/jira");
}
