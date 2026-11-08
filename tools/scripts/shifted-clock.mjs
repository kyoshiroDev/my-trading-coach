/**
 * Horloge décalée pour débusquer les tests qui dépendent de la date du jour (API, app, admin, libs).
 * Préchargé par Node dans chaque worker de Vitest : `TEST_NOW` (date ISO) devient « maintenant » au
 * démarrage, puis l'horloge avance normalement (les délais restent réels). Remplace `Date` avant les
 * faux minuteurs de Vitest : un test qui fige l'horloge puis appelle `vi.useRealTimers()` retombe sur
 * cette horloge décalée. Les dates de Postgres (`NOW()`) ne bougent pas : un test d'intégration qui
 * mélange les deux horloges échoue sous ce décalage sans être fautif.
 *
 *   TEST_NOW=2027-02-15T10:00:00Z NODE_OPTIONS="--import $PWD/tools/scripts/shifted-clock.mjs" \
 *     pnpm nx test api-mytradingcoach --skip-nx-cache
 */
const target = process.env.TEST_NOW;
if (target) {
  const RealDate = Date;
  const offset = RealDate.parse(target) - RealDate.now();
  if (Number.isNaN(offset)) throw new Error(`TEST_NOW invalide : ${target}`);
  class ShiftedDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(RealDate.now() + offset);
      else super(...args);
    }
    static now() {
      return RealDate.now() + offset;
    }
  }
  globalThis.Date = ShiftedDate;
}
