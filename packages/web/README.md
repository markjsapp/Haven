# Haven Web Frontend

React single-page application built with Vite, Zustand, and vanilla CSS.

## Structure

```
src/
├── main.tsx                # App entry point, router setup
├── App.tsx                 # Root component with route definitions
├── pages/
│   ├── Chat.tsx            # Main chat layout (sidebar + channel + messages)
│   ├── Login.tsx           # Login page
│   ├── Register.tsx        # Registration page (with invite code support)
│   └── ...
├── components/
│   ├── ServerBar.tsx            # Left server navigation (drag-and-drop folders)
│   ├── ChannelSidebar.tsx       # Channel list with categories
│   ├── MessageList.tsx          # Message display with virtual scrolling
│   ├── MessageInput.tsx         # TipTap rich text editor with file upload
│   ├── MessageAttachments.tsx   # Inline image/video/audio previews, spoiler overlays
│   ├── ImageLightbox.tsx        # Full-screen image viewer
│   ├── FriendsList.tsx          # Friends panel (list, requests, blocked)
│   ├── VoiceRoom.tsx            # Voice channel UI with screen sharing
│   ├── VoiceChannelPreview.tsx  # Sidebar voice participant list
│   ├── VoiceContextMenu.tsx     # Right-click voice user menu (volume, mute)
│   ├── UserContextMenu.tsx      # Right-click user menu
│   ├── EmojiPicker.tsx          # Emoji picker with categories and search
│   ├── LinkPreviewCard.tsx      # OpenGraph link previews and inline embeds
│   ├── ProfilePopup.tsx         # User profile popup (@mention clicks)
│   └── ...                      # ~40 components total
├── store/
│   ├── auth.ts             # Authentication, key management, registration
│   ├── chat.ts             # Servers, channels, messages, WebSocket
│   ├── friends.ts          # Friends list, requests, DM management
│   ├── presence.ts         # Online/offline status tracking
│   ├── voice.ts            # Voice channel state
│   └── ui.ts               # UI state (modals, sidebars, themes)
├── lib/
│   ├── crypto.ts           # Client-side E2EE — session cache, encrypt/decrypt
│   ├── message-cache.ts    # localStorage message cache (survives reloads)
│   ├── draft-store.ts      # localStorage draft saving
│   ├── notifications.ts    # Browser notification permissions and dispatch
│   ├── backup.ts           # Key backup utilities (security phrase flow)
│   └── serverUrl.ts        # Server URL configuration
├── hooks/                  # Custom React hooks
└── styles/
    └── index.css           # All styles (vanilla CSS, CSS variables for theming)
```

## Key Patterns

**Zustand stores**: All state management uses Zustand. Stores are in `src/store/` and provide both state and actions. Components subscribe to slices with selectors to minimize re-renders.

**E2EE flow**: `lib/crypto.ts` manages the client-side encryption layer. It caches Double Ratchet sessions and Sender Keys in memory. When a message arrives, the chat store calls crypto functions to decrypt before rendering.

**Rich text**: The message input uses TipTap with custom extensions for @mentions, spoilers, underline, subtext, and masked links.

**Media attachments**: Files are encrypted client-side (XChaCha20-Poly1305) before upload. Images render with thumbnail previews during loading, videos play inline with MIME normalization, and audio files get an embedded player with play/pause, seekable progress bar, and volume control. Spoiler overlays are supported for images and videos.

**Voice**: LiveKit-powered voice channels with screen sharing, per-user volume (0–200%), server mute/deafen, and right-click context menus on participants (both in the voice room and the channel sidebar).

**Theming**: CSS variables in `styles/index.css` power the theme system. Theme selection is persisted in localStorage.

## Development

```bash
# Install dependencies (assumes haven-core is already built)
npm install

# Start dev server with hot reload
npm run dev
# Frontend on http://localhost:5173, proxies API to http://localhost:8080

# Type check
npx tsc --noEmit

# Run tests
npx vitest run    # 53 tests
```

**Important**: If you change anything in `packages/haven-core/`, you must rebuild it before the web frontend will pick up the changes:

```bash
cd ../haven-core && npm run build
```
