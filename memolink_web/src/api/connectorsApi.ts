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
  owner?: string;
  repo?: string;
  base_url?: string;
  branch?: string;
}

export interface JiraConnectorPayload {
  project_key?: string;
  issue_type?: string;
}

export async function listConnectors(): Promise<ConnectorSummary[]> {
  return (await api.get("/connectors")).data.connectors;
}

export async function saveGitHubConnector(payload: GitHubConnectorPayload): Promise<void> {
  await api.put("/connectors/github", payload);
}

export async function getGitHubConnectUrl(): Promise<string> {
  return (await api.get("/connectors/github/connect-url")).data.url;
}

export async function deleteGitHubConnector(): Promise<void> {
  await api.delete("/connectors/github");
}

export async function saveJiraConnector(payload: JiraConnectorPayload): Promise<void> {
  await api.put("/connectors/jira", payload);
}

export async function getJiraConnectUrl(): Promise<string> {
  return (await api.get("/connectors/jira/connect-url")).data.url;
}

export async function deleteJiraConnector(): Promise<void> {
  await api.delete("/connectors/jira");
}
