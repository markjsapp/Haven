# Haven — Project Guide

## What Is This?

Haven is an end-to-end encrypted (E2EE) chat platform a privacy-focused gaming chat alternative. All message content is encrypted client-side; the server stores only encrypted blobs and never sees plaintext.

## Golden Rules

- **Route params use `:param`** syntax (NOT `{param}`). axum 0.7.9 uses matchit 0.7.3 which only supports colon syntax. `{param}` silently registers as a literal string and returns 404.
- **Rebuild haven-core** (`cd packages/haven-core && npm run build`) before the web frontend can pick up changes — web imports from `dist/`.
- **Never commit secrets** — `.env.*` files (except `.env.example`), private keys, API tokens.
- **All UI strings must use i18n** — use `t("key")` via react-i18next. Translations live in `packages/web/src/i18n/en.json`.
- **Migrations are append-only** — NEVER edit, delete, rename, or reorder an existing migration file. sqlx checksums every migration; a mismatch causes the server to panic on startup. Schema changes always go in a new file.

## Architecture

```
Haven/
├── src/                        # Rust backend (axum 0.7.9, sqlx 0.7, PostgreSQL, Redis)
│   ├── main.rs                 # Server entrypoint
│   ├── lib.rs                  # Router builder, AppState, re-exports
│   ├── config.rs               # AppConfig (env vars)
│   ├── models.rs               # All request/response structs, WS message types
│   ├── errors.rs               # AppError enum, AppResult type alias
│   ├── permissions.rs          # Bitfield permission constants + computation
│   ├── middleware.rs            # AuthUser JWT extractor
│   ├── ws.rs                   # WebSocket handler + message dispatch
│   ├── db/queries.rs           # All SQL queries (sqlx)
│   └── api/                    # REST endpoint handlers
│       ├── auth_routes.rs      # register, login, refresh, logout, password, totp
│       ├── servers.rs          # CRUD servers
│       ├── channels.rs         # CRUD channels, DMs, group DMs, join/leave
│       ├── messages.rs         # send, get, pins, pin-ids, reactions
│       ├── sender_keys.rs      # Sender key distribution (group E2EE)
│       ├── invites.rs          # create/list/delete invites, join, members, kick
│       ├── roles.rs            # CRUD roles, assign/unassign, overwrites
│       ├── categories.rs       # CRUD categories, reorder, assign channel
│       ├── friends.rs          # friend requests, DM requests, DM privacy
│       ├── users.rs            # profiles, search, avatar, block/unblock
│       ├── keys.rs             # key bundles, prekeys, identity key updates
│       ├── bans.rs             # ban/revoke/list
│       ├── reports.rs          # content reporting
│       ├── presence.rs         # bulk presence via Redis
│       ├── attachments.rs      # encrypted file upload/download
│       └── link_preview.rs     # OpenGraph link previews
├── migrations/                 # PostgreSQL migrations (sequential timestamps)
├── tests/
│   ├── common/mod.rs           # TestApp helper — builds router, provides request helpers
│   └── api_tests.rs            # Integration tests (#[sqlx::test])
├── packages/
│   ├── haven-core/             # Shared TypeScript library (crypto + networking)
│   │   └── src/
│   │       ├── types.ts        # All shared TypeScript types
│   │       ├── crypto/         # E2EE: X3DH, Double Ratchet, Sender Keys, file encryption
│   │       ├── net/api.ts      # HavenApi REST client
│   │       └── net/ws.ts       # HavenWs WebSocket client
│   └── web/                    # React frontend (Vite + Zustand + TipTap)
│       └── src/
│           ├── pages/Chat.tsx  # Main chat page layout
│           ├── store/          # Zustand stores: auth, chat, friends, presence, ui
│           ├── components/     # ~35 React components
│           ├── lib/            # Utilities: crypto.ts, draft-store.ts, message-cache.ts, tiptap extensions
│           ├── i18n/           # i18next config + en.json translations
│           └── styles/index.css
└── docker-compose.yml          # PostgreSQL + Redis (dev)
```

## E2EE Model

- **DMs**: X3DH key agreement → Double Ratchet session (type bytes 0x01 initial, 0x02 follow-up)
- **Server channels**: Sender Keys protocol (type byte 0x03)
  - Each user generates a sender key per channel
  - SKDM (Sender Key Distribution Message) encrypted to each member's identity key via `crypto_box_seal`
  - SKDMs are stored in DB and re-fetchable (NOT consumed on read)
  - Wire format: `[0x03][distId:16][chainIdx:4 LE][nonce:24][ciphertext+tag]`
