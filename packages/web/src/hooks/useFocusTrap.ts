import { useEffect, useRef } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Traps keyboard focus inside a container element.
 * On mount: saves the previously focused element and focuses the first focusable child.
 * On Tab/Shift+Tab: wraps focus within the container.
 * On unmount: restores focus to the previously focused element.
 */
export function useFocusTrap(ref: React.RefObject<HTMLElement | null>) {
  const previousFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previousFocus.current = document.activeElement as HTMLElement;
    const el = ref.current;
    if (!el) return;

    // Focus the first focusable element (or the container itself)
    const focusable = el.querySelectorAll<HTMLElement>(FOCUSABLE);
    if (focusable.length > 0) {
      focusable[0].focus();
    } else {
      el.setAttribute("tabindex", "-1");
      el.focus();
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== "Tab" || !el) return;
      const nodes = el.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (nodes.length === 0) return;

      const first = nodes[0];
      const last = nodes[nodes.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previousFocus.current?.focus();
    };
  }, [ref]);
}
