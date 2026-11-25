VPS prod partagé : en-têtes de sécurité au niveau des routeurs, mémoire réajustée
Contexte : le VPS prod va héberger un second projet, totalement indépendant de MyTradingCoach (son propre dépôt, ses propres bases, réseaux et sauvegardes). Il ne partage que Traefik. Pour cela, Greg retirera à la main, sur le serveur, le middleware security-headers@file de l'entrypoint websecure : chaque routeur de MTC doit donc le déclarer lui-même, AVANT ce retrait. Les valeurs de conf.d/security.yml ne changent pas. Aucune mention du second projet dans ce dépôt (il est public) : on parle seulement d'« un autre projet hébergé sur le VPS ».
À faire (branche depuis origin/dev, circuit habituel : deploy puis relecteur) :
1.    docker-compose.prod.yml
o    Renommer le routeur api-prod en api-prod-secure (rule, entrypoints, tls.certresolver identiques) et ajouter traefik.http.routers.api-prod-secure.middlewares=security-headers@file. Le service reste api-prod.

Pourquoi le renommage : pendant le blue/green, l'ancienne couleur garde api-prod sans middleware et la nouvelle déclare api-prod-secure avec ; deux routeurs distincts sur le même service, aucun conflit de définition (un même routeur défini différemment par deux conteneurs est rejeté par Traefik). Commentaire à laisser dans le fichier.
o    api_blue et api_green : WEB_CONCURRENCY: "2", mem_limit/memswap_limit 2g → 1536m (pic mesuré 766 Mio à 3 workers sans charge, 2026-11-24).
o    worker : 1g → 768m (pic mesuré 350 Mio).
2.    infra/prod/static-docker-compose.yml : ajouter traefik.http.routers.app-prod.middlewares=security-headers@file.
3.    infra/prod/databases/docker-compose.yml (copie de référence ; Greg l'applique sur le serveur) :
o    postgres : shared_buffers 1GB → 384MB, effective_cache_size 3GB → 1GB, maintenance_work_mem 256MB → 128MB, mem_limit/memswap 3g → 1536m (base 55 Mo, pic 251 Mio).
o    redis : --maxmemory 512mb → 256mb, mem_limit/memswap 640m → 320m (3 Mo de données).
o    Corriger l'écart existant avec le serveur : ajouter -c timezone=UTC après -c password_encryption=scram-sha-256.
4.    infra/prod/traefik/traefik.yml (copie de référence) :
o    retirer middlewares: - security-headers@file de l'entrypoint websecure, avec un commentaire : « entrypoint partagé avec un autre projet hébergé ; chaque routeur MTC déclare security-headers@file » ;
o    retirer le bloc proxyProtocol TEMPORAIRE (déjà absent du serveur).
o    Ajouter en tête : « Le serveur contient en plus un résolveur ACME secondaire et un docker-compose.override.yml (réseaux) propres à un autre projet hébergé. Ne jamais les supprimer ni les recopier ici. »
5.    infra/prod/traefik/docker-compose.yml : traefik mem_limit/memswap 256m → 384m (pic 208 Mio) ; socket-proxy : memswap_limit: 64m.
6.    Documentation (pour que tout agent de ce dépôt le sache) :
o    .claude/agents/deploy.md : labels d'exemple (l. ~155) renommés en api-prod-secure + ligne middlewares ; nouvelle règle permanente : « Tout nouveau routeur Traefik doit déclarer middlewares=security-headers@file. Ne jamais remettre de middleware sur l'entrypoint websecure ni toucher au résolveur secondaire / à l'override réseau du serveur (autre projet hébergé). Ne jamais construire d'image hors limites mémoire sans vérifier la RAM libre : le VPS est partagé. »
o    .claude/reference/deploy/maintenance-vps.md (et api-deploiement.md si le nom du routeur y figure) : même information ; 6 vCPU (et non 4) ; nouvelles limites mémoire.
o    infra/prod/README.md (section Traefik) : en-têtes déclarés routeur par routeur, entrypoint partagé, 6 cœurs, limites.
o    .claude/decisions.md (en haut) : « 2026-11-25 — VPS prod partagé avec un autre projet indépendant : en-têtes au routeur, API à 2 workers/1,5 Gio, worker 768 Mio, Postgres 1,5 Gio, Redis 320 Mio, Traefik 384 Mio. »
Ordre de mise en prod (à rappeler dans la PR) : cette PR fusionnée sur main et la CD verte d'abord ; Greg applique ensuite à la main les étapes serveur (static, databases, puis traefik). Le retour arrière de cette PR n'est sûr que tant que le middleware est encore sur l'entrypoint.
