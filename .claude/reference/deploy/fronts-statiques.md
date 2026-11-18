# Fronts statiques sur les VPS

> Contenu déplacé à l'identique depuis `.claude/agents/deploy.md` le 2026-11-16 (PROMPT-orchestration-agents).
> Chaque bloc garde son titre d'origine ; « Origine » donne l'agent, la section et la date d'origine (date du titre, sinon premier commit qui l'a écrite).

<!-- Origine : deploy.md · Fronts statiques sur les VPS (pas de Vercel) · 2026-10-16 -->
> **Origine** : `deploy.md` · « Fronts statiques sur les VPS (pas de Vercel) » · 2026-10-16

## Fronts statiques sur les VPS (pas de Vercel)

App Angular, admin et landing Astro sont **buildés dans GitHub Actions** puis publiés **en releases**
(app prod sur le VPS prod ; admin, landing et tout dev/beta sur l'ancien VPS) (voir plus bas), servis par des conteneurs **nginx:alpine derrière Traefik** (TLS
letsencrypt + routing par Host + redirect non-www→www en middleware Traefik).

| Site (`/opt/static/<site>`) | Build | Hôte | Workflow | Conteneur (compose) |
|---|---|---|---|---|
| `app-prod` | `dist/apps/app-mytradingcoach/browser/` | `app.mytradingcoach.app` | cd.yml | `mtc_app_prod` — **VPS prod** (`/opt/infra/static/` du 149.202.40.240) |
| `admin` | `dist/apps/admin-mytradingcoach/browser/` | `admin.mytradingcoach.app` | cd.yml | `mtc_admin` (`docker-compose.yml`) — pas de version dev/beta |
| `landing-prod` | `apps/landing-mytradingcoach/dist/` | `www.mytradingcoach.app` | cd.yml | `mtc_landing_prod` (`docker-compose.yml`) |
| `app-dev` | idem app | `dev.app.mytradingcoach.app` | ci.yml | `mtc_app_dev_static` (`docker-compose.yml`) |
| `landing-dev` | idem landing | `dev.mytradingcoach.app` | ci.yml | `mtc_landing_dev` (`docker-compose.yml`) |
| `app-beta` | idem app | `beta.app.mytradingcoach.app` | beta.yml | `mtc_app_beta_static` (**`docker-compose.beta.yml`**) |

Sauf `app-prod`, tout est sur l'ancien VPS ; les deux fichiers compose sont dans son `/opt/infra/static/`.

> ⚠️ **L'admin se déploie depuis `main`, comme l'app et la landing.** Jusqu'au 31/08/2026
> deux chaînes coexistaient : `ci.yml` publiait l'admin sur un push `dev` vers
> `/opt/static/admin` (le répertoire réellement servi), pendant que `cd.yml` publiait
> depuis `main` vers `/opt/static/admin-prod`, que **rien ne montait**. Résultat : la
> production admin était alimentée par `dev`, et les déploiements issus de `main`
> partaient dans le vide depuis le 17/08/2026. Le job admin de `ci.yml` a été supprimé,
> `cd.yml` pointe désormais sur `/opt/static/admin`, et `admin-prod` a été supprimé du
> VPS. Le répertoire servi est celui monté par `mtc_admin` dans
> `/opt/infra/static/docker-compose.yml` — c'est lui qui fait foi, pas le nom du dossier.

### Releases + lien symbolique (SCA-B8-05)

Plus de `rsync --delete` dans le dossier servi : pendant la copie, le site mélangeait deux versions
(`index.html` neuf, chunks pas encore arrivés, ou anciens chunks déjà supprimés → `ChunkLoadError`).
Chaque front se publie par `infra/deploy-static.sh <site> <build> <sha>` (appelé par ci/cd/beta.yml) :

```
/opt/static/<site>/
├── releases/<sha12>/   version complète ; fichiers inchangés = liens physiques vers la précédente
├── current  → releases/<sha12>   servi par nginx (root …/html/current)
└── previous → releases/<sha12>   repli des assets hashés (onglet ouvert avant la bascule)
```

