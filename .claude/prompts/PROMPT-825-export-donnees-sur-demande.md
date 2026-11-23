# PROMPT-825 — Export des données sur demande : procédure

## Texte de Greg (2026-11-23)

> relance le commit une fois cette feature fini enchaine sur les autres de la moin urgente a la plus urgente si tu as des question pose les au relecteur et suit ce qu'il te dit

Ordre fixé par le relecteur : #696, puis **#825**, puis #790 (#824 bloquée).

## Tâche : issue #825

Suite de la décision F1 de #745. La politique (§5, droit à la portabilité) et les CGU (§6) promettent une copie des données au format CSV, sur demande à `support@`, sous 30 jours. Aucun outil d'export n'existe dans le dépôt : la première demande serait traitée à la main, avec le risque d'oublier des tables ou de dépasser le délai.

### À faire
- Écrire la procédure dans `docs/ops/` : réception, vérification que la demande vient bien de l'adresse du compte, délai, réponse, trace de la demande.
- Script en lecture seule qui produit les CSV d'un compte, à partir de son identifiant.
- Définir le périmètre table par table depuis `prisma/schema.prisma`, au minimum : `User`, `Trade`, `TradeSession`, `Setup`, `TradingAccount`, `WeeklyDebrief`, `DailyRecap`, `EmailSend`, `ProductEventDaily`, `UserDailyActivity`, `AiUsageLog`, `FounderSeat`, `PartnerRedemption`, `UserPushDevice`, `TraderPushPreference`.
- Ne jamais exporter : hash du mot de passe, jetons Tradovate chiffrés, clés de notification.
- Indiquer dans la réponse que les factures sont à demander à Stripe ou disponibles dans le portail, à vérifier.
- Faire transiter le fichier de façon sûre : envoi chiffré ou lien à durée limitée, à décider.

### Hors périmètre
Un bouton d'export dans l'application reste une évolution séparée, à décider selon le nombre de demandes reçues.

## Arbitrages du relecteur (validation du plan, 2026-11-23)

- Données des autres comptes jamais exportées : `ReferralCommission.referredUserId` (et abonnement / facture du parrainé) ; `ReferralReward` sans l'identifiant de l'autre partie (colonne « rôle » parrain / filleul) ; `GiveawayDraw` exclue (`GiveawayWin` suffit).
- `--check` strict : colonne non classée d'une table exportée = erreur ; tout modèle portant une colonne liée à un compte doit être exporté ou exclu exprès ; `--check` vert obligatoire avant chaque export.
- SQL : `\set ON_ERROR_STOP on`, contrôle d'existence du compte (`1/count(*)`), identifiant `^c[a-z0-9]{20,32}$` (cuid seulement).
- Aucune copie sur l'hôte VPS : une seule commande (CSV dans le conteneur → tar sur stdout → effacement), puis vérification qu'il ne reste rien.
- Colonne en plus à ne pas exporter : `BrokerConnection.apiHosts`.
- Adresse différente de celle du compte : réponse neutre à l'adresse qui a écrit (« Pour des raisons de sécurité, envoie ta demande depuis l'adresse e-mail de ton compte MyTradingCoach. »), sans dire si un compte existe ; adresse jamais dans un fichier du dépôt ni en argument.
- `LISEZMOI.txt` dans l'archive (date, fichiers, une phrase par table, données non fournies, factures).
- Transit : 7z AES-256 `-mhe=on`, mot de passe `openssl rand -base64 18` dans un second e-mail depuis support@, copies effacées dès l'envoi ; 7-Zip (Windows) ou Keka (Mac).
- Trace : dossier Zoho « RGPD », objet `[RGPD export] limite AAAA-MM-JJ` puis `[RGPD export] envoyé AAAA-MM-JJ` ; pas de tableau dans le dépôt.
- Factures (si abonnement payant) : « Tes factures sont dans le portail de paiement : Profil, bouton « Gérer mon abonnement ». Si tu préfères, réponds à cet e-mail et on te les envoie. »
- Références : `reference/security/donnees-perso.md` et index de `deploy.md`. Vérificateurs : deploy, security (+ prisma recommandé), relecteur en dernier. Pas de branchement CI de `--check` (hors périmètre).
- Pour Greg (sans bloquer) : vérifier dans Stripe live que le portail client affiche l'historique des factures.
