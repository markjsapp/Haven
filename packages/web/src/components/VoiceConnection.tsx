import { useCallback, useEffect, type ReactNode } from "react";
import { LiveKitRoom, RoomAudioRenderer } from "@livekit/components-react";
import { useVoiceStore } from "../store/voice.js";

/**
 * Persistent LiveKit connection wrapper.
 * Rendered at the Chat layout level so it never unmounts when navigating
 * between channels. Children (e.g. VoiceRoom UI) can mount/unmount freely
 * while the connection stays alive.
 */
export default function VoiceConnection({ children }: { children?: ReactNode }) {
  const {
    connectionState,
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

  const handleConnected = useCallback(() => {
    setConnectionState("connected");
  }, [setConnectionState]);

  const handleDisconnected = useCallback(() => {
    // If leaveVoice() was already called (intentional), state is already "disconnected"
    const { connectionState: cs } = useVoiceStore.getState();
    if (cs === "disconnected") return;

    // Unexpected disconnect (LiveKit connection lost after all retries)
    leaveVoice();
  }, [leaveVoice]);

  // Auto-disconnect voice when window/tab is closed
  useEffect(() => {
    if (!isActive) return;
    const handler = () => { leaveVoice(); };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isActive, leaveVoice]);

  if (!livekitToken || !livekitUrl || !isActive) return <>{children}</>;

  return (
    <LiveKitRoom
      token={livekitToken}
      serverUrl={livekitUrl}
      connect={true}
      audio={!isMuted}
      video={false}
      options={{
        dynacast: true,
        adaptiveStream: true,
        audioCaptureDefaults: {
          deviceId: inputDeviceId || undefined,
          echoCancellation,
          noiseSuppression,
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
  );
}
