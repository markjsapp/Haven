import { describe, it, expect, beforeEach } from "vitest";
import { useUiStore } from "../ui.js";

beforeEach(() => {
  // Clear persisted state to prevent cross-test leakage
  localStorage.clear();
  // Reset store to defaults before each test
  useUiStore.setState({
    selectedServerId: null,
    memberSidebarOpen: true,
    showFriends: false,
    showUserSettings: false,
    pinnedPanelOpen: false,
    searchPanelOpen: false,
  });
});

describe("useUiStore", () => {
  describe("initial state", () => {
    it("has no server selected", () => {
      expect(useUiStore.getState().selectedServerId).toBeNull();
    });

    it("has member sidebar open by default", () => {
      expect(useUiStore.getState().memberSidebarOpen).toBe(true);
    });

    it("has showFriends false by default", () => {
      expect(useUiStore.getState().showFriends).toBe(false);
    });

    it("has pinnedPanelOpen false by default", () => {
      expect(useUiStore.getState().pinnedPanelOpen).toBe(false);
    });

    it("has searchPanelOpen false by default", () => {
      expect(useUiStore.getState().searchPanelOpen).toBe(false);
    });

    it("has showUserSettings false by default", () => {
      expect(useUiStore.getState().showUserSettings).toBe(false);
    });
  });

  describe("selectServer", () => {
    it("sets selectedServerId to a server id", () => {
      useUiStore.getState().selectServer("server-1");
      expect(useUiStore.getState().selectedServerId).toBe("server-1");
    });

    it("opens member sidebar when selecting a server", () => {
      useUiStore.setState({ memberSidebarOpen: false });
      useUiStore.getState().selectServer("server-1");
      expect(useUiStore.getState().memberSidebarOpen).toBe(true);
    });

    it("hides friends list when selecting a server", () => {
      useUiStore.setState({ showFriends: true });
      useUiStore.getState().selectServer("server-1");
      expect(useUiStore.getState().showFriends).toBe(false);
    });

    it("sets selectedServerId to null for Home/DMs", () => {
      useUiStore.getState().selectServer("server-1");
      useUiStore.getState().selectServer(null);
      expect(useUiStore.getState().selectedServerId).toBeNull();
    });

    it("closes member sidebar when going to Home", () => {
      useUiStore.getState().selectServer("server-1");
      useUiStore.getState().selectServer(null);
      expect(useUiStore.getState().memberSidebarOpen).toBe(false);
    });

    it("shows friends list when going to Home", () => {
      useUiStore.getState().selectServer(null);
      expect(useUiStore.getState().showFriends).toBe(true);
    });
  });

  describe("toggleMemberSidebar", () => {
    it("toggles from open to closed", () => {
      useUiStore.setState({ memberSidebarOpen: true });
      useUiStore.getState().toggleMemberSidebar();
      expect(useUiStore.getState().memberSidebarOpen).toBe(false);
    });

    it("toggles from closed to open", () => {
      useUiStore.setState({ memberSidebarOpen: false });
      useUiStore.getState().toggleMemberSidebar();
      expect(useUiStore.getState().memberSidebarOpen).toBe(true);
    });

    it("double toggle returns to original state", () => {
      useUiStore.setState({ memberSidebarOpen: true });
      useUiStore.getState().toggleMemberSidebar();
      useUiStore.getState().toggleMemberSidebar();
      expect(useUiStore.getState().memberSidebarOpen).toBe(true);
    });
  });

  describe("setShowFriends", () => {
    it("sets showFriends to true", () => {
      useUiStore.getState().setShowFriends(true);
      expect(useUiStore.getState().showFriends).toBe(true);
    });

    it("sets showFriends to false", () => {
      useUiStore.setState({ showFriends: true });
      useUiStore.getState().setShowFriends(false);
      expect(useUiStore.getState().showFriends).toBe(false);
    });
  });

  describe("setShowUserSettings", () => {
    it("sets showUserSettings to true", () => {
      useUiStore.getState().setShowUserSettings(true);
      expect(useUiStore.getState().showUserSettings).toBe(true);
    });

    it("sets showUserSettings to false", () => {
      useUiStore.setState({ showUserSettings: true });
      useUiStore.getState().setShowUserSettings(false);
      expect(useUiStore.getState().showUserSettings).toBe(false);
    });
  });

  describe("togglePinnedPanel", () => {
    it("opens pinned panel when closed", () => {
      useUiStore.getState().togglePinnedPanel();
      expect(useUiStore.getState().pinnedPanelOpen).toBe(true);
    });

    it("closes pinned panel when open", () => {
      useUiStore.setState({ pinnedPanelOpen: true });
      useUiStore.getState().togglePinnedPanel();
      expect(useUiStore.getState().pinnedPanelOpen).toBe(false);
    });

    it("closes search panel when opening pinned panel", () => {
      useUiStore.setState({ searchPanelOpen: true });
      useUiStore.getState().togglePinnedPanel();
      expect(useUiStore.getState().pinnedPanelOpen).toBe(true);
      expect(useUiStore.getState().searchPanelOpen).toBe(false);
    });
  });

  describe("toggleSearchPanel", () => {
    it("opens search panel when closed", () => {
      useUiStore.getState().toggleSearchPanel();
      expect(useUiStore.getState().searchPanelOpen).toBe(true);
    });

    it("closes search panel when open", () => {
      useUiStore.setState({ searchPanelOpen: true });
      useUiStore.getState().toggleSearchPanel();
      expect(useUiStore.getState().searchPanelOpen).toBe(false);
    });

    it("closes pinned panel when opening search panel", () => {
      useUiStore.setState({ pinnedPanelOpen: true });
      useUiStore.getState().toggleSearchPanel();
      expect(useUiStore.getState().searchPanelOpen).toBe(true);
      expect(useUiStore.getState().pinnedPanelOpen).toBe(false);
    });
  });

  describe("panels are mutually exclusive", () => {
    it("opening pinned closes search", () => {
      useUiStore.setState({ searchPanelOpen: true, pinnedPanelOpen: false });
      useUiStore.getState().togglePinnedPanel();
      expect(useUiStore.getState().pinnedPanelOpen).toBe(true);
      expect(useUiStore.getState().searchPanelOpen).toBe(false);
    });

    it("opening search closes pinned", () => {
      useUiStore.setState({ pinnedPanelOpen: true, searchPanelOpen: false });
      useUiStore.getState().toggleSearchPanel();
      expect(useUiStore.getState().searchPanelOpen).toBe(true);
      expect(useUiStore.getState().pinnedPanelOpen).toBe(false);
    });
  });
});
