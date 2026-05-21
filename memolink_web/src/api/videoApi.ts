import { api } from "./client";

export interface VideoImportResult {
  title: string;
  content: string;
  method: "captions" | "whisper";
}

export async function importVideo(url: string): Promise<VideoImportResult> {
  return (await api.post("/video/import", { url })).data;
}

export async function uploadVideo(file: File): Promise<VideoImportResult> {
  const form = new FormData();
  form.append("file", file);
  return (await api.post("/video/upload", form, {
    headers: { "Content-Type": "multipart/form-data" },
  })).data;
}