- **Files**: XChaCha20-Poly1305 client-side encryption, key/nonce embedded in message payload
- Client-side key caches are in-memory only (`packages/web/src/lib/crypto.ts`)

## Database

- PostgreSQL via sqlx 0.7 with compile-time query checking
- Migrations in `migrations/` — named `YYYYMMDD000001_description.sql`
- Redis for presence, rate limiting, refresh tokens
- Integration tests use `#[sqlx::test(migrations = "./migrations")]` — each test gets a fresh DB
- **Production data persists across deploys** — Docker named volumes (`postgres_data`, `redis_data`, `haven_data`) survive container recreation. `deploy.sh` only recreates the Haven container; PostgreSQL/Redis stay running.

### Migration Safety (production data preservation)

Migrations run automatically on server startup via `sqlx::migrate!()`. sqlx tracks applied migrations by checksum in a `_sqlx_migrations` table and only runs new ones.

**NEVER do in a migration:**
- `DROP TABLE` / `TRUNCATE` — destroys production data
- `DROP COLUMN` without first deploying code that stops using it (two-phase approach)
- `ALTER COLUMN ... TYPE` that narrows a type (e.g. `TEXT` → `VARCHAR(50)`)

**NEVER do to existing migration files:**
- Edit content — checksum mismatch → server panics on startup
- Delete the file — same panic
- Rename or reorder — breaks the sequential application order

**Safe operations (do freely):**
- `CREATE TABLE`, `ADD COLUMN`, `CREATE INDEX`, `ADD CONSTRAINT` (with defaults)
- Always in a **new** migration file following the `YYYYMMDD000001_description.sql` naming convention

**To remove a column safely (two-phase):**
1. Deploy code that stops reading/writing the column
2. Next deploy: add a new migration with `ALTER TABLE ... DROP COLUMN`

## Testing

Run these to verify changes:

- **Rust**: `cargo check --features postgres,embed-ui` (compile check — full `cargo test` requires Docker)
- **haven-core**: `cd packages/haven-core && npm ci && npx vitest run`
- **web**: `cd packages/web && npm ci && npx vitest run`
- **Type check**: `cd packages/web && npx tsc --noEmit`
- **Lint**: `cargo clippy --workspace -- -D warnings`

## Key Conventions

- Permissions are a bitfield system (Discord-style). Constants in `src/permissions.rs`.
- WebSocket messages: `WsClientMessage` / `WsServerMessage` enums in `src/models.rs` and `packages/haven-core/src/types.ts`.
- All API routes are under `/api/v1/`. Router defined in `src/lib.rs`.
- Frontend state management: Zustand stores in `packages/web/src/store/`.
- Rich text editor: TipTap with custom extensions (mention, spoiler, underline, subtext, masked links).
- Message cache: localStorage-based in `packages/web/src/lib/message-cache.ts`.
- Draft saving: localStorage-based in `packages/web/src/lib/draft-store.ts`.
- CSS is in a single file: `packages/web/src/styles/index.css` (no CSS modules or Tailwind).

## Deployment

- Docker image: `ghcr.io/markjsapp/haven:latest`
- Production stack: `docker-compose.prod.yml` (Caddy + Haven + PostgreSQL + Redis + LiveKit)
- Merges to `main` auto-tag, build, push to GHCR, and deploy to production via SSH
- Rust binary is built with `--features postgres,embed-ui` (frontend baked into binary)
- `SQLX_OFFLINE=true` for CI builds (no live DB needed for compile-time checks)

## Common Gotchas

- If new DB columns/tables are added but tests fail with 500: check that a migration file was created (not just applied via psql).
- If the frontend shows stale haven-core types: rebuild haven-core (`npm run build` in `packages/haven-core/`).
- If routes return 404 with 0ms latency: check for `{param}` instead of `:param` in route definitions.
- If the server panics on startup with a migration checksum error: an existing migration file was modified. Revert it to the original content — never edit applied migrations.
- `cargo test` requires Docker (PostgreSQL + Redis) running via `docker-compose up -d`.
- Vite `manualChunks`: don't add packages that lack a `"."` export in their package.json (e.g. `@tiptap/pm`).
- `libsodium-wrappers-sumo` lives in `haven-core/node_modules`, not `web/node_modules` — resolved via Vite alias.
