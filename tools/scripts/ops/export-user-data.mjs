#!/usr/bin/env node
// Export RGPD des données d'un compte (#825) : écrit le SQL psql (lecture seule) qui produit un CSV par table + LISEZMOI.txt.
// Usage : node tools/scripts/ops/export-user-data.mjs <userId> > export.sql   ·   node tools/scripts/ops/export-user-data.mjs --check
// Procédure complète (vérification de l'adresse, exécution par Greg, archive chiffrée, envoi) : docs/ops/export-donnees-sur-demande.md
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCHEMA = resolve(dirname(fileURLToPath(import.meta.url)), '../../../prisma/schema.prisma');

/** `User.id` est un cuid() : format strict, seule protection de l'identifiant inséré dans le SQL et le chemin. */
const USER_ID = /^c[a-z0-9]{20,32}$/;

/** Comptes de l'utilisateur, pour les tables reliées par `accountId`. */
const OWN_ACCOUNTS = (id) => `"accountId" IN (SELECT id FROM "TradingAccount" WHERE "userId" = '${id}')`;
const BY_USER = (id) => `"userId" = '${id}'`;

/**
 * Périmètre de l'export, en LISTE BLANCHE : `columns` = colonnes exportées, `excluded` = colonnes
 * écartées exprès (secret, ou donnée d'un autre compte). `--check` exige que chaque colonne du schéma
 * soit dans l'une des deux listes : une colonne ajoutée n'est jamais exportée par accident.
 * `select` remplace la liste quand une colonne est calculée (rôle dans un parrainage).
 */
