# Export des données d'un compte sur demande (droit d'accès et de portabilité)

> #825 · Promis par la politique de confidentialité (droit à la portabilité : « recevoir vos données au
> format CSV, sur demande par e-mail ») et les CGU. Délai : **30 jours** maximum après la demande.
> Toutes les commandes sur le VPS sont lancées par Greg, une par une, depuis son ordinateur. Le script
> et le schéma sont pris sur `origin/main` (le schéma de la prod). Lecture seule : rôle `mtc_readonly`,
> jamais `mtc_user`.

Exemples fictifs seulement dans ce fichier : le dépôt est public. Aucune adresse, aucun identifiant réel
dans le dépôt, dans un argument de commande ou dans un commit.

## 1. Réception et trace

1. La demande arrive sur `support@`. Ranger le fil dans le dossier Zoho **RGPD**.
2. Renommer l'objet du fil : `[RGPD export] limite AAAA-MM-JJ` (date de réception + 30 jours).
3. Pas de tableau ni de compte rendu dans le dépôt (public) : la trace, c'est le dossier Zoho.

## 2. Vérifier que la demande vient du titulaire

La demande doit venir de **l'adresse e-mail du compte MyTradingCoach**.

- Adresse différente : répondre **à l'adresse qui a écrit**, sans dire si un compte existe :
  > Pour des raisons de sécurité, envoie ta demande depuis l'adresse e-mail de ton compte MyTradingCoach.

  Ne jamais écrire à l'adresse du compte à partir de la demande d'un tiers. Le délai ne court pas tant
  que la demande ne vient pas de la bonne adresse.
- Vérifier aussi l'en-tête `Reply-To` : s'il désigne une autre adresse, l'ignorer. Les réponses de
  l'étape 4 partent toujours vers l'adresse lue en base, jamais par « Répondre ».
