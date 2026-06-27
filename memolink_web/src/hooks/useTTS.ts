import { useState, useRef, useEffect, useCallback } from "react";

const LS_VOICE = "memolink_tts_voice";
const LS_RATE  = "memolink_tts_rate";
const DEFAULT_TTS_RATE = 1;
const MIN_TTS_RATE = 0.1;
const MAX_TTS_RATE = 10;
const TTS_SILENT_FAILURE_THRESHOLD_MS = 200;

export type TTSQueueOutcome = "completed" | "unavailable" | "failed";

function normalizeRate(value: string | number | null): number {
  const parsed = typeof value === "number" ? value : Number.parseFloat(value ?? "");
  if (!Number.isFinite(parsed)) return DEFAULT_TTS_RATE;
  return Math.min(MAX_TTS_RATE, Math.max(MIN_TTS_RATE, parsed));
}

export function splitSentences(text: string): string[] {
  return text.match(/[^.!?\n]+[.!?\n]+|[^.!?\n]+$/g)?.map(s => s.trim()).filter(Boolean) ?? [];
}

export function useTTS() {
  const [playing, setPlaying] = useState(false);
  const [paused, setPaused] = useState(false);
  const [rate, setRateState] = useState<number>(() => normalizeRate(localStorage.getItem(LS_RATE)));
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoice, setSelectedVoiceState] = useState<SpeechSynthesisVoice | null>(null);
  const [currentSentenceIdx, setCurrentSentenceIdx] = useState(-1);
  const [sentencesList, setSentencesList] = useState<string[]>([]);
  // Char range of the word currently being spoken, relative to the current sentence.
  const [currentWord, setCurrentWord] = useState<{ start: number; end: number } | null>(null);

  const sentences = useRef<string[]>([]);
  const cursor = useRef(0);
  const rateRef = useRef<number>(normalizeRate(localStorage.getItem(LS_RATE)));
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);
  // Fired once when the whole sentence queue finishes playing (not on manual stop/pause).
  const queueEndRef = useRef<((outcome: TTSQueueOutcome) => void) | null>(null);
  // Invalidates callbacks from utterances cancelled by stop, seek, rate changes,
  // or a newer speak request. Some engines dispatch onend after cancel().
  const playbackGenerationRef = useRef(0);

  // Load voices and restore saved voice - async in some browsers
  useEffect(() => {
    function load() {
      const v = window.speechSynthesis?.getVoices() ?? [];
      if (v.length === 0) return;
      setVoices(v);
      applyStoredPrefs(v);
    }
    function applyStoredPrefs(v: SpeechSynthesisVoice[]) {
      const savedName = localStorage.getItem(LS_VOICE);
      const match = savedName ? (v.find(x => x.name === savedName) ?? null) : null;
      voiceRef.current = match;
      setSelectedVoiceState(match);
      const savedRate = normalizeRate(localStorage.getItem(LS_RATE));
      rateRef.current = savedRate;
      setRateState(savedRate);
    }
    function onSettingsChanged() {
      applyStoredPrefs(window.speechSynthesis?.getVoices() ?? []);
    }
    load();
    window.speechSynthesis?.addEventListener("voiceschanged", load);
    window.addEventListener("memolink_tts_changed", onSettingsChanged);
    return () => {
      window.speechSynthesis?.removeEventListener("voiceschanged", load);
      window.removeEventListener("memolink_tts_changed", onSettingsChanged);
    };
  }, []);

  const setSelectedVoice = useCallback((v: SpeechSynthesisVoice | null) => {
    voiceRef.current = v;
    setSelectedVoiceState(v);
    if (v) localStorage.setItem(LS_VOICE, v.name);
    else localStorage.removeItem(LS_VOICE);
  }, []);

  useEffect(() => () => {
    playbackGenerationRef.current += 1;
    queueEndRef.current = null;
  }, []);

  const speakSentence = useCallback(function playSentence(idx: number, generation: number) {
    if (generation !== playbackGenerationRef.current) return;
    if (!window.speechSynthesis) {
      setPlaying(false); setPaused(false);
      const cb = queueEndRef.current;
      queueEndRef.current = null;
      cb?.("unavailable");
      return;
    }
    if (idx < 0 || idx >= sentences.current.length) {
      setPlaying(false); setPaused(false); setCurrentSentenceIdx(-1);
      const cb = queueEndRef.current;
      queueEndRef.current = null;
      cb?.("failed");
      return;
    }
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(sentences.current[idx]);
    u.rate = rateRef.current;
    if (voiceRef.current) u.voice = voiceRef.current;
    cursor.current = idx;
    // Track whether the utterance actually started producing audio.
    // On Android WebView, onend can fire immediately without onstart if TTS silently
    // fails (no voice loaded) — without this guard, the sentence queue drains
    // instantly and onQueueEnd jumps the reader to the last page.
    let started = false;
    u.onstart = () => { started = true; setPlaying(true); setPaused(false); setCurrentSentenceIdx(idx); setCurrentWord(null); };
    // Word-level highlight: fires at each word boundary with a char offset
    // into the current sentence. charLength isn't reported by every browser,
    // so fall back to scanning to the next whitespace.
    u.onboundary = (e: SpeechSynthesisEvent) => {
      if (e.name && e.name !== "word") return;
      const sent = sentences.current[idx] ?? "";
      const start = e.charIndex;
      if (start == null || start < 0 || start >= sent.length) return;
      let end = start + (e.charLength ?? 0);
      if (!end || end <= start) {
        const rest = sent.slice(start);
        const ws = rest.search(/\s/);
        end = start + (ws === -1 ? rest.length : ws);
      }
      setCurrentWord({ start, end });
    };
    // Timestamp captured right before speak() is called. Android WebView's
    // speechSynthesis fires onend without onstart when TTS silently fails (no
    // voice available) — but on some Android builds onstart legitimately never
    // fires even though the speech DID play. Using elapsed time to distinguish:
    // < 200 ms with no onstart = genuine silent failure; ≥ 200 ms = speech
    // played (onstart just didn't fire), so continue to the next sentence.
    const startTime = Date.now();
    u.onend = () => {
      if (generation !== playbackGenerationRef.current) return;
      setCurrentWord(null);
      if (!started && Date.now() - startTime < TTS_SILENT_FAILURE_THRESHOLD_MS) {
        // onend fired almost immediately without onstart — TTS silently failed.
        // Abort rather than draining the sentence queue instantly.
        if (typeof window !== "undefined") window.speechSynthesis?.cancel();
        setPlaying(false); setPaused(false); setCurrentSentenceIdx(-1);
        const cb = queueEndRef.current;
        queueEndRef.current = null;
        cb?.("failed");
        return;
      }
      if (cursor.current + 1 < sentences.current.length) {
        playSentence(cursor.current + 1, generation);
      } else {
        setPlaying(false); setPaused(false); setCurrentSentenceIdx(-1);
        const cb = queueEndRef.current;
        queueEndRef.current = null;
        cb?.("completed");
      }
    };
    u.onerror = () => {
      if (generation !== playbackGenerationRef.current) return;
      setPlaying(false); setPaused(false); setCurrentSentenceIdx(-1); setCurrentWord(null);
      const cb = queueEndRef.current;
      queueEndRef.current = null;
      cb?.("failed");
    };
    window.speechSynthesis?.speak(u);
  }, []);

  /** startIndex lets callers (e.g. "click a sentence to read from here") skip ahead.
   *  onQueueEnd settles once with an explicit outcome. Auto-advance callers must
   *  advance only on "completed", never when speech is unavailable or fails. */
  const speak = useCallback((text: string, startIndex = 0, onQueueEnd?: (outcome: TTSQueueOutcome) => void) => {
    const generation = ++playbackGenerationRef.current;
    window.speechSynthesis?.cancel();
    const sents = splitSentences(text);
    sentences.current = sents;
    setSentencesList(sents);
    if (sents.length === 0) {
      const cb = onQueueEnd;
      queueEndRef.current = null;
      setPlaying(false); setPaused(false); setCurrentSentenceIdx(-1); setCurrentWord(null);
      cb?.("completed");
      return;
    }
    const start = sents.length === 0 ? 0 : Math.min(Math.max(0, startIndex), sents.length - 1);
    cursor.current = start;
    queueEndRef.current = onQueueEnd ?? null;
    speakSentence(start, generation);
  }, [speakSentence]);

  const stop = useCallback(() => {
    playbackGenerationRef.current += 1;
    window.speechSynthesis?.cancel();
    sentences.current = []; cursor.current = 0;
    queueEndRef.current = null;
    setPlaying(false); setPaused(false);
    setCurrentSentenceIdx(-1);
    setCurrentWord(null);
  }, []);

  const pause = useCallback(() => { window.speechSynthesis?.pause(); setPaused(true); }, []);
  const resume = useCallback(() => { window.speechSynthesis?.resume(); setPaused(false); }, []);

  const forward = useCallback(() => {
    const next = cursor.current + 1;
    if (next < sentences.current.length) {
      const generation = ++playbackGenerationRef.current;
      speakSentence(next, generation);
    }
  }, [speakSentence]);

  const back = useCallback(() => {
    const generation = ++playbackGenerationRef.current;
    speakSentence(Math.max(0, cursor.current - 1), generation);
  }, [speakSentence]);

  const setRate = useCallback((r: number) => {
    const normalizedRate = normalizeRate(r);
    rateRef.current = normalizedRate; setRateState(normalizedRate);
    localStorage.setItem(LS_RATE, String(normalizedRate));
    if (window.speechSynthesis?.speaking && !window.speechSynthesis.paused) {
      const generation = ++playbackGenerationRef.current;
      speakSentence(cursor.current, generation);
    }
  }, [speakSentence]);

  return {
    playing, paused, rate, voices, selectedVoice,
    speak, stop, pause, resume, forward, back, setRate, setSelectedVoice,
    currentSentenceIdx, sentencesList, currentWord,
  };
}
