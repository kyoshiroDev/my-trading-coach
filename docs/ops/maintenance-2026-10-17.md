# Déroulé du samedi 17/10/2026 — maintenance prod en deux temps

Préparé le 16/10, rien n'a été exécuté. Aucun secret ne figure ici : les valeurs sont produites et
écrites sur le serveur, jamais affichées ni recopiées.

- **OLD** = ancien VPS `greg@51.83.197.230` (dev, beta, admin et landing de prod)
- **PROD** = VPS prod `greg@149.202.40.240` (API, worker, Postgres, PgBouncer, Redis, app)
- Pendant toute modification de `sshd`, garder **une session SSH ouverte** sur la machine.

## État au 16/10 à 20 h 15 (à revérifier avant de commencer)

- `main` a déjà reçu `dev` (PR #570, 20 h 06) : **l'admin push** (déployée le matin, sans clés VAPID,
  donc désactivée) et **`SENTRY_ENVIRONMENT=production`**. Le CD de `c422daeb` est terminé en succès (API prod déjà avec cet environnement).
- Il ne reste à promouvoir que le correctif SSH : `61622cdb` (API) et `73ee92d0` (admin),
  plus ce qui arrivera sur `dev` d'ici samedi.
- D'après `deploy.md` (commit `beda3ece`, 20 h 39), la clé **`mtc-api-prod-admin`** (celle du
  principal, `VPS_SSH_KEY_B64`) a été autorisée chez `greg` sur OLD avec `from="149.202.40.240"`. Le
  nouveau code ne s'en sert plus pour le secondaire : elle est retirée à l'étape 1.10.
- Tant que la promotion n'est pas faite, **ne pas ouvrir l'onglet « VPS dev · beta »** de la page
  Surveillance. Chaque ouverture fait échouer des authentifications SSH sur OLD, ce qui alimente fail2ban.

---

# TEMPS 1 (matin) : clé restreinte, variables, promotion

## 1.0 Vérifications préalables (poste local)

```bash
gh run list --branch main --limit 3      # le CD de c422daeb doit être en success
git fetch origin && git log --oneline origin/main..origin/dev   # contenu exact de la promotion
```
**Vérification :** dernier CD en `success`, et la liste contient au moins `61622cdb` et `73ee92d0`.
**Retour arrière :** aucun.

## 1.1 fail2ban sur OLD : 149.202.40.240 est-il banni ?

```bash
ssh greg@51.83.197.230
sudo fail2ban-client status sshd                         # « Banned IP list »
sudo fail2ban-client status sshd | grep -c 149.202.40.240 # 0 = pas banni
sudo grep -h 149.202.40.240 /var/log/fail2ban.log* | tail -5
sudo ufw status | grep -E '^22'                          # 22 en ALLOW (pas LIMIT)
```
- Si l'IP est bannie : `sudo fail2ban-client set sshd unbanip 149.202.40.240`.
- **Vérification :** le `grep -c` répond `0`.
- Vérifier aussi `sudo grep -rn ignoreip /etc/fail2ban/jail.local /etc/fail2ban/jail.d/`.
  `deploy.md` recommande d'y mettre `149.202.40.240`. Avec le nouveau code (une tentative par minute
  au plus), ce n'est plus nécessaire. Si l'IP y est déjà, décider de la garder ou de la retirer.
- **Retour arrière :** aucun.

## 1.2 sshd sur OLD : autoriser `mtc-monitor` et le verrouiller

```bash
sudo cp -p /etc/ssh/sshd_config /etc/ssh/sshd_config.bak-20261017
sudo grep -rn -E '^\s*(AllowUsers|AllowGroups|DenyUsers|Match)' /etc/ssh/sshd_config /etc/ssh/sshd_config.d/
sudo sshd -T | grep -Ei '^(allowusers|allowgroups|pubkeyauthentication|authorizedkeysfile|maxauthtries)'
```

1. Si `AllowUsers` existe : **modifier la ligne dans le fichier où elle se trouve** (après avoir
   sauvegardé ce fichier). Ne pas en ajouter une seconde : avec sshd, c'est la première valeur qui gagne.
   ```
   AllowUsers greg mtc-monitor@149.202.40.240
   ```
2. Ajouter **à la fin** de `/etc/ssh/sshd_config`. Un bloc `Match` doit être en fin de fichier,
   pas dans `sshd_config.d`.
   ```
   Match User mtc-monitor
       ForceCommand /usr/local/bin/mtc-monitor-ro
       PermitTTY no
       AllowTcpForwarding no
       AllowAgentForwarding no
       X11Forwarding no
       PermitTunnel no
       PasswordAuthentication no
   ```
