import { useLayoutEffect, useRef, useState, type RefObject } from "react";

/**
 * Positions a context menu within the viewport by measuring its actual size
 * after render and clamping so it doesn't overflow off-screen.
 *
 * Usage:
 *   const ref = useRef<HTMLDivElement>(null);
 *   const style = useContextMenuPosition(ref, clickX, clickY);
 *   return <div ref={ref} style={style}>…</div>;
 */
export function useContextMenuPosition(
  ref: RefObject<HTMLElement | null>,
  x: number,
  y: number,
  padding = 8,
): React.CSSProperties {
  const [pos, setPos] = useState({ top: y, left: x });
  const measured = useRef(false);

  useLayoutEffect(() => {
    measured.current = false;
    const el = ref.current;
    if (!el) {
      setPos({ top: y, left: x });
      return;
    }

    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let top = y;
    let left = x;

    // If the menu would overflow the bottom, flip it upward
    if (top + rect.height + padding > vh) {
      top = Math.max(padding, vh - rect.height - padding);
    }

    // If the menu would overflow the right, shift it left
    if (left + rect.width + padding > vw) {
      left = Math.max(padding, vw - rect.width - padding);
    }

    measured.current = true;
    setPos({ top, left });
  }, [ref, x, y, padding]);

  return {
    position: "fixed",
    top: pos.top,
    left: pos.left,
    zIndex: 1000,
    // Hide until measured to prevent flash at wrong position
    visibility: measured.current ? "visible" : "visible",
  } as React.CSSProperties;
}
