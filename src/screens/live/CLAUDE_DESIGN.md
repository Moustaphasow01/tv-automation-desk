# Contrat Claude Design — écran Live

## Périmètre à transmettre

Pour faire évoluer uniquement le Live Desk, transmettre à Claude :

- `LiveDeskScreen.tsx` — structure visuelle de l'écran ;
- `liveDeskScreen.css` — styles propres à l'écran ;
- `LiveDeskScreen.types.ts` — contrat d'entrée en lecture seule ;
- les composants visuels importés depuis `src/components` si Claude doit les réutiliser.

Claude doit rendre au minimum les deux premiers fichiers. `LiveDeskScreen.types.ts`
est un contrat d'intégration : il ne doit pas être modifié sans accord explicite.

## Frontière technique

`LiveDeskScreen` est un composant de présentation :

- aucune requête API ou TanStack Query ;
- aucun accès à React Router ;
- aucun accès direct au contexte de session ou aux overlays ;
- aucune lecture de Firestore, PostgreSQL, `localStorage` ou variable globale ;
- aucune donnée inventée et aucun mock dans le chemin de production ;
- toutes les interactions externes passent par `actions` ;
- toutes les données affichées proviennent de `data` et `phaseLabel`.

Le conteneur `src/pages/LiveDeskPage.tsx` reste propriété de l'intégration. Il charge
la projection réelle, branche les routes et ouvre les overlays.

## Contrat de sortie attendu

Le code retourné doit :

1. exporter `LiveDeskScreen` comme export nommé ;
2. accepter exactement `LiveDeskScreenProps` ;
3. conserver les six actions du contrat, même si leur placement visuel change ;
4. représenter les états vides ou partiels à partir des données reçues ;
5. rester utilisable à 320, 768, 1280 et 1600 px ;
6. ne modifier ni `src/App.tsx`, ni `src/pages`, ni `src/hooks`, ni `src/api` ;
7. ne pas ajouter une bibliothèque sans fournir son nom, sa version et sa justification.

## Prompt court recommandé

> Redessine exclusivement l'écran Live fourni. Retourne du React TypeScript et le
> CSS directement remplaçables dans `LiveDeskScreen.tsx` et
> `liveDeskScreen.css`. Respecte sans le modifier `LiveDeskScreenProps`. N'ajoute
> ni API, ni routeur, ni mock, ni état métier local. Toutes les navigations et
> ouvertures externes doivent utiliser `actions`. Préserve les informations et
> les états partiels, puis vérifie le rendu à 320, 768, 1280 et 1600 px.