3. Valider, puis recharger :
   ```bash
   sudo sshd -t && sudo sshd -T -C user=mtc-monitor,host=prod,addr=149.202.40.240 \
     | grep -Ei '^(forcecommand|permittty|allowtcpforwarding)'
   sudo systemctl reload ssh
   ```

- **Vérification :**
  - `sshd -t` ne dit rien ;
  - `sshd -T` affiche `forcecommand /usr/local/bin/mtc-monitor-ro`, `permittty no` et
    `allowtcpforwarding no` ;
  - **un nouveau terminal** `ssh greg@51.83.197.230` se connecte toujours.
- **Retour arrière :**
  ```bash
  sudo cp -p /etc/ssh/sshd_config.bak-20261017 /etc/ssh/sshd_config
  ```
  Puis restaurer le fichier `AllowUsers` s'il est distinct, et lancer
  `sudo sshd -t && sudo systemctl reload ssh`.

## 1.3 Utilisateur, script de commande forcée et liste blanche sur OLD

On installe les fichiers depuis le clone `dev` d'OLD (`/opt/apps/mytradingcoach/dev`). Il contient
`61622cdb` dès que le CI dev a tourné.

```bash
R=/opt/apps/mytradingcoach/dev
git -C $R merge-base --is-ancestor 61622cdb HEAD && echo "clone dev à jour"
sudo adduser --system --group --home /home/mtc-monitor --shell /bin/sh mtc-monitor
sudo usermod -aG docker mtc-monitor
sudo install -o root -g root -m 755 $R/infra/vps/mtc-monitor-ro.sh /usr/local/bin/mtc-monitor-ro
sudo install -d -o root -g root -m 755 /etc/mtc-monitor
sudo install -o root -g root -m 644 $R/infra/vps/mtc-monitor-allowed-commands /etc/mtc-monitor/allowed-commands
sudo install -d -o mtc-monitor -g mtc-monitor -m 700 /home/mtc-monitor/.ssh
```

- **Vérification :**
  ```bash
  id mtc-monitor                                   # groupes : mtc-monitor, docker
  sudo -u mtc-monitor docker ps --format '{{.Names}}' | head -3
  sha256sum $R/infra/vps/mtc-monitor-allowed-commands /etc/mtc-monitor/allowed-commands   # identiques
  sudo -u mtc-monitor env SSH_ORIGINAL_COMMAND='docker restart x' /usr/local/bin/mtc-monitor-ro; echo $?   # refus, 126
  ```
- **Retour arrière :**
  ```bash
  sudo deluser --remove-home mtc-monitor
  sudo delgroup mtc-monitor
  sudo rm -rf /etc/mtc-monitor /usr/local/bin/mtc-monitor-ro
  ```

## 1.4 Clé dédiée, générée sur PROD (la clé privée ne quitte pas PROD)

```bash
ssh greg@149.202.40.240
S=/opt/apps/mytradingcoach/prod-secrets
(umask 077; ssh-keygen -t ed25519 -N '' -C 'mtc-api-prod-secondaire-ro' -f $S/mtc_monitor_ro)
cat $S/mtc_monitor_ro.pub        # clé PUBLIQUE : la seule chose à copier vers OLD
```
- **Vérification :** `ls -l $S/mtc_monitor_ro*` → privée en 600, publique en 644.
- **Retour arrière :** `shred -u $S/mtc_monitor_ro $S/mtc_monitor_ro.pub`.

## 1.5 `authorized_keys` de `mtc-monitor` sur OLD

```bash
PUB='ssh-ed25519 AAAA… mtc-api-prod-secondaire-ro'      # coller la ligne .pub de 1.4
printf 'from="149.202.40.240",command="/usr/local/bin/mtc-monitor-ro",restrict,no-pty,no-port-forwarding,no-agent-forwarding,no-X11-forwarding,no-user-rc %s\n' "$PUB" \
  | sudo tee /home/mtc-monitor/.ssh/authorized_keys >/dev/null
sudo chown mtc-monitor:mtc-monitor /home/mtc-monitor/.ssh/authorized_keys
sudo chmod 600 /home/mtc-monitor/.ssh/authorized_keys
cat /etc/ssh/ssh_host_ed25519_key.pub                                  # pour le known_hosts de 1.6
ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub | awk '{print $2}'    # SHA256:… → variable de 1.7
```
- **Vérification :** `sudo ssh-keygen -lf /home/mtc-monitor/.ssh/authorized_keys` donne la même
  empreinte que `ssh-keygen -lf $S/mtc_monitor_ro.pub` sur PROD.
