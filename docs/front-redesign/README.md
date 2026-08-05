# Redesign front V2

Ce dossier regroupe le paquet de passation destiné au redesign du frontend Desk Futures.

Le paquet historique ci-dessous couvre une spécification globale sans code. Pour
le nouveau flux où Claude rend du code écran par écran, utiliser désormais
`src/screens/<écran>/CLAUDE_DESIGN.md`. Le Live Desk dans `src/screens/live` est
le premier module directement remplaçable et sert de modèle aux autres écrans.

## Fichiers actifs

- `MANIFEST.md` : contrat de mission, responsabilités Claude/Codex et format de sortie attendu.
- `PROMPT.md` : prompt prêt à transmettre à Claude.
- `HANDOFF.md` : snapshot généré du frontend actuel, incluant inventaire des écrans et code/CSS utiles.

## Régénérer le handoff

Depuis la racine du dépôt :

```bash
npm run handoff:claude
```

`HANDOFF.md` est généré depuis `scripts/handoff/build_claude_front_handoff.mjs`. Les corrections durables doivent donc être faites dans le script ou dans les fichiers source recopiés, pas directement dans le handoff généré.

## Séparation des chantiers

Ce paquet couvre uniquement le redesign front. La migration d'infrastructure reste séparée et ne doit pas orienter les décisions UI/UX.
