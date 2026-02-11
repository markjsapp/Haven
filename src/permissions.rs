/// Permission bitfield constants (Discord-style).
/// Each permission is a single bit in a u64 / i64.

pub const ADMINISTRATOR: i64         = 1 << 0;
pub const MANAGE_SERVER: i64         = 1 << 1;
pub const MANAGE_ROLES: i64          = 1 << 2;
pub const MANAGE_CHANNELS: i64       = 1 << 3;
pub const KICK_MEMBERS: i64          = 1 << 4;
pub const BAN_MEMBERS: i64           = 1 << 5;
pub const MANAGE_MESSAGES: i64       = 1 << 6;
pub const VIEW_CHANNELS: i64         = 1 << 7;
pub const SEND_MESSAGES: i64         = 1 << 8;
pub const CREATE_INVITES: i64        = 1 << 9;
pub const MANAGE_INVITES: i64        = 1 << 10;
pub const ADD_REACTIONS: i64         = 1 << 11;
pub const MENTION_EVERYONE: i64      = 1 << 12;
pub const ATTACH_FILES: i64          = 1 << 13;
pub const READ_MESSAGE_HISTORY: i64  = 1 << 14;

/// Default permissions for the @everyone role.
pub const DEFAULT_PERMISSIONS: i64 =
    VIEW_CHANNELS | SEND_MESSAGES | ADD_REACTIONS | READ_MESSAGE_HISTORY | CREATE_INVITES | ATTACH_FILES;

/// Check if a permission bitfield has a specific permission.
#[inline]
pub fn has_permission(permissions: i64, required: i64) -> bool {
    // ADMINISTRATOR bypasses all checks
    if permissions & ADMINISTRATOR != 0 {
        return true;
    }
    permissions & required == required
}

/// Compute a member's effective server-level permissions.
///
/// Algorithm: start with @everyone base -> OR all member's role permissions -> ADMIN check.
/// If the user is the server owner, return all permissions.
pub fn compute_server_permissions(
    is_owner: bool,
    everyone_perms: i64,
    member_role_perms: &[i64],
) -> i64 {
    if is_owner {
        return i64::MAX; // owner has all perms
    }

    let mut perms = everyone_perms;
    for &role_perms in member_role_perms {
        perms |= role_perms;
    }

    // If ADMINISTRATOR is set, grant everything
    if perms & ADMINISTRATOR != 0 {
        return i64::MAX;
    }

    perms
}

/// Apply channel-level overwrites to a base permission set.
///
/// Process: base perms -> apply @everyone overwrite -> apply role overwrites -> apply member overwrite.
/// ADMINISTRATOR bypasses all overwrites.
pub fn apply_channel_overwrites(
    base_perms: i64,
    overwrites: &[(OverwriteTarget, i64, i64)], // (target, allow, deny)
    member_role_ids: &[uuid::Uuid],
    user_id: uuid::Uuid,
    everyone_role_id: uuid::Uuid,
) -> i64 {
    // ADMINISTRATOR bypasses
    if base_perms & ADMINISTRATOR != 0 || base_perms == i64::MAX {
        return i64::MAX;
    }

    let mut perms = base_perms;

    // 1. Apply @everyone role overwrite
    for (target, allow, deny) in overwrites {
        if let OverwriteTarget::Role(role_id) = target {
            if *role_id == everyone_role_id {
                perms &= !deny;
                perms |= allow;
            }
        }
    }

    // 2. Apply role overwrites (OR all allows, OR all denies)
    let mut role_allow: i64 = 0;
    let mut role_deny: i64 = 0;
    for (target, allow, deny) in overwrites {
        if let OverwriteTarget::Role(role_id) = target {
            if *role_id != everyone_role_id && member_role_ids.contains(role_id) {
                role_allow |= allow;
                role_deny |= deny;
            }
        }
    }
    perms &= !role_deny;
    perms |= role_allow;

    // 3. Apply member-specific overwrite
    for (target, allow, deny) in overwrites {
        if let OverwriteTarget::Member(uid) = target {
            if *uid == user_id {
                perms &= !deny;
                perms |= allow;
            }
        }
    }

    perms
}

#[derive(Debug, Clone)]
pub enum OverwriteTarget {
    Role(uuid::Uuid),
    Member(uuid::Uuid),
}
