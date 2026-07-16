import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { operationsApi } from "@/api/operationsApi";
import { Card, ErrorView, LoadingView } from "@/components/common";
import { Breadcrumbs, formatDateTime, PageHeading, StatusTag, WorkspaceNav } from "@/components/operations";
import { operationsKeys } from "@/hooks/useOperations";
import type { Incident, OperationsCommandInput } from "@/operationsTypes";

export default function IncidentsPage() {
  const query = useQuery({ queryKey: operationsKeys.incidents, queryFn: operationsApi.listIncidents, refetchInterval: 15_000 });
  const client = useQueryClient();
  const [selected, setSelected] = useState<Incident | null>(null);
  const [action, setAction] = useState<OperationsCommandInput["action"]>("acknowledge");
  const [reason, setReason] = useState("");
  const [phrase, setPhrase] = useState("");
  const mutation = useMutation({ mutationFn: (input: OperationsCommandInput) => operationsApi.executeIncidentAction(selected!.id, input), onSuccess: async () => { setSelected(null); setReason(""); setPhrase(""); await client.invalidateQueries({ queryKey: operationsKeys.all }); } });
  if (query.isLoading) return <LoadingView/>;
  if (query.isError || !query.data) return <ErrorView message={query.error?.message || "Incidents indisponibles"} retry={() => query.refetch()}/>;
  const expected = `CONFIRM_${action.toUpperCase()}`;
  return <section className="view workspace-view">
    <WorkspaceNav/><Breadcrumbs items={[{ label: "Opérations", to: "/operations" }, { label: "Incidents" }]}/><PageHeading eyebrow="Alert lifecycle" title="Incidents & alertes" subtitle="Acquitter, reporter, résoudre et réouvrir avec une trace d’audit." backTo="/operations"/>
    {!query.data.items.length ? <Card className="workspace-empty"><h3>Aucun incident</h3><p>Les alertes canoniques, erreurs et audits de qualité sont consolidés ici.</p></Card> : <div className="incident-list">{query.data.items.map(incident => <Card className="incident-card" key={incident.id}><div><div className="incident-card__title"><i data-severity={incident.severity}/><div><strong>{incident.title}</strong><small>{incident.kind} · {formatDateTime(incident.updatedAt)}</small></div></div><p>{incident.message}</p></div><div><StatusTag status={incident.lifecycleStatus}/>{incident.lifecycleStatus !== "resolved" ? <button className="secondary-btn" onClick={() => setSelected(incident)}>Traiter</button> : <button className="text-btn" onClick={() => { setSelected(incident); setAction("reopen"); }}>Réouvrir</button>}</div></Card>)}</div>}
    {selected && <Card className="command-panel"><div><p className="eyebrow">Incident sélectionné</p><h2>{selected.title}</h2></div><div className="command-panel__form"><label>Action<select value={action} onChange={event => { setAction(event.target.value as typeof action); setPhrase(""); }}><option value="acknowledge">Acquitter</option><option value="snooze">Reporter</option><option value="resolve">Résoudre</option><option value="reopen">Réouvrir</option></select></label><label>Motif<input value={reason} onChange={event => setReason(event.target.value)}/></label><label>Confirmation<input value={phrase} placeholder={expected} onChange={event => setPhrase(event.target.value)}/></label><button className="primary-btn" disabled={phrase !== expected || reason.length < 3 || mutation.isPending} onClick={() => mutation.mutate({ action, reason, confirmationPhrase: phrase, idempotencyKey: crypto.randomUUID(), expectedRevision: selected.revision })}>Appliquer</button><button className="text-btn" onClick={() => setSelected(null)}>Annuler</button></div>{mutation.isError && <p className="form-error">{mutation.error.message}</p>}</Card>}
  </section>;
}
