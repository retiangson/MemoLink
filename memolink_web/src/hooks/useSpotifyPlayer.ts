import { useEffect, useRef, useState } from "react";
import { getSpotifyPlayerToken } from "../api/connectorsApi";
import type { SpotifyApiTrack } from "../api/connectorsApi";

interface SpotifyWebPlaybackState {
  paused: boolean;
  position: number;
  duration: number;
  track_window?: {
    current_track?: {
      id?: string;
      uri?: string;
      name?: string;
      artists?: Array<{ name?: string }>;
      album?: { name?: string; images?: Array<{ url?: string }> };
      duration_ms?: number;
    };
  };
}

interface SpotifyWebPlaybackPlayer {
  addListener(event: "ready", callback: (event: { device_id: string }) => void): boolean;
  addListener(event: "not_ready", callback: (event: { device_id: string }) => void): boolean;
  addListener(event: "player_state_changed", callback: (state: SpotifyWebPlaybackState | null) => void): boolean;
  addListener(event: "initialization_error" | "authentication_error" | "account_error" | "playback_error", callback: (event: { message: string }) => void): boolean;
  connect(): Promise<boolean>;
  disconnect(): void;
}

declare global {
  interface Window {
    Spotify?: {
      Player: new (options: {
        name: string;
        getOAuthToken: (callback: (token: string) => void) => void;
        volume?: number;
      }) => SpotifyWebPlaybackPlayer;
    };
    onSpotifyWebPlaybackSDKReady?: () => void;
  }
}

let spotifySdkPromise: Promise<void> | null = null;

function loadSpotifySdk(): Promise<void> {
  if (window.Spotify) return Promise.resolve();
  if (!spotifySdkPromise) {
    spotifySdkPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector<HTMLScriptElement>("script[src='https://sdk.scdn.co/spotify-player.js']");
      window.onSpotifyWebPlaybackSDKReady = () => resolve();
      if (existing) return;
      const script = document.createElement("script");
      script.src = "https://sdk.scdn.co/spotify-player.js";
      script.async = true;
      script.onerror = () => reject(new Error("Could not load Spotify Web Playback SDK."));
      document.body.appendChild(script);
    });
  }
  return spotifySdkPromise;
}

export interface UseSpotifyPlayerResult {
  deviceId: string | null;
  liveTrack: SpotifyApiTrack | null;
  isPaused: boolean;
  progressMs: number;
  durationMs: number;
  playerStatus: string;
  sdkError: string | null;
}

/**
 * Owns the Spotify Web Playback SDK connection for the whole app. Must be mounted at a
 * persistent ancestor (not inside the Spotify tab) so the registered "MemoLink Spotify"
 * Connect device - and the audio it's playing - survives switching away from that tab.
 */
export function useSpotifyPlayer(enabled: boolean): UseSpotifyPlayerResult {
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [liveTrack, setLiveTrack] = useState<SpotifyApiTrack | null>(null);
  const [isPaused, setIsPaused] = useState(true);
  const [durationMs, setDurationMs] = useState(0);
  const [progressMs, setProgressMs] = useState(0);
  const [playerStatus, setPlayerStatus] = useState("Connecting Spotify player...");
  const [sdkError, setSdkError] = useState<string | null>(null);
  const positionRef = useRef({ position: 0, updatedAt: Date.now(), paused: true });

  useEffect(() => {
    if (!enabled) {
      setDeviceId(null);
      setLiveTrack(null);
      setIsPaused(true);
      return;
    }

    let cancelled = false;
    let player: SpotifyWebPlaybackPlayer | null = null;

    async function startPlayer() {
      try {
        await loadSpotifySdk();
        if (cancelled || !window.Spotify) return;
        player = new window.Spotify.Player({
          name: "MemoLink Spotify",
          volume: 0.6,
          getOAuthToken: (callback) => {
            getSpotifyPlayerToken()
              .then(callback)
              .catch(() => setSdkError("Could not refresh Spotify playback token. Reconnect Spotify."));
          },
        });
        player.addListener("ready", ({ device_id }) => {
          if (cancelled) return;
          setDeviceId(device_id);
          setPlayerStatus("MemoLink player ready");
          setSdkError(null);
        });
        player.addListener("not_ready", ({ device_id }) => {
          if (cancelled) return;
          setDeviceId(null);
          setPlayerStatus(`Spotify device went offline: ${device_id}`);
        });
        player.addListener("player_state_changed", (state) => {
          if (cancelled || !state) return;
          const current = state.track_window?.current_track;
          positionRef.current = { position: state.position, updatedAt: Date.now(), paused: state.paused };
          setIsPaused(state.paused);
          setProgressMs(state.position);
          setDurationMs(state.duration);
          if (current) {
            setLiveTrack({
              id: current.id ?? null,
              uri: current.uri ?? null,
              name: current.name ?? "Unknown track",
              artist: (current.artists ?? []).map((artist) => artist.name).filter(Boolean).join(", ") || "Unknown artist",
              album: current.album?.name ?? "",
              image_url: current.album?.images?.[0]?.url ?? null,
              duration_ms: current.duration_ms ?? state.duration,
            });
          }
        });
        player.addListener("initialization_error", ({ message }) => setSdkError(message));
        player.addListener("authentication_error", ({ message }) => setSdkError(message || "Spotify authentication failed. Reconnect Spotify."));
        player.addListener("account_error", ({ message }) => setSdkError(message || "Spotify Premium is required for in-app playback."));
        player.addListener("playback_error", ({ message }) => setSdkError(message || "Spotify playback failed."));
        const connected = await player.connect();
        if (!cancelled && !connected) {
          setSdkError("Spotify player could not connect. Make sure this app is allowed in your Spotify developer settings.");
          setPlayerStatus("Player unavailable");
        }
      } catch (err: any) {
        if (!cancelled) {
          setSdkError(err?.message ?? "Could not start Spotify player.");
          setPlayerStatus("Player unavailable");
        }
      }
    }

    startPlayer();
    return () => {
      cancelled = true;
      player?.disconnect();
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const interval = setInterval(() => {
      const { position, updatedAt, paused } = positionRef.current;
      if (paused) return;
      const elapsed = position + (Date.now() - updatedAt);
      setProgressMs((prev) => {
        const capped = durationMs > 0 ? Math.min(elapsed, durationMs) : elapsed;
        return capped === prev ? prev : capped;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [enabled, durationMs]);

  return { deviceId, liveTrack, isPaused, progressMs, durationMs, playerStatus, sdkError };
}
