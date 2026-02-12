// Library re-exports for integration tests.
// The binary crate (main.rs) uses these modules directly via `mod`.
// Integration tests in tests/ import them from this lib crate.

pub mod api;
pub mod auth;
pub mod config;
pub mod crypto;
pub mod db;
pub mod errors;
pub mod middleware;
pub mod models;
pub mod permissions;
pub mod storage;
pub mod ws;

use axum::{
    extract::DefaultBodyLimit,
    routing::{delete, get, post, put},
    Router,
};
use sqlx::PgPool;
use tower_http::{
    compression::CompressionLayer,
    cors::{Any, CorsLayer},
    trace::TraceLayer,
};

use config::AppConfig;
use ws::{ChannelBroadcastMap, ConnectionMap};

// ─── Application State ─────────────────────────────────

#[derive(Clone)]
pub struct AppState {
    pub db: PgPool,
    pub redis: redis::aio::ConnectionManager,
    pub config: AppConfig,
    pub storage_key: [u8; 32],
    pub connections: ConnectionMap,
    pub channel_broadcasts: ChannelBroadcastMap,
}

// ─── Router ────────────────────────────────────────────

pub fn build_router(state: AppState) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    // Auth routes (no authentication required)
    let auth_routes = Router::new()
        .route("/register", post(api::auth_routes::register))
        .route("/login", post(api::auth_routes::login))
        .route("/refresh", post(api::auth_routes::refresh_token));

    // Auth routes (authentication required)
    let auth_protected = Router::new()
        .route("/logout", post(api::auth_routes::logout))
        .route("/password", put(api::auth_routes::change_password))
        .route("/totp/setup", post(api::auth_routes::totp_setup))
        .route("/totp/verify", post(api::auth_routes::totp_verify))
        .route("/totp", delete(api::auth_routes::totp_disable));

    // Key management routes
    let key_routes = Router::new()
        .route("/identity", put(api::keys::update_identity_keys))
        .route("/prekeys", post(api::keys::upload_prekeys))
        .route("/prekeys/count", get(api::keys::prekey_count));

    // User routes
    let user_routes = Router::new()
        .route("/:user_id/keys", get(api::keys::get_key_bundle))
        .route("/:user_id/profile", get(api::users::get_profile))
        .route("/:user_id/avatar", get(api::users::get_avatar))
        .route(
            "/:user_id/block",
            post(api::users::block_user).delete(api::users::unblock_user),
        )
        .route("/search", get(api::users::get_user_by_username))
        .route("/profile", put(api::users::update_profile))
        .route("/avatar", post(api::users::upload_avatar))
        .route("/blocked", get(api::users::get_blocked_users));

    // Server routes
    let server_routes = Router::new()
        .route("/", get(api::servers::list_servers))
        .route("/", post(api::servers::create_server))
        .route("/:server_id", get(api::servers::get_server))
        .route(
            "/:server_id/channels",
            get(api::servers::list_server_channels),
        )
        .route(
            "/:server_id/channels",
            post(api::channels::create_channel),
        )
        .route(
            "/:server_id/categories",
            get(api::categories::list_categories)
                .post(api::categories::create_category),
        )
        .route(
            "/:server_id/categories/reorder",
            put(api::categories::reorder_categories),
        )
        .route(
            "/:server_id/categories/:category_id",
            put(api::categories::update_category)
                .delete(api::categories::delete_category),
        )
        .route(
            "/:server_id/invites",
            get(api::invites::list_invites),
        )
        .route(
            "/:server_id/invites",
            post(api::invites::create_invite),
        )
        .route(
            "/:server_id/invites/:invite_id",
            delete(api::invites::delete_invite),
        )
        .route(
            "/:server_id/members",
            get(api::invites::list_members),
        )
        .route(
            "/:server_id/members/:user_id",
            delete(api::invites::kick_member),
        )
        .route(
            "/:server_id/roles",
            get(api::roles::list_roles).post(api::roles::create_role),
        )
        .route(
            "/:server_id/roles/:role_id",
            put(api::roles::update_role).delete(api::roles::delete_role),
        )
        .route(
            "/:server_id/members/:user_id/roles",
            put(api::roles::assign_role),
        )
        .route(
            "/:server_id/members/:user_id/roles/:role_id",
            delete(api::roles::unassign_role),
        )
        .route(
            "/:server_id/bans",
            get(api::bans::list_bans),
        )
        .route(
            "/:server_id/bans/:user_id",
            post(api::bans::ban_member).delete(api::bans::revoke_ban),
        );

    // Channel routes
    let channel_routes = Router::new()
        .route("/:channel_id", put(api::channels::update_channel))
        .route("/:channel_id", delete(api::channels::delete_channel))
        .route("/:channel_id/join", post(api::channels::join_channel))
        .route("/:channel_id/category", put(api::categories::set_channel_category))
        .route(
            "/:channel_id/overwrites",
            get(api::roles::list_overwrites).put(api::roles::set_overwrite),
        )
        .route(
            "/:channel_id/overwrites/:target_type/:target_id",
            delete(api::roles::delete_overwrite),
        )
        .route(
            "/:channel_id/messages",
            get(api::messages::get_messages),
        )
        .route(
            "/:channel_id/messages",
            post(api::messages::send_message),
        )
        .route(
            "/:channel_id/sender-keys",
            get(api::sender_keys::get_sender_keys)
                .post(api::sender_keys::distribute_sender_keys),
        )
        .route(
            "/:channel_id/members/keys",
            get(api::sender_keys::get_channel_member_keys),
        )
        .route(
            "/:channel_id/reactions",
            get(api::messages::get_channel_reactions),
        )
        .route(
            "/:channel_id/members",
            get(api::channels::list_channel_members)
                .post(api::channels::add_group_member),
        )
        .route(
            "/:channel_id/leave",
            delete(api::channels::leave_channel),
        )
        .route(
            "/:channel_id/pins",
            get(api::messages::get_pins),
        )
        .route(
            "/:channel_id/pin-ids",
            get(api::messages::get_pin_ids),
        );

    // Friend routes
    let friend_routes = Router::new()
        .route("/", get(api::friends::list_friends))
        .route("/request", post(api::friends::send_friend_request))
        .route("/:friendship_id/accept", post(api::friends::accept_friend_request))
        .route("/:friendship_id/decline", post(api::friends::decline_friend_request))
        .route("/:friendship_id", delete(api::friends::remove_friend));

    // DM routes
    let dm_routes = Router::new()
        .route("/", get(api::channels::list_dm_channels))
        .route("/", post(api::channels::create_dm))
        .route("/group", post(api::channels::create_group_dm))
        .route("/requests", get(api::friends::list_dm_requests))
        .route("/:channel_id/request", post(api::friends::handle_dm_request));

    // Invite join route
    let invite_routes = Router::new()
        .route("/:code/join", post(api::invites::join_by_invite));

    // Attachment routes
    let attachment_routes = Router::new()
        .route("/upload", post(api::attachments::upload))
        .route("/:attachment_id", get(api::attachments::download))
        .layer(DefaultBodyLimit::max(state.config.max_upload_size_bytes as usize));

    // Link preview
    let link_preview_routes = Router::new()
        .route("/link-preview", get(api::link_preview::fetch_link_preview));

    // Presence routes
    let presence_routes = Router::new()
        .route("/presence", get(api::presence::get_presence));

    // DM privacy route
    let dm_privacy_routes = Router::new()
        .route("/users/dm-privacy", put(api::friends::update_dm_privacy));

    // Report routes
    let report_routes = Router::new()
        .route("/", post(api::reports::create_report));

    // Assemble the full API
    let api = Router::new()
        .nest("/auth", auth_routes.merge(auth_protected))
        .nest("/keys", key_routes)
        .nest("/users", user_routes)
        .nest("/servers", server_routes)
        .nest("/channels", channel_routes)
        .nest("/dm", dm_routes)
        .nest("/friends", friend_routes)
        .nest("/invites", invite_routes)
        .nest("/attachments", attachment_routes)
        .merge(link_preview_routes)
        .merge(presence_routes)
        .merge(dm_privacy_routes)
        .nest("/reports", report_routes);

    Router::new()
        .route("/api/v1/ws", get(ws::ws_handler))
        .nest("/api/v1", api)
        .route("/health", get(health_check))
        .layer(CompressionLayer::new())
        .layer(TraceLayer::new_for_http())
        .layer(cors)
        .with_state(state)
}

async fn health_check() -> &'static str {
    "ok"
}
