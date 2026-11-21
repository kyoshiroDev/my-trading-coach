# Contrat front ↔ API (`libs/shared/src/contracts`)

> Contenu déplacé à l'identique depuis `.claude/agents/angular.md`, `.claude/agents/nestjs.md` le 2026-11-16 (PROMPT-orchestration-agents).
> Chaque bloc garde son titre d'origine ; « Origine » donne l'agent, la section et la date d'origine (date du titre, sinon premier commit qui l'a écrite).

<!-- Origine : nestjs.md · Contrat front ↔ API (`libs/shared/src/contracts`, audit du 27/09/2026) · 2026-09-27 -->
> **Origine** : `nestjs.md` · « Contrat front ↔ API (`libs/shared/src/contracts`, audit du 27/09/2026) » · 2026-09-27

## Contrat front ↔ API (`libs/shared/src/contracts`, audit du 27/09/2026)

- **Source unique des formes JSON échangées** : enums (copie des enums Prisma), trades, sessions,
  débrief, calendrier éco, fiche utilisateur admin, stats VPS, statistiques ambassadeur
  (`AmbassadorStats` / `AdminAmbassadorStats`, #1073). Import : `from '@mtc/shared'`.
- Les dates y sont des `string` ISO (ce que le front reçoit). Côté API, les DTO de requête
  `implements` le contrat (`CreateTradeDto implements CreateTradeRequest`) : un champ ajouté d'un
  seul côté casse la compilation.
- Enums : `EmotionState.FOCUSED` (valeur) / `EmotionState` (type). Le test API
  `common/contracts-sync.spec.ts` compare chaque enum à Prisma : après une migration qui touche un
  enum, mettre à jour `contracts/enums.ts`.
- Jamais de nouvelle interface d'échange recopiée dans `core/api/*.api.ts` : l'ajouter au contrat,
  puis la ré-exporter (`export type { X }`) si des importeurs existants passent par l'API front.
- Aussi partagés : `todayParis` / `parisDayRange` (dates Paris), `normalizeEventKey` / `eventKey`,
  `renderEmailMarkdown` (rendu des campagnes, envoi + aperçu admin).
- **Envoi test des campagnes** (#525) : `POST /admin/campaigns/:type/test` → UN e-mail vers
  `CAMPAIGN_TEST_EMAIL` (défaut hello@, jamais saisi dans l'admin), sujet « [TEST] », même rendu
  (prénom d'exemple). Aucun `EmailSend`, ni oneShot ni plafond. L'empreinte sha256 du contenu (sans
  prénom / places / lien de désinscription) est gardée 7 j dans Redis `campaign-test:{type}` ; pour
  les campagnes `REQUIRES_TEST` (`founder_launch`, `legal_notice`), `send` refuse sans test sur le contenu actuel.
  `founder_launch` : refusée si l'offre est fermée ou complète ; `seatsLeft` calculé à l'envoi et
  passé à `dispatch(…, { seatsLeft })`. Lien `founderLaunchUrl(FRONTEND_URL)` = `/dashboard?plan=founder&cta=email`
  + UTM : les destinataires ont un compte, l'app garde l'intention pendant la connexion puis ouvre la
  modale fondateur (→ `/paiement`). Signature : « Grégory », sans nom de famille (demande de Greg).
- **Information de service « 30 jours avant »** (#817) : campagne manuelle `legal_notice`, pour
  prévenir d'une modification des CGU ou des prix. Type `transactional` : tous les comptes réels
  (`REAL_USERS`, hors démo et admin), sans consentement, malgré « ne plus recevoir les e-mails d'aide »,
  hors plafond, sans lien ni en-tête de désinscription. Objet et texte (Markdown) saisis dans l'admin,
  tous deux obligatoires (`assertContent`) ; `REQUIRES_TEST` ; gabarit `legalNoticeTemplate` (pied
  `LEGAL_NOTICE_FOOTER`, contact support@, aucun bouton). `recurringCooldownDays: 7` : un renvoi
  après erreur ne touche que ceux qui ne l'ont pas reçu, une nouvelle information reste possible
  après 7 jours. Jamais pour une nouveauté ou une offre : c'est `announcement` (marketing).
- **Pas de campagne « débrief prêt »** (#833) : l'e-mail part déjà, automatiquement, après chaque
  débrief généré (`debrief.processor`, réglage `notificationsEmail`), essai d'inscription compris.
  L'ancienne campagne manuelle `debrief_reminder` (ciblée sur `plan: PREMIUM`) le doublait et
  l'annonçait à des comptes sans débrief : retirée, ne pas la recréer.
- **Lettre de Greg** (`resend/campaigns/greg-letter.ts`) : forme des e-mails écrits à la 1re personne
  (`founder_launch`) = celle de ses envois manuels : fond blanc, style lettre, signature Zoho de Greg
  avec le logo joint en inline (`cid:logo-mtc`), expéditeur `Grégory · MyTradingCoach <support@>`,
  réponses sur hello@, version texte. `CampaignContent` porte `text/from/replyTo/attachments`, que
  `dispatch` et l'envoi test transmettent à `EmailJob`. Pas de ligne « Greg, … » dans le corps : la
  signature suffit (jamais deux signatures). Aperçu admin : `inlineLogoForPreview` (data URI).

<!-- Origine : angular.md · Contrat front ↔ API (`libs/shared/src/contracts`, audit du 27/09/2026) · 2026-09-27 -->
> **Origine** : `angular.md` · « Contrat front ↔ API (`libs/shared/src/contracts`, audit du 27/09/2026) » · 2026-09-27

## Contrat front ↔ API (`libs/shared/src/contracts`, audit du 27/09/2026)

- **Source unique des formes JSON échangées** : enums (copie des enums Prisma), trades, sessions,
  débrief, calendrier éco, fiche utilisateur admin, stats VPS. Import : `from '@mtc/shared'`.
- Les dates y sont des `string` ISO (ce que le front reçoit). Côté API, les DTO de requête
  `implements` le contrat (`CreateTradeDto implements CreateTradeRequest`) : un champ ajouté d'un
  seul côté casse la compilation.
- Enums : `EmotionState.FOCUSED` (valeur) / `EmotionState` (type). Le test API
  `common/contracts-sync.spec.ts` compare chaque enum à Prisma : après une migration qui touche un
  enum, mettre à jour `contracts/enums.ts`.
- Jamais de nouvelle interface d'échange recopiée dans `core/api/*.api.ts` : l'ajouter au contrat,
  puis la ré-exporter (`export type { X }`) si des importeurs existants passent par l'API front.
- Aussi partagés : `todayParis` / `parisDayRange` (dates Paris), `normalizeEventKey` / `eventKey`,
  `renderEmailMarkdown` (rendu des campagnes côté API).
- Aperçu des campagnes (admin `/emails`) : **toujours** le HTML renvoyé par
  `POST /admin/campaigns/:type/preview` (le vrai template envoyé), jamais un rendu reconstruit côté
  front. Objet/contenu d'une annonce → nouvel appel après 400 ms de pause (`switchMap`).
- Campagnes `requiresTest` (`founder_launch`, `legal_notice`) : bouton « Envoyer un test à {testEmail} » (adresse
  donnée par l'API, jamais saisie) ; « Envoyer à N inscrits » désactivé tant que le contenu actuel
  n'est pas testé (`testedCurrent`, revérifié par le serveur), puis confirmation « Envoyer à N
  inscrits ? ». Pas de case « force » pour ces campagnes. Ciblés avec / sans consentement affichés.
- Contenu saisi (`FREE_CONTENT` : `announcement`, `legal_notice` #817) : mêmes champs objet / texte.
  `legal_notice` exige aussi le texte, et l'avertissement dit « Information obligatoire » (envoyée
  même à ceux qui ont coupé les e-mails, réservée aux CGU et aux prix, 30 jours avant).