- Bonne adresse : retrouver l'identifiant du compte. L'adresse passe sur l'entrée standard (heredoc),
  jamais en argument. Commande précédée d'une espace pour rester hors de l'historique du terminal
  (`HISTCONTROL=ignorespace`, défaut d'Ubuntu) :

  ```bash
   cat <<'EOF' | ssh greg@149.202.40.240 "docker exec -i mtc_postgres psql -U mtc_readonly -d mytradingcoach_prod -At"
  SELECT id, email, "isDemo" FROM "User" WHERE lower(email) = lower('trader@exemple.fr');
  EOF
  ```

  Attendu : une ligne `c…|<adresse du compte>|f` (identifiant, adresse à utiliser à l'étape 4, compte
  non démo). Aucune ligne : pas de compte à cette
  adresse, répondre que l'adresse ne correspond à aucun compte et proposer de réécrire depuis la bonne.

## 3. Générer l'export

Sur l'ordinateur de Greg, dans un dossier privé qui ne contiendra que cet export :

```bash
ID=cxxxxxxxxxxxxxxxxxxxxxxxx          # identifiant trouvé à l'étape 2
[[ $ID =~ ^c[a-z0-9]{20,32}$ ]] || echo "IDENTIFIANT INVALIDE : ne pas continuer"
mkdir -m 700 ~/export-$ID && cd ~/export-$ID
git -C ~/Bureau/my-trading-coach fetch -q origin main
git -C ~/Bureau/my-trading-coach archive origin/main tools/scripts/ops/export-user-data.mjs prisma/schema.prisma | tar -x
```

Le script et le schéma de `main` (ceux de la prod) sont copiés dans ce dossier : une colonne encore
absente de la prod (sur `dev`) ferait échouer l'export, une colonne retirée sur `dev` mais encore en
prod ne serait pas vue par `--check`. Dans un nouveau terminal, redéfinir `ID` avant de continuer.

1. **Périmètre à jour** (obligatoire avant chaque export) :

   ```bash
   node tools/scripts/ops/export-user-data.mjs --check
   ```

   Attendu : `Périmètre à jour : 28 tables exportées, 5 exclues exprès.` Toute autre sortie (code 1) :
   une table ou une colonne du schéma n'est pas classée. **Ne pas exporter** : la classer dans le script
   (`TABLES` ou `EXCLUDED_TABLES`) par une PR, puis recommencer.

2. **SQL de l'export** (un identifiant mal formé est refusé, code 2) :

   ```bash
   node tools/scripts/ops/export-user-data.mjs "$ID" > export.sql
   ```

3. **Exécution en lecture seule**, une seule commande : les CSV sont écrits dans le conteneur, envoyés
   en archive tar vers l'ordinateur, puis effacés du conteneur. Rien n'est copié sur l'hôte du VPS.

   ```bash
   [[ $ID =~ ^c[a-z0-9]{20,32}$ ]] && ssh greg@149.202.40.240 "docker exec -i mtc_postgres sh -c 'rm -rf /tmp/mtc-export-$ID && mkdir -m 700 /tmp/mtc-export-$ID && psql -X -q -U mtc_readonly -d mytradingcoach_prod > /dev/null && tar -C /tmp -cf - mtc-export-$ID; rc=\$?; rm -rf /tmp/mtc-export-$ID; exit \$rc'" < export.sql > export.tar
   ```

   Attendu : aucune sortie, `export.tar` de quelques ko ou plus. En cas d'erreur (`ERROR: division by
   zero` = identifiant inconnu, ou toute autre erreur SQL) : l'export s'arrête net, `export.tar` est vide,
   rien n'est livré. Ne pas envoyer un export partiel.

4. **Vérifier qu'il ne reste rien dans le conteneur** :

   ```bash
   ssh greg@149.202.40.240 "docker exec mtc_postgres sh -c 'ls /tmp | grep mtc-export || echo propre'"
   ```

   Attendu : `propre`. Si un dossier `mtc-export-…` apparaît, le supprimer puis relancer cette
   vérification :

   ```bash
   [[ $ID =~ ^c[a-z0-9]{20,32}$ ]] && ssh greg@149.202.40.240 "docker exec mtc_postgres rm -rf /tmp/mtc-export-$ID"
   ```

5. **Contrôle rapide** : `tar -xf export.tar`, ouvrir `mtc-export-$ID/LISEZMOI.txt` et `compte.csv`
   (bonne adresse e-mail). L'archive contient un CSV par type de donnée et `LISEZMOI.txt`.

## 4. Archive chiffrée et envoi

1. Archive 7z chiffrée (AES-256, noms de fichiers chiffrés), mot de passe tiré au hasard, jamais
   enregistré (`sudo apt install p7zip-full` si `7z` manque) :

   ```bash
   PW=$(openssl rand -base64 18); echo "$PW"
   7z a -t7z -mhe=on -p"$PW" mytradingcoach-export.7z mtc-export-$ID
   ```

2. **Premier e-mail** depuis `support@`, **nouvel e-mail** adressé à l'adresse lue en base à l'étape 2
   (champ « À » saisi à la main, jamais par « Répondre », qui suivrait un éventuel `Reply-To`), avec `mytradingcoach-export.7z` en pièce
   jointe :
   > Voici la copie de tes données MyTradingCoach : un fichier CSV par type de donnée, et un fichier
   > LISEZMOI.txt qui explique chacun d'eux. L'archive est protégée par un mot de passe, envoyé dans un
   > second e-mail. Pour l'ouvrir : 7-Zip sur Windows, Keka sur Mac.

   Si le compte a eu un abonnement payant, ajouter :
   > Tes factures sont dans le portail de paiement : Profil, bouton « Gérer mon abonnement ». Si tu
   > préfères, réponds à cet e-mail et on te les envoie.

3. **Second e-mail**, séparé, depuis `support@`, à la même adresse lue en base : le mot de passe seul.
4. **Effacer tout de suite** les copies locales (archive, tar, CSV, SQL). Si l'archive se perd, on la
   régénère :

   ```bash
   cd ~ && rm -rf ~/export-$ID && unset PW
   ```

5. Renommer l'objet du fil Zoho : `[RGPD export] envoyé AAAA-MM-JJ`.

## Ce que contient l'export

Périmètre en liste blanche dans `tools/scripts/ops/export-user-data.mjs` : seules les colonnes listées
sont exportées. Une colonne ou une table ajoutée au schéma fait échouer `--check` tant qu'elle n'est pas
classée.

- **Exporté** : compte (profil, préférences, plan, consentements, provenance), trades, séances, setups,
  comptes de trading, clôtures courtier, risque par jour, payouts, alertes de risque et de comportement,
  incidents de compte, référence de comportement, connexions au courtier (sans jetons), état quotidien
  de la connexion Tradovate, débriefs, récaps
  du jour, e-mails envoyés, usage produit et IA, jours actifs, place fondateur, code partenaire,
  appareils de notification (sans clés), préférences de notification, lots gagnés, anciens codes de
  parrainage, récompenses de parrainage et commissions ambassadeur.
- **Jamais exporté** : hash du mot de passe, jetons de réinitialisation, de session et de désinscription,
  jetons courtier chiffrés, adresses internes de l'infrastructure (`apiHosts`), adresse et clés de
  notification, et toute donnée d'un autre compte (identifiant du filleul ou du parrain, abonnement ou
  facture d'un compte parrainé).
- **Tables exclues exprès** : notifications du back-office, réservations de paiement (30 minutes),
  modèles d'import partagés, tirage commun (le lot gagné est exporté), comptes
  supprimés.
- **Factures** : chez Stripe (portail client), pas dans l'export.
