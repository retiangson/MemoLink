import type React from "react";
import { useEffect, useRef, useState } from "react";
import { getSpotifyLibrary, getSpotifyPlaylistTracks, searchSpotify } from "../api/connectorsApi";
import type { SpotifyApiPlaylist, SpotifyApiTrack, SpotifyRepeatMode } from "../api/connectorsApi";

const LIKED_SONGS_ID = "__liked_songs__";

interface SpotifyControlState {
  track: SpotifyApiTrack | null;
  isPlaying: boolean;
  onPrevious: () => void;
  onTogglePlay: () => void;
  onStop: () => void;
  onNext: () => void;
}

interface SpotifyMiniPlayerProps extends SpotifyControlState {
  queueTracks: SpotifyApiTrack[];
  onSelectTrack: (track: SpotifyApiTrack) => void;
  progressMs: number;
  durationMs: number;
  showList: boolean;
  shuffle: boolean;
  repeatMode: SpotifyRepeatMode;
  onToggleShuffle: () => void;
  onCycleRepeat: () => void;
  onSeek: (positionMs: number) => void;
  onToggleList: () => void;
  onOpenFull: () => void;
}

interface SpotifyFullPlayerProps extends SpotifyControlState {
  onPlayUri: (uri: string, kind: "track" | "playlist", contextTracks?: SpotifyApiTrack[], contextUri?: string | null) => void;
  shuffle: boolean;
  onShuffle: (shuffle: boolean) => void;
  playerStatus: string;
  sdkError: string | null;
  playbackError: string | null;
  onClearPlaybackError: () => void;
}

function SpotifyLogo({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20m4.59 14.42a.62.62 0 0 1-.86.2c-2.35-1.43-5.3-1.75-8.78-.96a.62.62 0 1 1-.27-1.21c3.8-.87 7.08-.49 9.7 1.11.29.18.38.56.21.86m1.22-2.72a.77.77 0 0 1-1.06.25c-2.68-1.65-6.77-2.13-9.94-1.16a.77.77 0 1 1-.45-1.48c3.62-1.1 8.12-.57 11.2 1.32.36.22.47.7.25 1.07m.1-2.84C14.7 8.95 9.39 8.77 6.32 9.7a.92.92 0 1 1-.54-1.76c3.52-1.07 9.38-.86 13.07 1.33a.92.92 0 0 1-.94 1.59"/>
    </svg>
  );
}

function Equalizer({ active }: { active: boolean }) {
  return (
    <span className="flex h-4 items-end gap-[3px]" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className={`w-[3px] rounded-full bg-emerald-400 ${active ? "animate-pulse" : ""}`}
          style={{ height: `${7 + i * 3}px`, animationDelay: `${i * 0.12}s` }}
        />
      ))}
    </span>
  );
}

function ShuffleIcon({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="currentColor">
      <path d="M11 2.5h2.5a.5.5 0 0 1 .5.5v2.5a.5.5 0 0 1-1 0V4.2l-2.65 2.65a.5.5 0 0 1-.7-.7L12.3 3.5H11a.5.5 0 0 1 0-1M2 4a.5.5 0 0 1 .5-.5h2.1a1.5 1.5 0 0 1 1.16.55l5.49 6.77a.5.5 0 0 1 1.25.68h2.1a.5.5 0 0 1 0 1h-2.1a1.5 1.5 0 0 1-1.16-.55L5.85 5.18a.5.5 0 0 0-.39-.18H2.5A.5.5 0 0 1 2 4m9.04 7.85 2.66 2.65H11a.5.5 0 0 0 0 1h2.5a.5.5 0 0 0 .5-.5v-2.5a.5.5 0 0 0-1 0v1.3l-2.65-2.65a.5.5 0 0 0-.71.7M2.5 12.5a.5.5 0 0 0 0 1h2.1a1.5 1.5 0 0 0 1.16-.55l1.27-1.56a.5.5 0 0 0-.78-.63l-1.26 1.56a.5.5 0 0 1-.39.18z"/>
    </svg>
  );
}

