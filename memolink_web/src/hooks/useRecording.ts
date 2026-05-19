import { useState, useRef } from "react";
import { transcribeAudio } from "../api/chatApi";

const CHUNK_MS = 5000; // send a chunk to Whisper every 5 seconds

export function useRecording(onFinalText: (text: string) => void) {
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const languageRef = useRef<string>("");
  const onFinalTextRef = useRef(onFinalText);
  onFinalTextRef.current = onFinalText;

  function recordChunk(stream: MediaStream) {
    if (!streamRef.current) return; // stopped

    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "";

    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks: Blob[] = [];

    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

    recorder.onstop = async () => {
      const type = recorder.mimeType || "audio/webm";
      const ext = type.includes("mp4") ? "mp4" : type.includes("ogg") ? "ogg" : "webm";
      const blob = new Blob(chunks, { type });

      if (blob.size > 2000) {
        setIsTranscribing(true);
        try {
          const { text } = await transcribeAudio(blob, `chunk.${ext}`, languageRef.current);
          const stripped = text?.replace(/^\[Audio transcription:[^\]]*\]\s*/i, "");
          const clean = stripped?.trim();
          if (clean) onFinalTextRef.current(clean);
        } catch { /* silent */ } finally {
          setIsTranscribing(false);
        }
      }

      // start next chunk if still recording
      if (streamRef.current) recordChunk(streamRef.current);
    };

    recorder.start();
    recorderRef.current = recorder;

    // cut this chunk after CHUNK_MS
    setTimeout(() => {
      if (recorder.state === "recording") recorder.stop();
    }, CHUNK_MS);
  }

  async function startRecording(source: "mic" | "computer", language = "") {
    languageRef.current = language;
    try {
      let stream: MediaStream;

      if (source === "mic") {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } else {
        stream = await (navigator.mediaDevices as any).getDisplayMedia({
          video: true,
          audio: true,
        });
        // discard video — we only want the audio track
        stream.getVideoTracks().forEach((t) => t.stop());
        if (stream.getAudioTracks().length === 0) {
          stream.getTracks().forEach((t) => t.stop());
          alert('No audio captured. In the sharing dialog, make sure to check "Share system audio" / "Share tab audio".');
          return;
        }
      }

      streamRef.current = stream;
      setIsRecording(true);
      recordChunk(stream);
    } catch (err: any) {
      if (err?.name === "NotAllowedError" || err?.name === "PermissionDeniedError") {
        alert("Permission denied. Please allow access and try again.");
      } else if (err?.name !== "AbortError") {
        alert("Could not start recording. Please try again.");
      }
    }
  }

  function stopRecording() {
    const recorder = recorderRef.current;
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null; // null before onstop fires so recordChunk won't restart
    if (recorder?.state === "recording") recorder.stop();
    setIsRecording(false);
  }

  return { isRecording, isTranscribing, startRecording, stopRecording };
}
