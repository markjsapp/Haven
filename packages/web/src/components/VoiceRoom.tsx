import { useCallback, useEffect, useRef, useState } from "react";
import {
  LiveKitRoom,
  RoomAudioRenderer,
  VideoTrack,
  useLocalParticipant,
  useRemoteParticipants,
  useIsSpeaking,
  useTracks,
} from "@livekit/components-react";
import { Track, ScreenSharePresets, VideoPreset } from "livekit-client";
import type { TrackReference } from "@livekit/components-core";
import { useVoiceStore, type ScreenShareQuality } from "../store/voice.js";
import { useAuthStore } from "../store/auth.js";
import Avatar from "./Avatar.js";
import VoiceContextMenu from "./VoiceContextMenu.js";

const SCREEN_SHARE_PRESET_MAP: Record<ScreenShareQuality, VideoPreset> = {
  "360p": ScreenSharePresets.h360fps15,
  "720p": ScreenSharePresets.h720fps15,
  "720p60": ScreenSharePresets.h720fps30,
  "1080p": ScreenSharePresets.h1080fps15,
  "1080p60": new VideoPreset(1920, 1080, 8_000_000, 60),
  "1440p": new VideoPreset(2560, 1440, 12_000_000, 30),
  "1440p60": new VideoPreset(2560, 1440, 16_000_000, 60),
  "4k": new VideoPreset(3840, 2160, 20_000_000, 30),
  "4k60": new VideoPreset(3840, 2160, 30_000_000, 60),
};

interface VoiceRoomProps {
  channelId: string;
  channelName: string;
  serverId: string;
}

export default function VoiceRoom({ channelId, channelName, serverId }: VoiceRoomProps) {
  const {
    connectionState,
    currentChannelId,
    livekitToken,
    livekitUrl,
    isMuted,
    isDeafened,
    inputDeviceId,
    outputDeviceId,
    echoCancellation,
    noiseSuppression,
    joinVoice,
    leaveVoice,
    setConnectionState,
    participants,
  } = useVoiceStore();

  const isThisChannel = currentChannelId === channelId;
  const isConnected = isThisChannel && (connectionState === "connected" || connectionState === "connecting");

  // Debounce disconnects to handle React StrictMode double-mount.
  // StrictMode unmounts then remounts, causing a stale LiveKit disconnect
  // from the first instance. By delaying, we give the remounted instance
  // time to connect and cancel the pending leave.
  const disconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleConnected = useCallback(() => {
    if (disconnectTimerRef.current) {
      clearTimeout(disconnectTimerRef.current!);
      disconnectTimerRef.current = null;
    }
    setConnectionState("connected");
  }, [setConnectionState]);

  const handleDisconnected = useCallback(() => {
    disconnectTimerRef.current = setTimeout(() => {
      const { connectionState: cs } = useVoiceStore.getState();
      if (cs === "disconnected") return; // Already handled (explicit leave)
      leaveVoice();
    }, 2000);
  }, [leaveVoice]);

  // Clean up disconnect timer on unmount
  useEffect(() => {
    return () => {
      if (disconnectTimerRef.current) clearTimeout(disconnectTimerRef.current);
    };
  }, []);

  // Auto-disconnect voice when window/tab is closed or page is navigated away
  useEffect(() => {
    if (!isConnected) return;
    const handler = () => { leaveVoice(); };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isConnected, leaveVoice]);

  // If we have a token and URL, render LiveKitRoom
  if (livekitToken && livekitUrl && isConnected) {
    return (
      <div className="voice-room">
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
        >
          <RoomContent
            channelName={channelName}
            channelId={channelId!}
            serverId={serverId}
            isMuted={isMuted}
            isDeafened={isDeafened}
          />
          <RoomAudioRenderer />
        </LiveKitRoom>
      </div>
    );
  }

  // Not connected — show join prompt
  const channelParticipants = participants[channelId] ?? [];
  const isJoining = connectionState === "connecting" && isThisChannel;
  return (
    <div className="voice-room">
      <div className="voice-room-header">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" className="voice-room-icon">
          <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V5z" />
          <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
        </svg>
        <h2>{channelName}</h2>
      </div>
      <div className="voice-room-join-prompt">
        {channelParticipants.length > 0 && (
          <div className="voice-room-participants-preview">
            {channelParticipants.map((p) => (
              <div key={p.user_id} className="voice-participant-mini">
                <Avatar
                  avatarUrl={p.avatar_url}
                  name={p.display_name || p.username}
                  size={32}
                />
                <span>{p.display_name || p.username}</span>
              </div>
            ))}
          </div>
        )}
        <p className="voice-room-empty-text">
          {channelParticipants.length === 0
            ? "No one is in this voice channel yet."
            : `${channelParticipants.length} user${channelParticipants.length === 1 ? "" : "s"} in voice`}
        </p>
        <button
          className="btn-primary voice-join-btn"
          onClick={() => joinVoice(channelId)}
          disabled={isJoining}
        >
          {isJoining ? "Connecting..." : "Join Voice"}
        </button>
      </div>
    </div>
  );
}

