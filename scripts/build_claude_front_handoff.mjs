import { readdir, readFile, writeFile } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const output = join(root, "docs", "CLAUDE_FRONT_REDESIGN_HANDOFF.md");

const overview = [
  "# Passation Claude — redesign complet du frontend Desk Futures",
  "",
  "> Snapshot fonctionnel du frontend de préproduction. Ce fichier est volontairement autonome : contexte produit, inventaire des écrans, contraintes, architecture et code/CSS actuels.",
  "",
  "## Mission confiée à Claude",
  "",
  "Redesigner profondément le frontend, aujourd’hui jugé visuellement faible et mal organisé, en utilisant les skills de design/frontend disponibles. Le résultat attendu doit être cohérent, dense mais lisible, professionnel, responsive et réellement connecté au backend existant.",
  "",
  "Le redesign peut réorganiser les composants React, la navigation, le design system et le CSS. Il ne doit pas modifier les contrats métier, supprimer un parcours, remplacer les données réelles par des mocks ou contourner les confirmations opérateur.",
  "",
  "## Diagnostic du frontend actuel",
  "",
  "- Deux langages visuels cohabitent : les anciens écrans Live basés sur `SectionTitle` et les nouveaux écrans Operations basés sur `WorkspaceNav`/`PageHeading`.",
  "- La navigation principale mélange temps réel, recherche, opérations, historique et gouvernance dans une liste plate trop longue.",
  "- Le sous-menu Operations/Replay est ajouté dans le contenu, ce qui duplique la navigation globale.",
  "- `globals.css` est un monolithe global de plus de 1 000 lignes avec des styles historiques et récents entremêlés.",
  "- Plusieurs pages sont du JSX très compact, parfois sur une seule ligne, ce qui rend leur structure difficile à faire évoluer.",
  "- Les tableaux, cartes, formulaires, états vides, détails et inspecteurs JSON ne partagent pas toujours le même gabarit.",
  "- La taxonomie mélange français et anglais : Live Desk, Control plane, Research workspace, Long-term memory, etc.",
  "- Le niveau de densité et la hiérarchie visuelle varient fortement entre le Live Desk, Replay Lab et les pages de gouvernance.",
  "- Certains détails historiques utilisent encore un drawer alors que les nouveaux détails utilisent des écrans routés.",
  "",
  "## Principes non négociables",
  "",
  "1. Conserver toutes les routes et tous les parcours fonctionnels listés ci-dessous.",
  "2. Continuer à lire les API réelles via TanStack Query. Aucun mock dans le code de production.",
  "3. Ne pas changer les contrats backend, les identifiants, les statuts ni les payloads d’action sans chantier backend explicite.",
  "4. Les actions sensibles gardent : révision attendue, clé d’idempotence, justification et phrase `CONFIRM_<ACTION>`.",
  "5. Préserver la séparation entre setup théorique, position canonique et absence totale d’exécution broker depuis ces écrans.",
  "6. Les détails profonds s’ouvrent dans de vrais écrans, avec fil d’Ariane et retour. Ne pas empiler des cartes ou drawers pour Replay/Workflow/GPT.",
  "7. Une journée Replay peut avoir plusieurs sessions, plusieurs variantes et plusieurs tentatives de la même session.",
  "8. La timeline Replay doit rester zoomable, synchronisée au prix et filtrable par couches décision/étape/GPT.",
  "9. Prévoir desktop dense, tablette et mobile 320 px sans débordement horizontal global.",
  "10. La migration VPS/OVH est un chantier séparé et ne doit pas influencer ce redesign.",
  "",
  "## Architecture fonctionnelle cible suggérée",
  "",
  "Organiser la navigation en quatre espaces stables plutôt qu’en une liste plate :",
  "",
  "- **Temps réel** : Live Desk, Master, Monitors, Thèse, Setup & Position, Macro & News, Journal.",
  "- **Automatisation** : Cockpit Operations, workflows, incidents.",
  "- **Recherche** : Replay Lab, comparaison, performance, historique.",
  "- **Gouvernance** : stratégies, versions, audit, alertes et paramètres de session.",
  "",
  "Sur desktop, privilégier une sidebar persistante groupée et repliable, complétée par un header contextuel. Sur mobile, garder cinq destinations majeures et ouvrir le reste dans un menu structuré. Le contexte de session automatique Europe/Paris doit rester visible sans prendre le dessus sur le titre de la page.",
  "",
  "## Parcours métier à préserver",
  "",
  "### Parcours Live",
  "",
  "`Session automatique → Master → Monitors → Thèse active → Setup → Position → Clôture → Journal/Audit`",
  "",
  "### Parcours automatisation",
  "",
  "`Cockpit Operations → Workflow → Étape/événement → Action confirmée → Audit/incident`",
  "",
  "### Parcours Replay",
  "",
  "`Replay Lab → Run → Journée → Session/variante/tentative → Timeline → Processus GPT → Conclusion`",
  "",
  "### Parcours recherche et gouvernance",
  "",
  "`Performance/Comparaison → Historique → Stratégie → Versions → Diff structurel`",
  "",
  "## Inventaire des écrans et contexte de chacun",
  "",
  "### A. Temps réel et décision",
  "",
  "| Route | Écran | Contexte métier et contenu critique | Attente de redesign |",
  "|---|---|---|---|",
  "| `/live` | Live Desk | Écran d’entrée du desk pour la session automatique courante. Agrège prix/OHLC, lecture du marché, thèse, setup/position, qualité des données, activité workers et journal. Doit répondre immédiatement : que se passe-t-il, quelle est la décision et faut-il intervenir ? | En faire un vrai cockpit priorisé, avec une hiérarchie claire entre état du marché, décision, risque et activité secondaire. |",
  "| `/sessions` | Sessions | Explique la sélection automatique Asia/London/New York selon Europe/Paris, l’état des deux contextes de stratégie et la prochaine transition. | Présenter la chronologie de journée et le contexte actif, sans donner l’impression d’un sélecteur manuel quand la sélection est automatique. |",
  "| `/master` | Master Analysis | Plan initial figé au cutoff : biais, scénarios, niveaux, chemins attendu/échec, playbook de monitoring et chapitres complets du contrat Master. | Transformer le long empilement de cartes en document analytique scannable avec sommaire, niveaux saillants et scénarios comparables. |",
  "| `/monitors` | Monitors | Série chronologique des contrôles GPT de la thèse : attendu/réalisé, delta, score, WAIT→GO, invalidations et décision de replan. | Donner une lecture temporelle évidente et faciliter la comparaison entre checkpoints sans noyer les conditions. |",
  "| `/thesis` | Thèse active | État vivant issu du Master et actualisé par les Monitors : statut, confiance, niveaux, conditions et invalidations actuelles. | Créer une fiche de thèse centrale, lisible en quelques secondes, distinguant faits, interprétation, conditions et invalidation. |",
  "| `/setup` | Setup & Position | Sépare le plan théorique de l’exécution canonique. Affiche géométrie entrée/SL/TP, risque, statut et capacités opérateur sécurisées. | Mettre la sécurité et la distinction plan/exécution au centre. Les actions confirmées doivent être explicites, jamais ambiguës. |",
  "| `/timeline` | Journal de décision | Trace Master → Thèse → Monitor → Setup → Position, avec événements, acteurs et références. | Utiliser une timeline verticale structurée, filtrable, avec détails accessibles mais pas affichés en permanence. |",
  "| `/news` | Macro & News | Calendrier macro quotidien à l’heure de Paris, prochain événement, fenêtres rouges et headlines complémentaires. | Prioriser le prochain risque temporel et réduire le bruit éditorial. |",
  "| `/audit` | Audit | Contrats actifs, qualité, anti-lookahead, sources, avertissements et mapping API. Écran de confiance technique et métier. | Séparer clairement conformité, qualité de données et diagnostic technique avec niveaux de sévérité cohérents. |",
  "| `/alerts` | Centre d’alertes Live | Alertes de la session courante provenant du read model Live. Différent du cycle d’incidents global Operations. | Clarifier cette différence et permettre de comprendre la cible et l’urgence de chaque alerte. |",
  "| `/performance` | Calendrier R | Calendrier mensuel du résultat net quotidien en R ; un drawer ouvre le détail d’une journée. | Harmoniser avec l’analyse globale. Le drawer historique peut devenir un écran routé si cela améliore la cohérence. |",
  "",
  "### B. Automatisation et supervision",
  "",
  "| Route | Écran | Contexte métier et contenu critique | Attente de redesign |",
  "|---|---|---|---|",
  "| `/operations` | Cockpit des opérations | Vue globale de tous les jobs, replays, backtests et feature runs normalisés. KPIs, filtres, recherche, progression, attente GPT, blocages et incidents. | Concevoir un control plane dense : KPI utiles, filtres persistants, tableau performant et interventions évidentes. |",
  "| `/operations/incidents` | Incidents & alertes | Cycle de vie global des alertes/erreurs/data quality : open, acknowledged, snoozed, resolved, reopened. Actions révisionnées et auditées. | Créer une inbox opérationnelle claire avec priorité, âge, cible, propriétaire implicite et action suivante. |",
  "| `/operations/workflows/:workflowId` | Détail workflow | État canonique, progression, durée, étapes, événements et actions autorisées : pause, reprise, retry ou annulation selon le type/état. | Structurer comme une fiche d’exécution avec header d’état, stepper, journal et zone d’action séparée. |",
  "| `/operations/workflows/:workflowId/events/:eventId` | Détail événement | Une transition précise du workflow : type, horodatage, statut, acteur, référence et payload projeté. | Faire un écran de diagnostic concis ; le JSON brut doit rester secondaire et repliable. |",
  "",
  "### C. Replay Lab et processus GPT",
  "",
  "| Route | Écran | Contexte métier et contenu critique | Attente de redesign |",
  "|---|---|---|---|",
  "| `/replay` | Replay Lab | Vue de toutes les journées et runs, progression, résultat R, erreurs, sessions. Permet de créer un replay réel à partir d’un pack/build immuable. | Offrir une vue portefeuille/recherche, des filtres temporels et une création guidée qui explique pack, cadence et session. |",
  "| `/replay/compare` | Comparaison Replay | Sélection de 2 à 8 runs/variantes/tentatives et comparaison des métriques canoniques. | Rendre la sélection et les écarts visuellement comparables ; éviter une simple juxtaposition de cartes. |",
  "| `/replay/runs/:runId` | Vue run | Synthèse d’un run : statut, stratégie, progression, performance, journées, timeline et processus GPT associés. | En faire le hub du run avec résumé décisionnel et accès clair aux journées/sessions. |",
  "| `/replay/runs/:runId/days/:date` | Journée Replay | Matrice de toutes les exécutions du jour. Une même session peut avoir plusieurs variantes et tentatives numérotées. | Utiliser un tableau/matrice dense et responsive qui rend immédiatement visibles session, variante, tentative, état et résultat. |",
  "| `/replay/runs/:runId/days/:date/sessions/:sessionExecutionId` | Session Replay | Détail d’une exécution : métriques, timeline prix/décisions zoomable, couches décision/étape/GPT, événements et processus GPT. | C’est l’écran analytique principal : maximiser la surface du graphique, synchroniser sélection et détails, conserver une timeline de secours. |",
  "| `/replay/runs/:runId/gpt/:processId` | Inspecteur GPT | Cycle d’un work item GPT : statut, durée, tentative, bundle, manifest, save target, lease, erreurs, événements, décision et conclusion. | Présenter le lifecycle comme un pipeline inspectable ; rendre la conclusion lisible et les données techniques progressives. |",
  "",
  "### D. Analyse, mémoire et gouvernance",
  "",
  "| Route | Écran | Contexte métier et contenu critique | Attente de redesign |",
  "|---|---|---|---|",
  "| `/performance/analysis` | Analyse de performance | Consolidation réelle des trades par journée, session, instrument et direction : R, win rate et autres ventilations. | Créer un espace analytics avec filtres partagés, graphiques utiles et tableaux de drill-down. |",
  "| `/history` | Historique des sessions | Mémoire consolidée construite à partir des workflows persistés : date, session, état, nombre de workflows et performance. | Mettre en place recherche, filtres et regroupements temporels ; éviter une simple liste de cartes. |",
  "| `/history/sessions/:sessionId` | Session historique | Détail d’une session passée et tableau de ses workflows. | Réutiliser les patterns du cockpit sans perdre le contexte historique. |",
  "| `/strategies` | Stratégies & versions | Catalogue, configuration, runtime, contrats actifs et historique des versions. | Concevoir une vue de gouvernance comparable à un registry, avec santé et version courante visibles. |",
  "| `/strategies/:strategyId` | Détail stratégie | Versions publiées, contrats, configuration courante et comparaison structurelle de deux versions. | Remplacer le JSON-first par un diff lisible, tout en gardant l’inspecteur brut disponible. |",
  "| `/more` | Navigation complète | Accès mobile/secondaire à tous les espaces du Desk. | Le transformer en menu organisé par domaines, identique à la taxonomie desktop. |",
  "",
  "## États transverses à designer",
  "",
  "Chaque famille d’écran doit disposer de composants cohérents pour : chargement initial, rafraîchissement discret, erreur récupérable, état vide, données partielles/stale, accès interdit, révision conflictuelle, action en cours, action réussie et échec d’action.",
  "",
  "Les statuts normalisés Operations sont : `queued`, `running`, `waiting_gpt`, `paused`, `blocked`, `failed`, `completed`, `cancelled`, `unknown`. Le Live Desk possède également ses statuts métier propres ; ne pas les fusionner aveuglément.",
  "",
  "## Données, rafraîchissement et sécurité",
  "",
  "- React 18, React Router 6 avec `HashRouter`, TanStack Query 5 et TypeScript.",
  "- Le contexte Live sélectionne automatiquement `asia_open` ou `ny_open` selon la phase Europe/Paris.",
  "- Les read models Live sont rafraîchis séparément selon leur criticité.",
  "- Operations utilise polling + SSE `/api/v1/events` pour invalider les queries.",
  "- Les écritures utilisent Firebase Auth si disponible ou la clé API locale de préproduction.",
  "- Les données indisponibles doivent être indiquées honnêtement ; ne jamais inventer prix, résultats, conclusions ou états.",
  "",
  "## Critères d’acceptation visuels et UX",
  "",
  "- Un utilisateur doit identifier en moins de cinq secondes : contexte, état, anomalie et action suivante.",
  "- Aucune page ne doit ressembler à une accumulation indifférenciée de cartes.",
  "- Tables et timelines doivent rester efficaces avec de gros volumes.",
  "- Le graphique Replay doit être le centre de l’écran session sur desktop.",
  "- Tous les écrans profonds ont un fil d’Ariane et un retour prévisible.",
  "- Les couleurs de statut restent accessibles et ne sont jamais le seul vecteur de sens.",
  "- Navigation clavier, focus visibles, labels de formulaire et zones tactiles mobiles correctes.",
  "- Vérification obligatoire aux largeurs 320, 768, 1280 et 1600 px.",
  "- Conserver les tests fonctionnels ; mettre à jour uniquement les assertions de présentation devenues obsolètes.",
  "",
  "## Ordre de travail recommandé à Claude",
  "",
  "1. Définir tokens, typographie, grilles, densité, statuts et composants de base.",
  "2. Refaire `AppShell` et l’architecture de navigation par domaines.",
  "3. Créer des gabarits communs : cockpit, index/tableau, détail d’exécution, analyse, document métier.",
  "4. Refaire Operations et Replay Session comme écrans pilotes à forte densité.",
  "5. Migrer le Live Desk et les écrans décisionnels vers le même design system.",
  "6. Migrer historique, performance et gouvernance.",
  "7. Consolider le CSS, tester responsive/accessibilité et exécuter TypeScript + React + E2E réel.",
  "",
  "## Code source et CSS actuels",
  "",
  "Les fichiers ci-dessous sont copiés intégralement. Les tests ne sont pas inclus afin de garder ce document centré sur le redesign ; ils restent disponibles dans le dépôt.",
  "",
].join("\n");