const TABLES = [
  {
    table: 'User', file: 'compte.csv', label: 'ton compte : profil, préférences, plan, consentements, provenance',
    where: (id) => `id = '${id}'`,
    columns: ['id', 'email', 'name', 'role', 'plan', 'trialEndsAt', 'trialUsed', 'trialSource', 'signupTrialEndsAt', 'trialEndHandledAt',
      'keptAccountId', 'googleId', 'authProvider', 'emailVerifiedAt', 'signupFinalizedAt', 'resetPasswordExpires', 'marketingConsent',
      'marketingConsentAt', 'marketingConsentWithdrawnAt', 'termsAcceptedAt', 'termsVersion', 'serviceEmailsOptOutAt', 'stripeCustomerId',
      'stripeSubscriptionId', 'stripePriceId', 'stripeInterval', 'stripeCurrentPeriodEnd', 'stripeSubscriptionStatus', 'subscriptionCanceledAt',
      'stripeCancelAt', 'isDemo', 'isInternal', 'onboardingCompleted', 'market', 'goal', 'currency', 'currencyRate', 'startingCapital',
      'notificationsEmail', 'debriefAutomatic', 'tradingStyle', 'tradingStrategy', 'tradingSessions', 'tradesPerDayMin', 'tradesPerDayMax', 'newsShieldMinutes',
      'strategyDescription', 'tradingAssets', 'favoriteAsset', 'referralCode', 'referredBy', 'referralDiscountSince', 'acquisitionSource',
      'acquisitionMedium', 'acquisitionCampaign', 'pinnedEcoEvents', 'pinnedEcoDate', 'discordId', 'lastSeenAt', 'lastLoginAt', 'createdAt', 'updatedAt'],
    excluded: { password: 'hash du mot de passe', resetPasswordToken: 'jeton de réinitialisation', tokenVersion: 'version des jetons de session', unsubToken: 'jeton de désinscription' },
  },
  { table: 'Trade', file: 'trades.csv', label: 'tes trades (journal)', where: BY_USER,
    columns: ['id', 'userId', 'asset', 'side', 'entry', 'exit', 'stopLoss', 'takeProfit', 'pnl', 'commission', 'riskReward', 'quantity', 'capitalEngaged',
      'executionScore', 'executionGrade', 'executionMethod', 'emotion', 'setupId', 'session', 'timeframe', 'notes', 'tags', 'sessionId', 'accountId',
      'tradedAt', 'createdAt', 'source', 'importHash'] },
  { table: 'TradeSession', file: 'seances.csv', label: 'tes séances de trading et leurs notes', where: BY_USER,
    columns: ['id', 'userId', 'startedAt', 'endedAt', 'moodStart', 'moodEnd', 'totalPnl', 'totalTrades', 'winRate', 'status', 'notes', 'reflectionNote',
      'reflectionQuestion', 'planNote', 'marketContext', 'maxDrawdown', 'bestTradePnl', 'bestTradeAsset', 'accountId', 'createdAt'] },
  { table: 'Setup', file: 'setups.csv', label: 'tes setups', where: BY_USER,
    columns: ['id', 'userId', 'title', 'color', 'description', 'sortOrder', 'archived', 'createdAt', 'updatedAt'] },
  { table: 'TradingAccount', file: 'comptes-de-trading.csv', label: 'tes comptes de trading (prop firm, personnels)', where: BY_USER,
    columns: ['id', 'userId', 'label', 'broker', 'type', 'status', 'statusChangedAt', 'accountSize', 'currency', 'startingBalance', 'profitTarget',
      'maxDrawdown', 'drawdownType', 'platform', 'lastPayoutAt', 'propFirmPlanId', 'planLinkChoice', 'unlistedFirm', 'createdAt', 'updatedAt'] },
  { table: 'BrokerDailyClose', file: 'clotures-courtier.csv', label: 'soldes de clôture relevés chez ton courtier', where: OWN_ACCOUNTS,
    columns: ['id', 'accountId', 'tradeDate', 'closingBalance', 'realizedPnl', 'createdAt', 'updatedAt'] },
  { table: 'AccountRiskDay', file: 'risque-par-jour.csv', label: 'marges de drawdown et de perte du jour, jour par jour', where: OWN_ACCOUNTS,
    columns: ['id', 'accountId', 'tradeDate', 'minDrawdownMargin', 'minDrawdownAt', 'minDailyLossRemaining', 'minDailyLossAt', 'floorStart', 'floorEnd', 'createdAt', 'updatedAt'] },
  { table: 'BrokerPayout', file: 'payouts.csv', label: 'payouts détectés chez ton courtier ou saisis', where: OWN_ACCOUNTS,
    columns: ['id', 'accountId', 'transactionId', 'tradeDate', 'amount', 'changeType', 'confidence', 'dismissedAt', 'createdAt'] },
  { table: 'PropRiskEvent', file: 'alertes-risque.csv', label: 'alertes de risque prop firm envoyées', where: BY_USER,
    columns: ['id', 'userId', 'accountId', 'tradeDate', 'kind', 'level', 'data', 'createdAt'] },
  { table: 'AccountIncident', file: 'incidents-compte.csv', label: 'incidents de compte (règle franchie) et leur analyse', where: BY_USER,
    columns: ['id', 'userId', 'accountId', 'kind', 'period', 'tradeDate', 'source', 'data', 'failedByIncidentAt', 'aiAnalysis', 'aiGeneratedAt', 'dismissedAt', 'createdAt'] },
  { table: 'BehaviorAlert', file: 'alertes-comportement.csv', label: 'alertes de comportement en séance', where: BY_USER,
    columns: ['id', 'userId', 'accountId', 'tradeDay', 'sessionId', 'tradeId', 'type', 'severity', 'message', 'context', 'createdAt', 'dismissedAt', 'mutedByUser'] },
  { table: 'BehaviorDetectorMute', file: 'detecteurs-coupes.csv', label: 'détecteurs de comportement que tu as coupés (« Pas pour mon style »)', where: BY_USER,
    columns: ['userId', 'detector', 'createdAt'] },
  { table: 'SessionContract', file: 'contrats-seance.csv', label: 'règles que tu t’es fixées par séance et leurs modifications', where: BY_USER,
    columns: ['sessionId', 'userId', 'maxDailyLoss', 'maxConsecutiveLosses', 'maxTrades', 'newsMinutes', 'allowedAssets', 'edits', 'createdAt', 'updatedAt'] },
  { table: 'BehaviorBaseline', file: 'reference-comportement.csv', label: 'ta référence de comportement (moyennes de tes séances)', where: BY_USER,
    columns: ['userId', 'sessionsUsed', 'throughDay', 'data', 'computedAt'] },
  {
    table: 'BrokerConnection', file: 'connexions-courtier.csv', label: 'tes connexions au courtier (sans les jetons)', where: BY_USER,
    columns: ['id', 'userId', 'accountId', 'provider', 'status', 'accessTokenExpiresAt', 'refreshTokenExpiresAt', 'externalUserId', 'externalAccountId',
      'externalAccountName', 'externalEnv', 'apiHostsAt', 'availableAccounts', 'lastSyncAt', 'lastSyncError', 'tradesImported', 'historyImportedAt',
      'brokerCashBalance', 'brokerCashBalanceAt', 'brokerNetLiq', 'brokerOpenPnl', 'brokerEquityAt', 'brokerOpenPositions', 'payoutsCheckedThrough',
      'createdAt', 'updatedAt'],
    excluded: { accessTokenEnc: 'jeton courtier chiffré', refreshTokenEnc: 'jeton courtier chiffré', apiHosts: "adresses internes de l'infrastructure" },
  },
  { table: 'TradovateAccountObservation', file: 'observations-tradovate.csv', label: 'état quotidien de ton compte Tradovate vu par la synchronisation (90 derniers jours)',
    where: (id) => `"connectionId" IN (SELECT id FROM "BrokerConnection" WHERE "userId" = '${id}')`,
    columns: ['id', 'connectionId', 'day', 'outcome', 'httpStatus', 'listed', 'active', 'closed', 'restricted', 'accountStatus', 'syncPaused', 'lastSyncAt', 'createdAt'] },
  { table: 'WeeklyDebrief', file: 'debriefs-hebdo.csv', label: 'tes débriefs de la semaine', where: BY_USER,
    columns: ['id', 'userId', 'weekNumber', 'year', 'startDate', 'endDate', 'aiSummary', 'insights', 'objectives', 'stats', 'generatedAt'] },
  { table: 'DailyRecap', file: 'recaps-du-jour.csv', label: 'tes récaps du jour', where: BY_USER,
    columns: ['id', 'userId', 'date', 'tradesCount', 'pnl', 'winRate', 'dominantEmotion', 'aiOneLiner', 'generatedAt'] },
  { table: 'EmailSend', file: 'emails-envoyes.csv', label: "e-mails qu'on t'a envoyés (type et date)", where: BY_USER,
    columns: ['id', 'campaignKey', 'userId', 'kind', 'sentAt'] },
  { table: 'ProductEventDaily', file: 'usage-produit.csv', label: "usage de l'app par jour (fonction et nombre)", where: BY_USER,
    columns: ['id', 'date', 'userId', 'event', 'place', 'count'] },
  { table: 'UserDailyActivity', file: 'jours-actifs.csv', label: "jours où tu as utilisé l'app", where: BY_USER,
    columns: ['id', 'userId', 'date'] },
  { table: 'AiUsageLog', file: 'usage-ia.csv', label: "appels à l'IA faits pour toi (fonction, volume, coût)", where: BY_USER,
    columns: ['id', 'userId', 'feature', 'model', 'inputTokens', 'outputTokens', 'costUsd', 'createdAt'] },
  { table: 'FounderSeat', file: 'offre-fondateur.csv', label: 'ta place fondateur', where: BY_USER,
    columns: ['number', 'userId', 'status', 'interval', 'cta', 'stripeSubscriptionId', 'takenAt', 'firstPaidAt', 'endedAt'] },
  { table: 'PartnerRedemption', file: 'code-partenaire.csv', label: 'code partenaire utilisé', where: BY_USER,
    columns: ['id', 'partnerCodeId', 'userId', 'priceMonthlyEur', 'priceAnnualEur', 'durationMonths', 'stripeCouponId', 'status', 'cta', 'stripeSubscriptionId', 'createdAt', 'endedAt'] },
  {
    table: 'UserPushDevice', file: 'appareils-notifications.csv', label: 'appareils inscrits aux notifications (sans les clés)', where: BY_USER,
    columns: ['id', 'userId', 'userAgent', 'createdAt', 'lastSuccessAt'],
    excluded: { endpoint: 'adresse de notification', p256dh: 'clé de notification', auth: 'clé de notification' },
  },
  { table: 'TraderPushPreference', file: 'preferences-notifications.csv', label: 'heures calmes des notifications', where: BY_USER,
    columns: ['userId', 'quietStart', 'quietEnd', 'mutedTypes', 'updatedAt'] },
  { table: 'GiveawayWin', file: 'lots-gagnes.csv', label: 'lots gagnés au tirage mensuel', where: BY_USER,
    columns: ['id', 'drawId', 'userId', 'pool', 'prizeMonths', 'startsAt', 'endsAt', 'activationStatus', 'activationError', 'creditCents', 'stripeBalanceTxId',
      'displayConsent', 'displayPseudo', 'message', 'moderation', 'moderatedAt', 'instagramConsent', 'instagramHandle', 'publicationStatus', 'publishedUrl',
      'publishedAt', 'endingNoticeSentAt', 'createdAt', 'updatedAt'] },
  { table: 'RetiredReferralCode', file: 'anciens-codes-parrainage.csv', label: 'tes anciens codes de parrainage', where: BY_USER,
    columns: ['code', 'userId', 'retiredAt'] },
  {
    table: 'ReferralReward', file: 'parrainages.csv', label: "récompenses de parrainage (ton rôle, sans l'autre compte)",
    where: (id) => `"parrainId" = '${id}' OR "filleulId" = '${id}'`,
    select: (id) => `CASE WHEN "parrainId" = '${id}' THEN 'parrain' ELSE 'filleul' END AS "role", "id", "amountEur", "status", "createdAt"`,
    columns: ['id', 'amountEur', 'status', 'createdAt'],
    excluded: { parrainId: "identifiant d'un autre compte (remplacé par le rôle)", filleulId: "identifiant d'un autre compte (remplacé par le rôle)", subscriptionId: "abonnement d'un autre compte" },
  },
  {
    table: 'ReferralCommission', file: 'commissions-ambassadeur.csv', label: 'commissions ambassadeur (sans les comptes parrainés)',
    where: (id) => `"ambassadorId" = '${id}'`,
    columns: ['id', 'ambassadorId', 'amount', 'period', 'status', 'createdAt'],
    excluded: { referredUserId: "identifiant d'un autre compte", subscriptionId: "abonnement d'un autre compte", invoiceId: "facture d'un autre compte" },
  },
];

