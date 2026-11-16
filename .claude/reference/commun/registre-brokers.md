# Registre des brokers (`BrokerCsvMapping`)

> Contenu déplacé à l'identique depuis `.claude/agents/nestjs.md`, `.claude/agents/prisma.md` le 2026-11-16 (PROMPT-orchestration-agents).
> Chaque bloc garde son titre d'origine ; « Origine » donne l'agent, la section et la date d'origine (date du titre, sinon premier commit qui l'a écrite).

<!-- Origine : nestjs.md · Registre des brokers (2026-09-28) · 2026-09-28 -->
> **Origine** : `nestjs.md` · « Registre des brokers (2026-09-28) » · 2026-09-28

## Registre des brokers (2026-09-28)

Ordre de résolution d'un import, à ne pas réarranger :

1. `detectBroker` reconnaît l'en-tête → parseur en dur, local, gratuit.
2. **Registre** (`BrokerMappingService.findByHeader`) → fiche en base, local, gratuit, **tous
   les plans**. Placé AVANT le verrou Premium : c'est toute la raison d'être du registre.
3. Le fichier ressemble-t-il à un export de trades ? Sinon message neutre, sans upsell.
4. Chemin IA (`PremiumGuard` + `AI_ENABLED`) : d'abord un **mapping** (un appel, ~0,003 $,
   coût indépendant de la taille), et seulement s'il échoue le repli ligne par ligne
   (`AI_BATCH` = 25 depuis le 2026-10-08 : à 120, la sortie dépassait `max_tokens` 8192 ; un test
   impose `AI_BATCH × WORST_TOKENS_PER_TRADE ≤ 50 %` du plafond. Coût du repli inchangé, ~1,4 $
   pour 2000 lignes : la sortie suit le nombre de trades, seule l'entête est répétée).

Fichiers : `trades/csv-mapping.ts` (types, validation de forme, application, contrôle du P&L,
`headerSignature`), `trades/broker-mapping.service.ts` (lecture/écriture des fiches),
`admin/admin-broker-mappings.controller.ts` (`analyse` payant, `preview` gratuit, `POST`).

**Le sens (long/short) ne se prend jamais sur parole.** Mesuré le 2026-09-28 sur 5 formats :
les modèles identifient les colonnes de façon fiable (30/30 critères) mais se trompent de sens
2 fois sur 5, et une inversion transforme tous les longs en shorts sans qu'aucune erreur ne
remonte. Le sens est donc tranché par le **signe du P&L** (`applyMappingWithPnlCheck`) :
un long gagne quand la sortie dépasse l'entrée. Si le mapping contredit les chiffres, il est
inversé ; si le contrôle est impossible (pas de prix d'entrée, type Binance Futures) ou sous
80 %, on **renonce** et on retombe sur le parcours « broker inconnu ». Un import cher vaut
mieux qu'un import faux.

Ce contrôle est rejoué **à chaque import**, pas seulement à la validation : la fiche a été
validée sur 20 lignes d'un utilisateur, elle s'applique au fichier entier d'un autre.

Deux limites connues, documentées dans `csv-mapping.ts` : en mode horodatages, permuter les
colonnes de temps inverse le sens ET l'entrée/sortie, donc le P&L ne tranche pas ; un trade
dont les frais dépassent le gain brut a un signe « faux » sans rien de cassé, d'où un seuil en
part de lignes et non la perfection.

<!-- Origine : prisma.md · `BrokerCsvMapping` — registre des brokers (2026-09-28) · 2026-09-28 -->
> **Origine** : `prisma.md` · « `BrokerCsvMapping` — registre des brokers (2026-09-28) » · 2026-09-28

## `BrokerCsvMapping` — registre des brokers (2026-09-28)

Fiche de parsing d'un export CSV, déduite une fois par un modèle puis réutilisée pour **tous**
les utilisateurs, gratuits compris. Remplace l'écriture d'un parseur TypeScript par broker :
les fiches vivant en base, ajouter un broker ne demande ni build ni déploiement.

- `headerHash` (unique) : empreinte de l'en-tête normalisé, clé de reconnaissance. Voulue
  **exacte** — une colonne ajoutée par le broker change la signature, la fiche ne matche plus et
  l'import redevient « inconnu ». Mieux vaut ne pas reconnaître que lire chaque colonne à côté.
- `mappingJson` : la fiche au format `CsvMapping` (`trades/csv-mapping.ts`).
- `pnlConfidence` : part des lignes dont le signe du P&L confirmait le sens à la validation.
  Trace de la confiance accordée, pour pouvoir réexaminer une fiche plus tard.
- `validatedById` en `onDelete: Restrict` : une fiche porte les imports de tous les
  utilisateurs de ce broker, supprimer l'admin ne doit pas la faire disparaître en cascade.
- `enabled` : on désactive, on ne supprime pas — on garde la trace d'une fiche qui s'est
  avérée mauvaise.

**Aucune donnée de trading dans cette table** : uniquement des index de colonnes et des règles
de format. L'échantillon qui a servi à déduire la fiche n'est pas conservé ; seul l'en-tête brut
l'est (`headerSample`), pour diagnostiquer une fiche qui ne matche plus.