- **Retour arrière :** `sudo rm /home/mtc-monitor/.ssh/authorized_keys`. La clé est révoquée immédiatement.

## 1.6 Test manuel depuis PROD

Pas de `ssh-keyscan` : il déclenche fail2ban. La clé d'hôte est épinglée à la main.

```bash
S=/opt/apps/mytradingcoach/prod-secrets
(umask 077; echo '51.83.197.230 ssh-ed25519 AAAA…' > $S/known_hosts_secondaire)   # ligne de 1.5
O="-i $S/mtc_monitor_ro -o IdentitiesOnly=yes -o BatchMode=yes -o UserKnownHostsFile=$S/known_hosts_secondaire -o StrictHostKeyChecking=yes"
git -C /opt/apps/mytradingcoach/prod fetch -q origin dev
git -C /opt/apps/mytradingcoach/prod show origin/dev:infra/vps/mtc-monitor-allowed-commands > /tmp/allowed

ssh $O mtc-monitor@51.83.197.230 'cat /proc/loadavg'; echo "exit $?"       # valeurs, exit 0
ssh $O mtc-monitor@51.83.197.230 "$(sed -n 9p /tmp/allowed)" | head -2     # JSON docker ps
ssh $O mtc-monitor@51.83.197.230 "$(sed -n 10p /tmp/allowed)" | head -2    # docker stats
ssh $O mtc-monitor@51.83.197.230 'docker restart mtc_api_dev_blue'; echo "exit $?"   # refusée, 126
ssh $O mtc-monitor@51.83.197.230 'id'; echo "exit $?"                              # refusée, 126
ssh $O mtc-monitor@51.83.197.230 'docker logs --tail 1 mtc_api_dev_blue'; echo "exit $?"   # refusée
ssh $O -tt mtc-monitor@51.83.197.230 </dev/null; echo "exit $?"                  # PTY refusé, code 255 (voir ci-dessous)
rm /tmp/allowed
```

Puis, sur OLD :
```bash
sudo journalctl -t mtc-monitor-ro --since -10min                   # 3 refus avec commande + 1 refus « commande vide » (test -tt)
sudo fail2ban-client status sshd | grep -c 149.202.40.240          # toujours 0
```

- **Vérification :** les 3 lectures répondent (code 0), les 3 refus de commande sortent avec le code
  126, et l'IP n'est pas bannie.
- **Session interactive (`-tt`) — résultat réel du 16/10 :** le client sort avec le code **255** et
  affiche `PTY allocation request failed on channel 0` (`PermitTTY no` / `no-pty`). La commande forcée
  est **quand même lancée**, sans terminal et avec une commande vide, et elle refuse : le journal
  montre un refus `commande refusée : ` (commande vide) par tentative (19:05:58 et 19:06:06 UTC le
  16/10). Le stderr du client n'affiche que le refus du PTY, pas le message du wrapper : ne pas en
  déduire que la commande forcée n'a pas tourné, c'est le journal qui fait foi.
- **Retour arrière :** aucun, ce sont des tests en lecture. Si un test de lecture échoue, ne pas
  passer à 1.7 : revoir 1.2 et 1.3.

## 1.7 `.env.production` sur PROD : variables VPS_SECONDARY_* et VAPID

Ces variables ne sont lues qu'à la recréation des conteneurs, donc à l'étape 1.8.

```bash
cd /opt/apps/mytradingcoach/prod
cp -p .env.production .env.production.bak-20261017-matin
grep -cE '^(VPS_SECONDARY_USER|VPS_SECONDARY_SSH_KEY_B64|VPS_SECONDARY_HOST_KEY_SHA256|PUSH_ENABLED|VAPID_[A-Z]+)=' .env.production   # attendu : 0
grep -E '^VPS_SECONDARY_(HOST|LABEL)=' .env.production | cut -d= -f1    # déjà présentes ? sinon les ajouter

S=/opt/apps/mytradingcoach/prod-secrets
{
  echo 'VPS_SECONDARY_USER=mtc-monitor'
  printf 'VPS_SECONDARY_SSH_KEY_B64=%s\n' "$(base64 -w0 $S/mtc_monitor_ro)"
  echo 'VPS_SECONDARY_HOST_KEY_SHA256=SHA256:…'        # empreinte de 1.5
} >> .env.production

# VAPID : générées dans le conteneur API actif (web-push y est installé), écrites sans affichage.
C=$(docker ps --format '{{.Names}}' | grep -E '^mtc_api_prod_(blue|green)$' | head -1)
docker exec "$C" node -e "const k=require('web-push').generateVAPIDKeys();process.stdout.write('PUSH_ENABLED=true\nVAPID_PUBLIC_KEY='+k.publicKey+'\nVAPID_PRIVATE_KEY='+k.privateKey+'\nVAPID_SUBJECT=mailto:hello@mytradingcoach.app\n')" >> .env.production
```

