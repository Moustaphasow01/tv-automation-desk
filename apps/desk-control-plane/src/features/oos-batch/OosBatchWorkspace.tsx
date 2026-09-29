import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { useOosClient, useOosOverview, useOosReceipt } from "@/domains/front-api/oosBatchRepository";
import type { OosRequest } from "@/domains/front-api/oosBatchContract";
import { BatchForm } from "./BatchForm";
import { BatchStats, BatchTable } from "./BatchTable";
import { DayDetail } from "./DayDetail";
import { dateLabel, errorLabel } from "./model";
import "./oos-batch.css";

export function OosBatchWorkspace() {
  const [params, setParams] = useSearchParams(), batch = params.get("batch") || "", date = params.get("date") || "";
  const query = useOosOverview(batch), client = useOosClient();
  const [pending, setPending] = useState<{ input: OosRequest; id: string } | null>(null);
  const commandId = params.get("command") || "", receipt = useOosReceipt(commandId);
  const update = (values: Record<string, string>) => setParams(current => { const next = new URLSearchParams(current); Object.entries(values).forEach(([key, value]) => value ? next.set(key, value) : next.delete(key)); return next; });
  const mutation = useMutation({ mutationFn: (request: { input: OosRequest; id: string }) => client.submit(request.input, request.id),
    onSuccess: result => { update({ command: result.command_id }); setPending(null); void query.refetch(); } });
  const submit = (input: OosRequest) => { const request = { input, id: crypto.randomUUID() }; setPending(request); mutation.mutate(request); };
  const active = mutation.isPending || (!!commandId && (!receipt.data || receipt.data.status !== "COMPLETED"));
  return <section className="oos-workspace" aria-label="Suivi des batchs hors échantillon">
    <header className="oos-heading"><div><p>REJEU / OOS · JUILLET — AOÛT 2026</p><h1>Batchs hors échantillon</h1><p>Plans externes figés. Replay TradingView uniquement. Aucun ordre broker.</p></div><button disabled={query.isFetching} onClick={() => void query.refetch()}>Actualiser</button></header>
    <form className="oos-filter" onSubmit={event => { event.preventDefault(); update({ batch: String(new FormData(event.currentTarget).get("batch") || ""), date: "" }); }}><label>Filtrer un batch<input key={batch} name="batch" defaultValue={batch} placeholder="Tous les batchs" /></label><button>Afficher</button></form>
    {query.isLoading && <p role="status">Chargement du registre…</p>}
    {query.isError && <p role="alert">{query.data ? "Lecture ancienne. " : ""}{errorLabel(query.error)}</p>}
    {query.data && <><p className="oos-freshness">Registre lu le {dateLabel(query.data.observed_at)} · Paris</p>
      {query.data.can_write && <BatchForm disabled={active || mutation.isError} submit={submit} />}
      {mutation.isPending && <p role="status">Envoi de la commande…</p>}
      {mutation.isError && <p role="alert">{errorLabel(mutation.error)} {pending && <button onClick={() => mutation.mutate(pending)}>Réessayer le même envoi</button>} <button onClick={() => { mutation.reset(); setPending(null); }}>Abandonner l’envoi</button></p>}
      <CommandStatus id={commandId} />
      {query.data.days.length === 500 && <p role="status">Limite d’affichage de 500 journées atteinte. Filtrez un batch pour consulter sa liste et ses statistiques complètes.</p>}
      <BatchTable rows={query.data.days} disabled={active || mutation.isError} canWrite={query.data.can_write} submit={submit} select={row => update({ batch: row.batch_id, date: row.day })} />
      {batch && date && <DayDetail batch={batch} date={date} close={() => update({ date: "" })} />}
      <BatchStats stats={query.data.stats} />
    </>}
  </section>;
}

function CommandStatus({ id }: { id: string }) {
  const query = useOosReceipt(id);
  if (!id) return null;
  if (query.isError) return <p role="alert">Reçu indisponible. Ne relancez pas à l’aveugle. <button onClick={() => void query.refetch()}>Relire le reçu</button></p>;
  if (!query.data) return <p role="status">Lecture de la commande…</p>;
  const r = query.data;
  return <section className="oos-receipt" aria-live="polite"><p>{r.status === "QUEUED" ? "En file — en attente du runner OOS" : r.status === "RUNNING" ? "Commande en traitement" : "Commande traitée"} · {r.completed_days} / {r.total_days} journées</p>
    <small>Reçu {id}. Consultez le statut de chaque journée pour connaître son résultat.</small>
    {r.receipts.some(item => item.error) && <ul>{r.receipts.filter(item => item.error).map(item => <li key={item.date}>{dateLabel(item.date)} : {item.error?.code}</li>)}</ul>}
  </section>;
}
