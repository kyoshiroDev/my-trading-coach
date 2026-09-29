# Scripts

Tous les scripts ponctuels du dépôt, rangés par usage. Les `.ts` importent le code de l'API via
l'alias `@api/…` : toujours les lancer avec `--tsconfig tools/scripts/tsconfig.check.json`.
Typecheck : `pnpm nx typecheck tools-scripts`.

| Script | But | Lancement |
|---|---|---|
| `seed/demo-account.ts` | (Re)crée le compte démo en lecture seule (même logique que `POST /admin/seed-demo`). **Seul point d'entrée du seed démo.** | `pnpm seed:demo` |
| `seed/dev-propfirms.mjs` | SQL de comptes prop firm réalistes + trades pour un compte de dev. | `node tools/scripts/seed/dev-propfirms.mjs <userId> > seed.sql` |
| `seed/dev-trades-june.mjs` | SQL de trades MNQ réalistes (1er au 15 juin) pour un compte de dev. | `node tools/scripts/seed/dev-trades-june.mjs <userId> > seed.sql` |
| `backfill/referral-codes.ts` | Donne un code de parrainage à chaque utilisateur qui n'en a pas (idempotent). | `pnpm exec tsx --env-file=apps/api-mytradingcoach/.env --tsconfig tools/scripts/tsconfig.check.json tools/scripts/backfill/referral-codes.ts` |
| `backfill/ambassador-codes.ts` | Garantit un code à chaque ambassadeur (idempotent). | idem, `backfill/ambassador-codes.ts` |
| `backfill/snapshot-signups.ts` | Recalcule les inscriptions du jour des snapshots de métriques (`--dry-run` pour voir sans écrire). | idem, `backfill/snapshot-signups.ts [--dry-run]` |
| `ops/ensure-referral-coupon.ts` | Crée (idempotent) les deux coupons de parrainage dans Stripe. | idem, `ops/ensure-referral-coupon.ts` |
| `ops/send-welcome.mjs` | Envoie l'email de bienvenue (test de rendu Resend). | `node tools/scripts/ops/send-welcome.mjs <email>` |
| `ops/send-debrief-email.mjs` | Envoie un email de débrief hebdo d'exemple. | `node tools/scripts/ops/send-debrief-email.mjs <email>` |
| `ops/send-discord-invite.mjs` | Invite Discord aux utilisateurs (dry-run par défaut). | `node tools/scripts/ops/send-discord-invite.mjs` |

Règles : un en-tête d'une ligne (but + usage) par script ; jamais d'email, d'identifiant ou de clé
en dur (argument ou `.env`) ; un backfill est idempotent et propose un `--dry-run` quand il écrit.

Le bot Discord (`scripts/discord-bot/`) est une application à part entière, pas un script : il
rejoindra `apps/` quand le lockfile pourra être régénéré (il deviendra alors un paquet du workspace).
