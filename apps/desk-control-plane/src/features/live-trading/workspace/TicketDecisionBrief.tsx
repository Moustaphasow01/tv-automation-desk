import { useState } from "react";
import type { FocusQueueItem } from "../focusJournalModel";
import { ticketExplanation } from "./workspaceSources";
import { ticketDecisionFingerprint } from "./commandPolicy";
import { parisTime } from "./workspaceModel";

export function TicketDecisionBrief({ item }: { item: FocusQueueItem }) {
  const fingerprint = ticketDecisionFingerprint(item);
  const [seen, setSeen] = useState(() => ({ fingerprint, status: item.status, asOf: item.asOf }));
  const explanation = ticketExplanation(item);
  const planChanged = seen.fingerprint !== fingerprint;
  const statusChanged = seen.status !== item.status;
  return <section className="tw-decision-brief" aria-label="Lecture de décision">
    {planChanged || statusChanged ? <div className="tw-ticket-change" role="status"><strong>{planChanged ? "Le plan ou les autorisations ont changé" : "L’état du ticket a changé"}</strong><p>Depuis votre lecture à {parisTime(seen.asOf, true)}. Vérifiez les informations actuelles avant toute décision.</p><button onClick={() => setSeen({ fingerprint, status: item.status, asOf: item.asOf })}>J’ai relu les changements</button><small>Repère de lecture local ; aucune décision enregistrée.</small></div> : null}
    <details><summary>Pourquoi ce ticket ? Déclencheur et invalidation</summary><dl className="tw-decision-summary"><div><dt>Pourquoi ce sens ?</dt><dd>{explanation.direction}</dd></div><div><dt>Pourquoi maintenant ?</dt><dd>{explanation.now}</dd></div></dl><p>Configuration publiée : {explanation.setup}</p><h4>Conditions d’invalidation</h4>{explanation.invalidations.length ? <ul>{explanation.invalidations.map((text, index) => <li key={index}>{text}</li>)}</ul> : <p>Conditions non publiées. Le stop et la validité du plan restent affichés ci-dessous.</p>}{explanation.watch.length ? <><h4>À surveiller</h4><ul>{explanation.watch.map((text, index) => <li key={index}>{text}</li>)}</ul></> : null}</details>
  </section>;
}