Si le `require('web-push')` échoue dans le conteneur : générer en local avec
`node tools/scripts/vapid-generate.mjs`, puis coller les 4 lignes avec un éditeur.

- **Vérification :**
  ```bash
  grep -E '^(VPS_SECONDARY_[A-Z_]+|PUSH_ENABLED|VAPID_[A-Z]+)=' .env.production | cut -d= -f1 | sort | uniq -c   # 1 de chaque
  stat -c '%a %U' .env.production        # 600 greg
  ```
- **Retour arrière :** `cp -p .env.production.bak-20261017-matin .env.production`. Prend effet à la
  prochaine recréation : redéployer le même SHA, comme en 1.8.

## 1.8 Promotion `dev` → `main` (par toi)

1. Ouvrir la PR `dev` → `main` et la merger. Le CI de `main` lance ensuite le CD (environnement
   `production`). Celui-ci exécute `deploy-api.sh prod` en blue/green, ce qui recrée l'API et le
   worker avec le nouveau code **et** le nouvel env. Il redéploie aussi l'admin sur OLD, puisque
   l'admin a changé.
2. **Vérifier que le CD a vraiment tourné.** S'il a été annulé par une PR tardive, le relancer.
   ```bash
   gh run list --branch main --limit 4
   ```

- **Vérification :**
  - Jobs « Deploy API to VPS » et « Deploy Admin to VPS » en `success`.
  - Sur PROD :
    ```bash
    for c in mtc_api_prod_blue mtc_api_prod_green mtc_api_prod_worker; do docker inspect -f '{{.Name}} {{.Config.Image}} {{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' $c 2>/dev/null; done
    C=$(docker ps --format '{{.Names}}' | grep -E '^mtc_api_prod_(blue|green)$' | head -1)
    docker exec $C printenv SENTRY_ENVIRONMENT                                     # production
    docker exec $C sh -c 'test -n "$VPS_SECONDARY_SSH_KEY_B64" && echo clé secondaire présente'
    docker logs $C 2>&1 | grep -iE 'vapid|push|avertissement|warn' | tail -5      # aucun avertissement VAPID
    curl -s -o /dev/null -w '%{http_code}\n' https://api.mytradingcoach.app/api/health   # 200
    ```
- **Retour arrière :**
  - **API :** workflow « Deploy API prod (manuel) » avec le SHA précédent (`c422daeb`, image gardée
    sur PROD), sans coupure. Si c'est l'env qui pose problème : restaurer
    `.env.production.bak-20261017-matin`, puis relancer le même workflow avec le SHA en place.
  - **Admin**, sur OLD :
    ```bash
    cd /opt/apps/mytradingcoach/dev && bash infra/static-release.sh rollback admin
    ```

## 1.9 Vérifications fonctionnelles

1. **Admin › Surveillance › « VPS dev · beta »** : les stats et les conteneurs s'affichent, avec la
   mention « lecture seule ». Aucun bouton d'action ni de logs. Sur le principal, les boutons sont toujours là.
2. Sur OLD, `sudo journalctl -t mtc-monitor-ro --since -15min` ne doit montrer **aucun refus** venant
   de l'admin. Un refus signale une commande absente de la liste blanche.
3. **Sentry :** aucun nouvel événement sur NODE-NESTJS-6. La résoudre.
4. **Admin push :** page Notifications → s'abonner sur l'appareil → « Envoyer un test ». La
   notification doit arriver.
5. Sur OLD : `sudo fail2ban-client status sshd | grep -c 149.202.40.240` → 0.

**Test de panne (facultatif) :**
- Sur OLD : `sudo mv /home/mtc-monitor/.ssh/authorized_keys{,.off}`.
- Rafraîchir Surveillance : bandeau « VPS dev · beta injoignable en SSH (authentification refusée)… ».
  Dans Sentry, **un seul** événement `warning` « VPS injoignable en SSH : VPS dev · beta ».
