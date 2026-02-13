# Haven

A privacy-first, end-to-end encrypted communication platform that cannot read your messages.

## What is Haven?

Haven is a full-stack chat application with servers, channels, direct messages, friends, roles, and permissions. All message content is encrypted client-side before it ever reaches the server. The backend is an intentional **"dumb relay"** for encrypted data — it handles routing, authentication, and access control, but cannot read message content, group names, or file contents.

## Project Structure

```
Haven/
├── src/                    # Rust backend (axum, sqlx, PostgreSQL, Redis)
├── packages/
│   ├── haven-core/         # Shared TypeScript library (crypto, API client, types)
│   └── web/                # React frontend (Vite, Zustand, vanilla CSS)
├── migrations/             # PostgreSQL schema migrations
├── tests/                  # Rust integration tests
└── docs/                   # Documentation
```

## Features

### Communication
- **Servers & Channels** — create servers with text channels, organized into categories
- **Direct Messages** — 1-on-1 and group DMs with request/accept flow
- **Friends System** — send/accept/decline friend requests, mutual auto-accept
- **Real-time** — WebSocket-based messaging with typing indicators and presence
- **Rich Embeds** — link previews with YouTube, Spotify, Tenor, Giphy, and Imgur embeds
- **Big Emoji** — jumbo rendering for emoji-only messages (up to 10 emoji)
- **@Mentions** — mention users in messages with autocomplete, mention-aware notification badges
- **Message Pinning** — pin messages with clickable system message links

### Organization
- **Channel Categories** — group channels into collapsible categories with drag-and-drop reordering
- **Roles & Permissions** — Discord-style role system with bitfield permissions and channel overwrites
- **Channel Mute & Notifications** — per-channel mute with timed durations and notification overrides
- **Invites** — shareable invite codes with optional expiry and usage limits
- **Server Management** — leave or delete servers with confirmation dialogs

### Security
- **End-to-End Encryption** — messages encrypted with Double Ratchet (Signal Protocol)
- **Sealed Sender** — only the recipient can see who sent a message
- **Zero-Knowledge Server** — server stores only encrypted blobs and public keys
- **Encrypted Key Backup** — sync E2EE keys across devices with a security phrase (Argon2id KDF + XSalsa20-Poly1305)
- **Argon2id** password hashing, JWT auth with rotating refresh tokens, optional TOTP 2FA
- **Encrypted Attachments** — files encrypted client-side, stored as opaque blobs

### What the server stores
- Encrypted blobs (messages, metadata, attachments)
- Public cryptographic keys (for X3DH key exchange)
- Routing data (channel IDs, ephemeral sender tokens, timestamps)

### What the server CANNOT see
- Message content (E2EE with Double Ratchet)
- Sender identity (sealed sender)
- Group names or membership lists (encrypted with group key)
- File contents or types (client-side encryption, padded sizes)
- Email addresses (hashed before storage)

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Rust, axum 0.7, Tokio |
| Database | PostgreSQL 16 (via sqlx with compile-time checks) |
| Cache / Pub-Sub | Redis 7 |
| Frontend | React 19, Vite 6, Zustand 5 |
| Shared Library | TypeScript (crypto primitives, API client, types) |
| Auth | Argon2id + JWT + optional TOTP 2FA |
| Real-time | WebSockets (axum built-in) |
| Crypto | libsodium (X25519, Ed25519, XChaCha20-Poly1305) |
| Storage | Local filesystem with AES-256-GCM encryption at rest |

## Quick Start

### Prerequisites
- Rust 1.77+
- Node.js 20+
- Docker & Docker Compose

### 1. Start infrastructure
```bash
docker compose up -d
```
Starts PostgreSQL and Redis.

### 2. Configure environment
```bash
cp .env.example .env
# Edit .env if needed (defaults work for local dev)
```

### 3. Run the backend
```bash
cargo run
```
The server starts on `http://localhost:8080`.

### 4. Run the frontend
```bash
cd packages/haven-core && npm install && npm run build
cd ../web && npm install && npm run dev
```
The frontend starts on `http://localhost:5173` and proxies API requests to the backend.

### 5. Verify
```bash
curl http://localhost:8080/health
# → "ok"
```

## Testing

Haven has **92 automated tests** across the full stack. See [docs/testing.md](docs/testing.md) for details.

```bash
# Rust (22 unit + 24 integration)
DATABASE_URL="postgres://haven:haven_secret@127.0.0.1:5432/haven" cargo test

# haven-core (21 API client tests)
cd packages/haven-core && npm test

# Web frontend (25 store tests)
cd packages/web && npm test
```

## API Overview