1. `static-release.sh prepare` crée `releases/<sha12>` (suffixé `-<horodatage>` si ce SHA est déjà
   `current`/`previous` : relance de job, landing rebâtie après changement de variable GA4) ;
2. `rsync -rlz --checksum --delete --link-dest=../../current/` : comparaison au **contenu**, dates
   non conservées (avec `-a`, deux fichiers de même taille écrits dans la même seconde passent pour
   identiques : vu en test) ;
3. `static-release.sh activate` : `previous` ← ancienne `current`, `current` ← nouvelle, par
   `rename(2)` d'un lien temporaire (jamais d'instant sans lien), puis 3 releases gardées.

Le script distant `infra/static-release.sh` tourne sur le VPS via `ssh … bash -s` (pas besoin du
dépôt cloné). Les liens sont **relatifs** : le conteneur monte le dossier du site entier, et nginx
résout le lien à chaque requête → aucun reload ni restart à la bascule. (Monter `current`
directement ne marcherait pas : Docker fige la cible d'un lien au démarrage du conteneur.)

**Confs nginx** : `spa-releases.conf` (toutes les SPA : app ×3, admin) et `landing-releases.conf`
(landing prod + dev), montées depuis `/opt/infra/static/nginx/`. Leur copie de référence est dans
le dépôt (`infra/static/nginx/`) : modifier le dépôt **et** le VPS. Les assets hashés (`*.js|css|…`
côté SPA, `/_assets/` côté landing : c'est le `build.assets` d'Astro, pas `/_astro/`) font
`try_files /current$uri /previous$uri =404`.
Fichiers à nom fixe, avant la règle des assets (`location =`, prioritaire sur la regex) : les service
workers (`ngsw-worker.js`, `push-sw.js`, …) en `no-cache`, sinon la règle des `.js` leur donnait un
cache immuable d'un an ; `manifest.webmanifest` en `application/manifest+json`, cache 1 h, 404 s'il
manque (pas l'`index.html` de la SPA). Les icônes PWA (`/pwa/*.png`) gardent le cache d'un an : changer
leur nom si le dessin change. Modification du 25/10/2026 : **à reporter à la main sur les deux VPS**
(ancien : dev, beta, admin ; prod : app), selon la procédure ci-dessous. Appliquée sur les deux VPS le
25/10/2026 (prod : feu vert de Greg).

**Budget du bundle de l'app** (plafond bloquant 500 ko, avertissement 450 ko dépassé) : 495,04 ko après
le parcours d'installation (25/10/2026), 479,17 ko après le lot 1 du budget (26/10/2026), marge
20,83 ko. Règle : marge cible 20 ko, alerte sous 10 ko : au-dessous, on s'arrête et on ouvre une PR budget (`angular.md`, « Budget du bundle initial »). Mesurer au build de production
(`nx run app-mytradingcoach:build:production`, ligne « Initial total »).

Après modification d'une conf sur le VPS, **sans coupure** : la réécrire EN PLACE (même inode :
`cat nouvelle.conf > /opt/infra/static/nginx/<conf>`, jamais `cp`, `rsync` ni `sed -i` qui en créent
un nouveau), vérifier que chaque conteneur la voit (`docker exec <c> grep … /etc/nginx/conf.d/default.conf`),
`docker exec <c> nginx -t`, puis `docker exec <c> nginx -s reload`. Si l'inode a changé (copie,
`sed -i`), le conteneur garde l'ancienne : `docker restart` obligatoire (~1 s de coupure).

**Précompression (SCA-B7-03, 2026-10-09)** : `deploy-static.sh` produit un `.gz` à côté de chaque
fichier texte de plus de 1 Ko (`gzip -9 -k -n` : sans date, donc même contenu → même `.gz` → lien
physique conservé entre releases) ; les deux confs ont `gzip_static on` (nginx sert le `.gz`, sinon
compresse à la volée). `open_file_cache` : d'abord écarté (il garderait l'ancien `index.html`
quelques secondes après une bascule de `current`), puis **ajouté le 2026-10-17** (#482, commit
`20797699`) avec une validité de 10 s, sur les deux confs, appliqué sur les deux VPS : après une
bascule, l'ancienne version peut être servie au plus 10 s.