/** Tables reliées à un compte mais écartées exprès (raison obligatoire). */
const EXCLUDED_TABLES = {
  AdminPushSubscription: "notifications du back-office (administrateurs seulement)",
  CheckoutReservation: 'réservation technique de paiement, effacée après 30 minutes',
  BrokerCsvMapping: "modèles d'import partagés entre tous les comptes",
  GiveawayDraw: "tirage commun à tous les participants (GiveawayWin suffit)",
  DeletedAccount: 'compte supprimé : plus rien à exporter',
};

/** Colonnes qui relient une table à un compte : toute table qui en porte une doit être classée. */
const LINK_COLUMNS = ['userId', 'accountId', 'connectionId', 'sessionId', 'tradeId', 'drawId', 'parrainId', 'filleulId', 'ambassadorId', 'referredUserId', 'winnerId', 'validatedById'];

const SCALARS = new Set(['String', 'Int', 'Float', 'Boolean', 'DateTime', 'Json', 'Decimal', 'BigInt', 'Bytes']);

/** Colonnes de chaque modèle du schéma (scalaires et enums ; les relations ne sont pas des colonnes). */
export function schemaColumns(schema) {
  const enums = new Set([...schema.matchAll(/^enum (\w+) \{/gm)].map((m) => m[1]));
  const models = new Map();
  for (const m of schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
    const cols = [];
    for (const raw of m[2].split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('//') || line.startsWith('@@')) continue;
      const [name, type] = line.split(/\s+/);
      if (!type) continue;
      const base = type.replace(/[?[\]]/g, '');
      if (type.endsWith('[]') && !SCALARS.has(base) && !enums.has(base)) continue;
      if (SCALARS.has(base) || enums.has(base)) cols.push(name);
    }
    models.set(m[1], cols);
  }
  return models;
}

