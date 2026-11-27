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

**jobId stable (#1060, 2026-11-21)** : le cron et le rattrapage enfilent avec
`debriefJobId(userId, année, semaine)` = `debrief-<userId>-<année>-<semaine>` (sans « : », refusés par
BullMQ). Le job du dimanche encore en file et celui du lundi ne font qu'un : pas de deuxième e-mail.
`removeOnComplete` : l'id ne dédoublonne que tant que le job est en file (l'idempotence `generatedAt`
reste le garde-fou ensuite). Le rattrapage retire d'abord un job du dimanche **échoué** (gardé 7 j)
avant de réenfiler. La régénération admin (`force`) n'a jamais de jobId. Verrouillé par
`debrief/debrief-jobid.spec.ts`.
Limites acceptées : un job du dimanche encore **actif** le lundi 8 h qui échoue ensuite
définitivement n'est plus rattrapé cette semaine-là (prix de l'anti-doublon) ; la semaine est
calculée en heure locale du serveur (`getWeekInfo`) : le même id le dimanche et le lundi suppose un
serveur en UTC ou à Paris (cas des VPS et de la CI).

**Débrief manuel de milieu de semaine (C1 #1048, 2026-11-16)** : un débrief généré avant le dimanche
23:00 de sa semaine (`weeklyCutoff`, explicitement en heure de Paris, bouton « Générer le débrief de cette semaine ») est REFAIT par le
cron du dimanche et, à défaut, par le rattrapage du lundi, sur la semaine complète : `created=true`,
donc l'e-mail « débrief prêt » part. Un débrief produit par le cron (≥ 23:00) n'est jamais refait :
pas de 2e e-mail le lundi (test « anti double e-mail »). Le débrief est refait même si
`notificationsEmail` est faux (un appel IA, sans e-mail) : l'écran couvre alors toute la semaine.

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
| `DailyRecapCron` | `30 17 * * 1-5` Paris | Génère recap + envoie email aux users actifs du jour, seulement si `notificationsEmail` (N1 #1048) ; push RECAP selon ses propres réglages |
| `EcoCalendarCron` | `0 7 * * 1-5` Paris | Pré-génère le calendrier pour tous les users Premium |
| `SessionCloseCron` | `5 17 * * *` **America/Chicago** | Bascule CME : clôture les sessions `ACTIVE` d'une journée précédente (`startedAt < tradingDayStart(now)`, même fonction que `activeSessionWhere`), `endedAt` = fin de leur journée, totaux sur leurs propres trades (`autoCloseData`, `session-totals.ts`), `moodEnd` vide, hors démo (#595). Clôture ponctuelle par id : `scripts/close-sessions.ts` (même logique, dry-run sans `--apply`) |
| `TrialEndService` | `30 0 * * *` Paris | Fins de `trialEndsAt` passées (essai d'inscription ou Premium offert, #769) : rôle Discord réaligné, `trialEndHandledAt` posé (retraité si `trialEndsAt` est repoussé ensuite), hors démo. Journal : des nombres seulement. `DiscordGuildClient.setPlanRole` lève sur HTTP en erreur (hors 404) ou panne réseau : `discordFailed` compte vraiment, `trialEndHandledAt` reste posé (resynchronisation admin). `removePlanRoles` ne lève pas, renvoie `false` ; suppression de compte → `warn` avec le discordId pour un retrait à la main (N2 #1046) |
| `GiveawayCron` | `0 9 1 * *` Paris (constantes `GIVEAWAY_DRAW_*`) | Tirage mensuel (#1150) : seulement les tirages allumés, un tirage par (période, tirage) garanti par la contrainte unique, lot attribué puis e-mails (gagnant, admin). Voir `commun/tirage-mensuel.md` |
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

## Purge des comptes inactifs (#824, 2026-11-23)

`InactivityPurgeService` (`modules/inactivity-purge`), `@Cron('0 10 * * *', Europe/Paris)`, worker cron.
Compte sans connexion depuis 2 ans (`INACTIVITY_PURGE_DAYS`, `@mtc/shared`) : préavis J-28, J-21,
J-14, J-7, puis suppression par `UsersService.deleteForInactivity` (même chemin qu'une suppression
demandée, `deletedBy: 'inactivity'`). Calcul pur et en jours de Paris dans `inactivity-purge.util.ts` :
date annoncée = date plancher, jamais devancée ; préavis du cycle = lignes `EmailSend`
`inactivity_purge_notice` postérieures à la dernière connexion (une connexion remet à zéro).
Sélection et exclusions dans le `where` (`inactiveWhere`, prouvé par `inactivity-purge.int-spec.ts`).
Plafonds par passage : 50 suppressions, 500 préavis. Échec d'un compte (Stripe, Resend) : compté,
journalisé par id et nom d'erreur, le passage continue. `INACTIVITY_PURGE_ENABLED` ≠ `true` = journal
seul : aucune écriture, aucun appel, une ligne « Comptes inactifs (journal seul) » avec les comptes
par rang de préavis, les suppressions dues et les exclus par motif. Le worker dev tourne sans crons :
la preuve passe par les tests puis par ce journal en prod.
Tous les comptes éligibles sont examinés à chaque passage, par pages de 1 000
(`INACTIVITY_PAGE_SIZE`, #1257) : curseur « après (createdAt, id) » dans le `where`, pas le curseur
Prisma (un compte supprimé pendant le passage ne casse pas la page suivante). Si Resend envoie mais que l'écriture `EmailSend` échoue, le
même préavis repart au passage suivant : le compte reçoit un doublon mais la date plancher reste la
même, donc jamais de suppression anticipée.
