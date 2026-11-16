#!/usr/bin/env bash
# Vérifie qu'aucune ligne des agents n'a été perdue lors d'un déplacement vers .claude/reference/.
#
# Compare l'ensemble des lignes non vides (espaces de bord retirés) des agents d'une révision de
# référence (par défaut origin/dev) à celles des agents + fichiers de référence du dossier courant.
# Une ligne absente doit figurer à l'identique dans .claude/reference/CONTRADICTIONS.md (ligne
# remplacée, avec sa décision en face) ; sinon elle est « manquante » et le script échoue.
#
# Usage : .claude/scripts/verifier-references.sh [révision]   (à lancer depuis la racine du dépôt)
set -euo pipefail
export LC_ALL=C
BASE="${1:-origin/dev}"
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

norm() { sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' | grep -v '^$' || true; }

# Avant : agents de la révision de référence
for f in $(git ls-tree --name-only "$BASE" .claude/agents/); do
  git show "$BASE:$f"
  echo
done | norm > "$TMP/avant.all"

# Après : agents + références du dossier courant (CONTRADICTIONS.md compris à part)
REPL=".claude/reference/CONTRADICTIONS.md"
{ cat .claude/agents/*.md; find .claude/reference -name '*.md' ! -path "$REPL" -exec cat {} +; } | norm > "$TMP/apres.all"
[ -f "$REPL" ] && norm < "$REPL" | sort -u > "$TMP/remplacees" || : > "$TMP/remplacees"

sort -u "$TMP/avant.all" > "$TMP/avant"
sort -u "$TMP/apres.all" > "$TMP/apres"
comm -23 "$TMP/avant" "$TMP/apres" > "$TMP/absentes"
comm -12 "$TMP/absentes" "$TMP/remplacees" > "$TMP/remplacees.ok"
comm -23 "$TMP/absentes" "$TMP/remplacees" > "$TMP/manquantes"

echo "Référence           : $BASE"
echo "Lignes avant        : $(wc -l < "$TMP/avant.all") (uniques : $(wc -l < "$TMP/avant"))"
echo "Lignes après        : $(wc -l < "$TMP/apres.all") (uniques : $(wc -l < "$TMP/apres"))"
echo "Lignes remplacées   : $(wc -l < "$TMP/remplacees.ok") (listées dans $REPL)"
echo "Lignes manquantes   : $(wc -l < "$TMP/manquantes")"
if [ -s "$TMP/remplacees.ok" ]; then
  echo "--- remplacées (voir $REPL)"
  cut -c1-160 "$TMP/remplacees.ok"
fi
if [ -s "$TMP/manquantes" ]; then
  echo "--- MANQUANTES"
  cat "$TMP/manquantes"
  exit 1
fi
echo "OK : aucune ligne perdue."
