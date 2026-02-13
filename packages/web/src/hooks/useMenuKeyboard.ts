import { useEffect, useCallback } from "react";

/**
 * Hook for W3C-compliant keyboard navigation in menus.
 * Handles ArrowUp/Down, Home/End, and auto-focuses the first item on mount.
 */
export function useMenuKeyboard(menuRef: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;

    // Focus the first menuitem on mount
    const items = menu.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])');
    if (items.length > 0) {
      items[0].focus();
    }
  }, [menuRef]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const menu = menuRef.current;
    if (!menu) return;

    const items = Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])'));
    if (items.length === 0) return;

    const currentIndex = items.indexOf(document.activeElement as HTMLElement);

    switch (e.key) {
      case "ArrowDown": {
        e.preventDefault();
        const next = currentIndex < items.length - 1 ? currentIndex + 1 : 0;
        items[next].focus();
        break;
      }
      case "ArrowUp": {
        e.preventDefault();
        const prev = currentIndex > 0 ? currentIndex - 1 : items.length - 1;
        items[prev].focus();
        break;
      }
      case "Home": {
        e.preventDefault();
        items[0].focus();
        break;
      }
      case "End": {
        e.preventDefault();
        items[items.length - 1].focus();
        break;
      }
    }
  }, [menuRef]);

  return { handleKeyDown };
}
