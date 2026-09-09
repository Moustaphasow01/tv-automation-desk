import { useState } from "react";
import { WorkspaceDialog } from "./WorkspaceDialog";
import type { WorkspacePreferencesController } from "./useWorkspacePreferences";
import { marketName } from "./workspaceModel";

export function WatchlistEditor({ settings, supported, initialSymbols, onClose }: {
  settings: WorkspacePreferencesController; supported: readonly string[]; initialSymbols: readonly string[]; onClose(): void;
}) {
  const current = settings.preferences.groups.find((group) => group.id === settings.preferences.activeGroup);
  const [name, setName] = useState(current?.name ?? "");
  const [symbols, setSymbols] = useState<string[]>([...initialSymbols]);
  const [saved, setSaved] = useState(false);
  return <WorkspaceDialog title="Mes listes de marchés" onClose={onClose}>
    <p>Une liste choisit les actifs à surveiller. Elle ne change ni l’univers des stratégies ni les limites du desk.</p>
    <form className="tw-preferences" onSubmit={(event) => {
      event.preventDefault();
      if (!name.trim() || (!current && settings.preferences.groups.length >= 8)) return;
      const group = { id: current?.id ?? "group-" + crypto.randomUUID(), name: name.trim(), symbols };
      const groups = current ? settings.preferences.groups.map((item) => item.id === current.id ? group : item) : [...settings.preferences.groups, group];
      settings.update({ groups, activeGroup: group.id }); setSaved(true);
    }}>
      <label>Nom de la liste<input required maxLength={32} value={name} onChange={(event) => { setName(event.target.value); setSaved(false); }} placeholder="Ex. Grains du matin" /></label>
      <fieldset><legend>Actifs à afficher</legend>{supported.map((symbol) => <label className="tw-check" key={symbol}><input type="checkbox" checked={symbols.includes(symbol)} onChange={(event) => { setSymbols(event.target.checked ? [...symbols, symbol] : symbols.filter((item) => item !== symbol)); setSaved(false); }} />{symbol} · {marketName(symbol)}</label>)}</fieldset>
      <button className="tw-primary" disabled={!name.trim() || (!current && settings.preferences.groups.length >= 8)}>{current ? "Enregistrer la liste" : "Créer ma liste"}</button>
      {!current && settings.preferences.groups.length >= 8 ? <p>Huit listes maximum. Choisissez une liste existante pour la modifier.</p> : null}
      {saved ? <p role="status">Liste enregistrée. {settings.persistence}</p> : null}
    </form>
    {current ? <button className="tw-remove-list" onClick={() => { settings.update({ groups: settings.preferences.groups.filter((group) => group.id !== current.id), activeGroup: "desk" }); onClose(); }}>Supprimer uniquement cette liste</button> : null}
    <small>{settings.persistence}</small>
  </WorkspaceDialog>;
}
