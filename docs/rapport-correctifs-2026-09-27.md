# Rapport — correctifs de l'audit du 27/09/2026

Branche : `claude/audit-ui-ux-dx-rnr1wi` (à fusionner dans `beta`). Prompt appliqué :
[`docs/prompts/correctifs-audit-2026-09-27.md`](prompts/correctifs-audit-2026-09-27.md).
Décisions retenues : D1 tout en français · D2 maquettes branchées sur la home · D3 à D7 valeurs par défaut.

> Les GitHub Actions n'ayant plus de crédit, **tout a été vérifié en local** (lint, typecheck,
> tests, build, Playwright). Les workflows modifiés n'ont pas encore tourné sur GitHub.

## Vérification finale (tous projets)

- Lint ✅ · typecheck ✅ · build ✅ sur les 4 apps, les 3 libs, `tools-scripts` et l'e2e.
- Tests : API 720 ✅ (couverture lignes 69,6 %, seuils OK) · app 449 ✅ · admin, libs ✅.
- Bundle initial de l'app : 376 kB (602 kB avant), budget bloquant à 500 kB.
- Intégration API : 19 échecs `tradovate-sync` / `referral-coexistence` **identiques à la base**
  (Redis local protégé par mot de passe) : liés à l'environnement local, pas à la branche.

---

## Phase 0 — Socle outillage
- Faites : DX-02 (4f2fcf2), DX-03 (813cb7f), DX-04 (02c9d1d), DX-05 (a6fbcdb), DX-06 partiel
  (d03cc9a, 01b4673 : hook pre-commit qui lint les projets touchés), DX-07 (0511642), DX-09 (e79b13d, 9e2d411),
  API-13 (56db82c).
- Non faites : **DX-01** (vendoriser `xlsx`), **DX-08** (`zod`) : voir « Bloqué réseau ».

## Phase 1 — Nx
- Faites : NX-01 (ab6c94f), NX-03 (f7ed831), NX-05 (1d737bc), NX-06 (0f087e9), NX-07 (63bfabc), CI-02 (1fb15cd).

## Phase 2 — API robustesse
- Faites : API-01 (17d1f02), API-02 (8f12632), API-03 (0bbfa99), API-04 (21801ac), API-05 (df907aa),
  API-06 (ebda4ca), API-07 (9a0ee63), API-08/09 (aea88ee), API-10 (b728353), API-11 (4413079), API-12 (cdf30fd).
- Modifiée : API-11 sans zod (non installable), validation maison dans `config/env.ts`.

## Phase 3 — Contrats partagés
- Faites : CT-01 à CT-03, CT-05, CT-06 (91a1503, 5f8ae7d, 4b56f4e, c0d30ae), dans `libs/shared`.
- Non faite : **CT-04** (schéma zod du trade), bloquée par l'installation de zod.

## Phase 4 — Fondations front
- Faites : UI-01 à UI-04 (87a1a5a), UI-05 + ADM-03 (4e9fbaf, sans `@angular/cdk` : dialogue maison
  accessible), UI-06 + APP-01 (f9b75c2), UI-08 (6e37212), UI-09 (1b339f5).

## Phase 5 — App et admin
- Faites : APP-02 (16056ba), APP-03 (a58cbe5), APP-04 (9c2c3bf, 0e8eb46), APP-05 (ce877b0),
  A11Y-01 à 08 (97572d1, 9c2c3bf, 97cd46e, 60f26e9, 048c424, 5545969, d43bf23, a4b0d32),
  PERF-01 + CI-09 (aa4baa9), PERF-02 (385c77e), ADM-01 (a785a1c), ADM-02 (4e3307b), ADM-04 (a47df17).
- Constat faux : **APP-06** : les `toFixed` restants sont des pourcentages et des ratios, les montants
  passent déjà par le formatage monétaire.
- Non faites : audit axe (A11Y-06/CI-07) et PERF-03 (fontes) : voir « Bloqué réseau ».

## Phase 6 — Routes API
- Faites : API-20 (b593803 : `/admin/users/*`, `/admin/ambassadors/*`, guards au niveau classe),
  API-21/22 (0e14ef1 : `/market/*`, `/instruments/*`).
- Anciennes routes gardées avec `@DeprecatedRoute` (log `warn` à chaque appel) : **à supprimer**
  quand les logs n'en montrent plus.

