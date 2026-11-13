valide la capture en direct à l'entrée a 100% sinon applique ses recommandation une fois valider a 100% par l'agent de relecture push et ouvre la PR vers dev

---

Contexte (ajouté par Claude) : message de Greg du 13/11, après les PR #968 et #971. La « capture en direct à l'entrée » est le R/R des trades synchronisés Tradovate (#916, décision du 2026-11-10) : stop et objectif liés à l'ordre d'entrée, figés à l'entrée. Elle est déjà mergée dans dev (PR #927, #957, #964). Lecture retenue : l'agent relecteur valide l'état actuel dans origin/dev ; s'il recommande des corrections, elles sont appliquées sur cette branche (partie d'origin/dev), puis push et PR vers dev après sa validation à 100 %.