// ─── Inner component (inside LiveKitRoom context) ───

interface RoomContentProps {
  channelName: string;
  channelId: string;
  serverId: string;
  isMuted: boolean;
  isDeafened: boolean;
}

function RoomContent({ channelName, channelId, serverId, isMuted, isDeafened }: RoomContentProps) {
  const { localParticipant } = useLocalParticipant();
  const remoteParticipants = useRemoteParticipants();
  const {
    toggleMute, toggleDeafen, leaveVoice, participants, userVolumes,
    screenSharePreset, setScreenSharePreset, isScreenSharing, setIsScreenSharing,
  } = useVoiceStore();
  const user = useAuthStore((s) => s.user);

  const [contextMenu, setContextMenu] = useState<{
    userId: string;
    serverMuted: boolean;
    serverDeafened: boolean;
    position: { x: number; y: number };
  } | null>(null);

  // Screen share tracks from all participants (filter out placeholders)
  const allScreenShareTracks = useTracks([Track.Source.ScreenShare]);
  const screenShareTracks = allScreenShareTracks.filter(
    (t): t is TrackReference => t.publication !== undefined,
  );
  const [focusedScreenIndex, setFocusedScreenIndex] = useState(0);
  const hasScreenShares = screenShareTracks.length > 0;

  // Clamp focused index when streams change
  useEffect(() => {
    if (focusedScreenIndex >= screenShareTracks.length) {
      setFocusedScreenIndex(Math.max(0, screenShareTracks.length - 1));
    }
  }, [screenShareTracks.length, focusedScreenIndex]);

  // Sync mute state to LiveKit
  useEffect(() => {
    localParticipant.setMicrophoneEnabled(!isMuted);
  }, [isMuted, localParticipant]);

  // Apply per-user volume to remote participants
  useEffect(() => {
    for (const rp of remoteParticipants) {
      const vol = userVolumes[rp.identity] ?? 100;
      rp.setVolume(vol / 100);
    }
  }, [remoteParticipants, userVolumes]);

  // Detect when screen share stops externally (browser "Stop sharing" button)
  useEffect(() => {
    const handleTrackUnpublished = () => {
      const hasSS = Array.from(localParticipant.trackPublications.values()).some(
        (p) => p.source === Track.Source.ScreenShare,
      );
      if (!hasSS) setIsScreenSharing(false);
    };
    localParticipant.on("localTrackUnpublished", handleTrackUnpublished);
    return () => {
      localParticipant.off("localTrackUnpublished", handleTrackUnpublished);
    };
  }, [localParticipant, setIsScreenSharing]);

  const channelParticipants = participants[channelId] ?? [];

  function handleContextMenu(
    e: React.MouseEvent,
    userId: string,
    serverMuted: boolean,
    serverDeafened: boolean,
  ) {
    e.preventDefault();
    setContextMenu({
      userId,
      serverMuted,
      serverDeafened,
      position: { x: e.clientX, y: e.clientY },
    });
  }

  async function toggleScreenShare() {
    if (!isScreenSharing) {
      try {
        const preset = SCREEN_SHARE_PRESET_MAP[screenSharePreset];
        await localParticipant.setScreenShareEnabled(true, {
          audio: true,
          contentHint: "detail",
          resolution: preset.resolution,
          surfaceSwitching: "include",
          systemAudio: "include",
        }, {
          screenShareEncoding: preset.encoding,
        });
        setIsScreenSharing(true);
      } catch {
        // User cancelled the browser picker
      }
    } else {
      await localParticipant.setScreenShareEnabled(false);
      setIsScreenSharing(false);
    }
  }

  // Find server mute/deafen state for local user
  const localParticipantData = channelParticipants.find((p) => p.user_id === user?.id);

  // Build participant tiles (reused in both layouts)
  const participantTiles = (
    <>
      <ParticipantTile
        identity={localParticipant.identity}
        userId={user?.id ?? ""}
        name={user?.display_name || user?.username || "You"}
        avatarUrl={user?.avatar_url ?? null}
        isMuted={isMuted}
        isLocal={true}
        serverMuted={localParticipantData?.server_muted ?? false}
        serverDeafened={localParticipantData?.server_deafened ?? false}
        isScreenSharing={isScreenSharing}
        onContextMenu={handleContextMenu}
      />
      {remoteParticipants.map((p) => {
        const pData = channelParticipants.find((cp) => cp.user_id === p.identity);
        const pIsScreenSharing = screenShareTracks.some(
          (t) => t.participant.identity === p.identity,
        );
        return (
          <ParticipantTile
            key={p.identity}
            identity={p.identity}
            userId={p.identity}
            name={p.name || p.identity}
            avatarUrl={pData?.avatar_url ?? null}
            isMuted={!p.isMicrophoneEnabled}
            isLocal={false}
            serverMuted={pData?.server_muted ?? false}
            serverDeafened={pData?.server_deafened ?? false}
            isScreenSharing={pIsScreenSharing}
            onContextMenu={handleContextMenu}
          />
        );
      })}
    </>
  );

  return (
    <>
      <div className="voice-room-header">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="var(--green)" className="voice-room-icon">
          <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V5z" />
          <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
        </svg>
        <h2>{channelName}</h2>
        <span className="voice-connected-badge">Connected</span>
      </div>

      {hasScreenShares ? (
        <div className="voice-room-with-screenshare">
          <ScreenShareView
            tracks={screenShareTracks}
            focusedIndex={focusedScreenIndex}
            onFocusChange={setFocusedScreenIndex}
          />
          <div className="voice-participant-strip">
            {participantTiles}
          </div>
        </div>
      ) : (
        <div className="voice-participant-grid">
          {participantTiles}
        </div>
      )}

      <div className="voice-controls">
        <button
          className={`voice-control-btn ${isMuted ? "active" : ""}`}
          onClick={toggleMute}
          title={isMuted ? "Unmute" : "Mute"}
        >
          {isMuted ? (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.55-.9l4.17 4.18L21 19.73 4.27 3z" />
            </svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V5z" />
              <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
            </svg>
          )}
        </button>
        <button
          className={`voice-control-btn ${isDeafened ? "active" : ""}`}
          onClick={toggleDeafen}
          title={isDeafened ? "Undeafen" : "Deafen"}
        >
          {isDeafened ? (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M3.63 3.63a.996.996 0 000 1.41L7.29 8.7 7 9H4c-.55 0-1 .45-1 1v4c0 .55.45 1 1 1h3l3.29 3.29c.63.63 1.71.18 1.71-.71v-4.17l4.18 4.18c-.49.37-1.02.68-1.6.91-.36.15-.58.53-.58.92 0 .72.73 1.18 1.39.91.8-.33 1.55-.77 2.22-1.31l1.34 1.34a.996.996 0 101.41-1.41L5.05 3.63c-.39-.39-1.02-.39-1.42 0zM19 12c0 .82-.15 1.61-.41 2.34l1.53 1.53c.56-1.17.88-2.48.88-3.87 0-3.83-2.4-7.11-5.78-8.4-.59-.23-1.22.23-1.22.86v.19c0 .38.25.71.61.85C17.18 6.54 19 9.06 19 12zm-8.71-6.29l-.17.17L12 7.76V6.41c0-.89-1.08-1.33-1.71-.7zM16.5 12A4.5 4.5 0 0014 7.97v1.79l2.48 2.48c.01-.08.02-.16.02-.24z" />
            </svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
            </svg>
          )}
        </button>

        {/* Screen Share */}
        <div className="voice-control-group">
          <button
            className={`voice-control-btn ${isScreenSharing ? "screen-sharing" : ""}`}
            onClick={toggleScreenShare}
            title={isScreenSharing ? "Stop Sharing" : "Share Screen"}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M20 18c1.1 0 1.99-.9 1.99-2L22 6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2H0v2h24v-2h-4zM4 6h16v10H4V6z" />
            </svg>
          </button>
          <select
            className="screen-share-quality-picker"
            value={screenSharePreset}
            onChange={(e) => setScreenSharePreset(e.target.value as ScreenShareQuality)}
            title="Screen share quality"
          >
            <option value="360p">360p</option>
            <option value="720p">720p</option>
            <option value="720p60">720p 60fps</option>
            <option value="1080p">1080p</option>
            <option value="1080p60">1080p 60fps</option>
            <option value="1440p">1440p</option>
            <option value="1440p60">1440p 60fps</option>
            <option value="4k">4K</option>
            <option value="4k60">4K 60fps</option>
          </select>
        </div>

        <button
          className="voice-control-btn voice-disconnect-btn"
          onClick={leaveVoice}
          title="Disconnect"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08c-.18-.17-.29-.42-.29-.7 0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28-.79-.74-1.69-1.36-2.67-1.85-.33-.16-.56-.5-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z" />
          </svg>
        </button>
      </div>

      {contextMenu && (
        <VoiceContextMenu
          userId={contextMenu.userId}
          channelId={channelId}
          serverId={serverId}
          serverMuted={contextMenu.serverMuted}
          serverDeafened={contextMenu.serverDeafened}
          position={contextMenu.position}
          onClose={() => setContextMenu(null)}
        />
      )}
    </>
  );
}