- Remettre le fichier en place **dans la minute**. Chaque minute de panne coûte quelques échecs
  d'authentification à fail2ban.
- Revérifier ensuite le bannissement, comme en 1.1.

## 1.10 Retirer la clé du principal de `greg` sur OLD

À faire seulement si 1.9 est vert : le secondaire passe alors par `mtc-monitor`.

```bash
ssh greg@51.83.197.230
cp -p ~/.ssh/authorized_keys ~/.ssh/authorized_keys.bak-20261017
grep -n 'mtc-api-prod-admin' ~/.ssh/authorized_keys          # repérer la ligne (commentaire de la clé)
sed -i '/mtc-api-prod-admin/d' ~/.ssh/authorized_keys
```
Si le commentaire diffère, comparer les empreintes : `ssh-keygen -lf ~/.ssh/authorized_keys` sur OLD,
et sur PROD `ssh-keygen -lf` de la clé privée de `prod-secrets/`.

- **Vérification :**
  - `grep -c mtc-api-prod-admin ~/.ssh/authorized_keys` → 0 ;
  - **un nouveau terminal** `ssh greg@51.83.197.230` se connecte toujours (ta clé est intacte) ;
  - les clés CI de dev, beta, admin et landing sont toujours là : comparer `wc -l` avant et après,
    il ne doit y avoir qu'une ligne de moins ;
  - la page Surveillance du secondaire marche toujours.
- **Retour arrière :** `cp -p ~/.ssh/authorized_keys.bak-20261017 ~/.ssh/authorized_keys`.
- Mettre à jour `deploy.md` : le paragraphe « Accès SSH de l'admin » décrit encore l'ancien schéma
  (même clé des deux côtés).

---

# TEMPS 2 (fenêtre séparée) : mot de passe `mtc_user`, `log_timezone`, recréation de Postgres

**Attention :** ce temps recrée **aussi l'API**, parce que `DATABASE_URL` change. On redéploie le
même SHA (image réutilisée, blue/green). Il y a quand même **une coupure base de 1 à 3 minutes**,
entre le changement de mot de passe et le démarrage des nouveaux conteneurs. L'ancienne API répond
alors en 500, ce qui crée une rafale d'événements Sentry à résoudre ensuite. À faire en heure creuse.

## 2.0 Préparation (PROD, pas encore de coupure)

```bash
ssh greg@149.202.40.240
D=/opt/infra/databases; P=/opt/apps/mytradingcoach/prod; S=$P/prod-secrets
/opt/backups/mtc/backup.sh && ls -la /opt/backups/mtc | tail -2      # dump frais, taille cohérente
cp -p $D/.env $D/.env.bak-20261017
cp -p $D/docker-compose.yml $D/docker-compose.yml.bak-20261017
cp -p $D/pgbouncer-auth/userlist.txt $S/userlist.txt.bak-20261017
cp -p $P/.env.production $P/.env.production.bak-20261017-soir
docker images mtc_api_prod --format '{{.Tag}}  {{.CreatedAt}}' | head -6    # le tag SHA le plus récent = version en place
SHA=<tag SHA le plus récent>                                              # à redéployer en 2.4
docker exec mtc_postgres psql -U mtc_admin -d postgres -Atc 'show log_timezone; show timezone'   # valeurs actuelles, pour le compte rendu
(umask 077; openssl rand -base64 48 | tr -d '/+=\n' | cut -c1-40 > $S/mtc_user.new)          # mot de passe compatible URL, jamais affiché
```

Recouper avec le SHA du dernier CD (`gh run list --branch main --limit 1`).

- **Vérification :** le dump et les 4 sauvegardes existent, et `wc -c $S/mtc_user.new` donne 40.
- **Retour arrière :** `rm $S/mtc_user.new`.

## 2.1 Modifier les fichiers (rien n'est appliqué)

```bash
NEW=$(cat $S/mtc_user.new)
sed -i "s|^MTC_USER_PASSWORD=.*|MTC_USER_PASSWORD=$NEW|" $D/.env
sed -i "s|//mtc_user:[^@]*@|//mtc_user:$NEW@|g" $P/.env.production
```
Dans `$D/docker-compose.yml`, ajouter cette ligne au `command` de `postgres` (par exemple après
`-c log_min_duration_statement=500`) :
```
      -c log_timezone=Europe/Paris
```

