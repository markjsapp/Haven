import { describe, it, expect, beforeEach } from "vitest";
import { saveDraft, loadDraft, clearDraft } from "../draft-store.js";

beforeEach(() => {
  localStorage.clear();
});

describe("draft-store", () => {
  it("loadDraft returns null for unknown channel", () => {
    expect(loadDraft("unknown-channel")).toBeNull();
  });

  it("saveDraft and loadDraft round-trip", () => {
    const draft = { type: "doc", content: [{ type: "paragraph", text: "hello" }] };
    saveDraft("ch1", draft);
    expect(loadDraft("ch1")).toEqual(draft);
  });

  it("clearDraft removes the draft", () => {
    saveDraft("ch1", { text: "draft" });
    clearDraft("ch1");
    expect(loadDraft("ch1")).toBeNull();
  });

  it("stores drafts independently per channel", () => {
    saveDraft("ch1", { text: "one" });
    saveDraft("ch2", { text: "two" });
    expect(loadDraft("ch1")).toEqual({ text: "one" });
    expect(loadDraft("ch2")).toEqual({ text: "two" });
  });

  it("overwriting a draft replaces the old value", () => {
    saveDraft("ch1", { text: "first" });
    saveDraft("ch1", { text: "second" });
    expect(loadDraft("ch1")).toEqual({ text: "second" });
  });

  it("clearDraft only removes the targeted channel", () => {
    saveDraft("ch1", { text: "one" });
    saveDraft("ch2", { text: "two" });
    clearDraft("ch1");
    expect(loadDraft("ch1")).toBeNull();
    expect(loadDraft("ch2")).toEqual({ text: "two" });
  });

  it("loadDraft returns null when localStorage is empty", () => {
    expect(loadDraft("ch1")).toBeNull();
  });

  it("persists complex TipTap JSON", () => {
    const complex = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Hello " },
            {
              type: "mention",
              attrs: { id: "user-123", label: "alice" },
            },
            { type: "text", text: " how are you?" },
          ],
        },
      ],
    };
    saveDraft("ch1", complex);
    expect(loadDraft("ch1")).toEqual(complex);
  });
});
