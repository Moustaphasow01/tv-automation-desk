import type { WorkspacePreferencesController } from "./useWorkspacePreferences";

export function WorkspaceSettings({ settings, sound }: { settings: WorkspacePreferencesController; sound: { enable(): Promise<boolean>; status: string } }) {
  const { preferences, update, reset } = settings;
  return <section className="tw-preferences" aria-label="Préférences du poste">
    <p>{settings.persistence}</p>
    <p>Sur mobile, un seul graphique est affiché. Le choix de 1, 2 ou 4 graphiques ci-dessous est conservé pour le grand écran.</p>
    <label className="tw-check"><input type="checkbox" checked={preferences.followTickets} onChange={(event) => update({ followTickets: event.target.checked })} />Mettre automatiquement en avant le marché d’un nouveau ticket</label>
    <small>Une fiche ouverte, une saisie et une lecture figée sont préservées. Ce réglage change l’affichage, jamais votre autorisation de trading.</small>
    <fieldset><legend>Disposition rapide</legend><div className="tw-layout-presets"><button onClick={() => update({ chartCount: 1, inspectorWidth: 380, watchlistVisible: true })}>Décision · 1 graphique</button><button onClick={() => update({ chartCount: 2, inspectorWidth: 344, watchlistVisible: true })}>Surveillance · 2 graphiques</button><button onClick={() => update({ chartCount: 4, inspectorWidth: 320, watchlistVisible: false })}>Analyse · 4 graphiques</button></div></fieldset>
    <label>Densité de lecture<select value={preferences.density} onChange={(event) => update({ density: event.target.value === "compact" ? "compact" : "comfortable" })}><option value="comfortable">Confortable</option><option value="compact">Compacte sur grand écran</option></select></label>
    <label>Largeur de la fiche sur grand écran · {preferences.inspectorWidth} px<input type="range" min={300} max={480} step={4} value={preferences.inspectorWidth} onChange={(event) => update({ inspectorWidth: Number(event.target.value) })} /></label>
    <label className="tw-check"><input type="checkbox" checked={preferences.watchlistVisible} onChange={(event) => update({ watchlistVisible: event.target.checked })} />Afficher la liste des marchés</label>
    <label className="tw-check"><input type="checkbox" checked={preferences.linkedCursor} onChange={(event) => update({ linkedCursor: event.target.checked })} />Lier les curseurs des graphiques</label>
    <fieldset><legend>Notifications sonores facultatives</legend><button onClick={async () => { if (await sound.enable()) update({ sound: true }); }}>Activer le son dans cet onglet</button><button aria-pressed={!preferences.sound} onClick={() => update({ sound: false })}>Mettre en sourdine</button><p role="status">{sound.status}</p><small>Le son nécessite une activation après réouverture. Les alertes visuelles et avertissements de sécurité restent actifs.</small></fieldset>
    <details><summary>Raccourcis et accessibilité</summary><p>Alt + 1 : marchés · Alt + 2 : tickets · Alt + 3 : suivi · Alt + 4 : bilan. Inactifs pendant la saisie ou dans une fenêtre ouverte.</p><p>Dans un graphique : flèches gauche/droite, + / − et Origine. Aucun raccourci ne soumet une décision.</p></details>
    <button onClick={reset}>Réinitialiser uniquement mes préférences du poste</button>
  </section>;
}
