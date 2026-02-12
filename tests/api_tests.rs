mod common;

use axum::http::{Method, StatusCode};
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

use common::TestApp;

// ─── Auth ────────────────────────────────────────────────

#[sqlx::test(migrations = "./migrations")]
async fn register_returns_tokens_and_user(pool: PgPool) {
    let app = TestApp::new(pool).await;
    let (token, user_id) = app.register_user("alice").await;

    assert!(!token.is_empty());
    assert!(!user_id.is_nil());
}

#[sqlx::test(migrations = "./migrations")]
async fn login_with_correct_password(pool: PgPool) {
    let app = TestApp::new(pool).await;
    app.register_user("bob").await;

    let (access, refresh, user_id) = app.login_user("bob").await;
    assert!(!access.is_empty());
    assert!(!refresh.is_empty());
    assert!(!user_id.is_nil());
}

#[sqlx::test(migrations = "./migrations")]
async fn login_with_wrong_password_returns_401(pool: PgPool) {
    let app = TestApp::new(pool).await;
    app.register_user("carol").await;

    let body = json!({ "username": "carol", "password": "wrongpassword" });
    let (status, _) = app
        .request(Method::POST, "/api/v1/auth/login", None, Some(body))
        .await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[sqlx::test(migrations = "./migrations")]
async fn protected_route_without_token_returns_401(pool: PgPool) {
    let app = TestApp::new(pool).await;

    let (status, _) = app
        .request(Method::GET, "/api/v1/servers", None, None)
        .await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[sqlx::test(migrations = "./migrations")]
async fn protected_route_with_valid_token_returns_200(pool: PgPool) {
    let app = TestApp::new(pool).await;
    let (token, _) = app.register_user("dave").await;

    let (status, _) = app
        .request(Method::GET, "/api/v1/servers", Some(&token), None)
        .await;

    assert_eq!(status, StatusCode::OK);
}

#[sqlx::test(migrations = "./migrations")]
async fn duplicate_username_returns_error(pool: PgPool) {
    let app = TestApp::new(pool).await;
    app.register_user("duplicate").await;

    // Try registering again with the same username
    let b64 = &base64::engine::general_purpose::STANDARD;
    use base64::Engine;
    let fake_key = b64.encode([0u8; 32]);
    let fake_sig = b64.encode([0u8; 64]);
    let body = json!({
        "username": "duplicate",
        "password": "testpassword123",
        "identity_key": fake_key,
        "signed_prekey": fake_key,
        "signed_prekey_signature": fake_sig,
        "one_time_prekeys": []
    });

    let (status, _) = app
        .request(Method::POST, "/api/v1/auth/register", None, Some(body))
        .await;

    // Should fail (conflict or bad request)
    assert_ne!(status, StatusCode::OK);
}

#[sqlx::test(migrations = "./migrations")]
async fn refresh_token_returns_new_access_token(pool: PgPool) {
    let app = TestApp::new(pool).await;
    app.register_user("refresh_user").await;

    let (_, refresh, _) = app.login_user("refresh_user").await;

    let body = json!({ "refresh_token": refresh });
    let (status, value) = app
        .request(Method::POST, "/api/v1/auth/refresh", None, Some(body))
        .await;

    assert_eq!(status, StatusCode::OK);
    assert!(value["access_token"].as_str().is_some());
}

// ─── Servers ─────────────────────────────────────────────

#[sqlx::test(migrations = "./migrations")]
async fn create_server_returns_server(pool: PgPool) {
    let app = TestApp::new(pool).await;
    let (token, user_id) = app.register_user("server_owner").await;

    let server_id = app.create_server(&token, "Test Server").await;
    assert!(!server_id.is_nil());

    // Verify owner_id in get-server response
    let uri = format!("/api/v1/servers/{}", server_id);
    let (status, value) = app.request(Method::GET, &uri, Some(&token), None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(value["owner_id"].as_str().unwrap(), user_id.to_string());
}

#[sqlx::test(migrations = "./migrations")]
async fn list_servers_includes_created_server(pool: PgPool) {
    let app = TestApp::new(pool).await;
    let (token, _) = app.register_user("lister").await;

    app.create_server(&token, "My Server").await;

    let (status, value) = app
        .request(Method::GET, "/api/v1/servers", Some(&token), None)
        .await;

    assert_eq!(status, StatusCode::OK);
    let servers = value.as_array().unwrap();
    assert_eq!(servers.len(), 1);
}

#[sqlx::test(migrations = "./migrations")]
async fn non_member_cannot_access_server(pool: PgPool) {
    let app = TestApp::new(pool).await;
    let (token_a, _) = app.register_user("owner_a").await;
    let (token_b, _) = app.register_user("outsider_b").await;

    let server_id = app.create_server(&token_a, "Private").await;

    // User B is not a member
    let uri = format!("/api/v1/servers/{}", server_id);
    let (status, _) = app.request(Method::GET, &uri, Some(&token_b), None).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

// ─── Channels ────────────────────────────────────────────

#[sqlx::test(migrations = "./migrations")]
async fn create_channel_and_list(pool: PgPool) {
    let app = TestApp::new(pool).await;
    let (token, _) = app.register_user("chan_owner").await;
    let server_id = app.create_server(&token, "Channel Test").await;

    let channel_id = app.create_channel(&token, server_id, "dev-chat").await;
    assert!(!channel_id.is_nil());

    // List channels — should have "general" (auto-created) + "dev-chat"
    let uri = format!("/api/v1/servers/{}/channels", server_id);
    let (status, value) = app.request(Method::GET, &uri, Some(&token), None).await;
    assert_eq!(status, StatusCode::OK);

    let channels = value.as_array().unwrap();
    assert_eq!(channels.len(), 2);
}

#[sqlx::test(migrations = "./migrations")]
async fn delete_channel_removes_it(pool: PgPool) {
    let app = TestApp::new(pool).await;
    let (token, _) = app.register_user("del_owner").await;
    let server_id = app.create_server(&token, "Del Test").await;

    let channel_id = app.create_channel(&token, server_id, "to-delete").await;

    // Delete the channel
    let uri = format!("/api/v1/channels/{}", channel_id);
    let (status, _) = app
        .request(Method::DELETE, &uri, Some(&token), None)
        .await;
    assert_eq!(status, StatusCode::OK);

    // List channels — should only have "general"
    let uri = format!("/api/v1/servers/{}/channels", server_id);
    let (_, value) = app.request(Method::GET, &uri, Some(&token), None).await;
    let channels = value.as_array().unwrap();
    assert_eq!(channels.len(), 1);
}

// ─── Categories ──────────────────────────────────────────

#[sqlx::test(migrations = "./migrations")]
async fn create_and_list_categories(pool: PgPool) {
    let app = TestApp::new(pool).await;
    let (token, _) = app.register_user("cat_owner").await;
    let server_id = app.create_server(&token, "Cat Test").await;

    // Create a category
    let uri = format!("/api/v1/servers/{}/categories", server_id);
    let body = json!({ "name": "Voice Channels", "position": 0 });
    let (status, value) = app
        .request(Method::POST, &uri, Some(&token), Some(body))
        .await;
    assert_eq!(status, StatusCode::OK);
    let cat_id = value["id"].as_str().unwrap();

    // List categories
    let (status, value) = app.request(Method::GET, &uri, Some(&token), None).await;
    assert_eq!(status, StatusCode::OK);
    let categories = value.as_array().unwrap();
    assert!(categories.iter().any(|c| c["id"].as_str() == Some(cat_id)));
}

#[sqlx::test(migrations = "./migrations")]
async fn assign_channel_to_category(pool: PgPool) {
    let app = TestApp::new(pool).await;
    let (token, _) = app.register_user("assign_owner").await;
    let server_id = app.create_server(&token, "Assign Test").await;

    // Create category
    let cat_uri = format!("/api/v1/servers/{}/categories", server_id);
    let (_, cat_val) = app
        .request(
            Method::POST,
            &cat_uri,
            Some(&token),
            Some(json!({ "name": "Text", "position": 0 })),
        )
        .await;
    let cat_id = cat_val["id"].as_str().unwrap();

    // Create channel
    let channel_id = app.create_channel(&token, server_id, "my-channel").await;

    // Assign channel to category
    let uri = format!("/api/v1/channels/{}/category", channel_id);
    let (status, _) = app
        .request(
            Method::PUT,
            &uri,
            Some(&token),
            Some(json!({ "category_id": cat_id })),
        )
        .await;
    assert_eq!(status, StatusCode::OK);

    // Verify via channel list
    let list_uri = format!("/api/v1/servers/{}/channels", server_id);
    let (_, value) = app
        .request(Method::GET, &list_uri, Some(&token), None)
        .await;
    let channels = value.as_array().unwrap();
    let ch = channels
        .iter()
        .find(|c| c["id"].as_str().unwrap() == channel_id.to_string())
        .unwrap();
    assert_eq!(ch["category_id"].as_str().unwrap(), cat_id);
}

// ─── Roles ───────────────────────────────────────────────

#[sqlx::test(migrations = "./migrations")]
async fn server_has_default_everyone_role(pool: PgPool) {
    let app = TestApp::new(pool).await;
    let (token, _) = app.register_user("role_owner").await;
    let server_id = app.create_server(&token, "Role Test").await;

    let uri = format!("/api/v1/servers/{}/roles", server_id);
    let (status, value) = app.request(Method::GET, &uri, Some(&token), None).await;
    assert_eq!(status, StatusCode::OK);

    let roles = value.as_array().unwrap();
    assert!(roles.iter().any(|r| r["is_default"].as_bool() == Some(true)));
}

#[sqlx::test(migrations = "./migrations")]
async fn create_custom_role(pool: PgPool) {
    let app = TestApp::new(pool).await;
    let (token, _) = app.register_user("role_creator").await;
    let server_id = app.create_server(&token, "Custom Role Test").await;

    let uri = format!("/api/v1/servers/{}/roles", server_id);
    let body = json!({
        "name": "Moderator",
        "color": "#00ff00",
        "permissions": "8", // MANAGE_CHANNELS
        "position": 1
    });

    let (status, value) = app
        .request(Method::POST, &uri, Some(&token), Some(body))
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(value["name"].as_str(), Some("Moderator"));
    assert_eq!(value["color"].as_str(), Some("#00ff00"));
}

#[sqlx::test(migrations = "./migrations")]
async fn assign_role_to_member(pool: PgPool) {
    let app = TestApp::new(pool).await;
    let (token_owner, _) = app.register_user("role_assigner").await;
    let (token_member, member_id) = app.register_user("role_target").await;
    let server_id = app.create_server(&token_owner, "Assign Role Test").await;

    // Invite member to server
    let inv_uri = format!("/api/v1/servers/{}/invites", server_id);
    let (_, inv_val) = app
        .request(
            Method::POST,
            &inv_uri,
            Some(&token_owner),
            Some(json!({ "expires_in_hours": 24 })),
        )
        .await;
    let code = inv_val["code"].as_str().unwrap();

    // Member joins
    let join_uri = format!("/api/v1/invites/{}/join", code);
    let (status, _) = app
        .request(Method::POST, &join_uri, Some(&token_member), None)
        .await;
    assert_eq!(status, StatusCode::OK);

    // Create a role
    let roles_uri = format!("/api/v1/servers/{}/roles", server_id);
    let (_, role_val) = app
        .request(
            Method::POST,
            &roles_uri,
            Some(&token_owner),
            Some(json!({ "name": "VIP", "position": 1 })),
        )
        .await;
    let role_id = role_val["id"].as_str().unwrap();

    // Assign role to member
    let assign_uri = format!(
        "/api/v1/servers/{}/members/{}/roles",
        server_id, member_id
    );
    let (status, _) = app
        .request(
            Method::PUT,
            &assign_uri,
            Some(&token_owner),
            Some(json!({ "role_id": role_id })),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
}

// ─── Permissions ─────────────────────────────────────────

#[sqlx::test(migrations = "./migrations")]
async fn user_without_manage_channels_gets_403(pool: PgPool) {
    let app = TestApp::new(pool).await;
    let (token_owner, _) = app.register_user("perm_owner").await;
    let (token_member, _) = app.register_user("perm_member").await;
    let server_id = app.create_server(&token_owner, "Perm Test").await;

    // Invite member
    let inv_uri = format!("/api/v1/servers/{}/invites", server_id);
    let (_, inv_val) = app
        .request(
            Method::POST,
            &inv_uri,
            Some(&token_owner),
            Some(json!({ "expires_in_hours": 24 })),
        )
        .await;
    let code = inv_val["code"].as_str().unwrap();
    let join_uri = format!("/api/v1/invites/{}/join", code);
    app.request(Method::POST, &join_uri, Some(&token_member), None)
        .await;

    // Member tries to create a channel — should be 403 (no MANAGE_CHANNELS)
    use base64::Engine;
    let b64 = &base64::engine::general_purpose::STANDARD;
    let body = json!({ "encrypted_meta": b64.encode(b"test") });
    let uri = format!("/api/v1/servers/{}/channels", server_id);
    let (status, _) = app
        .request(Method::POST, &uri, Some(&token_member), Some(body))
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

// ─── Invites ─────────────────────────────────────────────

#[sqlx::test(migrations = "./migrations")]
async fn create_and_use_invite(pool: PgPool) {
    let app = TestApp::new(pool).await;
    let (token_owner, _) = app.register_user("inv_owner").await;
    let (token_joiner, _) = app.register_user("inv_joiner").await;
    let server_id = app.create_server(&token_owner, "Invite Test").await;

    // Create invite
    let uri = format!("/api/v1/servers/{}/invites", server_id);
    let (status, value) = app
        .request(
            Method::POST,
            &uri,
            Some(&token_owner),
            Some(json!({ "expires_in_hours": 24 })),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    let code = value["code"].as_str().unwrap();

    // Joiner uses the invite
    let join_uri = format!("/api/v1/invites/{}/join", code);
    let (status, _) = app
        .request(Method::POST, &join_uri, Some(&token_joiner), None)
        .await;
    assert_eq!(status, StatusCode::OK);

    // Verify joiner can list channels
    let chan_uri = format!("/api/v1/servers/{}/channels", server_id);
    let (status, _) = app
        .request(Method::GET, &chan_uri, Some(&token_joiner), None)
        .await;
    assert_eq!(status, StatusCode::OK);
}

#[sqlx::test(migrations = "./migrations")]
async fn invalid_invite_code_returns_error(pool: PgPool) {
    let app = TestApp::new(pool).await;
    let (token, _) = app.register_user("bad_inv").await;

    let (status, _) = app
        .request(
            Method::POST,
            "/api/v1/invites/INVALIDCODE/join",
            Some(&token),
            None,
        )
        .await;

    assert_ne!(status, StatusCode::OK);
}

// ─── Friends ─────────────────────────────────────────────

#[sqlx::test(migrations = "./migrations")]
async fn send_and_accept_friend_request(pool: PgPool) {
    let app = TestApp::new(pool).await;
    let (token_a, _) = app.register_user("friend_a").await;
    let (token_b, _) = app.register_user("friend_b").await;

    // A sends request to B
    let body = json!({ "username": "friend_b" });
    let (status, value) = app
        .request(
            Method::POST,
            "/api/v1/friends/request",
            Some(&token_a),
            Some(body),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(value["status"].as_str(), Some("pending"));
    let friendship_id = value["id"].as_str().unwrap();

    // B accepts the request
    let accept_uri = format!("/api/v1/friends/{}/accept", friendship_id);
    let (status, value) = app
        .request(Method::POST, &accept_uri, Some(&token_b), None)
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(value["status"].as_str(), Some("accepted"));

    // Both should see each other in friends list
    let (_, val_a) = app
        .request(Method::GET, "/api/v1/friends", Some(&token_a), None)
        .await;
    let friends_a = val_a.as_array().unwrap();
    assert!(friends_a
        .iter()
        .any(|f| f["status"].as_str() == Some("accepted")));

    let (_, val_b) = app
        .request(Method::GET, "/api/v1/friends", Some(&token_b), None)
        .await;
    let friends_b = val_b.as_array().unwrap();
    assert!(friends_b
        .iter()
        .any(|f| f["status"].as_str() == Some("accepted")));
}

#[sqlx::test(migrations = "./migrations")]
async fn decline_friend_request(pool: PgPool) {
    let app = TestApp::new(pool).await;
    let (token_a, _) = app.register_user("decl_a").await;
    let (token_b, _) = app.register_user("decl_b").await;

    // A sends request to B
    let (_, value) = app
        .request(
            Method::POST,
            "/api/v1/friends/request",
            Some(&token_a),
            Some(json!({ "username": "decl_b" })),
        )
        .await;
    let friendship_id = value["id"].as_str().unwrap();

    // B declines
    let uri = format!("/api/v1/friends/{}/decline", friendship_id);
    let (status, _) = app
        .request(Method::POST, &uri, Some(&token_b), None)
        .await;
    assert_eq!(status, StatusCode::OK);

    // A's friends list should be empty (or no accepted friends)
    let (_, val) = app
        .request(Method::GET, "/api/v1/friends", Some(&token_a), None)
        .await;
    let friends = val.as_array().unwrap();
    assert!(friends
        .iter()
        .all(|f| f["status"].as_str() != Some("accepted")));
}

#[sqlx::test(migrations = "./migrations")]
async fn mutual_friend_request_auto_accepts(pool: PgPool) {
    let app = TestApp::new(pool).await;
    let (token_a, _) = app.register_user("mutual_a").await;
    let (token_b, _) = app.register_user("mutual_b").await;

    // A sends request to B
    app.request(
        Method::POST,
        "/api/v1/friends/request",
        Some(&token_a),
        Some(json!({ "username": "mutual_b" })),
    )
    .await;

    // B also sends request to A — should auto-accept
    let (status, value) = app
        .request(
            Method::POST,
            "/api/v1/friends/request",
            Some(&token_b),
            Some(json!({ "username": "mutual_a" })),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(value["status"].as_str(), Some("accepted"));
}

// ─── Health Check ────────────────────────────────────────

#[sqlx::test(migrations = "./migrations")]
async fn health_check_returns_ok(pool: PgPool) {
    let app = TestApp::new(pool).await;

    let (status, value) = app.request(Method::GET, "/health", None, None).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(value.as_str(), Some("ok"));
}

// ─── Auth Extended ──────────────────────────────────────

#[sqlx::test(migrations = "./migrations")]
async fn logout_revokes_tokens(pool: PgPool) {
    let app = TestApp::new(pool).await;
    let (token, _) = app.register_user("logout_user").await;

    let (status, _) = app
        .request(Method::POST, "/api/v1/auth/logout", Some(&token), None)
        .await;
    assert_eq!(status, StatusCode::OK);
}

#[sqlx::test(migrations = "./migrations")]
async fn change_password_success(pool: PgPool) {
    let app = TestApp::new(pool).await;
    let (token, _) = app.register_user("pw_change").await;

    let body = json!({
        "current_password": "testpassword123",
        "new_password": "newpassword456"
    });
    let (status, _) = app
        .request(Method::PUT, "/api/v1/auth/password", Some(&token), Some(body))
        .await;
    assert_eq!(status, StatusCode::OK);

    // Old password should fail
    let (status, _) = app
        .request(
            Method::POST,
            "/api/v1/auth/login",
            None,
            Some(json!({ "username": "pw_change", "password": "testpassword123" })),
        )
        .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);

    // New password should work
    let (status, _) = app
        .request(
            Method::POST,
            "/api/v1/auth/login",
            None,
            Some(json!({ "username": "pw_change", "password": "newpassword456" })),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
}

#[sqlx::test(migrations = "./migrations")]
async fn change_password_wrong_current_fails(pool: PgPool) {
    let app = TestApp::new(pool).await;
    let (token, _) = app.register_user("pw_wrong").await;

    let body = json!({
        "current_password": "wrongpassword",
        "new_password": "newpassword456"
    });
    let (status, _) = app
        .request(Method::PUT, "/api/v1/auth/password", Some(&token), Some(body))
        .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

// ─── Messages ───────────────────────────────────────────

#[sqlx::test(migrations = "./migrations")]
async fn send_and_get_messages(pool: PgPool) {
    let app = TestApp::new(pool).await;
    let (token, _) = app.register_user("msg_user").await;
    let server_id = app.create_server(&token, "Msg Server").await;
    let channel_id = app.create_channel(&token, server_id, "general").await;

    // Send a message
    let (msg_id, msg_val) = app.send_message(&token, channel_id).await;
    assert!(!msg_id.is_nil());
    assert_eq!(msg_val["channel_id"].as_str().unwrap(), channel_id.to_string());

    // Get messages
    let uri = format!("/api/v1/channels/{}/messages", channel_id);
    let (status, value) = app.request(Method::GET, &uri, Some(&token), None).await;
    assert_eq!(status, StatusCode::OK);
    let messages = value.as_array().unwrap();
    assert!(messages.iter().any(|m| m["id"].as_str().unwrap() == msg_id.to_string()));
}

#[sqlx::test(migrations = "./migrations")]
async fn send_reply_includes_reply_to_id(pool: PgPool) {
    let app = TestApp::new(pool).await;
    let (token, _) = app.register_user("reply_user").await;
    let server_id = app.create_server(&token, "Reply Server").await;
    let channel_id = app.create_channel(&token, server_id, "general").await;

    let (original_id, _) = app.send_message(&token, channel_id).await;
    let (reply_id, reply_val) = app.send_reply(&token, channel_id, original_id).await;

    assert!(!reply_id.is_nil());
    assert_eq!(
        reply_val["reply_to_id"].as_str().unwrap(),
        original_id.to_string()
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn non_member_cannot_get_messages(pool: PgPool) {
    let app = TestApp::new(pool).await;
    let (token_a, _) = app.register_user("msg_owner").await;
    let (token_b, _) = app.register_user("msg_outsider").await;
    let server_id = app.create_server(&token_a, "Private Msgs").await;
    let channel_id = app.create_channel(&token_a, server_id, "secret").await;

    let uri = format!("/api/v1/channels/{}/messages", channel_id);
    let (status, _) = app.request(Method::GET, &uri, Some(&token_b), None).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

// ─── Pins ───────────────────────────────────────────────

#[sqlx::test(migrations = "./migrations")]
async fn get_pins_empty_initially(pool: PgPool) {
    let app = TestApp::new(pool).await;
    let (token, _) = app.register_user("pin_user").await;
    let server_id = app.create_server(&token, "Pin Server").await;
    let channel_id = app.create_channel(&token, server_id, "general").await;

    let uri = format!("/api/v1/channels/{}/pins", channel_id);
    let (status, value) = app.request(Method::GET, &uri, Some(&token), None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(value.as_array().unwrap().len(), 0);
}

#[sqlx::test(migrations = "./migrations")]
async fn get_pin_ids_empty_initially(pool: PgPool) {
    let app = TestApp::new(pool).await;
    let (token, _) = app.register_user("pinid_user").await;
    let server_id = app.create_server(&token, "PinId Server").await;
    let channel_id = app.create_channel(&token, server_id, "general").await;

    let uri = format!("/api/v1/channels/{}/pin-ids", channel_id);
    let (status, value) = app.request(Method::GET, &uri, Some(&token), None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(value.as_array().unwrap().len(), 0);
}

// ─── Reports ────────────────────────────────────────────

#[sqlx::test(migrations = "./migrations")]
async fn create_report_success(pool: PgPool) {
    let app = TestApp::new(pool).await;
    let (token, _) = app.register_user("reporter").await;
    let server_id = app.create_server(&token, "Report Server").await;
    let channel_id = app.create_channel(&token, server_id, "general").await;

    let (msg_id, _) = app.send_message(&token, channel_id).await;

    let body = json!({
        "message_id": msg_id,
        "channel_id": channel_id,
        "reason": "This message violates the rules and is inappropriate."
    });
    let (status, value) = app
        .request(Method::POST, "/api/v1/reports", Some(&token), Some(body))
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(value["status"].as_str(), Some("pending"));
    assert!(value["id"].as_str().is_some());
}

#[sqlx::test(migrations = "./migrations")]
async fn create_report_short_reason_fails(pool: PgPool) {
    let app = TestApp::new(pool).await;
    let (token, _) = app.register_user("short_report").await;
    let server_id = app.create_server(&token, "Report2").await;
    let channel_id = app.create_channel(&token, server_id, "general").await;
    let (msg_id, _) = app.send_message(&token, channel_id).await;

    let body = json!({
        "message_id": msg_id,
        "channel_id": channel_id,
        "reason": "short"
    });
    let (status, _) = app
        .request(Method::POST, "/api/v1/reports", Some(&token), Some(body))
        .await;
    assert_ne!(status, StatusCode::OK);
}

// ─── Bans ───────────────────────────────────────────────

#[sqlx::test(migrations = "./migrations")]
async fn ban_and_list_bans(pool: PgPool) {
    let app = TestApp::new(pool).await;
    let (token_owner, _) = app.register_user("ban_owner").await;
    let (token_target, target_id) = app.register_user("ban_target").await;
    let server_id = app.create_server(&token_owner, "Ban Server").await;

    app.invite_and_join(&token_owner, &token_target, server_id).await;

    // Ban the target
    let ban_uri = format!("/api/v1/servers/{}/bans/{}", server_id, target_id);
    let (status, value) = app
        .request(
            Method::POST,
            &ban_uri,
            Some(&token_owner),
            Some(json!({ "reason": "Test ban" })),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(value["user_id"].as_str().unwrap(), target_id.to_string());

    // List bans
    let list_uri = format!("/api/v1/servers/{}/bans", server_id);
    let (status, value) = app
        .request(Method::GET, &list_uri, Some(&token_owner), None)
        .await;
    assert_eq!(status, StatusCode::OK);
    let bans = value.as_array().unwrap();
    assert_eq!(bans.len(), 1);
}

#[sqlx::test(migrations = "./migrations")]
async fn revoke_ban(pool: PgPool) {
    let app = TestApp::new(pool).await;
    let (token_owner, _) = app.register_user("unban_owner").await;
    let (token_target, target_id) = app.register_user("unban_target").await;
    let server_id = app.create_server(&token_owner, "Unban Server").await;

    app.invite_and_join(&token_owner, &token_target, server_id).await;

    // Ban then unban
    let ban_uri = format!("/api/v1/servers/{}/bans/{}", server_id, target_id);
    app.request(
        Method::POST,
        &ban_uri,
        Some(&token_owner),
        Some(json!({ "reason": "Temp ban" })),
    )
    .await;

    let (status, value) = app
        .request(Method::DELETE, &ban_uri, Some(&token_owner), None)
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(value["unbanned"].as_bool(), Some(true));

    // Bans list should be empty
    let list_uri = format!("/api/v1/servers/{}/bans", server_id);
    let (_, value) = app
        .request(Method::GET, &list_uri, Some(&token_owner), None)
        .await;
    assert_eq!(value.as_array().unwrap().len(), 0);
}

#[sqlx::test(migrations = "./migrations")]
async fn banned_user_cannot_rejoin(pool: PgPool) {
    let app = TestApp::new(pool).await;
    let (token_owner, _) = app.register_user("banrej_owner").await;
    let (token_target, target_id) = app.register_user("banrej_target").await;
    let server_id = app.create_server(&token_owner, "BanReJoin").await;

    app.invite_and_join(&token_owner, &token_target, server_id).await;

    // Ban
    let ban_uri = format!("/api/v1/servers/{}/bans/{}", server_id, target_id);
    app.request(
        Method::POST,
        &ban_uri,
        Some(&token_owner),
        Some(json!({})),
    )
    .await;

    // Create new invite and try to rejoin
    let inv_uri = format!("/api/v1/servers/{}/invites", server_id);
    let (_, inv_val) = app
        .request(
            Method::POST,
            &inv_uri,
            Some(&token_owner),
            Some(json!({ "expires_in_hours": 24 })),
        )
        .await;
    let code = inv_val["code"].as_str().unwrap();
    let join_uri = format!("/api/v1/invites/{}/join", code);
    let (status, _) = app
        .request(Method::POST, &join_uri, Some(&token_target), None)
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

// ─── User Profiles ──────────────────────────────────────

#[sqlx::test(migrations = "./migrations")]
async fn get_user_profile(pool: PgPool) {
    let app = TestApp::new(pool).await;
    let (token_a, _) = app.register_user("profile_a").await;
    let (_, user_b) = app.register_user("profile_b").await;

    let uri = format!("/api/v1/users/{}/profile", user_b);
    let (status, value) = app.request(Method::GET, &uri, Some(&token_a), None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(value["username"].as_str(), Some("profile_b"));
    assert_eq!(value["is_friend"].as_bool(), Some(false));
    assert_eq!(value["is_blocked"].as_bool(), Some(false));
}

#[sqlx::test(migrations = "./migrations")]
async fn update_profile(pool: PgPool) {
    let app = TestApp::new(pool).await;
    let (token, _) = app.register_user("update_prof").await;

    let body = json!({
        "display_name": "Updated Name",
        "about_me": "Hello world",
        "custom_status": "Coding",
        "custom_status_emoji": "💻"
    });
    let (status, value) = app
        .request(Method::PUT, "/api/v1/users/profile", Some(&token), Some(body))
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(value["display_name"].as_str(), Some("Updated Name"));
    assert_eq!(value["about_me"].as_str(), Some("Hello world"));
}

#[sqlx::test(migrations = "./migrations")]
async fn search_user_by_username(pool: PgPool) {
    let app = TestApp::new(pool).await;
    let (token, _) = app.register_user("search_me").await;

    let (status, value) = app
        .request(
            Method::GET,
            "/api/v1/users/search?username=search_me",
            Some(&token),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(value["username"].as_str(), Some("search_me"));
}

#[sqlx::test(migrations = "./migrations")]
async fn search_nonexistent_user_returns_404(pool: PgPool) {
    let app = TestApp::new(pool).await;
    let (token, _) = app.register_user("searcher").await;

    let (status, _) = app
        .request(
            Method::GET,
            "/api/v1/users/search?username=doesnotexist",
            Some(&token),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

// ─── Blocked Users ──────────────────────────────────────

#[sqlx::test(migrations = "./migrations")]
async fn block_and_unblock_user(pool: PgPool) {
    let app = TestApp::new(pool).await;
    let (token_a, _) = app.register_user("blocker").await;
    let (_, user_b) = app.register_user("blockee").await;

    // Block
    let block_uri = format!("/api/v1/users/{}/block", user_b);
    let (status, _) = app
        .request(Method::POST, &block_uri, Some(&token_a), None)
        .await;
    assert_eq!(status, StatusCode::OK);

    // Get blocked users
    let (status, value) = app
        .request(Method::GET, "/api/v1/users/blocked", Some(&token_a), None)
        .await;
    assert_eq!(status, StatusCode::OK);
    let blocked = value.as_array().unwrap();
    assert_eq!(blocked.len(), 1);
    assert_eq!(blocked[0]["user_id"].as_str().unwrap(), user_b.to_string());

    // Unblock
    let (status, _) = app
        .request(Method::DELETE, &block_uri, Some(&token_a), None)
        .await;
    assert_eq!(status, StatusCode::OK);

    // Blocked list should be empty
    let (_, value) = app
        .request(Method::GET, "/api/v1/users/blocked", Some(&token_a), None)
        .await;
    assert_eq!(value.as_array().unwrap().len(), 0);
}

#[sqlx::test(migrations = "./migrations")]
async fn cannot_block_self(pool: PgPool) {
    let app = TestApp::new(pool).await;
    let (token, user_id) = app.register_user("self_blocker").await;

    let uri = format!("/api/v1/users/{}/block", user_id);
    let (status, _) = app.request(Method::POST, &uri, Some(&token), None).await;
    assert_ne!(status, StatusCode::OK);
}

#[sqlx::test(migrations = "./migrations")]
async fn blocked_user_cannot_send_friend_request(pool: PgPool) {
    let app = TestApp::new(pool).await;
    let (token_a, _) = app.register_user("block_fr_a").await;
    let (token_b, user_b) = app.register_user("block_fr_b").await;

    // A blocks B
    let block_uri = format!("/api/v1/users/{}/block", user_b);
    app.request(Method::POST, &block_uri, Some(&token_a), None).await;

    // B tries to friend A
    let (status, _) = app
        .request(
            Method::POST,
            "/api/v1/friends/request",
            Some(&token_b),
            Some(json!({ "username": "block_fr_a" })),
        )
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

// ─── DMs ────────────────────────────────────────────────

#[sqlx::test(migrations = "./migrations")]
async fn create_and_list_dm(pool: PgPool) {
    let app = TestApp::new(pool).await;
    let (token_a, _) = app.register_user("dm_a").await;
    let (token_b, user_b) = app.register_user("dm_b").await;

    let b64 = &base64::engine::general_purpose::STANDARD;
    use base64::Engine;

    let body = json!({
        "target_user_id": user_b,
        "encrypted_meta": b64.encode(b"dm-meta")
    });
    let (status, value) = app
        .request(Method::POST, "/api/v1/dm", Some(&token_a), Some(body))
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(value["channel_type"].as_str(), Some("dm"));

    // List DMs for user A
    let (status, value) = app
        .request(Method::GET, "/api/v1/dm", Some(&token_a), None)
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(value.as_array().unwrap().len(), 1);

    // User B should also see the DM
    let (status, value) = app
        .request(Method::GET, "/api/v1/dm", Some(&token_b), None)
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(value.as_array().unwrap().len(), 1);
}

#[sqlx::test(migrations = "./migrations")]
async fn create_group_dm(pool: PgPool) {
    let app = TestApp::new(pool).await;
    let (token_a, _) = app.register_user("gdm_a").await;
    let (token_b, user_b) = app.register_user("gdm_b").await;
    let (token_c, user_c) = app.register_user("gdm_c").await;

    // Make friends first
    app.make_friends(&token_a, &token_b, "gdm_b").await;
    app.make_friends(&token_a, &token_c, "gdm_c").await;

    let b64 = &base64::engine::general_purpose::STANDARD;
    use base64::Engine;

    let body = json!({
        "member_ids": [user_b, user_c],
        "encrypted_meta": b64.encode(b"group-dm-meta")
    });
    let (status, value) = app
        .request(Method::POST, "/api/v1/dm/group", Some(&token_a), Some(body))
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(value["channel_type"].as_str(), Some("group"));
}

#[sqlx::test(migrations = "./migrations")]
async fn group_dm_requires_friends(pool: PgPool) {
    let app = TestApp::new(pool).await;
    let (token_a, _) = app.register_user("gdm_nf_a").await;
    let (_, user_b) = app.register_user("gdm_nf_b").await;
    let (_, user_c) = app.register_user("gdm_nf_c").await;

    let b64 = &base64::engine::general_purpose::STANDARD;
    use base64::Engine;

    // No friends — should fail
    let body = json!({
        "member_ids": [user_b, user_c],
        "encrypted_meta": b64.encode(b"meta")
    });
    let (status, _) = app
        .request(Method::POST, "/api/v1/dm/group", Some(&token_a), Some(body))
        .await;
    assert_ne!(status, StatusCode::OK);
}

// ─── Channel Members & Leave ────────────────────────────

#[sqlx::test(migrations = "./migrations")]
async fn list_channel_members(pool: PgPool) {
    let app = TestApp::new(pool).await;
    let (token, _) = app.register_user("ch_mem").await;
    let server_id = app.create_server(&token, "Member Test").await;
    let channel_id = app.create_channel(&token, server_id, "general").await;

    let uri = format!("/api/v1/channels/{}/members", channel_id);
    let (status, value) = app.request(Method::GET, &uri, Some(&token), None).await;
    assert_eq!(status, StatusCode::OK);
    let members = value.as_array().unwrap();
    assert!(members.len() >= 1);
}

#[sqlx::test(migrations = "./migrations")]
async fn leave_group_dm(pool: PgPool) {
    let app = TestApp::new(pool).await;
    let (token_a, _) = app.register_user("leave_a").await;
    let (token_b, user_b) = app.register_user("leave_b").await;
    let (token_c, user_c) = app.register_user("leave_c").await;

    app.make_friends(&token_a, &token_b, "leave_b").await;
    app.make_friends(&token_a, &token_c, "leave_c").await;

    let b64 = &base64::engine::general_purpose::STANDARD;
    use base64::Engine;

    let body = json!({
        "member_ids": [user_b, user_c],
        "encrypted_meta": b64.encode(b"leave-test")
    });
    let (status, value) = app
        .request(Method::POST, "/api/v1/dm/group", Some(&token_a), Some(body))
        .await;
    assert_eq!(status, StatusCode::OK);
    let channel_id = value["id"].as_str().unwrap();

    // User B leaves
    let leave_uri = format!("/api/v1/channels/{}/leave", channel_id);
    let (status, _) = app
        .request(Method::DELETE, &leave_uri, Some(&token_b), None)
        .await;
    assert_eq!(status, StatusCode::OK);
}

// ─── Roles Extended ─────────────────────────────────────

#[sqlx::test(migrations = "./migrations")]
async fn update_role(pool: PgPool) {
    let app = TestApp::new(pool).await;
    let (token, _) = app.register_user("role_updater").await;
    let server_id = app.create_server(&token, "Role Update Test").await;

    // Create a role
    let roles_uri = format!("/api/v1/servers/{}/roles", server_id);
    let (_, role_val) = app
        .request(
            Method::POST,
            &roles_uri,
            Some(&token),
            Some(json!({ "name": "Original", "position": 1 })),
        )
        .await;
    let role_id = role_val["id"].as_str().unwrap();

    // Update it
    let update_uri = format!("/api/v1/servers/{}/roles/{}", server_id, role_id);
    let (status, value) = app
        .request(
            Method::PUT,
            &update_uri,
            Some(&token),
            Some(json!({ "name": "Renamed", "color": "#ff0000" })),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(value["name"].as_str(), Some("Renamed"));
    assert_eq!(value["color"].as_str(), Some("#ff0000"));
}

#[sqlx::test(migrations = "./migrations")]
async fn delete_role(pool: PgPool) {
    let app = TestApp::new(pool).await;
    let (token, _) = app.register_user("role_deleter").await;
    let server_id = app.create_server(&token, "Role Delete Test").await;

    // Create and delete a role
    let roles_uri = format!("/api/v1/servers/{}/roles", server_id);
    let (_, role_val) = app
        .request(
            Method::POST,
            &roles_uri,
            Some(&token),
            Some(json!({ "name": "Deletable", "position": 1 })),
        )
        .await;
    let role_id = role_val["id"].as_str().unwrap();

    let del_uri = format!("/api/v1/servers/{}/roles/{}", server_id, role_id);
    let (status, _) = app
        .request(Method::DELETE, &del_uri, Some(&token), None)
        .await;
    assert_eq!(status, StatusCode::OK);

    // Verify it's gone — only @everyone should remain
    let (_, value) = app
        .request(Method::GET, &roles_uri, Some(&token), None)
        .await;
    let roles = value.as_array().unwrap();
    assert!(roles.iter().all(|r| r["name"].as_str() != Some("Deletable")));
}

#[sqlx::test(migrations = "./migrations")]
async fn cannot_delete_default_role(pool: PgPool) {
    let app = TestApp::new(pool).await;
    let (token, _) = app.register_user("no_del_default").await;
    let server_id = app.create_server(&token, "Default Role").await;

    // Find the default role
    let roles_uri = format!("/api/v1/servers/{}/roles", server_id);
    let (_, value) = app
        .request(Method::GET, &roles_uri, Some(&token), None)
        .await;
    let default_role = value
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["is_default"].as_bool() == Some(true))
        .unwrap();
    let role_id = default_role["id"].as_str().unwrap();

    let del_uri = format!("/api/v1/servers/{}/roles/{}", server_id, role_id);
    let (status, _) = app
        .request(Method::DELETE, &del_uri, Some(&token), None)
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[sqlx::test(migrations = "./migrations")]
async fn unassign_role_from_member(pool: PgPool) {
    let app = TestApp::new(pool).await;
    let (token_owner, _) = app.register_user("unassign_owner").await;
    let (token_member, member_id) = app.register_user("unassign_target").await;
    let server_id = app.create_server(&token_owner, "Unassign Test").await;

    app.invite_and_join(&token_owner, &token_member, server_id).await;

    // Create and assign a role
    let roles_uri = format!("/api/v1/servers/{}/roles", server_id);
    let (_, role_val) = app
        .request(
            Method::POST,
            &roles_uri,
            Some(&token_owner),
            Some(json!({ "name": "TempRole", "position": 1 })),
        )
        .await;
    let role_id = role_val["id"].as_str().unwrap();

    let assign_uri = format!("/api/v1/servers/{}/members/{}/roles", server_id, member_id);
    app.request(
        Method::PUT,
        &assign_uri,
        Some(&token_owner),
        Some(json!({ "role_id": role_id })),
    )
    .await;

    // Unassign
    let unassign_uri = format!(
        "/api/v1/servers/{}/members/{}/roles/{}",
        server_id, member_id, role_id
    );
    let (status, _) = app
        .request(Method::DELETE, &unassign_uri, Some(&token_owner), None)
        .await;
    assert_eq!(status, StatusCode::OK);
}

// ─── Categories Extended ────────────────────────────────

#[sqlx::test(migrations = "./migrations")]
async fn update_category(pool: PgPool) {
    let app = TestApp::new(pool).await;
    let (token, _) = app.register_user("cat_updater").await;
    let server_id = app.create_server(&token, "Cat Update").await;

    let cat_uri = format!("/api/v1/servers/{}/categories", server_id);
    let (_, cat_val) = app
        .request(
            Method::POST,
            &cat_uri,
            Some(&token),
            Some(json!({ "name": "Original", "position": 0 })),
        )
        .await;
    let cat_id = cat_val["id"].as_str().unwrap();

    let update_uri = format!("/api/v1/servers/{}/categories/{}", server_id, cat_id);
    let (status, value) = app
        .request(
            Method::PUT,
            &update_uri,
            Some(&token),
            Some(json!({ "name": "Renamed Category" })),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(value["name"].as_str(), Some("Renamed Category"));
}

#[sqlx::test(migrations = "./migrations")]
async fn delete_category(pool: PgPool) {
    let app = TestApp::new(pool).await;
    let (token, _) = app.register_user("cat_deleter").await;
    let server_id = app.create_server(&token, "Cat Delete").await;

    let cat_uri = format!("/api/v1/servers/{}/categories", server_id);
    let (_, cat_val) = app
        .request(
            Method::POST,
            &cat_uri,
            Some(&token),
            Some(json!({ "name": "ToDelete", "position": 0 })),
        )
        .await;
    let cat_id = cat_val["id"].as_str().unwrap();

    let del_uri = format!("/api/v1/servers/{}/categories/{}", server_id, cat_id);
    let (status, _) = app
        .request(Method::DELETE, &del_uri, Some(&token), None)
        .await;
    assert_eq!(status, StatusCode::OK);

    // Verify it's gone
    let (_, value) = app
        .request(Method::GET, &cat_uri, Some(&token), None)
        .await;
    let cats = value.as_array().unwrap();
    assert!(cats.iter().all(|c| c["id"].as_str() != Some(cat_id)));
}

#[sqlx::test(migrations = "./migrations")]
async fn reorder_categories(pool: PgPool) {
    let app = TestApp::new(pool).await;
    let (token, _) = app.register_user("cat_reorder").await;
    let server_id = app.create_server(&token, "Reorder").await;

    let cat_uri = format!("/api/v1/servers/{}/categories", server_id);
    let (_, cat1) = app
        .request(
            Method::POST,
            &cat_uri,
            Some(&token),
            Some(json!({ "name": "First", "position": 0 })),
        )
        .await;
    let (_, cat2) = app
        .request(
            Method::POST,
            &cat_uri,
            Some(&token),
            Some(json!({ "name": "Second", "position": 1 })),
        )
        .await;

    let reorder_uri = format!("/api/v1/servers/{}/categories/reorder", server_id);
    let body = json!({
        "order": [
            { "id": cat1["id"], "position": 1 },
            { "id": cat2["id"], "position": 0 }
        ]
    });
    let (status, _) = app
        .request(Method::PUT, &reorder_uri, Some(&token), Some(body))
        .await;
    assert_eq!(status, StatusCode::OK);
}

// ─── Invites Extended ───────────────────────────────────

#[sqlx::test(migrations = "./migrations")]
async fn list_invites(pool: PgPool) {
    let app = TestApp::new(pool).await;
    let (token, _) = app.register_user("inv_lister").await;
    let server_id = app.create_server(&token, "Invite List").await;

    // Create two invites
    let uri = format!("/api/v1/servers/{}/invites", server_id);
    app.request(
        Method::POST,
        &uri,
        Some(&token),
        Some(json!({ "expires_in_hours": 24 })),
    )
    .await;
    app.request(
        Method::POST,
        &uri,
        Some(&token),
        Some(json!({ "expires_in_hours": 48 })),
    )
    .await;

    let (status, value) = app.request(Method::GET, &uri, Some(&token), None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(value.as_array().unwrap().len(), 2);
}

#[sqlx::test(migrations = "./migrations")]
async fn delete_invite(pool: PgPool) {
    let app = TestApp::new(pool).await;
    let (token, _) = app.register_user("inv_deleter").await;
    let server_id = app.create_server(&token, "Invite Delete").await;

    let uri = format!("/api/v1/servers/{}/invites", server_id);
    let (_, inv_val) = app
        .request(
            Method::POST,
            &uri,
            Some(&token),
            Some(json!({ "expires_in_hours": 24 })),
        )
        .await;
    let invite_id = inv_val["id"].as_str().unwrap();

    let del_uri = format!("/api/v1/servers/{}/invites/{}", server_id, invite_id);
    let (status, value) = app
        .request(Method::DELETE, &del_uri, Some(&token), None)
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(value["deleted"].as_bool(), Some(true));
}

// ─── Server Members ─────────────────────────────────────

#[sqlx::test(migrations = "./migrations")]
async fn list_server_members(pool: PgPool) {
    let app = TestApp::new(pool).await;
    let (token_owner, _) = app.register_user("mem_owner").await;
    let (token_member, _) = app.register_user("mem_member").await;
    let server_id = app.create_server(&token_owner, "Member List").await;

    app.invite_and_join(&token_owner, &token_member, server_id).await;

    let uri = format!("/api/v1/servers/{}/members", server_id);
    let (status, value) = app
        .request(Method::GET, &uri, Some(&token_owner), None)
        .await;
    assert_eq!(status, StatusCode::OK);
    let members = value.as_array().unwrap();
    assert_eq!(members.len(), 2);
}

#[sqlx::test(migrations = "./migrations")]
async fn kick_member(pool: PgPool) {
    let app = TestApp::new(pool).await;
    let (token_owner, _) = app.register_user("kick_owner").await;
    let (token_member, member_id) = app.register_user("kick_target").await;
    let server_id = app.create_server(&token_owner, "Kick Test").await;

    app.invite_and_join(&token_owner, &token_member, server_id).await;

    let kick_uri = format!("/api/v1/servers/{}/members/{}", server_id, member_id);
    let (status, value) = app
        .request(Method::DELETE, &kick_uri, Some(&token_owner), None)
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(value["kicked"].as_bool(), Some(true));

    // Verify member list reduced
    let list_uri = format!("/api/v1/servers/{}/members", server_id);
    let (_, value) = app
        .request(Method::GET, &list_uri, Some(&token_owner), None)
        .await;
    assert_eq!(value.as_array().unwrap().len(), 1);
}

// ─── Channel Update ─────────────────────────────────────

#[sqlx::test(migrations = "./migrations")]
async fn update_channel_meta(pool: PgPool) {
    let app = TestApp::new(pool).await;
    let (token, _) = app.register_user("ch_updater").await;
    let server_id = app.create_server(&token, "Ch Update").await;
    let channel_id = app.create_channel(&token, server_id, "old-name").await;

    use base64::Engine;
    let b64 = &base64::engine::general_purpose::STANDARD;
    let body = json!({ "encrypted_meta": b64.encode(b"new-name") });
    let uri = format!("/api/v1/channels/{}", channel_id);
    let (status, value) = app
        .request(Method::PUT, &uri, Some(&token), Some(body))
        .await;
    assert_eq!(status, StatusCode::OK);
    assert!(value["encrypted_meta"].as_str().is_some());
}

#[sqlx::test(migrations = "./migrations")]
async fn join_channel(pool: PgPool) {
    let app = TestApp::new(pool).await;
    let (token_owner, _) = app.register_user("join_owner").await;
    let (token_member, _) = app.register_user("join_member").await;
    let server_id = app.create_server(&token_owner, "Join Test").await;

    app.invite_and_join(&token_owner, &token_member, server_id).await;

    let channel_id = app.create_channel(&token_owner, server_id, "new-channel").await;

    let join_uri = format!("/api/v1/channels/{}/join", channel_id);
    let (status, _) = app
        .request(Method::POST, &join_uri, Some(&token_member), None)
        .await;
    assert_eq!(status, StatusCode::OK);
}

// ─── Channel Overwrites ─────────────────────────────────

#[sqlx::test(migrations = "./migrations")]
async fn set_and_list_overwrites(pool: PgPool) {
    let app = TestApp::new(pool).await;
    let (token, _) = app.register_user("ow_user").await;
    let server_id = app.create_server(&token, "Overwrite Test").await;
    let channel_id = app.create_channel(&token, server_id, "restricted").await;

    // Get the @everyone role to use as target
    let roles_uri = format!("/api/v1/servers/{}/roles", server_id);
    let (_, roles_val) = app
        .request(Method::GET, &roles_uri, Some(&token), None)
        .await;
    let everyone_role = roles_val
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["is_default"].as_bool() == Some(true))
        .unwrap();
    let role_id = everyone_role["id"].as_str().unwrap();

    // Set an overwrite
    let ow_uri = format!("/api/v1/channels/{}/overwrites", channel_id);
    let body = json!({
        "target_type": "role",
        "target_id": role_id,
        "allow_bits": "0",
        "deny_bits": "256"  // deny SEND_MESSAGES
    });
    let (status, value) = app
        .request(Method::PUT, &ow_uri, Some(&token), Some(body))
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(value["target_type"].as_str(), Some("role"));

    // List overwrites
    let (status, value) = app
        .request(Method::GET, &ow_uri, Some(&token), None)
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(value.as_array().unwrap().len(), 1);
}

#[sqlx::test(migrations = "./migrations")]
async fn delete_overwrite(pool: PgPool) {
    let app = TestApp::new(pool).await;
    let (token, _) = app.register_user("ow_del").await;
    let server_id = app.create_server(&token, "OW Delete").await;
    let channel_id = app.create_channel(&token, server_id, "ch").await;

    let roles_uri = format!("/api/v1/servers/{}/roles", server_id);
    let (_, roles_val) = app
        .request(Method::GET, &roles_uri, Some(&token), None)
        .await;
    let role_id = roles_val
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["is_default"].as_bool() == Some(true))
        .unwrap()["id"]
        .as_str()
        .unwrap();

    // Create overwrite
    let ow_uri = format!("/api/v1/channels/{}/overwrites", channel_id);
    app.request(
        Method::PUT,
        &ow_uri,
        Some(&token),
        Some(json!({
            "target_type": "role",
            "target_id": role_id,
            "allow_bits": "0",
            "deny_bits": "256"
        })),
    )
    .await;

    // Delete it
    let del_uri = format!(
        "/api/v1/channels/{}/overwrites/role/{}",
        channel_id, role_id
    );
    let (status, _) = app
        .request(Method::DELETE, &del_uri, Some(&token), None)
        .await;
    assert_eq!(status, StatusCode::OK);

    // Verify empty
    let (_, value) = app
        .request(Method::GET, &ow_uri, Some(&token), None)
        .await;
    assert_eq!(value.as_array().unwrap().len(), 0);
}

// ─── Keys ───────────────────────────────────────────────

#[sqlx::test(migrations = "./migrations")]
async fn get_key_bundle(pool: PgPool) {
    let app = TestApp::new(pool).await;
    let (token_a, _) = app.register_user("key_requester").await;
    let (_, user_b) = app.register_user("key_target").await;

    let uri = format!("/api/v1/users/{}/keys", user_b);
    let (status, value) = app.request(Method::GET, &uri, Some(&token_a), None).await;
    assert_eq!(status, StatusCode::OK);
    assert!(value["identity_key"].as_str().is_some());
    assert!(value["signed_prekey"].as_str().is_some());
    assert!(value["signed_prekey_sig"].as_str().is_some());
}

#[sqlx::test(migrations = "./migrations")]
async fn upload_and_count_prekeys(pool: PgPool) {
    let app = TestApp::new(pool).await;
    let (token, _) = app.register_user("prekey_user").await;

    use base64::Engine;
    let b64 = &base64::engine::general_purpose::STANDARD;
    let prekeys: Vec<String> = (0..5).map(|i| b64.encode([i as u8; 32])).collect();

    let body = json!({ "prekeys": prekeys });
    let (status, value) = app
        .request(
            Method::POST,
            "/api/v1/keys/prekeys",
            Some(&token),
            Some(body),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(value["total_available"].as_i64(), Some(5));

    // Check count
    let (status, value) = app
        .request(
            Method::GET,
            "/api/v1/keys/prekeys/count",
            Some(&token),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(value["count"].as_i64(), Some(5));
}

#[sqlx::test(migrations = "./migrations")]
async fn update_identity_keys(pool: PgPool) {
    let app = TestApp::new(pool).await;
    let (token, _) = app.register_user("key_updater").await;

    use base64::Engine;
    let b64 = &base64::engine::general_purpose::STANDARD;
    let body = json!({
        "identity_key": b64.encode([1u8; 32]),
        "signed_prekey": b64.encode([2u8; 32]),
        "signed_prekey_signature": b64.encode([3u8; 64])
    });

    let (status, _) = app
        .request(
            Method::PUT,
            "/api/v1/keys/identity",
            Some(&token),
            Some(body),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
}

// ─── Attachments ────────────────────────────────────────

#[sqlx::test(migrations = "./migrations")]
async fn upload_attachment(pool: PgPool) {
    let app = TestApp::new(pool).await;
    let (token, _) = app.register_user("attach_user").await;

    let data = vec![0u8; 1024]; // 1KB of zeros
    let (status, value) = app
        .request_bytes(Method::POST, "/api/v1/attachments/upload", Some(&token), data)
        .await;
    assert_eq!(status, StatusCode::OK);
    assert!(value["attachment_id"].as_str().is_some());
    assert!(value["storage_key"].as_str().is_some());
}

#[sqlx::test(migrations = "./migrations")]
async fn upload_empty_attachment_fails(pool: PgPool) {
    let app = TestApp::new(pool).await;
    let (token, _) = app.register_user("empty_attach").await;

    let (status, _) = app
        .request_bytes(Method::POST, "/api/v1/attachments/upload", Some(&token), vec![])
        .await;
    assert_ne!(status, StatusCode::OK);
}

// ─── DM Privacy ─────────────────────────────────────────

#[sqlx::test(migrations = "./migrations")]
async fn update_dm_privacy(pool: PgPool) {
    let app = TestApp::new(pool).await;
    let (token, _) = app.register_user("dm_priv_user").await;

    let body = json!({ "dm_privacy": "friends_only" });
    let (status, value) = app
        .request(
            Method::PUT,
            "/api/v1/users/dm-privacy",
            Some(&token),
            Some(body),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(value["dm_privacy"].as_str(), Some("friends_only"));
}

#[sqlx::test(migrations = "./migrations")]
async fn update_dm_privacy_invalid_value(pool: PgPool) {
    let app = TestApp::new(pool).await;
    let (token, _) = app.register_user("dm_priv_bad").await;

    let body = json!({ "dm_privacy": "invalid_value" });
    let (status, _) = app
        .request(
            Method::PUT,
            "/api/v1/users/dm-privacy",
            Some(&token),
            Some(body),
        )
        .await;
    assert_ne!(status, StatusCode::OK);
}

#[sqlx::test(migrations = "./migrations")]
async fn dm_friends_only_creates_pending_dm(pool: PgPool) {
    let app = TestApp::new(pool).await;
    let (token_a, _) = app.register_user("dm_fo_a").await;
    let (token_b, user_b) = app.register_user("dm_fo_b").await;

    // B sets friends_only
    app.request(
        Method::PUT,
        "/api/v1/users/dm-privacy",
        Some(&token_b),
        Some(json!({ "dm_privacy": "friends_only" })),
    )
    .await;

    // A (not a friend) creates DM with B — should be pending
    use base64::Engine;
    let b64 = &base64::engine::general_purpose::STANDARD;
    let body = json!({
        "target_user_id": user_b,
        "encrypted_meta": b64.encode(b"dm-meta")
    });
    let (status, value) = app
        .request(Method::POST, "/api/v1/dm", Some(&token_a), Some(body))
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(value["dm_status"].as_str(), Some("pending"));
}

// ─── Friends Extended ───────────────────────────────────

#[sqlx::test(migrations = "./migrations")]
async fn remove_friend(pool: PgPool) {
    let app = TestApp::new(pool).await;
    let (token_a, _) = app.register_user("remove_a").await;
    let (token_b, _) = app.register_user("remove_b").await;

    let friendship_id = app.make_friends(&token_a, &token_b, "remove_b").await;

    let uri = format!("/api/v1/friends/{}", friendship_id);
    let (status, _) = app
        .request(Method::DELETE, &uri, Some(&token_a), None)
        .await;
    assert_eq!(status, StatusCode::OK);

    // Friends list should be empty
    let (_, value) = app
        .request(Method::GET, "/api/v1/friends", Some(&token_a), None)
        .await;
    let friends = value.as_array().unwrap();
    assert!(friends.is_empty());
}

// ─── Reactions ──────────────────────────────────────────

#[sqlx::test(migrations = "./migrations")]
async fn get_channel_reactions_empty(pool: PgPool) {
    let app = TestApp::new(pool).await;
    let (token, _) = app.register_user("react_user").await;
    let server_id = app.create_server(&token, "React Server").await;
    let channel_id = app.create_channel(&token, server_id, "general").await;

    let uri = format!("/api/v1/channels/{}/reactions", channel_id);
    let (status, value) = app.request(Method::GET, &uri, Some(&token), None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(value.as_array().unwrap().len(), 0);
}

// ─── Presence ───────────────────────────────────────────

#[sqlx::test(migrations = "./migrations")]
async fn get_presence_returns_offline_for_unknown(pool: PgPool) {
    let app = TestApp::new(pool).await;
    let random_id = Uuid::new_v4();
    let uri = format!("/api/v1/presence?user_ids={}", random_id);
    let (status, value) = app.request(Method::GET, &uri, None, None).await;
    assert_eq!(status, StatusCode::OK);
    let entries = value.as_array().unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0]["status"].as_str(), Some("offline"));
}

#[sqlx::test(migrations = "./migrations")]
async fn get_presence_empty_ids_returns_empty(pool: PgPool) {
    let app = TestApp::new(pool).await;
    let (status, value) = app
        .request(Method::GET, "/api/v1/presence?user_ids=", None, None)
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(value.as_array().unwrap().len(), 0);
}
