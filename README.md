# Haven Backend

Privacy-first communication platform backend built with Rust.

## Architecture

The server is intentionally a **"dumb relay"** for encrypted data. It cannot read message content, group names, or file contents. All encryption and decryption happens on the client.

### What the server stores
- Encrypted blobs (messages, metadata, attachments)
- Public cryptographic keys (for X3DH key exchange)
- Routing data (channel IDs, ephemeral sender tokens, timestamps)

### What the server CANNOT see
- Message content (E2EE with Double Ratchet)
- Sender identity (sealed sender — only the recipient can see who sent a message)
- Group names or membership lists (encrypted with group key)
- File contents or types (client-side encryption, padded sizes)
- Email addresses (hashed before storage)

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Language | Rust |
| Web Framework | axum (Tokio-based) |
| Database | PostgreSQL (via sqlx with compile-time checks) |
| Cache / Pub-Sub | Redis |
| Object Storage | MinIO (S3-compatible) |
| Auth | Argon2id + JWT + optional TOTP 2FA |
| Real-time | WebSockets (axum built-in) |

## Quick Start

### Prerequisites
- Rust 1.77+
- Docker & Docker Compose

### 1. Start infrastructure
```bash
docker compose up -d
```

This starts PostgreSQL, Redis, and MinIO.

### 2. Configure environment
```bash
cp .env.example .env
# Edit .env if needed (defaults work for local dev)
```

### 3. Run the server
```bash
cargo run
```

The server starts on `http://localhost:8080`.

### 4. Verify
```bash
curl http://localhost:8080/health
# → "ok"
```

## API Endpoints

### Auth (no token required)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/auth/register` | Register with username + crypto keys |
| POST | `/api/v1/auth/login` | Login, returns JWT |
| POST | `/api/v1/auth/refresh` | Refresh access token |

### Auth (token required)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/auth/logout` | Revoke all refresh tokens |
| POST | `/api/v1/auth/totp/setup` | Enable 2FA |
| POST | `/api/v1/auth/totp/verify` | Verify TOTP code |
| DELETE | `/api/v1/auth/totp` | Disable 2FA |

### Key Management
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/users/:id/keys` | Fetch key bundle for E2EE session |
| POST | `/api/v1/keys/prekeys` | Upload one-time prekeys |
| GET | `/api/v1/keys/prekeys/count` | Check remaining prekeys |

### Servers & Channels
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/servers` | List user's servers |
| POST | `/api/v1/servers` | Create a server |
| GET | `/api/v1/servers/:id` | Get server details |
| GET | `/api/v1/servers/:id/channels` | List server channels |
| POST | `/api/v1/servers/:id/channels` | Create a channel |
| POST | `/api/v1/channels/:id/join` | Join a channel |
| POST | `/api/v1/dm` | Create a DM channel |

### Messages
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/channels/:id/messages` | Paginated message history |
| POST | `/api/v1/channels/:id/messages` | Send message (REST fallback) |

### Attachments
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/attachments/upload` | Get presigned upload URL |
| GET | `/api/v1/attachments/:id` | Get presigned download URL |

### WebSocket
| Path | Description |
|------|-------------|
| `GET /api/v1/ws?token=<JWT>` | Real-time messaging connection |

#### WebSocket Message Types (Client → Server)
```json
{ "type": "SendMessage", "payload": { "channel_id": "...", "sender_token": "...", "encrypted_body": "..." } }
{ "type": "Subscribe", "payload": { "channel_id": "..." } }
{ "type": "Unsubscribe", "payload": { "channel_id": "..." } }
{ "type": "Typing", "payload": { "channel_id": "..." } }
{ "type": "Ping" }
```

#### WebSocket Message Types (Server → Client)
```json
{ "type": "NewMessage", "payload": { "id": "...", "channel_id": "...", ... } }
{ "type": "UserTyping", "payload": { "channel_id": "...", "ephemeral_token": "..." } }
{ "type": "MessageAck", "payload": { "message_id": "..." } }
{ "type": "Subscribed", "payload": { "channel_id": "..." } }
{ "type": "Error", "payload": { "message": "..." } }
{ "type": "Pong" }
```

## Production Deployment

```bash
# Build the Docker image
docker build -t haven-backend .

# Run with production env vars
docker run -p 8080:8080 \
  -e DATABASE_URL=postgres://... \
  -e REDIS_URL=redis://... \
  -e JWT_SECRET=$(openssl rand -hex 32) \
  haven-backend
```

## Security Notes

- All passwords hashed with Argon2id (memory-hard, side-channel resistant)
- JWT tokens with short expiry + rotating refresh tokens
- Prekeys consumed atomically (prevents race conditions in key exchange)
- Expired messages purged automatically by background worker
- No plaintext PII stored (email is SHA-256 hashed)
- All file uploads treated as opaque encrypted blobs
- Size bucketing prevents file-type inference from attachment size