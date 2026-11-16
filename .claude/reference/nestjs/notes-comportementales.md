# Notes comportementales (barème B)

> Contenu déplacé à l'identique depuis `.claude/agents/nestjs.md` le 2026-11-16 (PROMPT-orchestration-agents).
> Chaque bloc garde son titre d'origine ; « Origine » donne l'agent, la section et la date d'origine (date du titre, sinon premier commit qui l'a écrite).

<!-- Origine : nestjs.md · Notes comportementales (barème B) — recalcul (SCA-B5-04, 2026-10-07) · 2026-10-07 -->
> **Origine** : `nestjs.md` · « Notes comportementales (barème B) — recalcul (SCA-B5-04, 2026-10-07) » · 2026-10-07

## Notes comportementales (barème B) — recalcul (SCA-B5-04, 2026-10-07)

`trades/behavioral-grades.ts` : `behavioralGradeUpdates(trades)` (pur : médianes du compte, une
passe, seulement les trades hors barème A dont la note change : sans stop, ou avec un stop mais
sans note STOP_BASED — stop seul, ni objectif ni émotion, #929 — pour que poser son stop ne fasse
jamais perdre la note) puis `writeGradeUpdates` : **un
`UPDATE "Trade" … FROM (VALUES …)` par paquet de 1 000**, tous dans une transaction, filtré sur
`accountId` (plus un UPDATE Prisma par trade). Volontairement **synchrone et sur tout le compte** :
la réponse de création d'un trade porte sa note, et un nouveau trade décale les médianes de tous.
(Le plan B5-04 proposait job asynchrone + fenêtre ±1 j : non retenu, cela change ce que voit
l'utilisateur.) Validé sur vraie base : `behavioral-grades.int-spec.ts`.