function RepeatIcon({ mode, className = "h-3.5 w-3.5" }: { mode: SpotifyRepeatMode; className?: string }) {
  return (
    <span className="relative inline-flex">
      <svg viewBox="0 0 16 16" className={className} fill="currentColor">
        <path d="M4.5 3.5h6A2.5 2.5 0 0 1 13 6v1.5a.5.5 0 0 1-1 0V6a1.5 1.5 0 0 0-1.5-1.5h-6a.5.5 0 0 1 0-1m-1.3.65 1.3 1.3a.5.5 0 1 1-.7.7l-2-2a.5.5 0 0 1 0-.7l2-2a.5.5 0 1 1 .7.7zM11.5 12.5h-6A2.5 2.5 0 0 1 3 10V8.5a.5.5 0 0 1 1 0V10a1.5 1.5 0 0 0 1.5 1.5h6a.5.5 0 0 1 0 1m1.3-.65-1.3-1.3a.5.5 0 1 1 .7-.7l2 2a.5.5 0 0 1 0 .7l-2 2a.5.5 0 1 1-.7-.7z"/>
      </svg>
      {mode === "track" && (
        <span className="absolute -bottom-1 -right-1.5 flex h-2.5 w-2.5 items-center justify-center rounded-full bg-current">
          <span className="text-[7px] font-bold leading-none text-black">1</span>
        </span>
      )}
    </span>
  );
}

function ControlButton({
  title,
  onClick,
  children,
  className = "",
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={`flex h-8 w-8 items-center justify-center rounded-full text-gray-300 transition hover:bg-white/10 hover:text-white ${className}`}
    >
      {children}
    </button>
  );
}