**Retour arrière (sur le VPS)** — immédiat, sans rebuild :

```bash
bash infra/static-release.sh list app-prod        # * = current, ← = previous
bash infra/static-release.sh rollback app-prod    # revient à previous (relancer = re-bascule)
bash infra/static-release.sh rollback app-prod <release>
```

Depuis un poste : `ssh greg@VPS bash -s -- rollback app-prod < infra/static-release.sh`.

**Transition terminée (2026-10-05)** : les 6 sites sont en releases, racines nettoyées ; plus
aucun conteneur ne monte les anciennes `spa.conf` / `landing.conf` (gardées sur le VPS, inutilisées).
Sauvegardes des compose d'avant : `*.bak-b8-05*`. Leçon : app-prod (9 h) et app-beta (12 h) ont servi
une version périmée, le workflow publiant déjà en releases alors que nginx servait encore la racine.

**Nouveau site statique** : créer `/opt/static/<site>`, le premier `deploy-static.sh` crée
`releases/` et `current` ; le conteneur monte le dossier du site sur `/usr/share/nginx/html` et
`spa-releases.conf` ou `landing-releases.conf`. Pour un site encore servi à la racine (ancien
layout), migrer **dès** que son workflow publie en releases :

```bash
# sur le VPS, ou depuis un poste : ssh greg@VPS bash -s -- <cmd> <site> < infra/static-release.sh
bash infra/static-release.sh migrate <site>   # release legacy-… (liens physiques) + current ; no-op si current existe
# compose : le service monte spa-releases.conf / landing-releases.conf
cd /opt/infra/static && docker compose [-f docker-compose.beta.yml] up -d <service>   # ~1 s, une fois
curl -s https://<hôte>/ | grep -o 'main-[A-Z0-9]*\.js'   # version servie = celle de current
bash infra/static-release.sh cleanup-legacy <site>   # supprime les fichiers restés à la racine
```

⚠️ C'est la conf montée **sur le VPS** (`/opt/infra/static/nginx/*-releases.conf`) qui est servie ;
la copie du dépôt (`infra/static/nginx/`) n'est pas déployée automatiquement. Le `nginx/nginx.conf`
à la racine du dépôt est un vestige mort.
La landing exige `PUBLIC_FEATURE_MULTI_ACCOUNTS=true` + `PUBLIC_FEATURE_REFERRAL=true` au build
(sinon `/journal-trading-prop-firm` et `/ambassadeur` redirigent vers `/`) — déjà dans cd.yml/ci.yml.

