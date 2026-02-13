import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { axe } from "vitest-axe";
import ErrorModal from "../ErrorModal.js";
import LinkWarningModal from "../LinkWarningModal.js";
import ConfirmDialog from "../ConfirmDialog.js";

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
});