const fixedFiles = [
  "package.json",
  "index.html",
  "vite.config.ts",
  "tsconfig.json",
  "tsconfig.app.json",
  "tsconfig.node.json",
  "public/desk-mark.svg",
  "public/manifest.webmanifest",
  "public/sw.js",
  "src/App.tsx",
  "src/main.tsx",
  "src/types.ts",
  "src/operationsTypes.ts",
];

const sourceDirectories = [
  "src/api",
  "src/components",
  "src/context",
  "src/hooks",
  "src/pages",
  "src/styles",
];

async function collect(directory) {
  const entries = await readdir(join(root, directory), { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collect(path));
    else if ([".ts", ".tsx", ".css"].includes(extname(entry.name)) && !path.includes("/test/")) files.push(path);
  }
  return files;
}

const discovered = (await Promise.all(sourceDirectories.map(collect))).flat();
const files = [...new Set([...fixedFiles, ...discovered])].sort((left, right) => left.localeCompare(right));
const sections = [];
for (const file of files) {
  const absolute = join(root, file);
  const content = await readFile(absolute, "utf8");
  const language = extname(file) === ".css"
    ? "css"
    : extname(file) === ".html"
      ? "html"
      : [".json", ".webmanifest"].includes(extname(file))
        ? "json"
        : extname(file) === ".svg"
          ? "xml"
          : extname(file) === ".js"
            ? "js"
            : "tsx";
  sections.push(`### \`${relative(root, absolute)}\`\n\n\`\`\`\`${language}\n${content.trimEnd()}\n\`\`\`\``);
}

const generated = `${overview}\n${sections.join("\n\n")}\n`;
await writeFile(output, generated, "utf8");
console.log(`Handoff Claude généré : ${relative(root, output)} (${files.length} fichiers, ${generated.split("\n").length} lignes)`);
