import { useCallback, useEffect } from "react";

/**
 * Implements the W3C roving tabindex pattern for list keyboard navigation.
 * Only one item (matching `selector`) has tabIndex=0 at a time.
 * ArrowDown/ArrowUp cycle through items; Home/End jump to first/last.
 * Tab naturally moves to the next region since only one item is tabbable.
 */
export function useRovingTabindex(
  containerRef: React.RefObject<HTMLElement | null>,
  selector: string = "[data-roving-item]",
) {
  // Ensure at least one item is tabbable after each render
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const items = container.querySelectorAll<HTMLElement>(selector);
    if (items.length === 0) return;
    const hasTabStop = Array.from(items).some((el) => el.tabIndex === 0);
    if (!hasTabStop) {
      items[0].tabIndex = 0;
    }
  });

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const container = containerRef.current;
      if (!container) return;
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;

      const items = Array.from(container.querySelectorAll<HTMLElement>(selector));
      if (items.length === 0) return;

      const currentIndex = items.indexOf(document.activeElement as HTMLElement);
      if (currentIndex === -1) return;

      e.preventDefault();

      let newIndex: number;
      switch (e.key) {
        case "ArrowDown":
          newIndex = (currentIndex + 1) % items.length;
          break;
        case "ArrowUp":
          newIndex = (currentIndex - 1 + items.length) % items.length;
          break;
        case "Home":
          newIndex = 0;
          break;
        case "End":
          newIndex = items.length - 1;
          break;
        default:
          return;
      }

      items.forEach((item, i) => {
        item.tabIndex = i === newIndex ? 0 : -1;
      });
      items[newIndex].focus();
    },
    [containerRef, selector],
  );

  return { handleKeyDown };
}
