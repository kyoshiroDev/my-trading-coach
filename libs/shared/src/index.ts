/**
 * `@mtc/shared` — code PUR partagé par l'API (NestJS), l'app et l'admin (Angular).
 *
 * Règles : aucune dépendance (ni Angular, ni NestJS, ni Prisma, ni lib externe), aucun effet
 * de bord, que des fonctions et constantes. Branché par alias dans chaque outil (tsconfig
 * `paths`, `resolve.alias` vitest, webpack de l'API) — cf. `.claude/agents/angular.md` et
 * `nestjs.md`.
 */
export * from './api-error';
export * from './currency';
export * from './pricing';
export * from './plan-benefits';
export * from './signup-pitch';
export * from './trade-stats';
export * from './contracts';
export * from './eco-event-key';
export * from './paris-date';
export * from './email-markdown';
export * from './prop-firm-rules/catalog';
export * from './prop-firm-rules/catalog-count';
export * from './prop-firm-rules/plan-match';
export * from './prop-firm-rules/daily-loss-status';
export * from './prop-firm-rules/drawdown-floor';
export * from './prop-firm-rules/plan-guess';
export * from './prop-firm-rules/plan-link';
export * from './prop-firm-rules/alert-levels';
export * from './signup-funnel';
export * from './landing-engagement';
export * from './acquisition-filter';
export * from './attempt-label';
export * from './terms';
