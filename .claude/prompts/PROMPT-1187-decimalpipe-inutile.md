# PROMPT-1187 : DecimalPipe importé sans usage

## Demande de Greg (2026-11-26)

« une fois la ci fini je veut que tu attaque la colonne idées features en commencant par la #1292 et pour remonter jusqu'a la #263 apres chaque feature fini tu push et ouvre la PR vers dev tu attend que la ci soit ok et tu enchaine avec l'autre feature »

## Ticket #1187 : Dette app : DecimalPipe importé sans usage (journal, sessions, debrief, profile)

Relevé par le vérificateur angular pendant #1180 (PR #1186), hors périmètre.

`DecimalPipe` est importé dans les `imports` de composants dont le gabarit ne l'utilise plus :
- `features/journal/journal.component.ts`
- `features/sessions/sessions.component.ts`
- `features/debrief/debrief.component.ts`
- `features/profile/profile.component.ts`

Huit specs (profile, accounts, journal, sessions) l'imposent aussi dans leurs `imports` surchargés : sans effet aujourd'hui, mais un `| number` réintroduit passerait les specs. Rappel #1180 : chiffres de trading au point (pas de `| number` avec LOCALE_ID fr-FR).

À faire : retirer l'import des composants et des specs, vérifier le build. Vérificateurs : angular, tests.
