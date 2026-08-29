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

export function commandShortcutLabel(platform = typeof navigator === "undefined" ? "" : navigator.platform): string {
  return /Mac|iPhone|iPad|iPod/i.test(platform) ? "⌘ K" : "Ctrl K";
}

export function rankCommandDestinations(destinations: readonly CommandDestination[], query: string): CommandDestination[] {
  const needle = normalizeSearch(query);
  if (!needle) return destinations.slice(0, 10);
  const resource = directResourceDestination(query);
  const ranked = destinations
    .map((item, index) => ({ item, index, score: commandDestinationScore(item, needle) }))
    .filter((entry) => Number.isFinite(entry.score))
    .sort((left, right) => left.score - right.score || left.index - right.index)
    .slice(0, resource ? 9 : 10)
    .map((entry) => entry.item);
  return resource ? [resource, ...ranked] : ranked;
}

export function directResourceDestination(query: string): CommandDestination | null {
  const match = query.trim().match(/^(signal|ordre|order|strategie|stratégie|run|incident|position)\s*[:#]\s*(\S+)$/i);
  if (!match) return null;
  const [, rawKind, rawId] = match;
  const kind = normalizeSearch(rawKind);
  const id = rawId.trim();
  if (!id || id.length > 240) return null;
  const encodedId = encodeURIComponent(id);
  if (kind === "signal") return { label: `Ouvrir le signal ${compactResourceId(id)}`, route: `/live/signals/${encodedId}`, group: "Objet canonique" };
  if (kind === "ordre" || kind === "order") return { label: `Ouvrir l’ordre ${compactResourceId(id)}`, route: `/execution/orders/${encodedId}`, group: "Objet canonique" };
  if (kind === "strategie") return { label: `Ouvrir la stratégie ${compactResourceId(id)}`, route: `/strategies/${encodedId}`, group: "Objet canonique" };
  if (kind === "run") return { label: `Ouvrir le run ${compactResourceId(id)}`, route: `/research/runs/${encodedId}`, group: "Objet canonique" };
  if (kind === "incident") return { label: `Ouvrir l’incident ${compactResourceId(id)}`, route: `/operations/incidents/${encodedId}`, group: "Objet canonique" };
  return { label: `Ouvrir la position ${compactResourceId(id)}`, route: `/execution/portfolio/positions/${encodedId}`, group: "Objet canonique" };
}

export function DeskCommandPalette({ destinations }: { destinations: readonly CommandDestination[] }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const shortcut = commandShortcutLabel();
  const results = useMemo(() => {
    return rankCommandDestinations(destinations, query);
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
        <FaSearch aria-hidden="true" /><span>Rechercher</span><kbd>{shortcut}</kbd>
      </button>
      {open ? createPortal(
        <div className="desk-command-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
          <section ref={dialogRef} className="desk-command-palette" role="dialog" aria-modal="true" aria-labelledby="desk-command-title" onKeyDown={onDialogKeyDown}>
            <header><span><FaSearch aria-hidden="true" /><input ref={inputRef} value={query} onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }} onKeyDown={onInputKeyDown} role="combobox" aria-expanded="true" aria-controls="desk-command-results" aria-activedescendant={results[activeIndex] ? `desk-command-option-${activeIndex}` : undefined} aria-label="Rechercher une destination ou un objet" placeholder="Destination ou signal:ID, ordre:ID…" /></span><kbd>Échap</kbd></header>
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

function commandDestinationScore(item: CommandDestination, needle: string): number {
  const label = normalizeSearch(item.label);
  const keywords = normalizeSearch(`${item.group} ${item.keywords ?? ""}`);
  const labelTokens = label.split(" ").filter(Boolean);
  const keywordTokens = keywords.split(" ").filter(Boolean);
  if (label === needle) return 0;
  if (label.startsWith(needle)) return 10;
  if (labelTokens.some((token) => token.startsWith(needle))) return 20;
  const labelDistance = levenshtein(label, needle);
  if (labelDistance <= Math.max(1, Math.floor(needle.length / 3))) return 30 + labelDistance;
  if (keywordTokens.some((token) => token === needle)) return 40;
  if (keywordTokens.some((token) => token.startsWith(needle))) return 50;
  if (label.includes(needle)) return 60;
  if (keywords.includes(needle)) return 70;
  return Number.POSITIVE_INFINITY;
}

function normalizeSearch(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("fr-FR").replace(/[^a-z0-9]+/g, " ").trim();
}

function compactResourceId(value: string): string {
  return value.length > 34 ? `${value.slice(0, 16)}…${value.slice(-12)}` : value;
}

function levenshtein(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let diagonal = previous[0];
    previous[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const above = previous[rightIndex];
      previous[rightIndex] = Math.min(
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + 1,
        diagonal + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return previous[right.length];
}
