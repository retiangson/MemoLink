import { api } from "./client";

export interface ConnectorSummary {
  id: "email" | "teams" | "github" | "jira" | "spotify";
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

export async function getSpotifyConnectUrl(): Promise<string> {
  return (await api.get("/connectors/spotify/connect-url")).data.url;
}

export async function deleteSpotifyConnector(): Promise<void> {
  await api.delete("/connectors/spotify");
}

export type SpotifyPlaybackAction = "previous" | "play" | "pause" | "stop" | "next" | "shuffle" | "repeat" | "seek";
export type SpotifyRepeatMode = "off" | "context" | "track";

export interface SpotifyApiTrack {
  id: string | null;
  uri: string | null;
  name: string;
  artist: string;
  album: string;
  image_url?: string | null;
  duration_ms: number;
  external_url?: string | null;
}

export interface SpotifyApiPlaylist {
  id: string | null;
  uri: string | null;
  name: string;
  owner: string;
  image_url?: string | null;
  track_count: number;
  external_url?: string | null;
}

export interface SpotifyLibraryResponse {
  playlists: SpotifyApiPlaylist[];
  tracks: SpotifyApiTrack[];
}

export interface SpotifyPlaylistTracksResponse {
  tracks: SpotifyApiTrack[];
  total: number;
}

export async function controlSpotifyPlayback(
  action: SpotifyPlaybackAction,
  payload?: {
    uri?: string | null;
    uris?: string[] | null;
    context_uri?: string | null;
    device_id?: string | null;
    shuffle?: boolean | null;
    repeat_mode?: SpotifyRepeatMode | null;
    position_ms?: number | null;
  },
): Promise<void> {
  await api.post(`/connectors/spotify/playback/${action}`, payload ?? {});
}

export async function getSpotifyLibrary(): Promise<SpotifyLibraryResponse> {
  return (await api.get("/connectors/spotify/library")).data;
}

export async function searchSpotify(q: string): Promise<SpotifyLibraryResponse> {
  return (await api.get("/connectors/spotify/search", { params: { q } })).data;
}

export async function getSpotifyPlayerToken(): Promise<string> {
  return (await api.get("/connectors/spotify/player-token")).data.access_token;
}

export async function getSpotifyPlaylistTracks(playlistId: string): Promise<SpotifyPlaylistTracksResponse> {
  return (await api.get(`/connectors/spotify/playlists/${encodeURIComponent(playlistId)}/tracks`)).data;
}
