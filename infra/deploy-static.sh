#!/usr/bin/env bash
# Publie un front statique sur le VPS sans état intermédiaire (SCA-B8-05).
#
#   infra/deploy-static.sh <site> <dossier-build> <sha>
#   ex. infra/deploy-static.sh app-prod dist/apps/app-mytradingcoach/browser/ "$GITHUB_SHA"
#
# Lancé par la CD (runner GitHub), avec VPS_TARGET=user@hôte et la clé SSH déjà en place.
# 1. rsync vers /opt/static/<site>/releases/<sha>/ : les fichiers inchangés sont des liens physiques
#    vers la version servie (--link-dest), seul le diff transite ;
# 2. bascule atomique du lien current (infra/static-release.sh, exécuté à distance).
# Le site servi ne voit jamais une copie à moitié faite : avant la bascule, l'ancienne version reste
# entière ; après, la nouvelle l'est déjà.
set -euo pipefail

SITE="${1:?site}"
SRC="${2:?dossier du build}"
SHA="${3:?sha}"
: "${VPS_TARGET:?VPS_TARGET=user@hôte requis}"

SHA="${SHA:0:12}"
HERE="$(cd "$(dirname "$0")" && pwd)"
remote() { ssh "$VPS_TARGET" bash -s -- "$@" < "$HERE/static-release.sh"; }

[ -f "${SRC%/}/index.html" ] || { echo "❌ ${SRC%/}/index.html absent : build incomplet" >&2; exit 1; }

# Précompression (SCA-B7-03) : nginx sert le .gz voisin (gzip_static) au lieu de compresser à
# chaque requête. -n : pas de nom ni de date dans l'en-tête → même contenu, même .gz, donc le
# fichier reste un lien physique vers la release précédente (--link-dest). -k : l'original reste.
find "${SRC%/}" -type f -size +1k \
  \( -name '*.js' -o -name '*.mjs' -o -name '*.css' -o -name '*.html' -o -name '*.svg' \
     -o -name '*.json' -o -name '*.txt' -o -name '*.xml' -o -name '*.webmanifest' \) \
  -exec gzip -9 -k -n -f {} +

# Nom de la release : le SHA court, suffixé si cette version est déjà en ligne (redéploiement).
REL=$(remote prepare "$SITE" "$SHA")
# Comparaison au contenu (--checksum), dates NON conservées (pas de -t) : un build neuf a des dates
# neuves, la vérification taille + date ne lierait rien, et deux fichiers différents de même taille
# écrits dans la même seconde seraient pris pour identiques. Un fichier inchangé devient un lien
# physique vers la version servie et garde sa date (ETag stable). --link-dest est relatif au dossier
# de destination : ../../current = /opt/static/<site>/current ; absent au premier déploiement, rsync
# le signale et copie tout, sans échouer.
rsync -rlz --checksum --delete --link-dest=../../current/ "${SRC%/}/" "$VPS_TARGET:/opt/static/$SITE/releases/$REL/"
remote activate "$SITE" "$REL"
