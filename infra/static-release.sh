#!/usr/bin/env bash
# Releases des fronts statiques sur le VPS, bascule atomique d'un lien (SCA-B8-05).
#
#   infra/static-release.sh prepare  <site> <release>   crée le dossier cible du rsync, affiche son nom
#   infra/static-release.sh activate <site> <release>   current → releases/<release>, previous → l'ancienne
#   infra/static-release.sh rollback <site> [<release>] revient à previous (ou à <release>)
#   infra/static-release.sh migrate  <site>             1re fois : release « legacy-… » depuis les fichiers à la racine
#   infra/static-release.sh cleanup-legacy <site>       supprime les fichiers à la racine (après bascule de nginx)
#   infra/static-release.sh list     <site>
#
# Lancé sur le VPS : par la CD via `ssh … bash -s -- <cmd> … < infra/static-release.sh`
# (infra/deploy-static.sh), ou à la main depuis un clone du dépôt.
#
# Arborescence de /opt/static/<site> :
#   releases/<sha>/   une version complète (fichiers inchangés en liens physiques vers la précédente)
#   current  → releases/<sha>   servi par nginx (root …/current)
#   previous → releases/<sha>   repli des assets hashés : un onglet ouvert sur l'ancienne version
#                               charge encore ses chunks après la bascule (pas de ChunkLoadError)
# Liens relatifs : ils se résolvent pareil dans le conteneur nginx, qui monte le dossier du site.
set -euo pipefail

STATIC_ROOT="${STATIC_ROOT:-/opt/static}"
KEEP_RELEASES=3

CMD="${1:-}"
SITE="${2:-}"
REL="${3:-}"

# Journal sur stderr : stdout ne porte que le nom de release rendu par « prepare ».
log() { echo "[static ${SITE}] $(date +%H:%M:%S) $*" >&2; }
die() { log "❌ $*"; exit 1; }
usage() { sed -n '4,9p' "$0" 2>/dev/null >&2 || true; exit 2; }

[ -n "$CMD" ] && [ -n "$SITE" ] || usage
[[ "$SITE" =~ ^[a-z0-9-]+$ ]] || die "site invalide : $SITE"
valid_rel() { [[ "$1" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || die "release invalide : $1"; }

DIR="$STATIC_ROOT/$SITE"
cd "$DIR" 2>/dev/null || die "$DIR introuvable"

# Une seule opération à la fois par site (deux déploiements concurrents, ou un retour arrière).
exec 9>"/tmp/static-release-${SITE}.lock"
flock -w 300 9 || die "une autre opération sur ${SITE} tourne depuis plus de 5 min"

target_of() { readlink "$1" 2>/dev/null | sed 's#^releases/##' || true; }

# Remplace un lien de façon atomique : rename(2) d'un lien temporaire, jamais d'instant sans lien.
swap_link() {
  ln -sfn "releases/$2" ".$1.tmp"
  mv -Tf ".$1.tmp" "$1"
}

# Garde les KEEP_RELEASES plus récemment activées, et toujours current + previous.
prune() {
  local cur prev keep=0 r
  cur=$(target_of current); prev=$(target_of previous)
  # shellcheck disable=SC2045 # noms validés (valid_rel), et ls -t donne l'ordre d'activation
  for r in $(ls -1t releases); do
    if [ "$r" = "$cur" ] || [ "$r" = "$prev" ]; then keep=$((keep + 1)); continue; fi
    if [ "$keep" -lt "$KEEP_RELEASES" ]; then keep=$((keep + 1)); continue; fi
    rm -rf "releases/$r" && log "release supprimée : $r"
  done
}

activate() {
  local rel="$1" cur
  [ -f "releases/$rel/index.html" ] || die "releases/$rel/index.html absent : rien à activer"
  cur=$(target_of current)
  if [ "$cur" = "$rel" ]; then
    log "$rel déjà active"
  else
    [ -n "$cur" ] && [ -d "releases/$cur" ] && swap_link previous "$cur"
    swap_link current "$rel"
    log "✅ current → $rel${cur:+ (previous → $cur)}"
  fi
  touch "releases/$rel"   # date d'activation : ordre de rétention
  prune
}

case "$CMD" in
  prepare)
    valid_rel "$REL"
    # Même SHA redéployé (job relancé, landing rebâtie avec d'autres variables) alors qu'il est
    # servi : jamais de rsync dans une release en ligne → nouveau dossier suffixé.
    if [ "$REL" = "$(target_of current)" ] || [ "$REL" = "$(target_of previous)" ]; then
      REL="$REL-$(date +%Y%m%d%H%M%S)"
    fi
    mkdir -p "releases/$REL"
    echo "$REL"
    ;;

  activate)
    valid_rel "$REL"
    activate "$REL"
    ;;

  rollback)
    if [ -n "$REL" ]; then valid_rel "$REL"; else REL=$(target_of previous); fi
    [ -n "$REL" ] || die "pas de previous : préciser la release (voir « list »)"
    activate "$REL"
    ;;

  migrate)
    if [ -L current ]; then log "déjà migré (current → $(target_of current))"; exit 0; fi
    [ -f index.html ] || die "pas d'index.html à la racine : rien à migrer"
    REL="legacy-$(date +%Y%m%d%H%M)"
    mkdir -p "releases/$REL"
    # Copie en liens physiques : instantanée, pas d'espace disque en plus.
    find . -mindepth 1 -maxdepth 1 ! -name releases ! -name current ! -name previous ! -name '.*.tmp' \
      -exec cp -al {} "releases/$REL/" \;
    activate "$REL"
    log "Étape suivante : nginx de ${SITE} sur la conf « releases », puis cleanup-legacy"
    ;;

  cleanup-legacy)
    [ -L current ] && [ -f current/index.html ] || die "current absent ou vide : migrer d'abord"
    find . -mindepth 1 -maxdepth 1 ! -name releases ! -name current ! -name previous \
      -exec rm -rf {} +
    log "fichiers à la racine supprimés"
    ;;

  list)
    cur=$(target_of current); prev=$(target_of previous)
    # shellcheck disable=SC2045 # idem prune
    for r in $(ls -1t releases 2>/dev/null); do
      mark="  "; [ "$r" = "$cur" ] && mark="* "; [ "$r" = "$prev" ] && mark="← "
      echo "${mark}${r}  $(date -r "releases/$r" '+%F %T')"
    done
    ;;

  *) usage ;;
esac
