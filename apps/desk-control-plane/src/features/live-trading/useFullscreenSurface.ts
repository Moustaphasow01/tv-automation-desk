import { useEffect, useRef, useState } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export function useFullscreenSurface<T extends HTMLElement>() {
  const [expanded, setExpanded] = useState(false);
  const surfaceRef = useRef<T>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!expanded || !surfaceRef.current) return;
    const surface = surfaceRef.current;
    const restoreIsolation = isolateModalPath(surface);
    const returnFocus = returnFocusRef.current;
    document.body.classList.add("lt-fullscreen-surface-open");
    (triggerRef.current ?? focusableElements(surface)[0] ?? surface).focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setExpanded(false);
        return;
      }
      if (event.key === "Tab") keepFocusInside(event, surface);
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.classList.remove("lt-fullscreen-surface-open");
      restoreIsolation();
      queueMicrotask(() => {
        if (returnFocus?.isConnected) returnFocus.focus();
      });
    };
  }, [expanded]);

  const toggleExpanded = () => {
    if (!expanded) {
      returnFocusRef.current = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : triggerRef.current;
    }
    setExpanded((value) => !value);
  };

  return {
    close: () => setExpanded(false),
    expanded,
    surfaceRef,
    toggleExpanded,
    triggerRef,
  };
}

function keepFocusInside(event: KeyboardEvent, surface: HTMLElement) {
  const available = focusableElements(surface);
  if (!available.length) {
    event.preventDefault();
    surface.focus();
    return;
  }
  const first = available[0];
  const last = available.at(-1) ?? first;
  if (!surface.contains(document.activeElement)) {
    event.preventDefault();
    first.focus();
  } else if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function focusableElements(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)]
    .filter((element) => !element.hidden && element.getAttribute("aria-hidden") !== "true");
}

function isolateModalPath(surface: HTMLElement): () => void {
  const changed: Array<{ element: HTMLElement; inert: boolean }> = [];
  let current: HTMLElement = surface;
  while (current.parentElement && current.parentElement !== document.body) {
    const parent = current.parentElement;
    for (const sibling of parent.children) {
      if (sibling === current || !(sibling instanceof HTMLElement) || sibling.classList.contains("lt-panel-backdrop")) continue;
      changed.push({ element: sibling, inert: sibling.inert });
      sibling.inert = true;
    }
    current = parent;
  }
  return () => {
    for (const { element, inert } of changed) element.inert = inert;
  };
}
