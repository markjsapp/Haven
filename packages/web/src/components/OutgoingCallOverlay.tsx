import { useTranslation } from "react-i18next";
import { useVoiceStore } from "../store/voice.js";

export default function OutgoingCallOverlay() {
  const { t } = useTranslation();
  const outgoingCall = useVoiceStore((s) => s.outgoingCall);
  const endCall = useVoiceStore((s) => s.endCall);

  if (!outgoingCall) return null;

  return (
    <div className="outgoing-call-overlay" role="alertdialog" aria-label={t("dmCall.calling")}>
      <div className="outgoing-call-dialog">
        <div className="outgoing-call-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="var(--green)">
            <path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56a.977.977 0 00-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z" />
          </svg>
        </div>
        <p>{t("dmCall.calling")}</p>
        <button
          className="call-cancel-btn"
          onClick={() => endCall(outgoingCall.channelId)}
          aria-label={t("dmCall.cancel")}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08c-.18-.17-.29-.42-.29-.7 0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28-.79-.74-1.69-1.36-2.67-1.85-.33-.16-.56-.5-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z" />
          </svg>
          {t("dmCall.cancel")}
        </button>
      </div>
    </div>
  );
}
