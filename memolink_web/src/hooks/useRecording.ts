import { useEffect, useState, useRef } from "react";
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
  onRecordingComplete?: (recording: { blob: Blob; durationSeconds: number }) => void | Promise<void>;
}

export function useRecording(onFinalText: (text: string) => void) {
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [recordingDurationSeconds, setRecordingDurationSeconds] = useState(0);
  const [recordingCaptureError, setRecordingCaptureError] = useState<string | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const archiveRecorderRef = useRef<MediaRecorder | null>(null);
  const archiveChunksRef = useRef<Blob[]>([]);
  const durationTimerRef = useRef<number | null>(null);
  const durationRef = useRef(0);
  const sessionRef = useRef<Required<Omit<RecordingStartOptions, "onFinalizeLecture" | "onRecordingComplete">> & {
    onFinalizeLecture?: (result: LectureFinalizeResponse) => void;
    onRecordingComplete?: (recording: { blob: Blob; durationSeconds: number }) => void | Promise<void>;
  }>({
    language: "",
    mode: "default",
    backend: "auto",
    chunkMs: CHUNK_MS,
    autoStopOnSilence: false,
    silenceThreshold: 0.018,
    silenceDurationMs: 1800,
    onFinalizeLecture: undefined,
    onRecordingComplete: undefined,
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

  function supportedMimeType(): string {
    return ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"]
      .find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
  }

  function stopDurationTimer() {
    if (durationTimerRef.current != null) {
      window.clearInterval(durationTimerRef.current);
      durationTimerRef.current = null;
    }
  }

  function startDurationTimer() {
    stopDurationTimer();
    durationTimerRef.current = window.setInterval(() => {
      durationRef.current += 1;
      setRecordingDurationSeconds(durationRef.current);
    }, 1000);
  }

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

    const mimeType = supportedMimeType();

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
    const stopChunkWhenReady = () => {
      if (recorder.state === "recording") recorder.stop();
      else if (recorder.state === "paused") window.setTimeout(stopChunkWhenReady, 500);
    };
    window.setTimeout(stopChunkWhenReady, sessionRef.current.chunkMs || CHUNK_MS);
  }

  function startArchiveRecorder(stream: MediaStream) {
    archiveChunksRef.current = [];
    const mimeType = supportedMimeType();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) archiveChunksRef.current.push(event.data);
    };
    const onRecordingComplete = sessionRef.current.onRecordingComplete;
    recorder.onstop = () => {
      const blob = new Blob(archiveChunksRef.current, { type: recorder.mimeType || mimeType || "audio/webm" });
      archiveChunksRef.current = [];
      if (blob.size > 0) {
        void onRecordingComplete?.({
          blob,
          durationSeconds: durationRef.current,
        });
      }
    };
    recorder.start(1000);
    archiveRecorderRef.current = recorder;
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
      onRecordingComplete: normalized.onRecordingComplete,
    };
    transcriptTailRef.current = "";
    lectureTranscriptRef.current = [];
    pendingLectureFinalizeRef.current = false;
    stopRequestedRef.current = false;
    durationRef.current = 0;
    setRecordingDurationSeconds(0);
    setIsPaused(false);
    setRecordingCaptureError(null);
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
      try {
        startArchiveRecorder(stream);
      } catch {
        // Some browsers do not allow two MediaRecorders on one stream. Keep the
        // established lecture transcription working even if local archival is unavailable.
        archiveRecorderRef.current = null;
        setRecordingCaptureError("Local recording capture is unavailable in this browser; transcription is still active.");
      }
      startDurationTimer();
      if (source === "mic") startAudioMonitor(stream);
      recordChunk(stream);
    } catch (err: any) {
      stopDurationTimer();
      cleanupAudioMonitor();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      archiveRecorderRef.current = null;
      setIsRecording(false);
      setIsPaused(false);
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
    const archiveRecorder = archiveRecorderRef.current;
    archiveRecorderRef.current = null;
    stopDurationTimer();
    cleanupAudioMonitor();
    const stream = streamRef.current;
    streamRef.current = null; // null before onstop fires so recordChunk won't restart
    pendingLectureFinalizeRef.current = sessionRef.current.mode === "lecture";
    if (recorder && recorder.state !== "inactive") recorder.stop();
    if (archiveRecorder && archiveRecorder.state !== "inactive") archiveRecorder.stop();
    stream?.getTracks().forEach((track) => track.stop());
    setIsRecording(false);
    setIsPaused(false);
    if (!recorder || recorder.state === "inactive") {
      finalizeLectureIfNeeded();
    }
  }

  function pauseResumeRecording() {
    const recorder = recorderRef.current;
    const archiveRecorder = archiveRecorderRef.current;
    if (!recorder) return;
    if (recorder.state === "recording") {
      recorder.pause();
      if (archiveRecorder?.state === "recording") archiveRecorder.pause();
      stopDurationTimer();
      setIsPaused(true);
      return;
    }
    if (recorder.state === "paused") {
      recorder.resume();
      if (archiveRecorder?.state === "paused") archiveRecorder.resume();
      startDurationTimer();
      setIsPaused(false);
    }
  }

  useEffect(() => () => {
    stopDurationTimer();
    cleanupAudioMonitor();
    const recorder = recorderRef.current;
    const archiveRecorder = archiveRecorderRef.current;
    recorderRef.current = null;
    archiveRecorderRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (recorder) {
      recorder.onstop = null;
      if (recorder.state !== "inactive") recorder.stop();
    }
    if (archiveRecorder) {
      archiveRecorder.onstop = null;
      if (archiveRecorder.state !== "inactive") archiveRecorder.stop();
    }
  }, []);

  return {
    isRecording,
    isPaused,
    isTranscribing,
    audioLevel,
    recordingDurationSeconds,
    recordingCaptureError,
    startRecording,
    stopRecording,
    pauseResumeRecording,
  };
}
