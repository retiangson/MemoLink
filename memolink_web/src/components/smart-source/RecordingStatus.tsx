import React from "react";
import type { AudioRecordingState } from "../../hooks/useAudioRecorder";

export function RecordingStatus({ state, duration, error }: { state: AudioRecordingState; duration: number; error: string | null }) {
  const minutes = Math.floor(duration / 60);
  const seconds = String(duration % 60).padStart(2, "0");
  return <span className={`text-xs ${state === "error" ? "text-red-400" : state === "recording" ? "text-red-400" : "text-gray-500"}`}>{error || `${state} ${minutes}:${seconds}`}</span>;
}
