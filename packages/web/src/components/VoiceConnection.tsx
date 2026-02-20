import { Component, useCallback, useEffect, useRef, type ReactNode } from "react";
import { LiveKitRoom, RoomAudioRenderer } from "@livekit/components-react";
import { AudioPresets } from "livekit-client";
import { useVoiceStore } from "../store/voice.js";

/** Timeout (ms) for the LiveKit connection to establish before giving up. */
const CONNECT_TIMEOUT_MS = 15_000;

// ─── Error Boundary ───────────────────────────────────────────────────────────
// LiveKit can throw during rendering (e.g. WebSocket 101 upgrade failure,
// malformed token). Without a boundary the entire app goes blank.

interface EBProps { children: ReactNode; onError: () => void }
interface EBState { hasError: boolean }

class LiveKitErrorBoundary extends Component<EBProps, EBState> {
  state: EBState = { hasError: false };

  static getDerivedStateFromError(): EBState {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    console.error("[VoiceConnection] LiveKit error caught by boundary:", error);
    this.props.onError();
  }

  // Reset when children change (new token → new connection attempt)
  componentDidUpdate(prev: EBProps) {
    if (this.state.hasError && prev.children !== this.props.children) {
      this.setState({ hasError: false });
    }
  }

  render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}

// ─── VoiceConnection ──────────────────────────────────────────────────────────

/**
 * Persistent LiveKit connection wrapper.
 * Rendered at the Chat layout level so it never unmounts when navigating
 * between channels. Children (e.g. VoiceRoom UI) can mount/unmount freely
 * while the connection stays alive.
 */
export default function VoiceConnection({ children }: { children?: ReactNode }) {
  const {
    connectionState,
    currentChannelId,
    livekitToken,
    livekitUrl,
    isMuted,
    inputDeviceId,
    outputDeviceId,
    echoCancellation,
    noiseSuppression,
    setConnectionState,
    leaveVoice,
  } = useVoiceStore();

  const isActive = connectionState === "connected" || connectionState === "connecting";
  const connectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleConnected = useCallback(() => {
    // Clear timeout — we connected successfully
    if (connectTimerRef.current) {
      clearTimeout(connectTimerRef.current);
      connectTimerRef.current = null;
    }
    setConnectionState("connected");
  }, [setConnectionState]);

  const handleDisconnected = useCallback(() => {
    if (connectTimerRef.current) {
      clearTimeout(connectTimerRef.current);
      connectTimerRef.current = null;
    }
    // If leaveVoice() was already called (intentional), state is already "disconnected"
    const { connectionState: cs } = useVoiceStore.getState();
    if (cs === "disconnected") return;

    // Unexpected disconnect (LiveKit connection lost after all retries)
    leaveVoice();
  }, [leaveVoice]);

  // Called when the error boundary catches a LiveKit crash
  const handleBoundaryError = useCallback(() => {
    leaveVoice();
  }, [leaveVoice]);

  // Connection timeout — if still "connecting" after 15s, give up
  useEffect(() => {
    if (connectionState !== "connecting") {
      if (connectTimerRef.current) {
        clearTimeout(connectTimerRef.current);
        connectTimerRef.current = null;
      }
      return;
    }

    connectTimerRef.current = setTimeout(() => {
      console.warn("[VoiceConnection] Connection timed out after", CONNECT_TIMEOUT_MS, "ms");
      connectTimerRef.current = null;
      leaveVoice();
    }, CONNECT_TIMEOUT_MS);

    return () => {
      if (connectTimerRef.current) {
        clearTimeout(connectTimerRef.current);
        connectTimerRef.current = null;
      }
    };
  }, [connectionState, leaveVoice]);

  // Auto-disconnect voice when window/tab is closed
  useEffect(() => {
    if (!isActive) return;
    const handler = () => { leaveVoice(); };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isActive, leaveVoice]);

  if (!livekitToken || !livekitUrl || !isActive) return <>{children}</>;

  return (
    <LiveKitErrorBoundary onError={handleBoundaryError}>
      <LiveKitRoom
        // Force full remount when switching channels to prevent cross-channel audio leak
        key={currentChannelId}
        token={livekitToken}
        serverUrl={livekitUrl}
        connect={true}
        audio={!isMuted}
        video={false}
        options={{
          dynacast: true,
          adaptiveStream: true,
          publishDefaults: {
            audioPreset: AudioPresets.music,  // 32kbps Opus (up from 20kbps default)
            dtx: true,                        // save bandwidth during silence
            red: true,                        // redundant encoding for packet loss resilience
          },
          audioCaptureDefaults: {
            deviceId: inputDeviceId || undefined,
            echoCancellation,
            noiseSuppression,
            channelCount: 1,
            autoGainControl: true,
          },
          audioOutput: {
            deviceId: outputDeviceId || undefined,
          },
        }}
        onConnected={handleConnected}
        onDisconnected={handleDisconnected}
        style={{ display: "contents" }}
      >
        <RoomAudioRenderer />
        {children}
      </LiveKitRoom>
    </LiveKitErrorBoundary>
  );
}
