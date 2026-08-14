# Sources du UI/UX & Frontend Product Engineering Rulebook

**Version du référentiel :** 1.0.0
**Date de consolidation :** 2026-08-13

Les règles sont une synthèse originale et normative. Elles ne reproduisent pas les sources mot pour mot. Les sources publiques ci-dessous ont été utilisées pour vérifier les principes, les exigences et les patterns. Les standards internes contextualisent le résultat pour les produits SaaS et control planes du projet.

| Code | Source | Rôle dans le référentiel | Lien |
| --- | --- | --- | --- |
| S01 | W3C — Web Content Accessibility Guidelines (WCAG) 2.2 | Critères d’accessibilité, contraste, focus, cible, authentification accessible et robustesse. | https://www.w3.org/TR/WCAG22/ |
| S02 | W3C — WAI-ARIA Authoring Practices Guide | Patterns interactifs, sémantique, clavier, focus et principe « No ARIA is better than bad ARIA ». | https://www.w3.org/WAI/ARIA/apg/ |
| S03 | W3C — Internationalization | Langues, direction, formats, Unicode, contenu traduisible et adaptation internationale. | https://www.w3.org/International/i18n-drafts/nav/about |
| S04 | ISO 9241-210 — Human-centred design for interactive systems | Processus de conception centré humain, contexte d’usage, évaluation et itération. | https://www.iso.org/standard/77520.html |
| S05 | ISO/TC 159/SC 4 — Ergonomics of human-system interaction catalogue | Principes d’interaction, présentation de l’information, navigation, formulaires, accessibilité et guidance. | https://www.iso.org/committee/53372/x/catalogue/ |
| S06 | Nielsen Norman Group — Usability heuristics and complex application UX | Visibilité du statut, contrôle, cohérence, prévention des erreurs, reconnaissance et efficacité. | https://www.nngroup.com/articles/ten-usability-heuristics/ |
| S07 | Google — Material Design 3 | Composants, états, couleur, layout, interaction et accessibilité multi-plateforme. | https://m3.material.io/ |
| S08 | Apple — Human Interface Guidelines | Hiérarchie, layout, typographie, écriture, feedback, navigation et accessibilité. | https://developer.apple.com/design/human-interface-guidelines/ |
| S09 | Microsoft — Fluent 2 Design System | Tokens, thèmes, layout, typographie, accessibilité et composants enterprise. | https://fluent2.microsoft.design/ |
| S10 | GOV.UK Design System | Patterns de service, formulaires, erreurs, contenu clair, navigation et validation par recherche. | https://design-system.service.gov.uk/ |
| S11 | U.S. Web Design System (USWDS) | Tokens, couleur, tableaux, visualisation, accessibilité et services publics robustes. | https://designsystem.digital.gov/ |
| S12 | IBM — Carbon Design System | Data visualization, accessibilité, composants enterprise, patterns et contenu. | https://carbondesignsystem.com/ |
| S13 | Atlassian Design System | Composants, contenu, tokens, accessibilité et workflows collaboratifs. | https://atlassian.design/ |
| S14 | Shopify — Polaris | Interfaces SaaS, index tables, actions, contenu et design system produit. | https://polaris.shopify.com/ |
| S15 | GitHub — Primer | Fondations, responsive, composants, navigation, contenu et interfaces développeurs. | https://primer.style/ |
| S16 | Adobe — Spectrum | Design inclusif, couleur, motion, contenu et composants multi-plateformes. | https://spectrum.adobe.com/ |
| S17 | Microsoft — Inclusive Design | Exclusion, cognition, diversité des capacités et conception inclusive. | https://inclusive.microsoft.design/ |
| S18 | Google PAIR — People + AI Guidebook | Mental models IA, explications, confiance, contrôle, erreurs et feedback utilisateur. | https://pair.withgoogle.com/guidebook/ |
| S19 | web.dev — Web Vitals | Performance perçue et terrain, LCP, INP, CLS, mesure et budgets. | https://web.dev/articles/vitals |
| S20 | MDN — HTML semantics and accessibility | HTML natif, sémantique, compatibilité, accessibilité et comportements web. | https://developer.mozilla.org/en-US/docs/Glossary/Semantics |
| S21 | React — Thinking in React and state structure | Décomposition de composants, source de vérité, état minimal et flux de données. | https://react.dev/learn/thinking-in-react |
| S22 | TanStack Query — Query keys and server-state guidance | Cache serveur, query keys, invalidation, synchronisation et données distantes. | https://tanstack.com/query/latest/docs/framework/react/guides/query-keys |
| S23 | Design Tokens Community Group — Design Tokens Format Module | Format interopérable de tokens, alias, groupes, types et gouvernance de design system. | https://www.designtokens.org/ |
| S24 | Storybook — Accessibility and visual testing | États de composants, tests d’accessibilité, interaction et régression visuelle. | https://storybook.js.org/docs/writing-tests/accessibility-testing |
| S25 | Playwright — Accessibility testing | Tests E2E, scans Axe, snapshots ARIA, captures et parcours réels. | https://playwright.dev/docs/accessibility-testing |
| S26 | OWASP — Secure Product Design and ASVS | Secure-by-design, authentification, validation, autorisations, erreurs et prévention des abus. | https://cheatsheetseries.owasp.org/cheatsheets/Secure_Product_Design_Cheat_Sheet.html |
| S27 | NIST SP 800-63-4 — Digital Identity Guidelines | Identité numérique, authentification, sessions, assurance et récupération. | https://pages.nist.gov/800-63-4/ |
| S28 | EDPB — Guidelines on deceptive design patterns | Prévention des interfaces manipulatrices et transparence des choix. | https://www.edpb.europa.eu/our-work-tools/our-documents/guidelines/guidelines-032022-deceptive-design-patterns-social-media_en |
| S29 | RGPD — Article 25, protection des données dès la conception et par défaut | Minimisation, privacy by design/default, finalité et protection des données. | https://eur-lex.europa.eu/eli/reg/2016/679/art_25/oj |
| S30 | Desk Control Plane V2 — documents maîtres internes du 13 août 2026 | Master Blueprint, Page Operating Contracts, audit backend-front et contrat de vérité du Desk. | Source interne au dépôt |
| S31 | NAKILI_ENGINEERING_STANDARDS.md — standard interne d’ingénierie | Architecture par feature, données réelles, qualité, tests, dérogations et protocole agent. | Source interne au dépôt |

## Principes de recherche

- Priorité aux normes et documentations officielles.
- Confrontation de plusieurs design systems afin d’éviter de transformer un seul système visuel en vérité universelle.
- Séparation entre exigences normatives, heuristiques, conventions de design system et règles internes renforcées.
- Adaptation aux interfaces enterprise, data-heavy, temps réel et à haut enjeu.
- Aucune maquette interne n’est traitée comme preuve d’une capacité backend.