/** Écarts entre le périmètre et le schéma ; vide = tout est classé. */
export function checkPerimeter(schema) {
  const models = schemaColumns(schema);
  const errors = [];
  const classified = new Set([...TABLES.map((t) => t.table), ...Object.keys(EXCLUDED_TABLES)]);
  for (const t of TABLES) {
    const cols = models.get(t.table);
    if (!cols) { errors.push(`${t.table} : table absente du schéma`); continue; }
    const listed = [...t.columns, ...Object.keys(t.excluded ?? {})];
    for (const c of listed) if (!cols.includes(c)) errors.push(`${t.table}.${c} : colonne absente du schéma`);
    for (const c of cols) if (!listed.includes(c)) errors.push(`${t.table}.${c} : colonne non classée (à exporter ou à exclure exprès)`);
  }
  for (const name of Object.keys(EXCLUDED_TABLES)) if (!models.has(name)) errors.push(`${name} : table exclue absente du schéma`);
  for (const [name, cols] of models) {
    if (!classified.has(name) && cols.some((c) => LINK_COLUMNS.includes(c))) {
      errors.push(`${name} : table reliée à un compte non classée (à exporter ou à exclure exprès)`);
    }
  }
  return errors;
}

const q = (c) => `"${c}"`;

/** SQL psql complet de l'export d'un compte (lecture seule, arrêt à la première erreur). */
export function exportSql(userId, now = new Date()) {
  if (!USER_ID.test(userId)) throw new Error('Identifiant invalide : un id de compte (cuid) est attendu.');
  const dir = `/tmp/mtc-export-${userId}`;
  const day = now.toISOString().slice(0, 10);
  const lines = [
    '\\set ON_ERROR_STOP on',
    'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;',
    '-- Compte inconnu : division par zéro, export arrêté.',
    `SELECT 1 / count(*) FROM "User" WHERE id = '${userId}';`,
  ];
  for (const t of TABLES) {
    const select = t.select ? t.select(userId) : t.columns.map(q).join(', ');
    lines.push(`\\copy (SELECT ${select} FROM ${q(t.table)} WHERE ${t.where(userId)}) TO '${dir}/${t.file}' WITH (FORMAT csv, HEADER true)`);
  }
  // LISEZMOI en littéraux SQL (apostrophes doublées) : \\qecho interpréterait les apostrophes du texte.
  const rows = readme(day).map((l, i) => `(${i}, '${l.replace(/'/g, "''")}')`).join(', ');
  lines.push(`\\copy (SELECT line FROM (VALUES ${rows}) AS r(n, line) ORDER BY n) TO '${dir}/LISEZMOI.txt' WITH (FORMAT text)`);
  lines.push('ROLLBACK;');
  return lines.join('\n') + '\n';
}

