import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { FaSearch } from "react-icons/fa";
import { useNavigate } from "react-router-dom";

export type CommandDestination = {
  label: string;
  route: string;
  group: string;
  keywords?: string;
};

export function DeskCommandPalette({ destinations }: { destinations: readonly CommandDestination[] }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const results = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("fr-FR");
    if (!needle) return destinations.slice(0, 10);
    return destinations.filter((item) => `${item.label} ${item.group} ${item.keywords ?? ""}`
      .toLocaleLowerCase("fr-FR")
      .includes(needle)).slice(0, 10);
  }, [destinations, query]);
  const close = (restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus());
  };

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
      }
      if (event.key === "Escape" && open) close();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  useEffect(() => {
    if (open) {
      setActiveIndex(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      setQuery("");
    }
  }, [open]);

  const select = (route: string) => {
    navigate(route);
    close();
  };
  const onDialogKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Tab") return;
    const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])') ?? [])];
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable.at(-1) ?? first;
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  const onInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") setActiveIndex((value) => Math.min(results.length - 1, value + 1));
    else if (event.key === "ArrowUp") setActiveIndex((value) => Math.max(0, value - 1));
    else if (event.key === "Enter" && results[activeIndex]) select(results[activeIndex].route);
    else return;
    event.preventDefault();
  };

  return (
    <>
      <button ref={triggerRef} className="desk-command-trigger" type="button" onClick={() => setOpen(true)} aria-label="Ouvrir la navigation rapide" aria-haspopup="dialog" aria-expanded={open}>
        <FaSearch aria-hidden="true" /><span>Rechercher</span><kbd>Ctrl K</kbd>
      </button>
      {open ? createPortal(
        <div className="desk-command-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
          <section ref={dialogRef} className="desk-command-palette" role="dialog" aria-modal="true" aria-labelledby="desk-command-title" onKeyDown={onDialogKeyDown}>
            <header><span><FaSearch aria-hidden="true" /><input ref={inputRef} value={query} onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }} onKeyDown={onInputKeyDown} role="combobox" aria-expanded="true" aria-controls="desk-command-results" aria-activedescendant={results[activeIndex] ? `desk-command-option-${activeIndex}` : undefined} aria-label="Rechercher une destination" placeholder="Aller vers un espace du Desk…" /></span><kbd>Échap</kbd></header>
            <h2 id="desk-command-title">Navigation rapide</h2>
            <div id="desk-command-results" role="listbox" aria-label="Destinations">
              {results.map((item, index) => <button id={`desk-command-option-${index}`} key={item.route} type="button" role="option" aria-selected={index === activeIndex} onMouseEnter={() => setActiveIndex(index)} onClick={() => select(item.route)}><span>{item.label}</span><small>{item.group}</small></button>)}
              {!results.length ? <p role="status">Aucune destination correspondante.</p> : null}
            </div>
            <footer><span>↑ ↓ naviguer</span><span>Entrée ouvrir</span><span>Échap fermer</span></footer>
          </section>
        </div>,
        document.body,
      ) : null}
    </>
  );
}
