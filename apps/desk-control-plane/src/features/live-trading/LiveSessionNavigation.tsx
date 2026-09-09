import { useSearchParams } from "react-router-dom";

export function useLiveSessionPanel() {
  const [params, setParams] = useSearchParams();
  const value = params.get("livePanel");
  const panel = value === "activity" || value === "decision" ? value : "market";
  const select = (nextPanel: string) => setParams((current) => {
    const next = new URLSearchParams(current);
    next.set("livePanel", nextPanel);
    return next;
  }, { replace: true });
  return { panel, select };
}

export function LiveSessionNavigation({ panel, onSelect }: { panel: string; onSelect(value: string): void }) {
  return <nav className="lt-session-navigation" aria-label="Parcours Live sur mobile">{[{ id: "market", label: "Marché" }, { id: "activity", label: "Activité" }, { id: "decision", label: "Décision" }].map((item) => <button key={item.id} type="button" aria-pressed={panel === item.id} onClick={() => onSelect(item.id)}>{item.label}</button>)}</nav>;
}