// ─── Screen Share View ───

interface ScreenShareViewProps {
  tracks: TrackReference[];
  focusedIndex: number;
  onFocusChange: (index: number) => void;
}

function ScreenShareView({ tracks, focusedIndex, onFocusChange }: ScreenShareViewProps) {
  const focused = tracks[focusedIndex];

  return (
    <div className="screen-share-view">
      <div className="screen-share-main">
        {focused && (
          <>
            <VideoTrack trackRef={focused} />
            <div className="screen-share-label">
              {focused.participant.name || focused.participant.identity}&apos;s screen
            </div>
          </>
        )}
      </div>
      {tracks.length > 1 && (
        <div className="screen-share-strip">
          {tracks.map((t, i) => (
            <button
              key={`${t.participant.identity}-${i}`}
              className={`screen-share-thumb ${i === focusedIndex ? "focused" : ""}`}
              onClick={() => onFocusChange(i)}
            >
              <VideoTrack trackRef={t} />
              <span>{t.participant.name || t.participant.identity}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Participant Tile ───

interface ParticipantTileProps {
  identity: string;
  userId: string;
  name: string;
  avatarUrl: string | null;
  isMuted: boolean;
  isLocal: boolean;
  serverMuted: boolean;
  serverDeafened: boolean;
  isScreenSharing: boolean;
  onContextMenu: (
    e: React.MouseEvent,
    userId: string,
    serverMuted: boolean,
    serverDeafened: boolean,
  ) => void;
}

function ParticipantTile({
  identity,
  userId,
  name,
  avatarUrl,
  isMuted,
  isLocal,
  serverMuted,
  serverDeafened,
  isScreenSharing,
  onContextMenu,
}: ParticipantTileProps) {
  return (
    <div
      className={`voice-participant ${isMuted ? "muted" : ""} ${serverMuted ? "server-muted" : ""} ${serverDeafened ? "server-deafened" : ""}`}
      onContextMenu={(e) => onContextMenu(e, userId, serverMuted, serverDeafened)}
    >
      <div className="voice-participant-avatar">
        <Avatar avatarUrl={avatarUrl} name={name} size={64} />
      </div>
      <div className="voice-participant-info">
        <span className="voice-participant-name">
          {name}
          {isLocal && <span className="voice-you-badge">(you)</span>}
        </span>
        <div className="voice-participant-icons">
          {isScreenSharing && (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="var(--green)" className="voice-mute-icon" aria-label="Screen Sharing">
              <path d="M20 18c1.1 0 1.99-.9 1.99-2L22 6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2H0v2h24v-2h-4zM4 6h16v10H4V6z" />
            </svg>
          )}
          {isMuted && (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="var(--red)" className="voice-mute-icon" aria-label="Muted">
              <path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.55-.9l4.17 4.18L21 19.73 4.27 3z" />
            </svg>
          )}
          {serverMuted && (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="var(--yellow)" className="voice-mute-icon" aria-label="Server Muted">
              <path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.55-.9l4.17 4.18L21 19.73 4.27 3z" />
            </svg>
          )}
          {serverDeafened && (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="var(--yellow)" className="voice-mute-icon" aria-label="Server Deafened">
              <path d="M3.63 3.63a.996.996 0 000 1.41L7.29 8.7 7 9H4c-.55 0-1 .45-1 1v4c0 .55.45 1 1 1h3l3.29 3.29c.63.63 1.71.18 1.71-.71v-4.17l4.18 4.18c-.49.37-1.02.68-1.6.91-.36.15-.58.53-.58.92 0 .72.73 1.18 1.39.91.8-.33 1.55-.77 2.22-1.31l1.34 1.34a.996.996 0 101.41-1.41L5.05 3.63c-.39-.39-1.02-.39-1.42 0zM19 12c0 .82-.15 1.61-.41 2.34l1.53 1.53c.56-1.17.88-2.48.88-3.87 0-3.83-2.4-7.11-5.78-8.4-.59-.23-1.22.23-1.22.86v.19c0 .38.25.71.61.85C17.18 6.54 19 9.06 19 12zm-8.71-6.29l-.17.17L12 7.76V6.41c0-.89-1.08-1.33-1.71-.7zM16.5 12A4.5 4.5 0 0014 7.97v1.79l2.48 2.48c.01-.08.02-.16.02-.24z" />
            </svg>
          )}
        </div>
      </div>
    </div>
  );
}