- **Vérification :**
  ```bash
  grep -c "//mtc_user:$NEW@" $P/.env.production                 # 2 (DATABASE_URL et DATABASE_DIRECT_URL)
  docker compose -f $D/docker-compose.yml --env-file $D/.env config -q && echo compose OK
  ```
- **Retour arrière :** recopier les 3 fichiers `.bak-20261017`.

## 2.2 Changer le mot de passe dans Postgres (la coupure commence)

```bash
docker exec -i mtc_postgres psql -U mtc_admin -d postgres -v ON_ERROR_STOP=1 -v pw="$NEW" <<'SQL'
ALTER ROLE mtc_user PASSWORD :'pw';
SQL
```
- **Vérification :** la commande répond `ALTER ROLE`.
- **Retour arrière :** même commande avec l'ancien mot de passe, lu dans `$D/.env.bak-20261017`.

## 2.3 Régénérer `userlist.txt` de PgBouncer, puis recréer Postgres et PgBouncer

Procédure de `deploy.md`. Le fichier est régénéré **avant** la recréation : PgBouncer le relit au
démarrage, donc pas besoin de `RELOAD`.

```bash
A=$D/pgbouncer-auth
s=$(docker exec mtc_postgres psql -U mtc_user -d postgres -Atc "select rolpassword from pg_authid where rolname='mtc_user'")
(umask 077; printf '"mtc_user" "%s"\n' "$s" > $A/userlist.txt); unset s
docker run --rm -v $A:/d alpine:3 sh -c 'chown 70:70 /d/userlist.txt && chmod 600 /d/userlist.txt'
cd $D && docker compose up -d postgres pgbouncer       # recrée les deux (command et env modifiés)
```

`pg_authid` n'est lisible que par un superuser. Si la première commande échoue avec `mtc_user`,
la relancer avec `-U mtc_admin`.

- **Vérification :**
  ```bash
  docker inspect -f '{{.State.Health.Status}}' mtc_postgres                     # healthy
  docker exec mtc_postgres psql -U mtc_admin -d postgres -Atc 'show log_timezone' # Europe/Paris
  docker exec -e PGPASSWORD="$NEW" mtc_postgres psql -h mtc_pgbouncer -p 6432 -U mtc_user -d mytradingcoach_prod -Atc 'select 1'   # 1
  docker logs --since 2m mtc_postgres 2>&1 | tail -3                            # horodatage en CEST
  ```
- **Retour arrière :** l'étape 2.2 avec l'ancien mot de passe, puis recopier `docker-compose.yml`,
  `.env` et `userlist.txt` depuis les `.bak`, puis `docker compose up -d postgres pgbouncer`.

## 2.4 Recréer l'API avec le nouveau mot de passe (fin de la coupure)

```bash
cd $P && bash infra/deploy-api.sh prod "$SHA"     # ou le workflow « Deploy API prod (manuel) » avec ce SHA
```

Le script lance la migration Prisma avec `DATABASE_DIRECT_URL` : si elle passe, le nouveau mot de
passe est validé. Il démarre ensuite la couleur inactive, attend `healthy`, draine l'ancienne et
recrée le worker.

- **Vérification :**
  ```bash
  docker logs --since 5m $(docker ps --format '{{.Names}}' | grep -E '^mtc_api_prod_(blue|green)$' | head -1) 2>&1 | grep -ciE 'password authentication failed|P1000|ECONNREFUSED'   # 0
  curl -s -o /dev/null -w '%{http_code}\n' https://api.mytradingcoach.app/api/health/ready   # 200
  /opt/backups/etat-prod.sh
  ```
  Puis se connecter à l'app (compte démo) et ouvrir le dashboard admin.
- **Retour arrière :**
  1. Revenir à l'ancien mot de passe : étapes 2.2 et 2.3 avec les fichiers `.bak`.
  2. `cp -p $P/.env.production.bak-20261017-soir $P/.env.production`.
  3. `bash infra/deploy-api.sh prod "$SHA"`.

## 2.5 Après

- `shred -u $S/mtc_user.new` ; `unset NEW`. Garder les `.bak` 7 jours, puis `shred -u`.
- Sentry : résoudre la rafale de 500 de la fenêtre.
- Dépôt : reporter `-c log_timezone=Europe/Paris` dans `infra/prod/databases/docker-compose.yml`
  (copie de référence), commit sur `dev`.
- Prochaine nuit : vérifier que `backup.sh` (3 h) et `offsite.sh` (3 h 45) passent. Les deux
  utilisent `docker exec` en local et ne dépendent pas du mot de passe, mais on vérifie quand même.
