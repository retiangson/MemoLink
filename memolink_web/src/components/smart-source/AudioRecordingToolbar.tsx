import React from "react";
import { saveRecordingMetadata } from "../../api/smartSourceApi";
import { useAudioRecorder, type CompletedRecording } from "../../hooks/useAudioRecorder";
import { useLocalRecordingStorage } from "../../hooks/useLocalRecordingStorage";
import { RecordingStatus } from "./RecordingStatus";
import { api } from "../../api/client";

export function AudioRecordingToolbar({ noteId, noteTitle, onSaved, onTranscriptConfirmed }: { noteId: number | null; noteTitle: string; onSaved?: () => void; onTranscriptConfirmed?: (text: string) => void }) {
  const storage = useLocalRecordingStorage();
  const [transcribing, setTranscribing] = React.useState(false);
  const [transcript, setTranscript] = React.useState<string | null>(null);
  const [warning, setWarning] = React.useState<string | null>(null);
  async function persist(recording: CompletedRecording) {
    await storage.saveRecording(recording.blob, recording.fileName);
    if (noteId) {
      try {
        await saveRecordingMetadata(noteId, { file_name: recording.fileName, duration_seconds: recording.durationSeconds, local_only: true });
      } catch {
        setWarning("Recording saved locally, but its timeline metadata could not sync.");
      }
    }
    onSaved?.();
  }
  const recorder = useAudioRecorder(persist);
  async function start() {
    setWarning(null);
    if (await storage.prepareDirectory()) await recorder.start(noteTitle);
  }
  async function transcribe() {
    if (!recorder.lastRecording) return;
    setTranscribing(true);
    try {
      const form = new FormData();
      form.append("file", new File([recorder.lastRecording.blob], recorder.lastRecording.fileName, { type: recorder.lastRecording.blob.type }));
      form.append("mode", "default");
      form.append("backend", "auto");
      const result = (await api.post("/transcribe", form)).data;
      setTranscript(result.cleaned_text || result.text || "");
    } catch {
      setWarning("The recording is still saved locally, but transcription failed.");
    } finally { setTranscribing(false); }
  }
  if (recorder.state === "idle" || recorder.state === "saved" || recorder.state === "error") {
    return (
      <div className="flex items-center gap-2">
        <button onClick={() => void start()} className="rounded-lg border border-red-400/20 px-2 py-1 text-xs text-red-400 hover:bg-red-400/10">Start recording</button>
        {(recorder.state === "saved" || recorder.state === "error") && <RecordingStatus state={recorder.state} duration={recorder.durationSeconds} error={recorder.error} />}
        {warning && <span className="max-w-56 text-[11px] text-amber-400">{warning}</span>}
        {recorder.state === "saved" && recorder.lastRecording && !transcript && <button onClick={() => void transcribe()} disabled={transcribing} className="text-xs text-indigo-400 disabled:opacity-50">{transcribing ? "Transcribing…" : "Transcribe"}</button>}
        {transcript && <button onClick={() => { onTranscriptConfirmed?.(transcript); setTranscript(null); }} className="text-xs text-emerald-400">Add transcript to note</button>}
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <button onClick={recorder.pauseResume} className="rounded-lg border border-[var(--ml-bg-hover)] px-2 py-1 text-xs text-gray-300">{recorder.state === "paused" ? "Resume" : "Pause"}</button>
      <button onClick={recorder.stopAndSave} disabled={recorder.state === "saving" || storage.saving} className="rounded-lg bg-red-600 px-2 py-1 text-xs text-white disabled:opacity-50">Stop & Save</button>
      <RecordingStatus state={recorder.state} duration={recorder.durationSeconds} error={recorder.error} />
    </div>
  );
}
