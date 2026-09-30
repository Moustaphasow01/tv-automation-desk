import { useState, type FormEvent } from "react";
import type { OosRequest } from "@/domains/front-api/oosBatchContract";
export function BatchForm({ disabled, submit }: { disabled: boolean; submit: (input: OosRequest) => void }) {
  const [mode, setMode] = useState("day");
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget), field = (key: string) => String(data.get(key) || "");
    submit({ batch_id: field("batch_id"), symbol: field("symbol"), cutoff_time: field("cutoff_time"), action: "capture",
      ...(mode === "day" ? { date: field("date") } : mode === "month" ? { month: field("month") } : { from: field("from"), to: field("to") }) });
  }
  return <details className="oos-panel"><summary>Préparer un nouveau lancement</summary>
    <form className="oos-form" onSubmit={onSubmit}>
      <label>Identifiant du batch<input required name="batch_id" pattern="[A-Za-z0-9_-]{1,80}" maxLength={80} defaultValue="OOS" /></label>
      <label>Symbole TradingView<input required name="symbol" maxLength={80} defaultValue="CME_MINI:MES1!" /></label>
      <label>Cutoff pré-market · Paris<input required type="time" name="cutoff_time" max="19:59" defaultValue="09:00" /></label>
      <label>Période<select value={mode} onChange={e => setMode(e.target.value)}><option value="day">Une journée</option><option value="range">Une plage</option><option value="month">Un mois</option></select></label>
      {mode === "day" && <label>Journée<input type="date" name="date" min="2026-07-01" max="2026-08-31" required /></label>}
      {mode === "month" && <label>Mois<select name="month"><option value="2026-07">Juillet 2026</option><option value="2026-08">Août 2026</option></select></label>}
      {mode === "range" && <><label>Du<input type="date" name="from" min="2026-07-01" max="2026-08-31" required /></label><label>Au<input type="date" name="to" min="2026-07-01" max="2026-08-31" required /></label></>}
      <p>Chaque date est demandée, week-ends inclus. Les journées sans données restent signalées ; aucun calendrier n’est déduit.</p>
      <button type="submit" disabled={disabled}>Capturer le pré-market uniquement</button>
    </form>
  </details>;
}
