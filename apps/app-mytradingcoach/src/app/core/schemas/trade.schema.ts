import { z } from 'zod';

/*
 * Schéma du formulaire de trade, côté FRONT uniquement.
 *
 * CT-04 voulait le partager avec l'API via un `ZodValidationPipe` sur POST/PATCH /trades. Deux
 * raisons de ne pas l'avoir fait, à lire avant de s'y remettre.
 *
 * 1. `libs/shared` s'interdit toute dépendance externe (cf. l'en-tête de son index) : y mettre un
 *    schéma zod casserait ce contrat. Le partage suppose donc une lib dédiée, ce que le prompt
 *    d'audit appelait `libs/contracts`.
 *
 * 2. Ce schéma N'EST PAS équivalent à `CreateTradeDto`. Substitué tel quel côté API, il change le
 *    comportement — comparaison faite le 2026-09-27 :
 *
 *      entry        DTO optionnel ≥ 0   │ ici OBLIGATOIRE et > 0   → un trade sans entry refusé
 *      commission   DTO présent         │ ici ABSENT               → les frais seraient perdus
 *      accountId    DTO présent         │ ici ABSENT               → le compte serait perdu
 *      exit/SL/TP   DTO ≥ 0             │ ici > 0                  → 0 refusé
 *      asset        DTO max 40          │ ici sans borne           → plus permissif
 *      notes        DTO max 2000        │ ici sans borne           → plus permissif
 *      tags         DTO 20 × max 30     │ ici sans borne           → plus permissif
 *      tradedAt     DTO IsDateString    │ ici string quelconque    → plus permissif
 *
 *    `commission` et `accountId` sont écrits par la synchro broker et l'import CSV : un pipe qui
 *    dépouille les clés inconnues les effacerait en silence. C'est un chemin d'écriture en
 *    production, pas un détail de formulaire.
 *
 * Pour finir CT-04 : créer la lib dédiée, partir du DTO (plus complet) et non de ce schéma, puis
 * tester les cas limites d'un trade venant de la synchro et d'un import CSV.
 */

// ngModel sur <input type="number"> produit null quand le champ est vidé.
// On normalise null → undefined pour que .optional() accepte les champs vides.
const nullToUndef = (v: unknown) => (v == null ? undefined : v);

const optPositive = z.preprocess(nullToUndef, z.number().positive().optional());
const optNumber = z.preprocess(nullToUndef, z.number().optional());

export const CreateTradeSchema = z.object({
  asset: z.string().min(1, 'Asset requis'),
  side: z.enum(['LONG', 'SHORT']),
  entry: z.preprocess(nullToUndef, z.number().positive('Entry requis (> 0)')),
  exit: optPositive,
  stopLoss: optPositive,
  takeProfit: optPositive,
  pnl: optNumber,
  riskReward: optNumber,
  // Émotion = override optionnel : nullable, absente = hérite de l'humeur de session.
  emotion: z
    .enum(['CONFIDENT', 'STRESSED', 'REVENGE', 'FEAR', 'FOCUSED', 'NEUTRAL'])
    .nullish(),
  setupId: z.string().min(1, 'Setup requis'),
  session: z.enum(['LONDON', 'NEW_YORK', 'ASIAN']),
  timeframe: z.string().min(1),
  quantity: z.preprocess(nullToUndef, z.number().positive().optional()),
  capitalEngaged: z.preprocess(nullToUndef, z.number().positive().optional()),
  notes: z.preprocess(nullToUndef, z.string().optional()),
  tags: z.array(z.string()).optional(),
  tradedAt: z.string().optional(),
});

export type CreateTradeDtoValidated = z.infer<typeof CreateTradeSchema>;