**Pages gatées flag OFF → 301 Nginx (recommandé).** Astro ne sait faire qu'une redirection
`<meta http-equiv="refresh">` (page HTML servie en 200, puis redirection à 2 s) : acceptable
(page en `noindex`, hors sitemap), mais une 301 est plus propre pour Google et plus rapide.
Quand un flag est OFF sur un environnement, ajouter dans `landing-releases.conf` (partagée par
landing prod et dev : n'ajouter la règle que si le flag est OFF partout, sinon séparer les confs),
puis `docker restart mtc_landing_prod mtc_landing_dev` (pas `nginx -s reload`, cf. bind-mount) :

```nginx
# Flag PUBLIC_FEATURE_REFERRAL=false
location = /ambassadeur { return 301 /; }
# Flag PUBLIC_FEATURE_MULTI_ACCOUNTS=false
location = /journal-trading-prop-firm { return 301 /; }
```

Retirer la ligne le jour où le flag passe à `true`, sinon la page publiée reste inaccessible.

**Redirections 301 de la landing (#1067, L2).** Le slash final (`location ~ ^/(.+)/$`) et
`/confidentialite` redirigent en **Location relative** avec la query string (`/$1$is_args$args`,
`absolute_redirect off`). Avant, l'URL de prod était écrite en dur : la landing dev renvoyait vers la
prod et les paramètres (`utm_*`, `ref`, `promo`) étaient perdus. Testé dans un conteneur
`nginx:1.27-alpine` : `/blog/x/?utm_source=nt&promo=X` → 301 `/blog/x?utm_source=nt&promo=X`,
`/confidentialite?ref=abc` → 301 `/politique-confidentialite?ref=abc`. Mise en place sur l'ancien
VPS : même procédure que la redirection de l'accueil ci-dessous (scp, sauvegarde datée, `diff` qui
ne montre que ces deux blocs, réécriture en place, `nginx -t` + reload), avec
`grep -c 'return 301 /\$1\$is_args\$args'` comme contrôle.

**Redirection temporaire de l'accueil (2026-11-08, newsletter NinjaTrader).** `landing-releases.conf`
envoie `/` et `/index.html` en **302** vers `/prop-firm`, query string conservée, Location relative
(`absolute_redirect off` : sinon nginx, en http derrière Traefik, écrirait `http://<hôte>/…`). Vaut
pour la landing prod **et** dev (conf partagée). Côté Astro, une page de secours (`index.astro`)
fait la même redirection en JavaScript si la règle manque, et l'ancienne home est sur `/accueil`
(astro.md, « Accueil → /prop-firm »). Ordre : la landing passe d'abord par la CD, la règle nginx
ensuite.

**État : EN PROD depuis le 2026-11-08** (landing prod et dev ; CD `f934ee0c` puis règle appliquée par
Greg). Sauvegarde de la conf d'avant sur l'ancien VPS : `/home/greg/landing-releases.conf.bak-20261108`.
Vérifié le 08/11 : `/?utm_source=test&utm_medium=x` → 302 `Location: /prop-firm?utm_source=test&utm_medium=x` ;
`mytradingcoach.app/?ref=…` → 308 vers www → 302 → `/prop-firm?ref=…` → 200 ; `dev.` → 302 sur dev ;
`/prop-firm`, `/accueil`, blog, légal → 200. La page de secours n'est plus servie sur `/`.

Procédure suivie (pour la réappliquer ; fichier réécrit en place, même inode) :

```bash
# Poste, depuis le dépôt :
scp infra/static/nginx/landing-releases.conf greg@51.83.197.230:/home/greg/landing-releases.conf.new
# Ancien VPS :
F=/opt/infra/static/nginx/landing-releases.conf
B=/home/greg/landing-releases.conf.bak-$(date +%Y%m%d-%H%M)        # sauvegarde datée à la minute,
cp -pn "$F" "$B" && cmp "$F" "$B" && echo SAUVEGARDE_OK            # jamais un nom existant (cp -n)
diff "$F" /home/greg/landing-releases.conf.new                     # attendu : seulement les 2 blocs de la 302
cat /home/greg/landing-releases.conf.new > "$F"                    # en place (sinon : sudo tee "$F" < … > /dev/null)
for c in mtc_landing_prod mtc_landing_dev; do docker exec "$c" grep -c 'return 302 /prop-firm' /etc/nginx/conf.d/default.conf && docker exec "$c" nginx -t && docker exec "$c" nginx -s reload; done
# Vérification (n'importe où) :
curl -sI "https://www.mytradingcoach.app/?utm_source=test&utm_medium=x" | grep -iE '^HTTP|^location'   # 302, /prop-firm?utm_source=test&utm_medium=x
```

Si `grep -c` répond 0, le conteneur ne voit pas le nouveau fichier (inode changé) : `docker restart
<c>` (~1 s de coupure). **Retrait / retour arrière** : `cat "$B" > "$F"` (sauvegarde
prise juste avant ; celle d'origine, du 08/11, est `/home/greg/landing-releases.conf.bak-20261108`, à ne
pas écraser) (ou supprimer les deux blocs `location = /` et `location = /index.html`), puis la même
boucle `nginx -t` + `nginx -s reload` (sans le `grep -c`). La 302 n'est pas mise en cache par les
navigateurs : effet immédiat.
