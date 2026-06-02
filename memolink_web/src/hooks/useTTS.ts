import { useState, useRef, useEffect } from "react";

const LS_VOICE = "memolink_tts_voice";
const LS_RATE  = "memolink_tts_rate";

export function splitSentences(text: string): string[] {
  return text.match(/[^.!?\n]+[.!?\n]+|[^.!?\n]+$/g)?.map(s => s.trim()).filter(Boolean) ?? [text];
}

export function useTTS() {
  const [playing, setPlaying] = useState(false);
  const [paused, setPaused] = useState(false);
  const [rate, setRateState] = useState<number>(() => parseFloat(localStorage.getItem(LS_RATE) ?? "1.0"));
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoice, setSelectedVoiceState] = useState<SpeechSynthesisVoice | null>(null);
  const [currentSentenceIdx, setCurrentSentenceIdx] = useState(-1);
  const [sentencesList, setSentencesList] = useState<string[]>([]);

  const sentences = useRef<string[]>([]);
  const cursor = useRef(0);
  const rateRef = useRef<number>(parseFloat(localStorage.getItem(LS_RATE) ?? "1.0"));
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);

  // Load voices and restore saved voice — async in some browsers
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
      const savedRate = parseFloat(localStorage.getItem(LS_RATE) ?? "1.0");
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

  function setSelectedVoice(v: SpeechSynthesisVoice | null) {
    voiceRef.current = v;
    setSelectedVoiceState(v);
    if (v) localStorage.setItem(LS_VOICE, v.name);
    else localStorage.removeItem(LS_VOICE);
  }

  function _speak(idx: number) {
    if (idx < 0 || idx >= sentences.current.length) {
      setPlaying(false); setPaused(false); return;
    }
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(sentences.current[idx]);
    u.rate = rateRef.current;
    if (voiceRef.current) u.voice = voiceRef.current;
    cursor.current = idx;
    u.onstart = () => { setPlaying(true); setPaused(false); setCurrentSentenceIdx(idx); };
    u.onend = () => {
      if (cursor.current + 1 < sentences.current.length) {
        _speak(cursor.current + 1);
      } else {
        setPlaying(false); setPaused(false);
      }
    };
    u.onerror = () => { setPlaying(false); setPaused(false); };
    window.speechSynthesis.speak(u);
  }

  function speak(text: string) {
    window.speechSynthesis.cancel();
    const sents = splitSentences(text);
    sentences.current = sents;
    setSentencesList(sents);
    cursor.current = 0;
    _speak(0);
  }

  function stop() {
    window.speechSynthesis.cancel();
    sentences.current = []; cursor.current = 0;
    setPlaying(false); setPaused(false);
    setCurrentSentenceIdx(-1);
  }

  function pause() { window.speechSynthesis.pause(); setPaused(true); }
  function resume() { window.speechSynthesis.resume(); setPaused(false); }

  function forward() {
    const next = cursor.current + 1;
    if (next < sentences.current.length) _speak(next);
  }

  function back() { _speak(Math.max(0, cursor.current - 1)); }

  function setRate(r: number) {
    rateRef.current = r; setRateState(r);
    localStorage.setItem(LS_RATE, String(r));
    if (playing && !paused) _speak(cursor.current);
  }

  return {
    playing, paused, rate, voices, selectedVoice,
    speak, stop, pause, resume, forward, back, setRate, setSelectedVoice,
    currentSentenceIdx, sentencesList,
  };
}
