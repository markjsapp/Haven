import { useChatStore } from "../store/chat.js";
import { useAuthStore } from "../store/auth.js";
import { useUiStore } from "../store/ui.js";
import { Permission } from "@haven/core";

/**
 * Hook that returns the current user's effective permissions for a server.
 *
 * @param serverId - Optional server ID. Defaults to the currently selected server.
 * @returns `can(perm)` to check a permission, `isOwner`, `isAdmin`, and the raw `permissions` bigint.
 */
export function usePermissions(serverId?: string | null) {
  const selectedServerId = useUiStore((s) => s.selectedServerId);
  const effectiveServerId = serverId !== undefined ? serverId : selectedServerId;

  const permissions = useChatStore(
    (s) => (effectiveServerId ? s.myPermissions[effectiveServerId] : undefined) ?? BigInt(0),
  );
  const server = useChatStore((s) =>
    s.servers.find((sv) => sv.id === effectiveServerId),
  );
  const userId = useAuthStore((s) => s.user?.id);

  const isOwner = Boolean(server && userId && server.owner_id === userId);
  const isAdmin =
    isOwner ||
    (permissions & Permission.ADMINISTRATOR) === Permission.ADMINISTRATOR;

  function can(perm: bigint): boolean {
    if (isOwner) return true;
    if ((permissions & Permission.ADMINISTRATOR) === Permission.ADMINISTRATOR)
      return true;
    return (permissions & perm) === perm;
  }

  return { can, permissions, isOwner, isAdmin };
}
