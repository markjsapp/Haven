# ─── Stage 1: Frontend Build ────────────────────────────
FROM node:22-slim AS frontend

WORKDIR /app

# Build haven-core (shared library)
COPY packages/haven-core/package.json packages/haven-core/package-lock.json packages/haven-core/tsconfig.json packages/haven-core/
COPY packages/haven-core/src packages/haven-core/src
RUN cd packages/haven-core && npm ci && npm run build

# Build web frontend
COPY packages/web/package.json packages/web/package-lock.json packages/web/tsconfig.json packages/web/vite.config.ts packages/web/index.html packages/web/
COPY packages/web/.npmrc packages/web/
COPY packages/web/src packages/web/src
RUN cd packages/web && npm ci && npm run build

# ─── Stage 2: Rust Build ───────────────────────────────
FROM rust:slim-bookworm AS builder

RUN apt-get update && apt-get install -y \
    pkg-config \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Cache dependencies by building them first
COPY Cargo.toml Cargo.lock* ./
RUN mkdir src && echo "fn main() {}" > src/main.rs
RUN cargo build --release 2>/dev/null || true
RUN rm -rf src

# Copy frontend dist from stage 1
COPY --from=frontend /app/packages/web/dist packages/web/dist

# Build the actual application with embedded UI
COPY src src
COPY migrations migrations
ENV SQLX_OFFLINE=true
RUN cargo build --release --features postgres,embed-ui

# ─── Stage 3: Runtime ──────────────────────────────────
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y \
    ca-certificates \
    curl \
    libssl3 \
    && rm -rf /var/lib/apt/lists/*

RUN useradd -r -s /bin/false haven

WORKDIR /app

COPY --from=builder /app/target/release/haven-backend /app/haven-backend
COPY --from=builder /app/migrations /app/migrations

RUN mkdir -p /data/attachments && chown -R haven:haven /data

USER haven

EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=3s \
    CMD curl -f http://localhost:8080/health || exit 1

CMD ["/app/haven-backend"]
