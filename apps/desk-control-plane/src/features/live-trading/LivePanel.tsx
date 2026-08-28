import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { FaCompress, FaExpand } from "react-icons/fa";

export type LivePanelProps = {
  title: string;
  className?: string;
  action?: ReactNode;
  children: ReactNode;
  expandable?: boolean;
};

export function LivePanel({
  title,
  className = "",
  action,
  children,
  expandable = true,
}: LivePanelProps) {
  const [expanded, setExpanded] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  const expandButtonRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    if (!expanded || !panelRef.current) return;
    const panel = panelRef.current;
    const restoreIsolation = isolateModalPath(panel);
    const returnFocus = returnFocusRef.current;
    const focusable = focusableElements(panel);
    (expandButtonRef.current ?? focusable[0] ?? panel).focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setExpanded(false);
        return;
      }
      if (event.key !== "Tab") return;
      const available = focusableElements(panel);
      if (!available.length) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = available[0];
      const last = available.at(-1) ?? first;
      if (!panel.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
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
        : expandButtonRef.current;
    }
    setExpanded((value) => !value);
  };

  return (
    <>
      {expanded ? (
        <button
          type="button"
          className="lt-panel-backdrop"
          onClick={() => setExpanded(false)}
          aria-label="Fermer le panneau"
          tabIndex={-1}
        />
      ) : null}
      <section
        ref={panelRef}
        className={`lt-panel ${className}${expanded ? " lt-panel--expanded" : ""}`}
        role={expanded ? "dialog" : undefined}
        aria-modal={expanded || undefined}
        aria-labelledby={expanded ? titleId : undefined}
        tabIndex={expanded ? -1 : undefined}
      >
        <header>
          <h2 id={titleId}>{title}</h2>
          {expandable ? (
            <button
              ref={expandButtonRef}
              type="button"
              className="lt-panel-expand"
              onClick={toggleExpanded}
              aria-label={expanded ? `Réduire ${title}` : `Agrandir ${title}`}
            >
              {expanded ? <FaCompress aria-hidden="true" /> : <FaExpand aria-hidden="true" />}
            </button>
          ) : null}
          {action ? <div>{action}</div> : null}
        </header>
        <div className="lt-panel__body">{children}</div>
      </section>
    </>
  );
}

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function focusableElements(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)]
    .filter((element) => !element.hidden && element.getAttribute("aria-hidden") !== "true");
}

function isolateModalPath(panel: HTMLElement): () => void {
  const changed: Array<{ element: HTMLElement; inert: boolean }> = [];
  let current: HTMLElement = panel;
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
