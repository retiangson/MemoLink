import { useState, useRef } from "react";
import { finalizeLectureTranscript, transcribeAudio } from "../api/chatApi";
import type { LectureFinalizeResponse, TranscribeAudioOptions } from "../api/chatApi";

const CHUNK_MS = 5000; // send a chunk to Whisper every 5 seconds
const LECTURE_CHUNK_MS = 20000;

export interface RecordingStartOptions {
  language?: string;
  mode?: "default" | "lecture";
  backend?: "auto" | "whisper" | "deepgram";
  chunkMs?: number;
  autoStopOnSilence?: boolean;
  silenceThreshold?: number;
  silenceDurationMs?: number;
  onFinalizeLecture?: (result: LectureFinalizeResponse) => void;
}

export function useRecording(onFinalText: (text: string) => void) {
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const sessionRef = useRef<Required<Omit<RecordingStartOptions, "onFinalizeLecture">> & { onFinalizeLecture?: (result: LectureFinalizeResponse) => void }>({
    language: "",
    mode: "default",
    backend: "auto",
    chunkMs: CHUNK_MS,
    autoStopOnSilence: false,
    silenceThreshold: 0.018,
    silenceDurationMs: 1800,
    onFinalizeLecture: undefined,
  });
  const transcriptTailRef = useRef<string>("");
  const lectureTranscriptRef = useRef<string[]>([]);
  const pendingLectureFinalizeRef = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const monitorTimerRef = useRef<number | null>(null);
  const heardSpeechRef = useRef(false);
  const lastSpeechAtRef = useRef<number>(0);
  const stopRequestedRef = useRef(false);
  const onFinalTextRef = useRef(onFinalText);
  onFinalTextRef.current = onFinalText;

  function cleanupAudioMonitor() {
    if (monitorTimerRef.current != null) {
      window.clearInterval(monitorTimerRef.current);
      monitorTimerRef.current = null;
    }
    try { sourceNodeRef.current?.disconnect(); } catch {}
    try { analyserRef.current?.disconnect(); } catch {}
    sourceNodeRef.current = null;
    analyserRef.current = null;
    if (audioContextRef.current) {
      try { audioContextRef.current.close(); } catch {}
      audioContextRef.current = null;
    }
    setAudioLevel(0);
  }

  function startAudioMonitor(stream: MediaStream) {
    cleanupAudioMonitor();
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    try {
      const ctx = new AudioCtx();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      audioContextRef.current = ctx;
      sourceNodeRef.current = source;
      analyserRef.current = analyser;
      const data = new Uint8Array(analyser.fftSize);
      heardSpeechRef.current = false;
      lastSpeechAtRef.current = Date.now();
      monitorTimerRef.current = window.setInterval(() => {
        if (!analyserRef.current || !streamRef.current) return;
        analyserRef.current.getByteTimeDomainData(data);
        let sumSquares = 0;
        for (let i = 0; i < data.length; i += 1) {
          const centered = (data[i] - 128) / 128;
          sumSquares += centered * centered;
        }
        const rms = Math.sqrt(sumSquares / data.length);
        setAudioLevel(Math.min(1, rms * 12));
        if (rms >= sessionRef.current.silenceThreshold) {
          heardSpeechRef.current = true;
          lastSpeechAtRef.current = Date.now();
          return;
        }
        if (
          sessionRef.current.autoStopOnSilence &&
          heardSpeechRef.current &&
          !stopRequestedRef.current &&
          Date.now() - lastSpeechAtRef.current >= sessionRef.current.silenceDurationMs
        ) {
          stopRequestedRef.current = true;
          stopRecording();
        }
      }, 180);
    } catch {
      cleanupAudioMonitor();
    }
  }

  function finalizeLectureIfNeeded() {
    if (!pendingLectureFinalizeRef.current) return;
    pendingLectureFinalizeRef.current = false;
    if (sessionRef.current.mode !== "lecture" || !lectureTranscriptRef.current.length || !sessionRef.current.onFinalizeLecture) return;
    const transcript = lectureTranscriptRef.current.join("\n\n").trim();
    if (!transcript) return;
    setIsTranscribing(true);
    finalizeLectureTranscript(transcript, sessionRef.current.language)
      .then((result) => sessionRef.current.onFinalizeLecture?.(result))
      .catch(() => {})
      .finally(() => setIsTranscribing(false));
  }

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
          const opts: TranscribeAudioOptions = {
            language: sessionRef.current.language,
            mode: sessionRef.current.mode,
            backend: sessionRef.current.backend,
            promptContext: sessionRef.current.mode === "lecture" ? transcriptTailRef.current : undefined,
          };
          const { text, cleaned_text } = await transcribeAudio(blob, `chunk.${ext}`, opts);
          const stripped = (cleaned_text || text)?.replace(/^\[Audio transcription:[^\]]*\]\s*/i, "");
          const clean = stripped?.trim();
          if (clean) {
            onFinalTextRef.current(clean);
            if (sessionRef.current.mode === "lecture") {
              lectureTranscriptRef.current.push(clean);
              transcriptTailRef.current = `${transcriptTailRef.current} ${clean}`.trim().slice(-1800);
            }
          }
        } catch { /* silent */ } finally {
          setIsTranscribing(false);
        }
      }

      // start next chunk if still recording
      if (streamRef.current) recordChunk(streamRef.current);
      else finalizeLectureIfNeeded();
    };

    recorder.start();
    recorderRef.current = recorder;

    // cut this chunk after CHUNK_MS
    setTimeout(() => {
      if (recorder.state === "recording") recorder.stop();
    }, sessionRef.current.chunkMs || CHUNK_MS);
  }

  async function startRecording(source: "mic" | "computer", config: string | RecordingStartOptions = "") {
    const normalized = typeof config === "string" ? { language: config } : config;
    sessionRef.current = {
      language: normalized.language ?? "",
      mode: normalized.mode ?? "default",
      backend: normalized.backend ?? "auto",
      chunkMs: normalized.chunkMs ?? ((normalized.mode ?? "default") === "lecture" ? LECTURE_CHUNK_MS : CHUNK_MS),
      autoStopOnSilence: normalized.autoStopOnSilence ?? false,
      silenceThreshold: normalized.silenceThreshold ?? 0.018,
      silenceDurationMs: normalized.silenceDurationMs ?? 1800,
      onFinalizeLecture: normalized.onFinalizeLecture,
    };
    transcriptTailRef.current = "";
    lectureTranscriptRef.current = [];
    pendingLectureFinalizeRef.current = false;
    stopRequestedRef.current = false;
    try {
      let stream: MediaStream;

      if (source === "mic") {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } else {
        stream = await (navigator.mediaDevices as any).getDisplayMedia({
          video: true,
          audio: true,
        });
        // discard video - we only want the audio track
        stream.getVideoTracks().forEach((t) => t.stop());
        if (stream.getAudioTracks().length === 0) {
          stream.getTracks().forEach((t) => t.stop());
          alert('No audio captured. In the sharing dialog, make sure to check "Share system audio" / "Share tab audio".');
          return;
        }
      }

      streamRef.current = stream;
      setIsRecording(true);
      if (source === "mic") startAudioMonitor(stream);
      recordChunk(stream);
    } catch (err: any) {
      cleanupAudioMonitor();
      if (err?.name === "NotAllowedError" || err?.name === "PermissionDeniedError") {
        alert("Permission denied. Please allow access and try again.");
      } else if (err?.name !== "AbortError") {
        alert("Could not start recording. Please try again.");
      }
    }
  }

  function stopRecording() {
    stopRequestedRef.current = true;
    const recorder = recorderRef.current;
    recorderRef.current = null;
    cleanupAudioMonitor();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null; // null before onstop fires so recordChunk won't restart
    pendingLectureFinalizeRef.current = sessionRef.current.mode === "lecture";
    if (recorder?.state === "recording") recorder.stop();
    setIsRecording(false);
    if (!recorder || recorder.state !== "recording") {
      finalizeLectureIfNeeded();
    }
  }

  return { isRecording, isTranscribing, audioLevel, startRecording, stopRecording };
}
