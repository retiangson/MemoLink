import { api } from "./client";

export interface CustomProvider {
  id: number;
  name: string;
  base_url: string | null;
  model: string;
}

export interface AddProviderPayload {
  name: string;
  key: string;
  model: string;
  base_url?: string;
}

export interface UpdateProviderPayload {
  name?: string;
  key?: string;
  model?: string;
  base_url?: string;
}

export async function getProviders(): Promise<CustomProvider[]> {
  return (await api.get("/settings/api-keys")).data.providers;
}

export async function addProvider(payload: AddProviderPayload): Promise<void> {
  await api.post("/settings/api-keys", payload);
}

export async function updateProvider(id: number, payload: UpdateProviderPayload): Promise<void> {
  await api.put(`/settings/api-keys/${id}`, payload);
}

export async function deleteProvider(id: number): Promise<void> {
  await api.delete(`/settings/api-keys/${id}`);
}
