/**
 * Variables d'environnement de l'API : LA liste de référence, vérifiée au démarrage (main.ts).
 * Documentation et valeurs d'exemple : `apps/api-mytradingcoach/.env.example`.
 *
 * - `required`   : l'API refuse de démarrer si elle manque.
 * - `production` : indispensable en prod (sinon fonctionnement dégradé) → avertissement au démarrage.
 * - `optional`   : seulement le format est vérifié, si la variable est définie.
 */
type Level = 'required' | 'production' | 'optional';

interface EnvVar {
  name: string;
  level: Level;
  /** Renvoie un message d'erreur si la valeur est invalide. */
  check?: (value: string) => string | undefined;
}

const isBase64Key32 = (v: string) =>
  Buffer.from(v, 'base64').length === 32 ? undefined : 'doit faire 32 octets encodés en base64 (openssl rand -base64 32)';
const isBoolean = (v: string) => (v === 'true' || v === 'false' ? undefined : 'doit valoir "true" ou "false"');
const isPort = (v: string) => (/^\d+$/.test(v) ? undefined : 'doit être un numéro de port');

export const ENV_VARS: EnvVar[] = [
  { name: 'DATABASE_URL', level: 'required' },
  { name: 'JWT_SECRET', level: 'required' },
  { name: 'JWT_REFRESH_SECRET', level: 'required' },
  { name: 'ANTHROPIC_API_KEY', level: 'required' },
  { name: 'STRIPE_SECRET_KEY', level: 'required' },
  { name: 'STRIPE_WEBHOOK_SECRET', level: 'required' },
  { name: 'STRIPE_PREMIUM_PRICE_MONTHLY_V2', level: 'required' },
  { name: 'STRIPE_PREMIUM_PRICE_YEARLY_V2', level: 'required' },
  { name: 'RESEND_API_KEY', level: 'required' },
  // Sans REDIS_HOST, l'API vise localhost : cache, files de jobs et temps réel hors service.
  { name: 'REDIS_HOST', level: 'production' },
  // Sans CORS_ORIGINS, seul http://localhost:4200 est autorisé : l'app de prod est bloquée.
  { name: 'CORS_ORIGINS', level: 'production' },
  { name: 'FRONTEND_URL', level: 'production' },
  { name: 'PORT', level: 'optional', check: isPort },
  // Isolation Redis par environnement (redis-config.ts). Défauts : base 0, aucun préfixe.
  { name: 'REDIS_DB', level: 'optional', check: (v) => (/^\d+$/.test(v) ? undefined : 'doit être un entier >= 0') },
  { name: 'REDIS_PREFIX', level: 'optional', check: (v) => (/^[A-Za-z0-9_:-]+$/.test(v) ? undefined : 'lettres, chiffres, « _ », « - », « : » uniquement') },
  { name: 'AI_ENABLED', level: 'optional', check: isBoolean },
  { name: 'BROKER_TOKEN_ENCRYPTION_KEY', level: 'optional', check: isBase64Key32 },
];

export interface EnvReport {
  /** Bloquant : l'API ne doit pas démarrer. */
  errors: string[];
  /** Non bloquant : à corriger, affiché au démarrage. */
  warnings: string[];
}

export function checkEnv(env: NodeJS.ProcessEnv, isProduction: boolean): EnvReport {
  const report: EnvReport = { errors: [], warnings: [] };
  for (const { name, level, check } of ENV_VARS) {
    const value = env[name];
    if (!value) {
      if (level === 'required') report.errors.push(`${name} manquante`);
      if (level === 'production' && isProduction) report.warnings.push(`${name} manquante (indispensable en production)`);
      continue;
    }
    const problem = check?.(value);
    if (problem) report.warnings.push(`${name} ${problem}`);
  }
  return report;
}