function readme(day) {
  return [
    `Export de tes données MyTradingCoach, ${day}.`,
    '',
    'Un fichier CSV par type de donnée (séparateur virgule, encodage UTF-8, dates en UTC) :',
    ...TABLES.map((t) => `- ${t.file} : ${t.label}`),
    '',
    'Non fournis, pour ta sécurité : mot de passe, jetons de connexion au courtier et clés de notification.',
    'Factures : elles sont chez Stripe, notre prestataire de paiement. Si tu as eu un abonnement payant,',
    'retrouve-les dans Profil, bouton « Gérer mon abonnement », ou réponds à notre e-mail pour les recevoir.',
  ];
}

function main(argv) {
  if (argv[0] === '--check') {
    const errors = checkPerimeter(readFileSync(SCHEMA, 'utf8'));
    if (errors.length) {
      process.stderr.write(`Périmètre de l'export à mettre à jour (${errors.length}) :\n${errors.map((e) => `- ${e}`).join('\n')}\n`);
      return 1;
    }
    process.stdout.write(`Périmètre à jour : ${TABLES.length} tables exportées, ${Object.keys(EXCLUDED_TABLES).length} exclues exprès.\n`);
    return 0;
  }
  if (argv.length !== 1) {
    process.stderr.write('Usage : node tools/scripts/ops/export-user-data.mjs <userId> > export.sql  (ou --check)\n');
    return 2;
  }
  try {
    process.stdout.write(exportSql(argv[0]));
    return 0;
  } catch (e) {
    process.stderr.write(`${e.message}\n`);
    return 2;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