### Auth
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/auth/register` | Register with username + crypto keys |
| POST | `/api/v1/auth/login` | Login, returns JWT |
| POST | `/api/v1/auth/refresh` | Refresh access token |
| POST | `/api/v1/auth/logout` | Revoke refresh tokens |
| POST | `/api/v1/auth/totp/setup` | Enable 2FA |
| POST | `/api/v1/auth/totp/verify` | Verify TOTP code |
| DELETE | `/api/v1/auth/totp` | Disable 2FA |

### Key Management
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/users/:id/keys` | Fetch key bundle for E2EE session |
| PUT | `/api/v1/keys/identity` | Update identity + signed prekey |
| POST | `/api/v1/keys/prekeys` | Upload one-time prekeys |
| GET | `/api/v1/keys/prekeys/count` | Check remaining prekeys |
| PUT | `/api/v1/keys/backup` | Upload encrypted key backup |
| GET | `/api/v1/keys/backup` | Download encrypted key backup |
| GET | `/api/v1/keys/backup/status` | Check if backup exists |
| DELETE | `/api/v1/keys/backup` | Delete key backup |

### Servers & Channels
| Method | Path | Description |
|--------|------|-------------|
| GET/POST | `/api/v1/servers` | List / create servers |
| GET | `/api/v1/servers/:id` | Get server details |
| DELETE | `/api/v1/servers/:id` | Delete server (owner only) |
| POST | `/api/v1/servers/:id/leave` | Leave server |
| GET/POST | `/api/v1/servers/:id/channels` | List / create channels |
| PUT/DELETE | `/api/v1/channels/:id` | Update / delete channel |
| GET/POST | `/api/v1/servers/:id/categories` | List / create categories |
| PUT | `/api/v1/channels/:id/category` | Assign channel to category |

### Messages & Attachments
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/channels/:id/messages` | Paginated message history |
| POST | `/api/v1/channels/:id/messages` | Send message |
| POST | `/api/v1/attachments/upload` | Upload encrypted file |
| GET | `/api/v1/attachments/:id` | Download encrypted file |

### Roles & Permissions
| Method | Path | Description |
|--------|------|-------------|
| GET/POST | `/api/v1/servers/:id/roles` | List / create roles |
| PUT/DELETE | `/api/v1/servers/:id/roles/:rid` | Update / delete role |
| PUT | `/api/v1/servers/:id/members/:uid/roles` | Assign role |
| GET/PUT | `/api/v1/channels/:id/overwrites` | Channel permission overwrites |

### Friends & DMs
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/friends` | List friends |
| POST | `/api/v1/friends/request` | Send friend request |
| POST | `/api/v1/friends/:id/accept` | Accept friend request |
| GET/POST | `/api/v1/dm` | List / create DM channels |
| PUT | `/api/v1/users/dm-privacy` | Set DM privacy |

### Invites
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/servers/:id/invites` | Create invite |
| POST | `/api/v1/invites/:code/join` | Join server via invite code |

### User Profiles & Presence
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/users/:id/profile` | Get user profile |
| PUT | `/api/v1/users/profile` | Update own profile (bio, banner) |
| GET | `/api/v1/users/search` | Search users by username |
| POST/DELETE | `/api/v1/users/:id/block` | Block / unblock user |
| GET | `/api/v1/presence` | Bulk presence check by user IDs |

### WebSocket
| Path | Description |
|------|-------------|
| `GET /api/v1/ws?token=<JWT>` | Real-time messaging connection |

#### Client → Server
```json
{ "type": "SendMessage", "payload": { "channel_id": "...", "sender_token": "...", "encrypted_body": "..." } }
{ "type": "Subscribe", "payload": { "channel_id": "..." } }
{ "type": "Unsubscribe", "payload": { "channel_id": "..." } }
{ "type": "Typing", "payload": { "channel_id": "..." } }
{ "type": "Ping" }
```

#### Server → Client
```json
{ "type": "NewMessage", "payload": { "id": "...", "channel_id": "...", ... } }
{ "type": "UserTyping", "payload": { "channel_id": "...", "ephemeral_token": "..." } }
{ "type": "MessageAck", "payload": { "message_id": "..." } }
{ "type": "Subscribed", "payload": { "channel_id": "..." } }
{ "type": "Error", "payload": { "message": "..." } }
{ "type": "Pong" }
```

## Security Notes

- All passwords hashed with Argon2id (memory-hard, side-channel resistant)
- JWT tokens with short expiry + rotating refresh tokens
- Prekeys consumed atomically (prevents race conditions in key exchange)
- Expired messages purged automatically by background worker
- No plaintext PII stored (email is SHA-256 hashed)
- All file uploads treated as opaque encrypted blobs
- Size bucketing prevents file-type inference from attachment size
- Discord-style bitfield permissions with channel-level overwrites
- Encrypted key backup uses Argon2id KDF + XSalsa20-Poly1305 — server stores opaque blob, zero knowledge of key material
