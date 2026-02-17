/**
 * Multi-tab coordination via BroadcastChannel.
 *
 * Uses leader election so only one tab owns the WebSocket connection.
 * Other tabs receive state updates via broadcast and relay send requests
 * through the leader.
 *
 * Gracefully degrades: if BroadcastChannel is unsupported, every tab
 * operates independently (current behavior).
 */

export type TabRole = "leader" | "follower" | "solo";

interface TabMessage {
  type:
    | "heartbeat"
    | "claim-leader"
    | "leader-ack"
    | "ws-event"
    | "ws-send"
    | "tab-closing";
  tabId: string;
  timestamp: number;
  payload?: unknown;
}

const CHANNEL_NAME = "haven-tabs";
const HEARTBEAT_INTERVAL = 3000;
const LEADER_TIMEOUT = 6000; // If no heartbeat in this time, leader is dead

let channel: BroadcastChannel | null = null;
let tabId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let role: TabRole = "solo";
let leaderId: string | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let leaderCheckTimer: ReturnType<typeof setInterval> | null = null;
let lastLeaderHeartbeat = 0;
let onRoleChangeCallback: ((role: TabRole) => void) | null = null;
let onWsEventCallback: ((event: unknown) => void) | null = null;
let onWsSendCallback: ((data: unknown) => void) | null = null;

function broadcast(msg: Omit<TabMessage, "tabId" | "timestamp">): void {
  if (!channel) return;
  try {
    channel.postMessage({ ...msg, tabId, timestamp: Date.now() } as TabMessage);
  } catch {
    // Channel closed
  }
}

function handleMessage(msg: TabMessage): void {
  if (msg.tabId === tabId) return; // Ignore own messages

  switch (msg.type) {
    case "heartbeat":
      if (msg.tabId === leaderId) {
        lastLeaderHeartbeat = Date.now();
      }
      break;

    case "claim-leader":
      // Someone is claiming leader — if we're already leader with lower ID, re-assert
      if (role === "leader" && tabId < msg.tabId) {
        broadcast({ type: "leader-ack", payload: { leaderId: tabId } });
      } else if (role !== "leader") {
        // Accept their claim
        leaderId = msg.tabId;
        lastLeaderHeartbeat = Date.now();
        setRole("follower");
      }
      break;

    case "leader-ack":
      leaderId = (msg.payload as { leaderId: string }).leaderId;
      lastLeaderHeartbeat = Date.now();
      if (role !== "leader" || leaderId !== tabId) {
        setRole("follower");
      }
      break;

    case "ws-event":
      // Leader broadcasting a WS event to followers
      if (role === "follower" && onWsEventCallback) {
        onWsEventCallback(msg.payload);
      }
      break;

    case "ws-send":
      // Follower requesting leader to send via WS
      if (role === "leader" && onWsSendCallback) {
        onWsSendCallback(msg.payload);
      }
      break;

    case "tab-closing":
      if (msg.tabId === leaderId) {
        // Leader is closing — trigger election
        leaderId = null;
        tryBecomeLeader();
      }
      break;
  }
}

function setRole(newRole: TabRole): void {
  if (role === newRole) return;
  role = newRole;
  onRoleChangeCallback?.(newRole);

  // Leader sends heartbeats
  if (newRole === "leader") {
    leaderId = tabId;
    heartbeatTimer = setInterval(() => {
      broadcast({ type: "heartbeat" });
    }, HEARTBEAT_INTERVAL);
  } else {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }
}

function tryBecomeLeader(): void {
  broadcast({ type: "claim-leader" });
  // Wait briefly for challenges, then assume leadership if no one objects
  setTimeout(() => {
    if (!leaderId || leaderId === tabId) {
      setRole("leader");
      broadcast({ type: "leader-ack", payload: { leaderId: tabId } });
    }
  }, 500);
}

function checkLeaderAlive(): void {
  if (role === "follower" && leaderId && Date.now() - lastLeaderHeartbeat > LEADER_TIMEOUT) {
    // Leader seems dead — try to become leader
    leaderId = null;
    tryBecomeLeader();
  }
}

// ─── Public API ─────────────────────────────────────────

/** Initialize tab sync. Returns current role. */
export function initTabSync(): TabRole {
  if (typeof BroadcastChannel === "undefined") {
    role = "solo";
    return role;
  }

  try {
    channel = new BroadcastChannel(CHANNEL_NAME);
    channel.onmessage = (e) => handleMessage(e.data as TabMessage);
  } catch {
    role = "solo";
    return role;
  }

  // Try to become leader
  tryBecomeLeader();

  // Periodically check if leader is alive
  leaderCheckTimer = setInterval(checkLeaderAlive, HEARTBEAT_INTERVAL);

  // Clean up on tab close
  window.addEventListener("beforeunload", () => {
    broadcast({ type: "tab-closing" });
    cleanup();
  });

  return role;
}

/** Get current tab role. */
export function getTabRole(): TabRole {
  return role;
}

/** Check if this tab should own the WebSocket connection. */
export function isWsOwner(): boolean {
  return role === "leader" || role === "solo";
}

/** Called by the leader to broadcast a WS event to follower tabs. */
export function broadcastWsEvent(event: unknown): void {
  broadcast({ type: "ws-event", payload: event });
}

/** Called by followers to request the leader tab to send something via WS. */
export function requestWsSend(data: unknown): void {
  broadcast({ type: "ws-send", payload: data });
}

/** Register callback for role changes. */
export function onRoleChange(cb: (role: TabRole) => void): void {
  onRoleChangeCallback = cb;
}

/** Register callback for WS events received from leader (follower only). */
export function onWsEvent(cb: (event: unknown) => void): void {
  onWsEventCallback = cb;
}

/** Register callback for WS send requests from followers (leader only). */
export function onWsSend(cb: (data: unknown) => void): void {
  onWsSendCallback = cb;
}

/** Clean up resources. */
export function cleanup(): void {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (leaderCheckTimer) clearInterval(leaderCheckTimer);
  heartbeatTimer = null;
  leaderCheckTimer = null;
  channel?.close();
  channel = null;
}
