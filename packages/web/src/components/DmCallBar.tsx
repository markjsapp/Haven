import { useEffect, useRef, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  VideoTrack,
  useLocalParticipant,
  useRemoteParticipants,
  useTracks,
} from "@livekit/components-react";
import { Track, ScreenSharePresets, VideoPreset } from "livekit-client";
import type { TrackReference } from "@livekit/components-core";
import { useVoiceStore, type ScreenShareQuality } from "../store/voice.js";
import { useAuthStore } from "../store/auth.js";
import Avatar from "./Avatar.js";

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

const MIN_HEIGHT = 100;
const MAX_HEIGHT = 600;
const DEFAULT_HEIGHT = 200;

interface DmCallBarProps {
  channelId: string;
  channelName: string;
}

export default function DmCallBar({ channelId, channelName }: DmCallBarProps) {
  const { connectionState, currentChannelId, activeCallChannelId } = useVoiceStore();
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const barRef = useRef<HTMLDivElement>(null);

  const isThisChannel = currentChannelId === channelId;
  const isConnected = isThisChannel && connectionState === "connected";
  const isActiveCall = activeCallChannelId === channelId;

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = barRef.current?.offsetHeight ?? height;

    const handleMove = (ev: MouseEvent) => {
      const newHeight = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, startHeight + (ev.clientY - startY)));
      setHeight(newHeight);
    };
    const handleUp = () => {
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseup", handleUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseup", handleUp);
  }, [height]);

  if (!isConnected || !isActiveCall) return null;

  return (
    <div className="dm-call-bar" ref={barRef} style={{ height }}>
      <div className="dm-call-bar-inner">
        <DmCallBarContent channelId={channelId} channelName={channelName} height={height} />
      </div>
      <div
        className="dm-call-resize-handle"
        role="separator"
        aria-orientation="horizontal"
        onMouseDown={handleResizeStart}
      />
    </div>
  );
}

function DmCallBarContent({ channelId, channelName, height }: DmCallBarProps & { height: number }) {
  const { t } = useTranslation();
  const { localParticipant } = useLocalParticipant();
  const remoteParticipants = useRemoteParticipants();
  const {
    isMuted, isDeafened, toggleMute, toggleDeafen, endCall,
    userVolumes, screenSharePreset, setScreenSharePreset,
    isScreenSharing, setIsScreenSharing,
  } = useVoiceStore();
  const user = useAuthStore((s) => s.user);

  // Screen share tracks
  const allScreenShareTracks = useTracks([Track.Source.ScreenShare]);
  const screenShareTracks = allScreenShareTracks.filter(
    (t): t is TrackReference => t.publication !== undefined,
  );
  const hasScreenShares = screenShareTracks.length > 0;

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

  // Detect when screen share stops externally
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

  // Scale avatar and font sizes based on container height
  const avatarSize = Math.max(32, Math.min(80, Math.round(height * 0.25)));
  const nameFontSize = Math.max(0.7, Math.min(1.1, height / 200));

  return (
    <>
      <div className="dm-call-bar-header">
        <div className="dm-call-bar-status">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56a.977.977 0 00-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z" />
          </svg>
          <span>{t("dmCall.connected")} — {channelName}</span>
        </div>
      </div>

      {hasScreenShares && (
        <div className="dm-call-screenshare">
          <VideoTrack trackRef={screenShareTracks[0]} />
        </div>
      )}

      <div className="dm-call-participants">
        {/* Local participant */}
        <div className="dm-call-participant">
          <Avatar
            avatarUrl={user?.avatar_url ?? null}
            name={user?.display_name || user?.username || "You"}
            size={avatarSize}
          />
          <span className="dm-call-participant-name" style={{ fontSize: `${nameFontSize}rem` }}>
            {user?.display_name || user?.username}
          </span>
        </div>
        {/* Remote participants */}
        {remoteParticipants.map((p) => (
          <div key={p.identity} className="dm-call-participant">
            <Avatar avatarUrl={null} name={p.name || p.identity} size={avatarSize} />
            <span className="dm-call-participant-name" style={{ fontSize: `${nameFontSize}rem` }}>{p.name || p.identity}</span>
          </div>
        ))}
      </div>

      <div className="dm-call-controls">
        <button
          className={`voice-control-btn ${isMuted ? "active" : ""}`}
          onClick={toggleMute}
          title={isMuted ? t("voiceRoom.unmute") : t("voiceRoom.mute")}
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
          title={isDeafened ? t("voiceRoom.undeafen") : t("voiceRoom.deafen")}
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

        <div className="voice-control-group">
          <button
            className={`voice-control-btn ${isScreenSharing ? "screen-sharing" : ""}`}
            onClick={toggleScreenShare}
            title={isScreenSharing ? t("voiceRoom.stopSharing") : t("voiceRoom.shareScreen")}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M20 18c1.1 0 1.99-.9 1.99-2L22 6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2H0v2h24v-2h-4zM4 6h16v10H4V6z" />
            </svg>
          </button>
          <select
            className="screen-share-quality-picker"
            value={screenSharePreset}
            onChange={(e) => setScreenSharePreset(e.target.value as ScreenShareQuality)}
            title={t("voiceRoom.screenShareQuality")}
          >
            <option value="360p">{t("voiceRoom.quality360p")}</option>
            <option value="720p">{t("voiceRoom.quality720p")}</option>
            <option value="720p60">{t("voiceRoom.quality720p60")}</option>
            <option value="1080p">{t("voiceRoom.quality1080p")}</option>
            <option value="1080p60">{t("voiceRoom.quality1080p60")}</option>
            <option value="1440p">{t("voiceRoom.quality1440p")}</option>
            <option value="1440p60">{t("voiceRoom.quality1440p60")}</option>
            <option value="4k">{t("voiceRoom.quality4k")}</option>
            <option value="4k60">{t("voiceRoom.quality4k60")}</option>
          </select>
        </div>

        <button
          className="voice-control-btn voice-disconnect-btn"
          onClick={() => endCall(channelId)}
          title={t("dmCall.endCall")}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08c-.18-.17-.29-.42-.29-.7 0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28-.79-.74-1.69-1.36-2.67-1.85-.33-.16-.56-.5-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z" />
          </svg>
        </button>
      </div>
    </>
  );
}
