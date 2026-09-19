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
export * from './trade-stats';
