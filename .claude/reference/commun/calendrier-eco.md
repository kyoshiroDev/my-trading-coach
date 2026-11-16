# Calendrier économique

> Contenu déplacé à l'identique depuis `.claude/agents/angular.md`, `.claude/agents/nestjs.md`, `.claude/agents/prisma.md` le 2026-11-16 (PROMPT-orchestration-agents).
> Chaque bloc garde son titre d'origine ; « Origine » donne l'agent, la section et la date d'origine (date du titre, sinon premier commit qui l'a écrite).

<!-- Origine : nestjs.md · Calendrier éco : données FMP à ne pas croire sur parole (2026-10-05) · 2026-10-05 -->
> **Origine** : `nestjs.md` · « Calendrier éco : données FMP à ne pas croire sur parole (2026-10-05) » · 2026-10-05

## Calendrier éco : données FMP à ne pas croire sur parole (2026-10-05)

- FMP renvoie parfois un `actual` sur un event **encore à venir** (inflation brésilienne du vendredi
  « publiée » le lundi). `fetchAndStoreEvents` ne stocke un `actual` que si l'heure UTC est passée, et
  `getEventsFromDb` le masque aussi à la lecture (lignes déjà en base). `isReleased` = `actual !== null`
  après ce filtre.
- L'upsert resynchronise heure, impact, prévision, précédent, unité et `actual` (pas seulement `actual`) :
  FMP révise ses prévisions après coup. La clé est `(date, name, currency, country)` depuis C6 (#1046, décision du 2026-11-15 : clé élargie au pays, historique fusionné gardé tel quel).
- Traduction des libellés (`translateEventNames`) **par lots de 15**, `max_tokens: 1024` par lot. Un seul
  appel à 300 tokens tronquait le JSON des journées chargées → rien traduit et nouvel appel à chaque
  polling (toutes les minutes). Un lot illisible n'empêche pas les autres.
- **Verrou de relance par libellé** (`eco:label-tr:<nom>`, `SET NX EX` 12 h, `claimForTranslation`) : un
  libellé n'est soumis au modèle qu'une fois par 12 h, réussite ou échec. Sans lui, tout libellé en
  échec (JSON tronqué, clé renvoyée modifiée, panne) repartait au modèle à chaque polling : ~603
  appels/jour, 4 834 `eco_translation` sur 30 jours au 2026-10-08. Redis indisponible → traduction
  reportée (jamais de rafale). Régime attendu : ~30-50 appels/mois.
- `translateEventNames(dates)` couvre **toutes les dates enregistrées par le fetch** (FMP renvoie la
  veille et le lendemain), et la propagation se fait par nom sur les lignes `nameFr: null` : un jour
  jamais demandé (dimanche, « OPEC Meeting ») gardait sinon ses libellés en anglais.
- **Tri façon ForexFactory** (`eco-calendar.impact.ts`, `classifyEcoEvent`, pur) appliqué à l'ingestion
  ET à la lecture (`getEventsFromDb`, sur le `name` anglais FMP) : seules les 9 devises FF (USD EUR GBP
  JPY CAD AUD NZD CHF CNY) ; EUR limité aux pays EU/DE/FR ; bruit retiré (CFTC, MBA, enchères, prix
  immobiliers, balance courante, stocks EIA hors brut…) ; impact **fort = nos règles** (NFP, CPI, PCE,
  PIB trimestriel, ventes au détail, ISM manuf., taux directeurs, FOMC, gouverneurs), y compris quand
  FMP dit Low ; le reste jugé High/Medium par FMP = moyen ; Low = écarté. Écartés aussi : discours des
  membres non gouverneurs (`SPEECH` sans `GOVERNORS`), exports/imports, PMI construction, WASDE…, et
  `KEEP_ONLY_FOR` (balance commerciale hors CNY, production industrielle hors GBP/CNY, ventes au détail,
  chômage et confiance des ménages hors devises où FF les montre). Semaine du 5/10 : ~90 → ~15 annonces.
  `ALWAYS_MEDIUM` (Michigan, inscriptions au chômage, ISM Services, brut EIA, Ivey) : gardés en moyen même
  classés Low par FMP, sinon jamais stockés ou plus resynchronisés.
  Une annonce manquante ou mal classée = une règle à ajouter dans `HIGH`/`NOISE` + un cas dans
  `eco-calendar.impact.spec.ts`.
- `EcoEvent` est **partagé** (pas de `userId`) : le seed démo n'y écrit plus de faux events quand
  `FMP_API_KEY` est défini (il épingle 2 vraies annonces du jour). Avant, ses 4 faux events (« CPI US »
  fantôme, « Balance courante »…) apparaissaient chaque nuit chez tout le monde ; purgés par la migration
  `20261005160000_purge_demo_fake_eco_events`. Le seed écrit aussi `pinnedEcoDate` (sinon
  `readUserPins` vidait la sélection démo).

<!-- Origine : nestjs.md · Calendrier éco : relevé planifié autour de chaque annonce (2026-11-10, #920) · 2026-11-10 -->
> **Origine** : `nestjs.md` · « Calendrier éco : relevé planifié autour de chaque annonce (2026-11-10, #920) » · 2026-11-10

## Calendrier éco : relevé planifié autour de chaque annonce (2026-11-10, #920)

- Plus de fenêtre fixe 8 h-18 h. `EcoCalendarCron.pollScheduledReleases` tourne **toutes les 20 s** mais
  n'appelle FMP que si une annonce chiffrée sans résultat est dans sa fenêtre : de son heure prévue à
  **+15 min** (`eco-calendar.schedule.ts`, pur, `datesToPoll`). Hors fenêtre : une lecture en base, zéro
  requête FMP. Semaine de marché : dimanche 18 h → vendredi 23 h 59 Paris (`isInTradingWeek`).
- `EcoEvent.date/time` sont l'heure murale de Paris : `parisWallTimeToUtc` la reconvertit (heure d'été
  comprise). La veille est lue aussi (annonce de 23 h 50 encore en fenêtre après minuit).
- `hasNumericResult(name)` : discours, auditions, conférences de presse, communiqués, minutes, rapports de
  politique monétaire et gouverneurs nommés = **sans chiffre**, jamais relevés (prod 30 j : 0 `actual` sur
  38). Une décision de taux reste chiffrée.
- 6 h (lun-ven) : today + prochain jour ouvré, puis `catchUpMissingResults` resynchronise les 4 derniers
  jours où une annonce chiffrée passée est restée sans résultat (la veille ; le vendredi soir le lundi).
  Dimanche 17 h : today + lundi (annonces du dimanche soir). 18 h 30 : filet + purge `eco:calendar:<jour>:*`
  (calendriers par user reconstruits à la demande ; ne touche ni `eco:analysis:*` ni les verrous).
- Purge aussi (#982) : à chaque résultat relevé par le tick de 20 s, `eco:calendar:<jour>:*` est vidé
  **avant** le broadcast (le tableau de bord démo, où `refresh-today` est refusé, relit un cache frais au
  polling de secours) ; à 6 h, today, demain et les jours rattrapés. Une panne Redis au vidage est
  journalisée et ne bloque ni le broadcast ni le relevé suivant.
- Coût FMP : avant ~603 requêtes/jour ouvré ; après = 3 à 5 fixes + 1 par tick de 20 s pendant les
  fenêtres (au plus 45 par créneau horaire si FMP ne publie jamais le chiffre).
- **Observable en prod seulement** : relevé du soir, `🔔 … nouveaux résultats`, `✨ … analyse(s)` (analyse
  auto). Dev n'a ni crons ni IA (`AI_ENABLED=false`) ; `POST /eco-calendar/fetch/:date` (admin) remplit
  `EcoEvent` sans broadcast ni analyse. Vérifier sur le worker prod : logs, `EcoEvent`, `AiUsageLog`.

<!-- Origine : nestjs.md · Calendrier éco : analyse automatique des résultats forts (2026-11-10, #920) · 2026-11-10 -->
> **Origine** : `nestjs.md` · « Calendrier éco : analyse automatique des résultats forts (2026-11-10, #920) » · 2026-11-10

## Calendrier éco : analyse automatique des résultats forts (2026-11-10, #920)

- `ensureReleasedAnalysis(day, event, assets, 'auto'|'clic')` : **un seul appel modèle par clé**
  `eco:analysis:<jour>:<nom sans période>:<actifs triés ,>` (la clé du clic d'avant), même à 50 traders
  simultanés : verrou `eco:analysis-lock:<clé>` (SET NX EX 90), les autres attendent le cache (15 s max).
  Échec du modèle → `null` + `eco:analysis-fail:<clé>` 10 min (nouvel essai ensuite). Plafond quotidien
  `ECO_RESULT_ANALYSIS_DAILY_MAX` (défaut 200, compteur `eco:analysis-count:<jour>`). Journal : « générée
  (auto|clic, jour, n/plafond) », jamais le contenu. Redis indisponible : le clic appelle sans verrou
  (comportement d'avant), l'auto s'abstient.
- `autoAnalyzeReleased(day, newEvents)` : appelé par le relevé planifié après la diffusion (non attendu),
  annonces **fortes + chiffrées** publiées seulement, pour les signatures vues aujourd'hui ou hier
  (`eco:sigs:<jour>`, alimenté par `/today` et `/analyze-result`). Jamais hors `NODE_ENV=production`.
- `analyzeEcoResult` : plus de `actual ?? 0` / `estimate ?? 0`. Sans résultat → rejet sans appel ; sans
  prévision → « pas de consensus publié », aucune surprise calculée.
- Analyses du matin et des résultats journalisées avec `userId: null` (job mutualisé) : `'shared'` violait
  la clé étrangère d'`AiUsageLog`, ces appels n'étaient jamais comptés.
- Front (`eco-calendar.component`) : les annonces fortes publiées du jour sont chargées et dépliées sans
  clic (`openEvents`), le clic replie/déplie et réutilise le cache.

<!-- Origine : nestjs.md · Calendrier éco : interventions sans chiffre, état « passé » (2026-11-10, #920) · 2026-11-10 -->
> **Origine** : `nestjs.md` · « Calendrier éco : interventions sans chiffre, état « passé » (2026-11-10, #920) » · 2026-11-10

## Calendrier éco : interventions sans chiffre, état « passé » (2026-11-10, #920)

- `EcoEvent` (contrat `@mtc/shared`) gagne `hasResult` (false = discours, conférence de presse, minutes,
  communiqué : `hasNumericResult` sur le libellé anglais FMP) et `status` : `released` (chiffre publié),
  `past` (heure passée sans chiffre), `upcoming`. Les deux sont optionnels (données figées de démo).
- Front calendrier : colonne IA `talk` (« 🎙 sans chiffre ») + statut neutre sous le libellé : « Intervention
  prévue à HH:MM, volatilité possible. Pas de résultat chiffré, pas d'analyse automatique. » puis
  « Intervention passée (HH:MM)… » ; ligne en état `past`, distinct de `published`. Aucune analyse IA.
- Pas de source de texte branchée. Existantes, non ajoutées : flux RSS des discours de la Fed
  (federalreserve.gov) et communiqués/discours BCE (ecb.europa.eu) ; FMP n'en fournit pas.

<!-- Origine : nestjs.md · Calendrier éco : briefing factuel avant les annonces fortes (2026-11-10, #920) · 2026-11-10 -->
> **Origine** : `nestjs.md` · « Calendrier éco : briefing factuel avant les annonces fortes (2026-11-10, #920) » · 2026-11-10

## Calendrier éco : briefing factuel avant les annonces fortes (2026-11-10, #920)

- `GET /eco-calendar/today` renvoie `briefing: EcoBriefingLine[]` (`eco-calendar.briefing.ts`, pur, sans
  IA) : une ligne par annonce forte du jour, « HH:MM · libellé (devise) · prévision X · précédent Y ·
  concerne <actifs du trader dans la devise> ». Sans prévision : « pas de consensus publié » ; intervention :
  « pas de chiffre attendu ». Aucune direction ni conseil (test : `findForbiddenTerms` vide).
- `assetCurrencies(asset)` : racine de contrat avec ou sans échéance (NQZ6, MNQ 12-26), paires (EUR/USD,
  XAUUSD), futures devises CME (6E…), indices (GER40, UK100…), crypto → USD ; inconnu (actions) → aucune.
- Dashboard matin (`session-morning`) : lignes des annonces encore à venir (`status === 'upcoming'`).

<!-- Origine : nestjs.md · Calendrier éco : sorties IA factuelles, conformité (2026-11-10, #920, commit séparé) · 2026-11-10 -->
> **Origine** : `nestjs.md` · « Calendrier éco : sorties IA factuelles, conformité (2026-11-10, #920, commit séparé) » · 2026-11-10

## Calendrier éco : sorties IA factuelles, conformité (2026-11-10, #920, commit séparé)

- Avant : sentiment `bull/bear/neutral` par actif (matin et résultat), flèches ▲▼ par devise dans le
  calendrier, « haussier/baissier » dans le widget live, recommandation rédigée par le modèle.
- Maintenant : `EcoResultAnalysis` (contrat partagé) = `{ interpretation, gap }`. `gap` = `releaseGap`
  (`eco-calendar.gap.ts`, pur) : `above` / `inline` (à la précision de la prévision) / `below` /
  `no_consensus`. Le modèle rédige 1 à 2 phrases neutres (ce que mesure l'indicateur, ce que dit le
  résultat vs prévision et précédent), sans direction ni conseil.
- Matin : le modèle ne rédige que `summary` (factuel : annonces, heures, devises) ; `recommendation` =
  `morningFocus` en code (« Prochaine annonce à fort impact : HH:MM, … Volatilité possible… ») ;
  `assetImpacts` toujours `[]`, même relu depuis une ligne `EcoAnalysisCache` antérieure.
- Clé de cache des résultats passée en `eco:analysis:v2:` (les anciennes portaient des sentiments).
- Garde : `eco-calendar.compliance.spec.ts` (prompts, sorties, textes en code, affichage) + dossiers
  `eco-calendar` ajoutés au balayage `ai-texts-compliance.spec.ts`.
- Non touché (données de démo figées) : `DEMO_ECO_RECO` dans `session-morning.component.ts`
  (« Évite d'ouvrir une position 5 min avant le NFP »), à revoir avec Greg.

<!-- Origine : angular.md · Calendrier éco : analyses ouvertes d'office (2026-11-10, #920) · 2026-11-10 -->
> **Origine** : `angular.md` · « Calendrier éco : analyses ouvertes d'office (2026-11-10, #920) » · 2026-11-10

## Calendrier éco : analyses ouvertes d'office (2026-11-10, #920)

- `eco-calendar.component` : au chargement de la semaine, les annonces **fortes publiées du jour** voient
  leur analyse chargée (`POST /eco-calendar/analyze-result`, cache serveur) et dépliée sans clic
  (`openEvents`, plusieurs à la fois). Le clic replie/déplie. Erreur de chargement automatique : pas de
  toast (le panneau dit « indisponible »). **Compte démo** : rien d'office (POST refusé en lecture seule).
- Interventions sans chiffre (`event.hasResult === false`, discours, conférences, minutes) : colonne IA
  `talk` (« 🎙 sans chiffre »), statut neutre sous le libellé (`talkStatus`), jamais analysées. Heure passée
  sans chiffre : ligne en état `past`, distinct de `published` (`event.status`, contrat partagé).
- Dashboard matin (`session-morning`) : `ecoBriefing` = `ecoCalendar().briefing` filtré sur
  `status === 'upcoming'` (aujourd'hui seulement) ; une ligne factuelle calculée côté serveur, affichée telle
  quelle (`line.text`), aucune direction ni conseil.

<!-- Origine : prisma.md · Analyses des annonces publiées (`EcoReleaseAnalysis`, 2026-11-09) · 2026-11-09 -->
> **Origine** : `prisma.md` · « Analyses des annonces publiées (`EcoReleaseAnalysis`, 2026-11-09) » · 2026-11-09

## Analyses des annonces publiées (`EcoReleaseAnalysis`, 2026-11-09)

Migration `20261109180000_eco_release_analysis` (additive, table seule) : l'analyse IA d'une annonce
publiée (`analyze-result`) est gardée par `(date, eventName sans suffixe de période, assetsKey)`,
écrite au premier calcul (upsert, `update: {}`), au clic comme par la génération automatique des
annonces fortes (#920, `ensureReleasedAnalysis`), relue pour un jour passé par
`GET /eco-calendar/release-analyses` sans appel IA. Pas d'`@@index([date])` : préfixe de l'unique.
Le seed démo n'en écrit que sans FMP (faux vendredi NFP, chômage, ISM), au format factuel
`{ interpretation, gap }` (écart par `releaseGap`, aucun sentiment ; textes dans
`fakePastReleaseAnalyses`), jamais sur des annonces FMP. Il réécrit ses propres lignes à chaque passage.
