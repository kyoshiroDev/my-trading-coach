# Parrainage : commissions et codes retirés

> Contenu déplacé à l'identique depuis `.claude/agents/prisma.md` le 2026-11-16 (PROMPT-orchestration-agents).
> Chaque bloc garde son titre d'origine ; « Origine » donne l'agent, la section et la date d'origine (date du titre, sinon premier commit qui l'a écrite).

<!-- Origine : prisma.md · Commission ambassadeur par facture (`ReferralCommission.invoiceId`, A1 #1013, 2026-11-15) · 2026-11-15 -->
> **Origine** : `prisma.md` · « Commission ambassadeur par facture (`ReferralCommission.invoiceId`, A1 #1013, 2026-11-15) » · 2026-11-15

## Commission ambassadeur par facture (`ReferralCommission.invoiceId`, A1 #1013, 2026-11-15)

Migration `20261115120000_referral_commission_invoice` : colonne `invoiceId` (nullable, unique),
l'unicité `(subscriptionId, period)` devient un simple index. Une commission par facture Stripe
(upsert sur `invoiceId`, `update: {}`) ; `period` reste le mois de rattachement (affichage, relevé).
Statuts : `pending` → `paid` (admin) ou `canceled` (1er paiement du filleul remboursé, A4) ; une
`canceled` est exclue de toutes les lectures. N-1 : pendant les ~30 s de drain, l'ancienne version ne
peut plus faire son upsert `(subscriptionId, period)` (index unique retiré) : le job BullMQ échoue et
est rejoué par la nouvelle version (5 tentatives) ; prod au 14/11 : 0 commission. Lignes antérieures :
`invoiceId` null (aucune en prod).

<!-- Origine : prisma.md · Codes de parrainage retirés (`RetiredReferralCode`, A5 #1013, 2026-11-15) · 2026-11-15 -->
> **Origine** : `prisma.md` · « Codes de parrainage retirés (`RetiredReferralCode`, A5 #1013, 2026-11-15) » · 2026-11-15

## Codes de parrainage retirés (`RetiredReferralCode`, A5 #1013, 2026-11-15)

Migration `20261115130000_retired_referral_code` (additive, table seule). Écrite dans la transaction
d'un changement de code ambassadeur et à la révocation (`upsert`, `update: {}`) ; lue par `promote` et
les deux générateurs de code (ambassadeur, parrainage). Clé = le code ; `userId` sans clé étrangère
(la trace survit à la suppression du compte) ; seul ce `userId` peut reprendre le code (la ligne est
alors supprimée).
