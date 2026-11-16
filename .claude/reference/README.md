# Références des agents

Détail des agents de `.claude/agents/`, déplacé à l'identique le 2026-11-16 (PROMPT-orchestration-agents)
pour que chaque agent reste court : règles permanentes, checklist « Vérification d'un diff », index.

- `<domaine>/<sujet>.md` : détail propre à un agent (nestjs, angular, deploy, astro, plans, prisma, design, tests, security).
- `commun/<sujet>.md` : fonctionnalité décrite par plusieurs couches (API, app, schéma, sécurité, tests) — une seule version,
  une sous-section par couche, chaque bloc avec son « Origine » (agent, section, date).
- `CONTRADICTIONS.md` : lignes corrigées pendant le déplacement (contradiction avec `decisions.md` ou fait technique).

On n'ouvre un fichier que quand l'index de l'agent dit qu'il concerne la tâche. Après un déplacement :
`.claude/scripts/verifier-references.sh` (doit finir sur « aucune ligne perdue »).