function PlayerControls({ isPlaying, onPrevious, onTogglePlay, onStop, onNext }: Pick<SpotifyControlState, "isPlaying" | "onPrevious" | "onTogglePlay" | "onStop" | "onNext">) {
  return (
    <div className="flex items-center justify-center gap-1.5">
      <ControlButton title="Previous" onClick={onPrevious}>
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor">
          <path d="M4.5 4.5v7h-1v-7zm1.3 3.07 6.2-3.1a.5.5 0 0 1 .73.45v6.16a.5.5 0 0 1-.73.45l-6.2-3.1a.5.5 0 0 1 0-.86"/>
        </svg>
      </ControlButton>
      <ControlButton title={isPlaying ? "Pause" : "Play"} onClick={onTogglePlay} className="bg-white text-black hover:bg-emerald-100 hover:text-black">
        {isPlaying ? (
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor">
            <path d="M5.5 3.5A.5.5 0 0 1 6 4v8a.5.5 0 0 1-1 0V4a.5.5 0 0 1 .5-.5m5 0a.5.5 0 0 1 .5.5v8a.5.5 0 0 1-1 0V4a.5.5 0 0 1 .5-.5"/>
          </svg>
        ) : (
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor">
            <path d="M5 3.6v8.8a.6.6 0 0 0 .92.5l6.8-4.4a.6.6 0 0 0 0-1L5.92 3.1A.6.6 0 0 0 5 3.6"/>
          </svg>
        )}
      </ControlButton>
      <ControlButton title="Stop" onClick={onStop}>
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor">
          <path d="M4.5 4.5h7v7h-7z"/>
        </svg>
      </ControlButton>
      <ControlButton title="Next" onClick={onNext}>
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor">
          <path d="M11.5 4.5v7h1v-7zm-1.3 3.07L4 4.47a.5.5 0 0 0-.73.45v6.16a.5.5 0 0 0 .73.45l6.2-3.1a.5.5 0 0 0 0-.86"/>
        </svg>
      </ControlButton>
    </div>
  );
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function SpotifyMiniPlayer({
  track,
  queueTracks,
  isPlaying,
  showList,
  shuffle,
  repeatMode,
  onPrevious,
  onTogglePlay,
  onStop,
  onNext,
  onSelectTrack,
  onToggleShuffle,
  onCycleRepeat,
  onSeek,
  onToggleList,
  onOpenFull,
  progressMs,
  durationMs,
}: SpotifyMiniPlayerProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const [dragMs, setDragMs] = useState<number | null>(null);

  useEffect(() => {
    if (dragMs === null) return;
    if (Math.abs(progressMs - dragMs) < 1500) {
      setDragMs(null);
    }
  }, [progressMs, dragMs]);

  useEffect(() => {
    if (dragMs === null) return;
    const timer = setTimeout(() => setDragMs(null), 4000);
    return () => clearTimeout(timer);
  }, [dragMs]);

  function msFromPointer(e: React.PointerEvent<HTMLDivElement>): number {
    const bar = barRef.current;
    if (!bar || durationMs <= 0) return 0;
    const rect = bar.getBoundingClientRect();
    const fraction = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    return Math.round(fraction * durationMs);
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (durationMs <= 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragMs(msFromPointer(e));
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (dragMs === null) return;
    setDragMs(msFromPointer(e));
  }

  function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (dragMs === null) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    const finalMs = msFromPointer(e);
    setDragMs(finalMs);
    onSeek(finalMs);
  }

  const displayMs = dragMs ?? progressMs;
  const progressPct = `${durationMs > 0 ? Math.min(100, Math.round((displayMs / durationMs) * 100)) : 0}%`;
  const title = track?.name ?? "Nothing playing";
  const artist = track ? track.artist : "Open Spotify to pick a track";
  const repeatTitle = repeatMode === "off" ? "Enable repeat" : repeatMode === "context" ? "Repeat all - click for repeat one" : "Repeat one - click to turn off";
  return (
    <div className="group border-t border-[var(--ml-bg-panel)] bg-gradient-to-b from-[var(--ml-bg-surface)] to-[var(--ml-bg-bar)]" tabIndex={0}>
      <div className="flex justify-center pt-1" title="Hover to show player controls">
        <span className="h-1 w-9 rounded-full bg-gray-600/70 transition group-hover:bg-emerald-400/70 group-focus-within:bg-emerald-400/70" />
      </div>

      <div className="flex items-center gap-2 px-3 py-1">
        <span className="w-8 shrink-0 text-right text-[10px] tabular-nums text-gray-500">{formatDuration(displayMs)}</span>
        <div
          ref={barRef}
          className="group/bar relative flex-1 cursor-pointer touch-none py-1.5"
          title={`${title} - ${artist}`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        >
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--ml-bg-hover)] transition-all group-hover/bar:h-2">
            <div className="h-full rounded-full bg-emerald-400" style={{ width: progressPct }} />
          </div>
          <div
            className="pointer-events-none absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 -translate-x-1/2 rounded-full bg-emerald-300 opacity-0 shadow transition-opacity group-hover/bar:opacity-100"
            style={{ left: progressPct }}
          />
        </div>
        <span className="w-8 shrink-0 text-[10px] tabular-nums text-gray-500">{formatDuration(durationMs)}</span>
      </div>

      <div className="max-h-0 overflow-hidden opacity-0 transition-all duration-200 group-hover:max-h-44 group-hover:opacity-100 group-focus-within:max-h-44 group-focus-within:opacity-100">
        <div className="flex items-center gap-2.5 px-3 pb-2">
          <button
            type="button"
            onClick={onOpenFull}
            title="Open Spotify"
            aria-label="Open Spotify"
            className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-emerald-500 text-black shadow-sm transition hover:brightness-105"
          >
            {track?.image_url ? (
              <img src={track.image_url} alt="" className="h-full w-full object-cover" />
            ) : (
              <SpotifyLogo className="h-5 w-5" />
            )}
            {isPlaying && track && (
              <span className="absolute inset-0 flex items-center justify-center bg-black/45">
                <Equalizer active />
              </span>
            )}
          </button>
          <button type="button" onClick={onOpenFull} className="min-w-0 flex-1 text-left">
            <p className="truncate text-xs font-semibold text-gray-100">{title}</p>
            <p className="truncate text-[10px] text-gray-500">{artist}</p>
          </button>
          <ControlButton title={isPlaying ? "Pause" : "Play"} onClick={onTogglePlay} className="bg-white text-black hover:bg-emerald-100 hover:text-black">
            {isPlaying ? (
              <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor">
                <path d="M5.5 3.5A.5.5 0 0 1 6 4v8a.5.5 0 0 1-1 0V4a.5.5 0 0 1 .5-.5m5 0a.5.5 0 0 1 .5.5v8a.5.5 0 0 1-1 0V4a.5.5 0 0 1 .5-.5"/>
              </svg>
            ) : (
              <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor">
                <path d="M5 3.6v8.8a.6.6 0 0 0 .92.5l6.8-4.4a.6.6 0 0 0 0-1L5.92 3.1A.6.6 0 0 0 5 3.6"/>
              </svg>
            )}
          </ControlButton>
          <button
            type="button"
            onClick={onToggleList}
            title="Show music list"
            aria-label="Show music list"
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition ${showList ? "bg-emerald-500/20 text-emerald-300" : "text-gray-500 hover:bg-white/10 hover:text-gray-200"}`}
          >
            <svg viewBox="0 0 16 16" className="h-4 w-4" fill="currentColor">
              <path d="M2 4.25A.75.75 0 0 1 2.75 3.5h10.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 4.25m0 4A.75.75 0 0 1 2.75 7.5h10.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 8.25m0 4A.75.75 0 0 1 2.75 11.5h10.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 12.25"/>
            </svg>
          </button>
        </div>

        <div className="flex items-center justify-center gap-1.5 px-3 pb-2.5">
          <ControlButton
            title={shuffle ? "Shuffle on" : "Shuffle off"}
            onClick={onToggleShuffle}
            className={shuffle ? "text-emerald-400!" : ""}
          >
            <ShuffleIcon />
          </ControlButton>
          <ControlButton title="Previous" onClick={onPrevious}>
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor">
              <path d="M4.5 4.5v7h-1v-7zm1.3 3.07 6.2-3.1a.5.5 0 0 1 .73.45v6.16a.5.5 0 0 1-.73.45l-6.2-3.1a.5.5 0 0 1 0-.86"/>
            </svg>
          </ControlButton>
          <ControlButton title="Stop" onClick={onStop}>
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor">
              <path d="M4.5 4.5h7v7h-7z"/>
            </svg>
          </ControlButton>
          <ControlButton title="Next" onClick={onNext}>
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor">
              <path d="M11.5 4.5v7h1v-7zm-1.3 3.07L4 4.47a.5.5 0 0 0-.73.45v6.16a.5.5 0 0 0 .73.45l6.2-3.1a.5.5 0 0 0 0-.86"/>
            </svg>
          </ControlButton>
          <ControlButton
            title={repeatTitle}
            onClick={onCycleRepeat}
            className={repeatMode !== "off" ? "text-emerald-400!" : ""}
          >
            <RepeatIcon mode={repeatMode} />
          </ControlButton>
        </div>
      </div>

      {showList && (
        <div className="max-h-0 overflow-hidden opacity-0 transition-all duration-200 group-hover:max-h-56 group-hover:opacity-100 group-focus-within:max-h-56 group-focus-within:opacity-100">
          <div className="max-h-56 overflow-y-auto border-t border-[var(--ml-bg-panel)] bg-[var(--ml-bg-base)]">
            {queueTracks.length === 0 ? (
              <p className="px-3 py-2 text-[11px] text-gray-600">No saved tracks yet — open Spotify to search.</p>
            ) : (
              queueTracks.map((item, index) => {
                const isCurrent = Boolean(item.uri) && item.uri === track?.uri;
                return (
                  <button
                    key={item.uri ?? item.id ?? `${item.name}-${index}`}
                    type="button"
                    onClick={() => onSelectTrack(item)}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left transition hover:bg-[var(--ml-bg-hover)] ${isCurrent ? "text-emerald-300" : "text-gray-400"}`}
                  >
                    <span className="w-4 shrink-0 text-[10px]">{isCurrent && isPlaying ? <Equalizer active /> : index + 1}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[11px] font-medium">{item.name}</span>
                      <span className="block truncate text-[10px] text-gray-600">{item.artist}</span>
                    </span>
                    <span className="text-[10px] text-gray-600">{formatDuration(item.duration_ms)}</span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function SpotifyFullPlayer({
  track,
  isPlaying,
  onPrevious,
  onTogglePlay,
  onStop,
  onNext,
  onPlayUri,
  shuffle,
  onShuffle,
  playerStatus,
  sdkError,
  playbackError,
  onClearPlaybackError,
}: SpotifyFullPlayerProps) {
  const [playlists, setPlaylists] = useState<SpotifyApiPlaylist[]>([]);
  const [tracks, setTracks] = useState<SpotifyApiTrack[]>([]);
  const [searchPlaylists, setSearchPlaylists] = useState<SpotifyApiPlaylist[]>([]);
  const [searchTracks, setSearchTracks] = useState<SpotifyApiTrack[]>([]);
  const [expandedPlaylistId, setExpandedPlaylistId] = useState<string | null>(null);
  const [playlistTrackCache, setPlaylistTrackCache] = useState<Record<string, SpotifyApiTrack[]>>({});
  const [loadingPlaylistId, setLoadingPlaylistId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [activeView, setActiveView] = useState<"library" | "search">("library");
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getSpotifyLibrary()
      .then((data) => {
        if (cancelled) return;
        setPlaylists(data.playlists);
        setTracks(data.tracks);
      })
      .catch((err: any) => {
        if (cancelled) return;
        setError(err?.response?.data?.detail ?? "Could not load your Spotify library.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setSearchPlaylists([]);
      setSearchTracks([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(() => {
      searchSpotify(trimmed)
        .then((data) => {
          if (cancelled) return;
          setSearchPlaylists(data.playlists);
          setSearchTracks(data.tracks);
        })
        .catch((err: any) => {
          if (!cancelled) setError(err?.response?.data?.detail ?? "Spotify search failed.");
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  const visibleTracks = activeView === "search" ? searchTracks : tracks;
  const likedSongsPlaylist: SpotifyApiPlaylist | null =
    activeView === "library" && tracks.length > 0
      ? {
          id: LIKED_SONGS_ID,
          uri: null,
          name: "Liked Songs",
          owner: "Saved tracks",
          image_url: tracks.find((item) => item.image_url)?.image_url ?? null,
          track_count: tracks.length,
          external_url: null,
        }
      : null;
  const visiblePlaylists = activeView === "search" ? searchPlaylists : likedSongsPlaylist ? [likedSongsPlaylist, ...playlists] : playlists;
  const trackSectionTitle = activeView === "search" ? "Track Results" : "Saved Tracks";
  const trackRows = visibleTracks;

  function togglePlaylist(playlist: SpotifyApiPlaylist) {
    if (!playlist.id) {
      setError("Spotify did not return a playlist id for this playlist.");
      return;
    }
    const playlistId = playlist.id;
    if (expandedPlaylistId === playlistId) {
      setExpandedPlaylistId(null);
      return;
    }
    setExpandedPlaylistId(playlistId);
    if (playlistId === LIKED_SONGS_ID || playlistTrackCache[playlistId]) return;
    setLoadingPlaylistId(playlistId);
    getSpotifyPlaylistTracks(playlistId)
      .then((data) => setPlaylistTrackCache((prev) => ({ ...prev, [playlistId]: data.tracks })))
      .catch((err: any) => setError(err?.response?.data?.detail ?? "Could not load playlist tracks."))
      .finally(() => setLoadingPlaylistId((id) => (id === playlistId ? null : id)));
  }

  function renderCover(imageUrl: string | null | undefined, fallbackClass = "rounded-md") {
    if (imageUrl) {
      return <img src={imageUrl} alt="" className={`h-full w-full object-cover ${fallbackClass}`} />;
    }
    return (
      <div className={`flex h-full w-full items-center justify-center bg-emerald-500/15 text-emerald-300 ${fallbackClass}`}>
        <SpotifyLogo className="h-6 w-6" />
      </div>
    );
  }

  return (
    <main className="flex-1 overflow-hidden bg-[var(--ml-bg-base)]">
      <div className="flex h-full min-h-0 flex-col overflow-hidden">
        <section className="shrink-0 bg-gradient-to-br from-emerald-600 to-emerald-950 px-6 py-6">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-end">
            <div className="flex h-28 w-28 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-black/25 shadow-2xl ring-1 ring-white/10">
              {track?.image_url ? (
                <img src={track.image_url} alt="" className="h-full w-full object-cover" />
              ) : (
                <SpotifyLogo className="h-20 w-20 text-white" />
              )}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wider text-white/70">{track ? "Now Playing" : "MemoLink Spotify"}</p>
              <h1 className="mt-2 truncate text-4xl font-bold text-white sm:text-5xl">{track?.name ?? "Spotify"}</h1>
              <p className="mt-3 truncate text-sm text-white/80">
                {track ? track.artist : "Search music, open playlists, and play tracks from your connected Spotify account."}
              </p>
            </div>
          </div>
        </section>

        <section className="flex min-h-0 flex-1 flex-col overflow-hidden px-6 py-5">
          <div className="shrink-0 border-b border-[var(--ml-bg-panel)] pb-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex min-w-0 items-center gap-3">
                <div className="h-12 w-12 shrink-0 overflow-hidden rounded-md bg-gradient-to-br from-emerald-600 to-emerald-950">
                  {track?.image_url && <img src={track.image_url} alt="" className="h-full w-full object-cover" />}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-gray-100">Playback controls</p>
                  <p className="truncate text-xs text-gray-500">Use an active Spotify device for playback.</p>
                </div>
                <Equalizer active={isPlaying} />
              </div>
              <PlayerControls
                isPlaying={isPlaying}
                onPrevious={onPrevious}
                onTogglePlay={onTogglePlay}
                onStop={onStop}
                onNext={onNext}
              />
            </div>

            <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-center">
              <div className="flex rounded-lg border border-[var(--ml-bg-hover)] bg-[var(--ml-bg-surface)] p-1">
                {(["library", "search"] as const).map((view) => (
                  <button
                    key={view}
                    onClick={() => setActiveView(view)}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium capitalize transition ${activeView === view ? "bg-emerald-500 text-black" : "text-gray-400 hover:text-gray-200"}`}
                  >
                    {view}
                  </button>
                ))}
              </div>
              <input
                value={query}
                onChange={(e) => { setQuery(e.target.value); setActiveView("search"); }}
                placeholder="Search tracks or playlists"
                className="min-w-0 flex-1 rounded-lg border border-[var(--ml-bg-hover)] bg-[var(--ml-bg-surface)] px-3 py-2 text-sm text-gray-100 outline-none focus:border-emerald-500/50"
              />
              {searching && <span className="text-xs text-gray-500">Searching...</span>}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto pt-4">
            {(error || playbackError || sdkError) && (
              <div className="mb-4 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
                <div className="flex items-start justify-between gap-3">
                  <span>{error || playbackError || sdkError}</span>
                  {playbackError && (
                    <button type="button" onClick={onClearPlaybackError} className="text-xs text-amber-100 hover:text-white">
                      Dismiss
                    </button>
                  )}
                </div>
              </div>
            )}
            {loading ? (
              <p className="text-sm text-gray-500">Loading Spotify library...</p>
            ) : (
              <div className="space-y-6">
                <section>
                  <div className="mb-3 flex items-center justify-between">
                    <h2 className="text-sm font-semibold text-gray-100">{activeView === "search" ? "Playlist Results" : "Your Playlists"}</h2>
                    <span className="text-xs text-gray-600">{visiblePlaylists.length}</span>
                  </div>
                  {visiblePlaylists.length === 0 ? (
                    <p className="text-sm text-gray-600">No playlists found.</p>
                  ) : (
                    <div className="divide-y divide-[var(--ml-bg-panel)] rounded-lg border border-[var(--ml-bg-panel)] bg-[var(--ml-bg-surface)]">
                      {visiblePlaylists.map((playlist) => {
                        const playlistId = playlist.id;
                        const isExpanded = playlistId != null && expandedPlaylistId === playlistId;
                        const playlistTracks = playlistId === LIKED_SONGS_ID ? tracks : playlistId ? playlistTrackCache[playlistId] : undefined;
                        const isLoadingTracks = playlistId !== LIKED_SONGS_ID && playlistId != null && loadingPlaylistId === playlistId;
                        return (
                          <div key={playlist.uri ?? playlist.id}>
                            <button
                              type="button"
                              onClick={() => togglePlaylist(playlist)}
                              className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition hover:bg-[var(--ml-bg-hover)]"
                            >
                              <div className="h-11 w-11 shrink-0 overflow-hidden rounded-md bg-[var(--ml-bg-hover)]">
                                {renderCover(playlist.image_url)}
                              </div>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-medium text-gray-100">{playlist.name}</span>
                                <span className="block truncate text-xs text-gray-500">{playlist.owner || `${playlist.track_count} tracks`}</span>
                              </span>
                              {playlist.uri && (
                                <span
                                  role="button"
                                  tabIndex={0}
                                  title="Play playlist"
                                  aria-label="Play playlist"
                                  onClick={(e) => { e.stopPropagation(); onPlayUri(playlist.uri as string, "playlist", playlistTracks); }}
                                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); onPlayUri(playlist.uri as string, "playlist", playlistTracks); } }}
                                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-black transition hover:bg-emerald-100"
                                >
                                  <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor">
                                    <path d="M5 3.6v8.8a.6.6 0 0 0 .92.5l6.8-4.4a.6.6 0 0 0 0-1L5.92 3.1A.6.6 0 0 0 5 3.6"/>
                                  </svg>
                                </span>
                              )}
                              <svg
                                viewBox="0 0 16 16"
                                className={`h-3.5 w-3.5 shrink-0 text-gray-500 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                                fill="currentColor"
                              >
                                <path d="M6 3.5a.5.5 0 0 1 .82-.39l5 4a.5.5 0 0 1 0 .78l-5 4A.5.5 0 0 1 6 11.5z"/>
                              </svg>
                            </button>
                            {isExpanded && (
                              <div className="border-t border-[var(--ml-bg-panel)] bg-[var(--ml-bg-base)] px-2 py-2">
                                {isLoadingTracks ? (
                                  <p className="px-2 py-2 text-sm text-gray-500">Loading tracks...</p>
                                ) : !playlistTracks || playlistTracks.length === 0 ? (
                                  <p className="px-2 py-2 text-sm text-gray-600">No playable tracks found in this playlist.</p>
                                ) : (
                                  <div className="divide-y divide-[var(--ml-bg-panel)]">
                                    {playlistTracks.map((item, index) => {
                                      const isCurrent = Boolean(item.uri) && item.uri === track?.uri;
                                      return (
                                        <button
                                          key={item.uri ?? item.id ?? `${item.name}-${index}`}
                                          type="button"
                                          onClick={() => item.uri && onPlayUri(item.uri, "track", playlistTracks, playlist.uri)}
                                          className={`grid w-full grid-cols-[28px_40px_1fr_64px] items-center gap-3 rounded-lg px-2 py-2 text-left transition hover:bg-white/5 ${isCurrent ? "text-emerald-300" : "text-gray-300"}`}
                                        >
                                          <span className="text-xs text-gray-500">{isCurrent && isPlaying ? <Equalizer active /> : index + 1}</span>
                                          <div className="h-9 w-9 overflow-hidden rounded-md bg-[var(--ml-bg-hover)]">
                                            {renderCover(item.image_url)}
                                          </div>
                                          <span className="min-w-0">
                                            <span className="block truncate text-sm font-medium">{item.name}</span>
                                            <span className="block truncate text-xs text-gray-600">{item.artist}</span>
                                          </span>
                                          <span className="text-right text-xs text-gray-500">{formatDuration(item.duration_ms)}</span>
                                        </button>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>

                <section>
                  <div className="mb-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <h2 className="truncate text-sm font-semibold text-gray-100">{trackSectionTitle}</h2>
                      <p className="text-xs text-gray-600">{playerStatus} · {trackRows.length}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onShuffle(!shuffle)}
                        className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${shuffle ? "bg-emerald-500 text-black" : "bg-[var(--ml-bg-surface)] text-gray-400 hover:text-gray-200"}`}
                      >
                        Shuffle {shuffle ? "On" : "Off"}
                      </button>
                    </div>
                  </div>
                  {track && (
                    <div className="mb-3 flex items-center gap-3 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2">
                      <div className="h-10 w-10 overflow-hidden rounded-md bg-[var(--ml-bg-hover)]">
                        {renderCover(track.image_url)}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-emerald-100">Now playing: {track.name}</p>
                        <p className="truncate text-xs text-emerald-300/70">{track.artist}</p>
                      </div>
                    </div>
                  )}
                  {trackRows.length === 0 ? (
                    <p className="text-sm text-gray-600">No tracks found.</p>
                  ) : (
                    <div className="divide-y divide-[var(--ml-bg-panel)]">
                      {trackRows.map((item, index) => {
                        const isCurrent = Boolean(item.uri) && item.uri === track?.uri;
                        return (
                          <button
                            key={item.uri ?? item.id ?? `${item.name}-${index}`}
                            type="button"
                            onClick={() => item.uri && onPlayUri(item.uri, "track", visibleTracks)}
                            className={`grid w-full grid-cols-[40px_44px_1fr_72px] items-center gap-3 rounded-lg px-3 py-2 text-left transition hover:bg-white/5 ${isCurrent ? "text-emerald-300" : "text-gray-300"}`}
                          >
                            <span className="text-sm text-gray-500">{isCurrent && isPlaying ? <Equalizer active /> : index + 1}</span>
                            <div className="h-10 w-10 overflow-hidden rounded-md bg-[var(--ml-bg-hover)]">
                              {renderCover(item.image_url)}
                            </div>
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-medium">{item.name}</span>
                              <span className="block truncate text-xs text-gray-600">{item.artist}{item.album ? ` - ${item.album}` : ""}</span>
                            </span>
                            <span className="text-right text-xs text-gray-500">{formatDuration(item.duration_ms)}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </section>
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