## Phase 7 — Landing
- Faites : LAND-01/02 (69b6f6b, sans `aggregateRating`), LAND-03/04 (5ab8d40), LAND-05 (3e6017a),
  LAND-06 (ba605a9), LAND-07 (5f1d9f7), LAND-08 styles (253c129, d6efa04, 85d9169 : 330 → 72 `style=`,
  rendu vérifié par comparaison des styles calculés), LAND-11/12 (ef69f31).
- Non faites : LAND-08 retrait de tailwind, LAND-09, LAND-10 : lockfile bloqué.
- Déploiement : ajouter la **301 nginx** des pages gatées décrite dans `deploy.md`.

## Phase 8 — Lisibilité
- Faites : READ-02 (d072ca0, 0 `PROMPT-xxx`), READ-03 (903e7f9), READ-04 (05c308e), READ-05 (ab75a46, d837a0e),
  READ-06 (7ebc21a), READ-07/08/09 (f99fe93), READ-01 (6df2fca, 2cd0ac8, 0054eab, 027d51e, 888fe35, 6bf3e9a,
  644378a, 3bffd58).
- READ-01 modifiée : la logique pure est sortie dans des fichiers testés (`*.helpers.ts`, `*.util.ts`,
  `*.model.ts`) plutôt qu'en sous-composants par étape ou onglet. ESLint avertit au-delà de 400 lignes.
  **10 fichiers restent au-dessus** (liste dans `CONTRIBUTING.md`), à découper quand on y retouche.

## Phase 9 — CI/CD et tests
- Faites : CI-01 (a56bf18 : lint et test inférés), CI-03 (04e887a : `checks.yml` réutilisable, appelé
  par `ci.yml` et `beta.yml`), CI-04 (36153bd : tests de l'app **240 s → 40 s** en local, specs sans
  isolation, stable sur 4 ordres aléatoires), CI-05 (97d158e : lignes ≥ 60 % sur trades, analytics,
  stripe, auth, vérifié en le forçant à 99 %), CI-06 (squelette Jest supprimé en 9e2d411),
  CI-07 (04e887a : smoke `/demo` → dashboard → journal → analytics sur base éphémère, **non bloquant**,
  validé en local avec l'environnement exact du job).
- Reportée : **CI-08** (images GHCR) : sans crédit Actions.
- Non tentée : essai de `happy-dom` (paquet non installé).

---

## Bloqué réseau (à faire depuis un poste avec accès normal)

`cdn.sheetjs.com` et `cdn.jsdelivr.net` sont inaccessibles ici. Or le lockfile référence `xlsx` sur
le CDN SheetJS : **toute modification du lockfile échoue**. Le paquet présent localement est la
0.18.5 du registre npm, une version vulnérable, donc inutilisable comme copie vendorisée.

1. **DX-01** : télécharger `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` dans `vendor/`,
   puis `"xlsx": "file:../../vendor/xlsx-0.20.3.tgz"` dans l'API et `COPY vendor ./vendor` dans le
   Dockerfile avant `pnpm install`. Le remplacement par `read-excel-file` est écarté : il ne lit pas le `.xls`
   et formate les dates autrement que `sheet_to_csv`, ce qui fait courir un risque sur les imports broker.
2. Ensuite, dans l'ordre : DX-08 + CT-04 (`zod`), DX-06 complet (`lint-staged`), PERF-03 + LAND-10
   (`@fontsource/*`), LAND-08 (retirer `tailwindcss`, `@tailwindcss/vite`), LAND-09
   (`eslint-plugin-astro`, TypeScript 6 sur la landing), audit axe (A11Y-06 / CI-07), déplacement
   de `scripts/discord-bot` vers `apps/`.

## Points d'attention pour la revue et le déploiement

- La branche contient aussi 13 commits de fusion `dev`/`beta` qui ne sont pas encore dans `origin/beta`.
- Premier run GitHub : vérifier `checks.yml` (jamais exécuté sur GitHub), surtout le job smoke
  (`playwright install --with-deps`, démarrage API et app).
- Formatage Prettier de masse **non appliqué** : il aurait noyé la revue. À faire dans un commit dédié.
- Contraste `text3` de l'admin : aligné AA, donc légèrement différent de la maquette.
- La landing et les emails parlent encore de « Weekly Debrief » alors que l'app dit « Débrief ».
- `DESIGN.md` et `PRODUCT.md` restent à la racine ; `.github/agents`, `.opencode/` sont générés par Nx.
- Agents mis à jour : `angular.md`, `nestjs.md`, `astro.md`, `deploy.md`, `tests.md`, `security.md`, plus un en-tête
  de sous-agent (nom, description) sur `design.md`, `instruments.md`, `plans.md`, `prisma.md`.
