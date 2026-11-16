# Tests critiques à maintenir

> Contenu déplacé à l'identique depuis `.claude/agents/tests.md` le 2026-11-16 (PROMPT-orchestration-agents).
> Chaque bloc garde son titre d'origine ; « Origine » donne l'agent, la section et la date d'origine (date du titre, sinon premier commit qui l'a écrite).

<!-- Origine : tests.md · Tests critiques NestJS à maintenir · 2026-04-25 -->
> **Origine** : `tests.md` · « Tests critiques NestJS à maintenir » · 2026-04-25

## Tests critiques NestJS à maintenir

```
├── auth.service.spec.ts
│   → register, login, trial 7j, refresh token
│   → email déjà utilisé → 409
│   → mot de passe incorrect → 401
│
├── trades.service.spec.ts
│   → CRUD complet
│   → limite 50/mois FREE → 403 au 51ème
│   → historique illimité (pas de filtre date)
│
├── analytics.service.spec.ts
│   → summary accessible FREE
│   → by-setup, by-emotion → PREMIUM uniquement
│
├── premium.guard.spec.ts
│   → FREE → 403 avec trialAvailable
│   → PREMIUM → autorisé
│   → trial en cours → autorisé
│   → trial expiré → 403
│
├── beta.guard.spec.ts    ← V2
│   → BETA_TESTER → autorisé
│   → ADMIN → autorisé
│   → USER → 403 code BETA_ONLY
│   → USER + plan PREMIUM → 403 (rôle ≠ plan)
│
├── session.service.spec.ts    ← V2
│   → démarrer session, fermer la session active précédente
│   → getTodayTrades retourne uniquement les trades du jour
│   → closeTrade détecte SL pour un LONG (exitPrice ≤ stopLoss)
│   → closeTrade détecte TP pour un LONG (exitPrice ≥ takeProfit)
│   → closeTrade détecte Manuel si ni SL ni TP touché
│   → closeTrade enregistre le P&L en argent (MNQ 2 ct +10 pts = 40 $ ; ES SHORT −10 pts = 500 $)
│   → getLiveStats calcule winRate correctement
│
├── daily-recap.service.spec.ts    ← V2
│   → génère recap avec stats correctes (pnl, winRate, dominantEmotion)
│   → pas de aiOneLiner pour user FREE
│   → pas de aiOneLiner si < 3 trades
│   → retourne null si aucun trade aujourd'hui
│   → upsert si recap existant pour la même date
│
├── eco-calendar.service.spec.ts    ← V2
│   → retourne les données depuis le cache Redis si disponible
│   → getUserTopAssets retourne les 5 actifs les plus tradés
│   → analyzeReleasedEvent retourne null si event non publié (isReleased: false)
│   → fetchEconomicEvents retourne [] si pas de clé API
│
├── tradovate-watch*.spec.ts + tradovate-live.service.spec.ts (veille serveur, #770)
│   → éligibilité : démo, Free, sans appareil, sans séance, types coupés → fin ; heures silencieuses → pause
│   → fin de veille : 10 h, bornée à la journée de trading ; variable absente → veille éteinte
│   → dernier onglet fermé + éligible → WS gardé ; non titulaire du bail → rien gardé ici
│   → balayage : fin, pause puis reprise, onglet ouvert jamais touché, reprise après déploiement,
│     deux process → un seul WS ; int-spec : app fermée → trade suivi → clôture de séance → WS fermé
│     (`tradovate-live.int-spec.ts`, vrai Redis : en local, REDIS_PASSWORD du .env et REDIS_DB isolée)
│
└── ai.service.spec.ts
    → insights avec mock Anthropic
    → cooldown 4h → 429 au 2ème appel
    → overloaded_error → 503 lisible
    → generateDailyOneLiner retourne string (mock Anthropic)    ← V2
    → analyzeEcoEvents parse le JSON de réponse               ← V2
```

<!-- Origine : tests.md · Tests critiques Angular à maintenir · 2026-04-25 -->
> **Origine** : `tests.md` · « Tests critiques Angular à maintenir » · 2026-04-25

## Tests critiques Angular à maintenir

```
├── user.store.spec.ts    → isPremium(), isFreePlan(), isInTrial()
├── auth.guard.spec.ts    → redirect si non connecté
├── index-register-view.spec.ts (src/, à côté d'index.html)
│   → exécute le script inline register_view d'index.html avec un faux navigateur ;
│     motif inApp = IN_APP_UA_PATTERN, URL de l'API = environment.*.ts (un script inline
│     ne peut rien importer : ce test est la seule garde contre la dérive)
├── index-pwa.spec.ts (src/)
│   → manifest et balises PWA : couleurs = --bg de theme.css, icônes présentes à leur taille
│     (en-tête PNG), maskable et apple-touch-icon sans transparence, lien manifest présent
└── pnl-color.pipe.spec.ts
    → positif → var(--green)
    → négatif → var(--red)
    → null → var(--text-2)
```
- jsdom n'implémente pas `Blob.text()` : lire un corps de `sendBeacon` avec `FileReader`
  (cf. `signup-funnel.service.spec.ts`).
