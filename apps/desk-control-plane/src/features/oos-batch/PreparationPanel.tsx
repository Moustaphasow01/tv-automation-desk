import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { useOosClient, useOosPreparations } from "@/domains/front-api/oosBatchRepository";
import type { PreparationRequest, OosPreparation } from "@/domains/front-api/oosPreparationContract";
import { dateLabel, errorLabel } from "./model";

export function PreparationPanel({ batchId, canWrite, selectBatch }: { batchId: string; canWrite: boolean; selectBatch: (id: string) => void }) {
  const client = useOosClient(), query = useOosPreparations(batchId);
  const [pending, setPending] = useState<PreparationRequest | null>(null);
  const mutation = useMutation({ mutationFn: (input: PreparationRequest) => client.prepare(input), onSuccess: result => {
    if ("batch_id" in result && result.batch_id) selectBatch(result.batch_id);
    setPending(null); void query.refetch();
  } });
  const submit = (input: PreparationRequest) => { setPending(input); mutation.mutate(input); };
  return <section className="oos-panel" aria-label="Préparation autonome des bundles">
    <h2>Préparer les bundles</h2><p>MES · 09:00 Paris · bougies clôturées uniquement. Aucun plan ni replay ne sera lancé.</p>
    {canWrite && <PreparationForm disabled={mutation.isPending || mutation.isError} submit={submit} />}
    {mutation.isPending && <p role="status">Mise en file de la préparation…</p>}
    {mutation.isSuccess && <p role="status">État reçu : {"state" in mutation.data ? mutation.data.state : mutation.data.status}. Consultez la file pour suivre la préparation.</p>}
    {mutation.isError && <p role="alert">{errorLabel(mutation.error)} {pending && <button type="button" onClick={() => mutation.mutate(pending)}>Reprendre la même demande</button>} <button type="button" onClick={() => { mutation.reset(); setPending(null); }}>Fermer l’erreur</button></p>}
    {query.isLoading && <p role="status">Lecture de la file de préparation…</p>}
    {query.isError && <p role="alert">{query.data && "Dernière lecture conservée. "}{errorLabel(query.error)} <button type="button" onClick={() => void query.refetch()}>Relire la file</button></p>}
    {query.data && <PreparationProgress data={query.data} />}
    {!!batchId && <button type="button" onClick={() => selectBatch("")}>Voir toutes les préparations</button>}
  </section>;
}

export function PreparationForm({ disabled, submit }: { disabled: boolean; submit: (input: PreparationRequest) => void }) {
  const [mode, setMode] = useState("day");
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget), field = (name: string) => String(data.get(name) || "");
    submit(mode === "day" ? { date: field("date") } : { start_date: field("start_date"), end_date: field("end_date") });
  }
  return <form className="oos-form" onSubmit={onSubmit}>
    <label>Préparation<select value={mode} onChange={e => setMode(e.target.value)}><option value="day">Une journée</option><option value="range">Une plage</option></select></label>
    {mode === "day" ? <label>Journée<input required type="date" name="date" min="2026-07-01" max="2026-08-31" /></label>
      : <><label>Du<input required type="date" name="start_date" min="2026-07-01" max="2026-08-31" /></label><label>Au<input required type="date" name="end_date" min="2026-07-01" max="2026-08-31" /></label></>}
    <button disabled={disabled} type="submit">{mode === "day" ? "Préparer journée" : "Préparer plage"}</button>
    <p>Les week-ends sont ignorés. Une journée déjà prête n’est jamais recapturée. Les incidents restent visibles et récupérables.</p>
  </form>;
}

export function PreparationProgress({ data }: { data: OosPreparation }) {
  return <div className="oos-preparation-progress" aria-live="polite">
    {data.observed_at && <p className="oos-freshness">File lue le {dateLabel(data.observed_at)} · Paris</p>}
    <p>Pré-market prêt : {data.ready} / {data.total_days} · Échecs : {data.failed} · Replays terminés : {data.completed}</p>
    {data.batch_id && <><p className="oos-hash">Batch {data.batch_id} · {data.status}</p><progress value={data.ready} max={Math.max(1, data.total_days)} aria-label="Bundles pré-market prêts" /></>}
    <p>{data.premarket_ready} bundles PREMARKET_READY · {data.queued} préparations restantes · concurrence effective : {data.concurrency}</p>
    <p>Prochaine journée en attente de scénario : {data.next_waiting_scenario ? dateLabel(data.next_waiting_scenario) : "Aucune dans cette sélection"}</p>
    <p>File en cours : {data.current_queue.length ? data.current_queue.map(dateLabel).join(" · ") : "Aucune préparation en file"}</p>
    {!!data.skipped_dates.length && <p>{data.skipped_dates.length} dates de week-end ignorées.</p>}
    {data.days.filter(day => day.error).map(day => <p role="alert" key={day.date}>{dateLabel(day.date)} : {day.error?.code}</p>)}
  </div>;
}
