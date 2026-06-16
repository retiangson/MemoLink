import React, { useState } from "react";

interface Props {
  paused: boolean;
  rate: number;
  voices: SpeechSynthesisVoice[];
  selectedVoice: SpeechSynthesisVoice | null;
  onPauseResume: () => void;
  onStop: () => void;
  onBack: () => void;
  onForward: () => void;
  onRateChange: (r: number) => void;
  onVoiceChange: (v: SpeechSynthesisVoice | null) => void;
}

const RATES = [0.75, 1.0, 1.25, 1.5, 2.0];

export function TTSPlayerBar({ paused, rate, voices, selectedVoice, onPauseResume, onStop, onBack, onForward, onRateChange, onVoiceChange }: Props) {
  const [showVoices, setShowVoices] = useState(false);
  const [voiceSearch, setVoiceSearch] = useState("");

  const filteredVoices = voiceSearch
    ? voices.filter(v => v.name.toLowerCase().includes(voiceSearch.toLowerCase()) || v.lang.toLowerCase().includes(voiceSearch.toLowerCase()))
    : voices;

  const voiceLabel = selectedVoice
    ? selectedVoice.name.split(" ").slice(0, 2).join(" ")
    : "Default";

  return (
    <div className="flex justify-center pb-1 px-4 relative">
      {/* Voice picker popup */}
      {showVoices && (
        <>
          <div className="fixed inset-0 z-50" onClick={() => { setShowVoices(false); setVoiceSearch(""); }} />
          <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 z-50 w-72 bg-[#1a1a24] border border-[var(--ml-bg-hover)] rounded-2xl shadow-2xl overflow-hidden">
            <div className="px-3 py-2.5 border-b border-[var(--ml-bg-hover)]">
              <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5">Select Voice</p>
              <input
                autoFocus
                value={voiceSearch}
                onChange={e => setVoiceSearch(e.target.value)}
                placeholder="Search voices…"
                className="w-full bg-[var(--ml-bg-surface)] border border-[var(--ml-bg-hover)] rounded-lg px-2.5 py-1.5 text-xs text-gray-300 placeholder-gray-600 focus:outline-none focus:border-indigo-500"
              />
            </div>
            <div className="max-h-52 overflow-y-auto">
              {/* Default option */}
              <button
                onClick={() => { onVoiceChange(null); setShowVoices(false); setVoiceSearch(""); }}
                className={`w-full flex items-center justify-between px-3 py-2 text-left hover:bg-[var(--ml-bg-hover)] transition ${!selectedVoice ? "bg-indigo-500/10" : ""}`}
              >
                <span className={`text-xs ${!selectedVoice ? "text-indigo-300 font-medium" : "text-gray-400"}`}>Default (system)</span>
                {!selectedVoice && <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 shrink-0" />}
              </button>
              {filteredVoices.map((v, i) => (
                <button
                  key={i}
                  onClick={() => { onVoiceChange(v); setShowVoices(false); setVoiceSearch(""); }}
                  className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-[var(--ml-bg-hover)] transition ${selectedVoice?.name === v.name ? "bg-indigo-500/10" : ""}`}
                >
                  <div className="min-w-0">
                    <p className={`text-xs truncate ${selectedVoice?.name === v.name ? "text-indigo-300 font-medium" : "text-gray-300"}`}>{v.name}</p>
                    <p className="text-[10px] text-gray-600">{v.lang}{v.localService ? " · offline" : " · online"}</p>
                  </div>
                  {selectedVoice?.name === v.name && <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 shrink-0" />}
                </button>
              ))}
              {filteredVoices.length === 0 && (
                <p className="px-3 py-3 text-xs text-gray-600">No voices match "{voiceSearch}"</p>
              )}
            </div>
          </div>
        </>
      )}

      <div className="flex items-center gap-2 px-3 py-2 bg-black/50 backdrop-blur-md border border-white/10 rounded-2xl shadow-lg">
        {/* Sound wave */}
        <span className="flex gap-[3px] items-end h-4 mr-1">
          {[0,1,2,3].map(i => (
            <span key={i} className={`w-[3px] bg-indigo-400 rounded-full ${paused ? "opacity-30" : "animate-pulse"}`}
              style={{ height: `${6 + i * 2 + (3 - i) * 2}px`, animationDelay: `${i * 0.12}s` }} />
          ))}
        </span>

        {/* Back */}
        <button onClick={onBack} title="Previous sentence"
          className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-white hover:bg-white/8 transition">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M11 19l-7-7 7-7M18 19l-7-7 7-7" />
          </svg>
        </button>

        {/* Play/Pause */}
        <button onClick={onPauseResume} title={paused ? "Resume" : "Pause"}
          className="w-8 h-8 flex items-center justify-center rounded-xl bg-indigo-600/80 hover:bg-indigo-500 text-white transition shadow-sm">
          {paused
            ? <svg className="w-4 h-4 ml-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
            : <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>}
        </button>

        {/* Forward */}
        <button onClick={onForward} title="Next sentence"
          className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-white hover:bg-white/8 transition">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 5l7 7-7 7M6 5l7 7-7 7" />
          </svg>
        </button>

        {/* Stop */}
        <button onClick={onStop} title="Stop"
          className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-red-400 hover:bg-white/8 transition">
          <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M6 6h12v12H6z"/></svg>
        </button>

        {/* Speed */}
        <div className="flex items-center gap-0.5 border-l border-white/10 pl-2">
          {RATES.map(r => (
            <button key={r} onClick={() => onRateChange(r)}
              className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition ${rate === r ? "bg-indigo-500/30 text-indigo-300" : "text-gray-600 hover:text-gray-300 hover:bg-white/6"}`}>
              {r}×
            </button>
          ))}
        </div>

        {/* Voice picker */}
        {voices.length > 0 && (
          <button
            onClick={() => setShowVoices(v => !v)}
            title="Change voice"
            className={`flex items-center gap-1.5 pl-2 border-l border-white/10 text-[10px] transition max-w-[90px] ${showVoices ? "text-indigo-300" : "text-gray-600 hover:text-gray-300"}`}
          >
            <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
            </svg>
            <span className="truncate">{voiceLabel}</span>
          </button>
        )}
      </div>
    </div>
  );
}
