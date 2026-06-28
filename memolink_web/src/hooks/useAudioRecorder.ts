import { useEffect, useRef, useState } from "react";

export type AudioRecordingState = "idle" | "recording" | "paused" | "saving" | "saved" | "error";

export interface CompletedRecording {
  blob: Blob;
  fileName: string;
  durationSeconds: number;
}

function supportedMimeType(): string | undefined {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type));
}

function safeTitle(title: string): string {
  const cleaned = title.trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").replace(/\s+/g, "_").slice(0, 80);
  return cleaned || "Untitled";
}

function timestamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

export function useAudioRecorder(onComplete: (recording: CompletedRecording) => Promise<void>) {
  const [state, setState] = useState<AudioRecordingState>("idle");
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [lastRecording, setLastRecording] = useState<CompletedRecording | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const titleRef = useRef("Untitled");
  const durationRef = useRef(0);

  useEffect(() => {
    if (state !== "recording") return;
    const timer = setInterval(() => {
      durationRef.current += 1;
      setDurationSeconds(durationRef.current);
    }, 1000);
    return () => clearInterval(timer);
  }, [state]);

  useEffect(() => () => { streamRef.current?.getTracks().forEach((track) => track.stop()); }, []);

  async function start(noteTitle: string) {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Audio recording is not supported on this device.");
      setState("error");
      return;
    }
    try {
      setError(null);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      titleRef.current = safeTitle(noteTitle);
      chunksRef.current = [];
      durationRef.current = 0;
      setDurationSeconds(0);
      const mimeType = supportedMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data); };
      recorder.onerror = () => {
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        setError("The browser stopped recording unexpectedly.");
        setState("error");
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        const actualType = recorder.mimeType || mimeType || "audio/webm";
        const extension = actualType.includes("mp4") ? "mp4" : "webm";
        const completed: CompletedRecording = {
          blob: new Blob(chunksRef.current, { type: actualType }),
          fileName: `MemoLink_Recording_${titleRef.current}_${timestamp(new Date())}.${extension}`,
          durationSeconds: durationRef.current,
        };
        setState("saving");
        try {
          await onComplete(completed);
          setLastRecording(completed);
          setState("saved");
        } catch (caught: unknown) {
          setError(caught instanceof Error ? caught.message : "Could not save the recording.");
          setState("error");
        }
      };
      recorder.start(1000);
      setState("recording");
    } catch (caught: unknown) {
      const errorName = caught instanceof DOMException ? caught.name : "";
      const denied = errorName === "NotAllowedError" || errorName === "PermissionDeniedError";
      setError(denied ? "Microphone permission was denied. Allow microphone access and try again." : (caught instanceof Error ? caught.message : "Could not start recording."));
      setState("error");
    }
  }

  function pauseResume() {
    const recorder = recorderRef.current;
    if (!recorder) return;
    if (recorder.state === "recording") { recorder.pause(); setState("paused"); }
    else if (recorder.state === "paused") { recorder.resume(); setState("recording"); }
  }

  function stopAndSave() {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
  }

  function reset() { setState("idle"); setError(null); setLastRecording(null); }

  return { state, durationSeconds, error, lastRecording, start, pauseResume, stopAndSave, reset };
}
