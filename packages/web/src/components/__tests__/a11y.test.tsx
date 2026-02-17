import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { axe } from "vitest-axe";
import ErrorModal from "../ErrorModal.js";
import LinkWarningModal from "../LinkWarningModal.js";
import ConfirmDialog from "../ConfirmDialog.js";

// ─── ErrorModal ──────────────────────────────────────

describe("Accessibility: ErrorModal", () => {
  it("should have no a11y violations", async () => {
    const { container } = render(
      <ErrorModal
        message="Something went wrong"
        onClose={() => {}}
      />
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("should have no a11y violations with custom title", async () => {
    const { container } = render(
      <ErrorModal
        title="Connection Failed"
        message="Unable to reach the server. Please try again later."
        onClose={() => {}}
      />
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});

// ─── LinkWarningModal ────────────────────────────────

describe("Accessibility: LinkWarningModal", () => {
  it("should have no a11y violations", async () => {
    const { container } = render(
      <LinkWarningModal
        url="https://example.com"
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("should have no a11y violations with a long URL", async () => {
    const { container } = render(
      <LinkWarningModal
        url="https://example.com/very/long/path?query=string&param=value#fragment"
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});

// ─── ConfirmDialog ───────────────────────────────────

describe("Accessibility: ConfirmDialog", () => {
  it("should have no a11y violations", async () => {
    const { container } = render(
      <ConfirmDialog
        title="Confirm Action"
        message="Are you sure?"
        confirmLabel="Confirm"
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("should have no a11y violations in danger mode", async () => {
    const { container } = render(
      <ConfirmDialog
        title="Delete Item"
        message="This cannot be undone."
        confirmLabel="Delete"
        danger
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("should have no a11y violations with custom cancel label", async () => {
    const { container } = render(
      <ConfirmDialog
        title="Leave Server"
        message="You will lose access to all channels in this server."
        confirmLabel="Leave"
        cancelLabel="Stay"
        danger
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("should trap focus within the dialog", () => {
    const { getByRole } = render(
      <ConfirmDialog
        title="Test Focus"
        message="Focus test"
        confirmLabel="OK"
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );
    const dialog = getByRole("alertdialog");
    expect(dialog).toBeTruthy();
    const buttons = dialog.querySelectorAll("button");
    expect(buttons.length).toBeGreaterThanOrEqual(1);
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("buttons should be keyboard focusable", () => {
    const { getAllByRole } = render(
      <ConfirmDialog
        title="Test"
        message="Test"
        confirmLabel="Yes"
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );
    const buttons = getAllByRole("button");
    buttons.forEach(btn => {
      expect(btn.tabIndex).not.toBe(-1);
    });
  });
});

// ─── CreateChannelModal ─────────────────────────────

vi.mock("../../store/auth.js", () => ({
  useAuthStore: (selector: (s: any) => any) => selector({
    api: { createChannel: vi.fn().mockResolvedValue({}) },
  }),
}));

vi.mock("../../store/chat.js", () => ({
  useChatStore: (selector: (s: any) => any) => selector({
    loadChannels: vi.fn().mockResolvedValue(undefined),
  }),
}));

const { default: CreateChannelModal } = await import("../CreateChannelModal.js");
const { default: BanMemberModal } = await import("../BanMemberModal.js");

describe("Accessibility: CreateChannelModal", () => {
  it("should have no a11y violations", async () => {
    const { container } = render(
      <CreateChannelModal
        serverId="test-server-id"
        onClose={() => {}}
      />
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("should have no a11y violations with category", async () => {
    const { container } = render(
      <CreateChannelModal
        serverId="test-server-id"
        categoryId="test-cat-id"
        categoryName="General"
        onClose={() => {}}
      />
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("should have properly associated labels", () => {
    const { container } = render(
      <CreateChannelModal
        serverId="test-server-id"
        onClose={() => {}}
      />
    );
    const nameInput = container.querySelector("#create-channel-name");
    expect(nameInput).toBeTruthy();
    const label = container.querySelector('label[for="create-channel-name"]');
    expect(label).toBeTruthy();
    expect(label?.textContent).toContain("CHANNEL NAME");
  });

  it("should use fieldset for channel type radio group", () => {
    const { container } = render(
      <CreateChannelModal
        serverId="test-server-id"
        onClose={() => {}}
      />
    );
    const fieldset = container.querySelector("fieldset");
    expect(fieldset).toBeTruthy();
    const legend = fieldset?.querySelector("legend");
    expect(legend).toBeTruthy();
    expect(legend?.textContent).toContain("CHANNEL TYPE");
  });
});

// ─── BanMemberModal ─────────────────────────────────

describe("Accessibility: BanMemberModal", () => {
  it("should have no a11y violations", async () => {
    const { container } = render(
      <BanMemberModal
        serverId="test-server"
        userId="test-user"
        username="TestUser"
        onBanned={() => {}}
        onClose={() => {}}
      />
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("should have an associated label for the reason textarea", () => {
    const { container } = render(
      <BanMemberModal
        serverId="test-server"
        userId="test-user"
        username="TestUser"
        onBanned={() => {}}
        onClose={() => {}}
      />
    );
    const textarea = container.querySelector("textarea");
    expect(textarea).toBeTruthy();
    const label = textarea?.closest("label");
    expect(label).toBeTruthy();
    expect(label?.textContent).toContain("Reason");
  });
});
