# Haven

A privacy-first, end-to-end encrypted chat platform. 

## What is Haven?

Haven is a full-featured chat application — servers, channels, DMs, friends, roles, voice, file sharing — with one fundamental difference: **all message content is encrypted client-side before it ever touches the server**. The backend is an intentional "dumb relay" for encrypted blobs. It handles routing, auth, and access control, but has zero knowledge of what you're saying.

### What the server can see
- Encrypted blobs (messages, metadata, attachments)
- Public cryptographic keys (for key exchange)
- Routing data (channel IDs, ephemeral sender tokens, timestamps)

### What the server cannot see
- Message content (Double Ratchet / Sender Keys encryption)
- Sender identity within channels (sealed sender tokens)
- Server/channel names (encrypted metadata)
- File contents or types (client-side encryption with padded sizes)
- Email addresses (hashed before storage)

## Features

**Communication** — Servers with text and voice channels, 1-on-1 and group DMs, friend requests, typing indicators, online presence, link previews, @mentions, message pinning, emoji reactions, big emoji rendering

**Media** — Encrypted file attachments with inline image/video/audio previews, image lightbox viewer, embedded audio player with seek and volume controls, video playback with MIME normalization, spoiler overlays for sensitive content, drag-and-drop uploads with progress tracking, thumbnail previews during loading

**Organization** — Channel categories with drag-and-drop, server folders for grouping servers, Discord-style roles and permissions (bitfield with channel overwrites), shareable invite codes, server management, audit logs

**Security** — X3DH + Double Ratchet for DMs (Signal Protocol), Sender Keys for group channels, encrypted file attachments, encrypted key backup (Argon2id KDF), Argon2id password hashing, JWT + rotating refresh tokens, optional TOTP 2FA, proof-of-work registration gate

**Voice** — LiveKit-powered voice channels with screen sharing (360p–4K quality presets), per-user volume control (0–200%), server mute/deafen, right-click context menu on participants

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Rust, axum 0.7, Tokio |
| Database | PostgreSQL 16 (sqlx 0.7) |
| Cache / Pub-Sub | Redis 7 |
| Frontend | React 19, Vite 6, Zustand 5 |
| Shared Library | TypeScript (crypto, API client, types) |
| Crypto | libsodium (X25519, Ed25519, XChaCha20-Poly1305) |
| Voice | LiveKit (self-hosted) |
| Storage | Local filesystem with AES-256-GCM at rest |

## Project Structure

```
Haven/
├── src/                        # Rust backend — see src/README.md
│   ├── api/                    # REST endpoint handlers
│   ├── db/                     # Database queries
│   └── middleware/              # Auth extractors, rate limiting
├── packages/
│   ├── haven-core/             # Shared TS library — see packages/haven-core/README.md
│   └── web/                    # React frontend — see packages/web/README.md
├── migrations/                 # PostgreSQL schema migrations
├── tests/                      # Rust integration tests (126 tests)
├── docs/                       # Guides and research
└── docker-compose.yml          # Local dev infrastructure
```

## Quick Start

### Prerequisites
- Rust 1.77+
- Node.js 20+
- Docker & Docker Compose

### 1. Start infrastructure
```bash
docker compose up -d    # PostgreSQL + Redis
```

### 2. Configure environment
```bash
cp .env.example .env
# Defaults work for local development
```

### 3. Run the backend
```bash
cargo run
# Server starts on http://localhost:8080
```

### 4. Run the frontend
```bash
cd packages/haven-core && npm install && npm run build
cd ../web && npm install && npm run dev
# Frontend starts on http://localhost:5173
```

### 5. Verify
```bash
curl http://localhost:8080/health   # → "ok"
```

The first user to register is automatically promoted to instance admin.

## Testing

```bash
# Rust backend
cargo test

# haven-core — 78 tests
cd packages/haven-core && npx vitest run

# Web frontend — 53 tests
cd packages/web && npx vitest run
```

Docker must be running for Rust integration tests (they need PostgreSQL + Redis).

## Deployment

See [docs/deployment.md](docs/deployment.md) for the full production deployment guide, covering:
- Hetzner Cloud VPS setup (Debian 12, ~8/mo)
- Docker Compose production stack (Caddy + Haven + PostgreSQL + Redis + LiveKit)
- Auto-TLS via Let's Encrypt
- Invite-only registration for beta
- Backup strategies

See [docs/contributing.md](docs/contributing.md) for the development workflow and how to push updates.

## API Overview

All routes are under `/api/v1/`. The WebSocket endpoint is at `/api/v1/ws?token=<JWT>`.

| Area | Endpoints | Description |
|------|-----------|-------------|
| Auth | `/auth/register`, `/auth/login`, `/auth/refresh` | Registration with PoW, JWT auth, TOTP 2FA |
| Keys | `/users/:id/keys`, `/keys/prekeys`, `/keys/backup` | X3DH key bundles, prekey management, encrypted backup |
| Servers | `/servers`, `/servers/:id/channels` | CRUD servers and channels |
| Messages | `/channels/:id/messages` | Send/receive encrypted messages |
| Sender Keys | `/channels/:id/sender-keys` | Group E2EE key distribution |
| Roles | `/servers/:id/roles`, `/channels/:id/overwrites` | Permission management |
| Friends | `/friends`, `/dm` | Friend requests, DMs, privacy settings |
| Invites | `/servers/:id/invites`, `/invites/:code/join` | Server invite codes |
| Voice | `/voice/:id/join` | LiveKit voice channel tokens |
| Attachments | `/attachments/upload`, `/attachments/:id` | Encrypted file upload/download |
| Admin | `/admin/stats`, `/admin/users` | Instance administration |
| Registration Invites | `/registration-invites`, `/auth/invite-required` | Beta invite system |

## License

All rights reserved.
