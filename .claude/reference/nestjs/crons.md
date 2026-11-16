# Crons, débrief hebdo et PDF

> Contenu déplacé à l'identique depuis `.claude/agents/nestjs.md` le 2026-11-16 (PROMPT-orchestration-agents).
> Chaque bloc garde son titre d'origine ; « Origine » donne l'agent, la section et la date d'origine (date du titre, sinon premier commit qui l'a écrite).

<!-- Origine : nestjs.md · Cron BullMQ — Weekly Debrief · 2026-04-25 -->
> **Origine** : `nestjs.md` · « Cron BullMQ — Weekly Debrief » · 2026-04-25

## Cron BullMQ — Weekly Debrief

`DebriefCron` (dimanche 23 h Paris, rattrapage lundi 8 h) enfile un job `generate` par utilisateur
de `debriefService.getEligibleUsers(refDate)` : Premium / admin / bêta / essai, débrief automatique
activé, non démo, **et au moins un trade clôturé dans la semaine de `refDate`** (SCA-B5-08 ; clôturé :
#1056, une semaine de positions ouvertes ne coûte pas d'appel IA). Le cron ne
journalise que le nombre de jobs, jamais les adresses. 3 essais, échecs gardés 7 j.

**Comptes désignés à l'IA par une clé courte** (`debrief/debrief-account-keys.ts`, 2026-10-23) :
`compte-1`, `compte-2`… dans l'ordre des comptes, `unassigned` inchangé ; jamais l'identifiant
interne. Les trades partent regroupés par clé et SANS leur `accountId`. L'IA renvoie la clé dans
`accounts[].accountId` ; `toId` la retraduit avant la fusion, une clé inconnue est ignorée. Le
débrief stocké garde les vrais ids (onglets, PDF).

<!-- Origine : nestjs.md · Crons V2 · 2026-05-23 -->
> **Origine** : `nestjs.md` · « Crons V2 » · 2026-05-23

### Crons V2

| Cron | Planning | Rôle |
|---|---|---|
| `DailyRecapCron` | `30 17 * * 1-5` Paris | Génère recap + envoie email aux users actifs du jour |
| `EcoCalendarCron` | `0 7 * * 1-5` Paris | Pré-génère le calendrier pour tous les users Premium |
| `SessionCloseCron` | `5 17 * * *` **America/Chicago** | Bascule CME : clôture les sessions `ACTIVE` d'une journée précédente (`startedAt < tradingDayStart(now)`, même fonction que `activeSessionWhere`), `endedAt` = fin de leur journée, totaux sur leurs propres trades (`autoCloseData`, `session-totals.ts`), `moodEnd` vide, hors démo (#595). Clôture ponctuelle par id : `scripts/close-sessions.ts` (même logique, dry-run sans `--apply`) |
| `TrialEndService` | `30 0 * * *` Paris | Fins de `trialEndsAt` passées (essai d'inscription ou Premium offert, #769) : rôle Discord réaligné, `trialEndHandledAt` posé (retraité si `trialEndsAt` est repoussé ensuite), hors démo. Journal : des nombres seulement. `DiscordGuildClient.setPlanRole` lève sur HTTP en erreur (hors 404) ou panne réseau : `discordFailed` compte vraiment, `trialEndHandledAt` reste posé (resynchronisation admin). `removePlanRoles` ne lève pas, renvoie `false` ; suppression de compte → `warn` avec le discordId pour un retrait à la main (N2 #1046) |
| `DemoSeedCron` | `20 3 * * *` Paris | Re-seed le compte démo (dates relatives recalculées) |
| `TradovateTokenRefreshCron` | `17 * * * *` Paris | Renouvelle les tokens Tradovate qui expirent sous 18 h + seconde chance des « à reconnecter » encore promises (aucun import de trades, hors démo) |
| `TradovateObservationCron` | `40 6 * * *` Paris | Journal d'observation (#684, phase 2) : une lecture de `/account/list` par login, une ligne `TradovateAccountObservation` par connexion `CONNECTED` (comptes en pause compris), hors démo, purge à 90 j. N'agit sur rien |
| `TradovateBackgroundRefreshCron` | `*/15 * * * *` Paris | Synchro de fond des connexions sans synchro depuis 12 min (hors démo, hors app ouverte). **Au 1er passage de chaque heure seulement** (minute < 15), ajoute le rattrapage du mois par la Reporting API, et remonte tout le passé (≤ 2 par passage) des connexions dont `historyImportedAt` est vide |

> `TradovateBackgroundRefreshCron` (SCA-B5-03, 2026-10-09) : verrou Redis `tradovate:background-refresh`
> (SET NX, 30 min, rendu par son seul propriétaire) → un passage qui démarre pendant le précédent est
> **sauté** ; utilisateurs traités **5 en parallèle**, les connexions d'un même utilisateur l'une
> après l'autre (login Tradovate partagé). Budget de passés complets décidé avant le parallélisme.
> Non fait : file BullMQ par connexion et étalement du mois sur l'heure (hash % 4).

<!-- Origine : nestjs.md · PDF du débrief — Chromium réutilisé (SCA-B0-06, 2026-09-30) · 2026-09-30 -->
> **Origine** : `nestjs.md` · « PDF du débrief — Chromium réutilisé (SCA-B0-06, 2026-09-30) » · 2026-09-30

## PDF du débrief — Chromium réutilisé (SCA-B0-06, 2026-09-30)

`PdfService` garde **un seul** Chromium par process (lancé à la demande, fermé après 5 min sans
PDF ou 200 rendus, recyclé après une erreur), rend **un PDF à la fois** (file interne) avec un
timeout de 20 s, et referme toujours la page. Ne jamais revenir à `puppeteer.launch` par requête :
150 à 300 Mo par instance, 3 ou 4 téléchargements simultanés suffisaient à l'OOM.
Tout texte IA ou utilisateur injecté dans le HTML passe par `escapeHtml()`.
Pas de cache Redis des PDF : Redis prod (256 Mo, `noeviction`) porte les files BullMQ.
