#!/usr/bin/env bash
# Critère « 0 e-mail perdu » de la vague d'inscriptions (SCA-B9-02, #487), sur le VPS prod, juste
# après signup-wave.js. Lecture seule, environnement de test uniquement (load_redis, load_api).
#
# Chaque inscription réussie met un job « send » dans la file BullMQ `email` (SCA-B5-02). L'API de
# test tourne en rôle web, sans worker : les jobs restent dans la file, on peut les compter.
# Un job en attente, différé, actif ou en échec visible n'est pas perdu ; un e-mail perdu, c'est un
# écart entre ce total et le nombre d'inscriptions réussies (compteur k6 `signups_ok`).
#
#   bash file-email.sh <inscriptions réussies (signups_ok de k6)>
set -euo pipefail

ATTENDU="${1:?usage: $0 <signups_ok>}"
r() { docker exec load_redis redis-cli --no-auth-warning "$@"; }
k=bull:email
attente=$(r LLEN $k:wait); pause=$(r LLEN $k:paused); actifs=$(r LLEN $k:active)
differes=$(r ZCARD $k:delayed); prioritaires=$(r ZCARD $k:prioritized)
echecs=$(r ZCARD $k:failed); termines=$(r ZCARD $k:completed)
total=$((attente + pause + actifs + differes + prioritaires + echecs + termines))
# Repli de ResendService.send quand la file est indisponible : envoi direct (pas perdu, mais pas en file).
replis=$(docker logs load_api 2>&1 | grep -c 'File e-mail indisponible' || true)

echo "file email : attente ${attente} · pause ${pause} · actifs ${actifs} · différés ${differes} · prioritaires ${prioritaires} · échecs ${echecs} · terminés ${termines}"
echo "total en file : ${total} · envois directs (file indisponible) : ${replis} · inscriptions réussies : ${ATTENDU}"
if [ $((total + replis)) -eq "$ATTENDU" ]; then
  echo "✅ 0 e-mail perdu"
else
  echo "❌ écart de $((ATTENDU - total - replis)) e-mail(s)"; exit 1
fi
