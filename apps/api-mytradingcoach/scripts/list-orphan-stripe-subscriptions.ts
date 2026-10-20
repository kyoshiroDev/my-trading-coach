/**
 * LECTURE SEULE. Abonnements Stripe encore en cours (actif, essai, impayé) dont le client n'a plus
 * de compte MTC, rapprochés de `DeletedAccount` par e-mail. Rattrapage des suppressions faites
 * avant la résiliation automatique (DELETE /users/me ne résiliait pas l'abonnement).
 *
 * Aucune écriture : Stripe n'est que listé (`subscriptions.list`), la base n'est lue que dans une
 * session `default_transaction_read_only`. La clé Stripe n'est jamais affichée (seul le mode test /
 * live l'est). Clé conseillée : une clé restreinte en lecture (Customers + Subscriptions : Read).
 *
 * Variables : STRIPE_SECRET_KEY, DATABASE_URL (rôle `mtc_readonly` de préférence).
 *
 * Exécution (comme `close-sessions.ts`) :
 *   pnpm exec esbuild apps/api-mytradingcoach/scripts/list-orphan-stripe-subscriptions.ts --bundle \
 *     --platform=node --external:pg --external:stripe --outfile=list-orphan-stripe-subscriptions.js
 *   docker cp list-orphan-stripe-subscriptions.js <conteneur>:/app/
 *   docker exec -e DATABASE_URL=<url mtc_readonly> <conteneur> node /app/list-orphan-stripe-subscriptions.js
 *
 * Sortie : une ligne JSON par abonnement orphelin, puis un résumé.
 */
import Stripe from 'stripe';
import { Pool } from 'pg';

/** « En cours » au sens de la demande : actif, en essai, impayé (relances ou abandonnées). */
const STATUSES: Stripe.SubscriptionListParams.Status[] = ['active', 'trialing', 'past_due', 'unpaid'];

async function main() {
  const key = process.env['STRIPE_SECRET_KEY'];
  const databaseUrl = process.env['DATABASE_URL'];
  if (!key) throw new Error('STRIPE_SECRET_KEY manquante');
  if (!databaseUrl) throw new Error('DATABASE_URL manquante');
  const mode = /^(sk|rk)_live_/.test(key) ? 'live' : /^(sk|rk)_test_/.test(key) ? 'test' : 'inconnu';
  console.error(`Stripe : mode ${mode} · base : lecture seule`);

  const stripe = new Stripe(key, { apiVersion: '2024-06-20' as Stripe.LatestApiVersion });
  const pool = new Pool({ connectionString: databaseUrl, max: 1, options: '-c default_transaction_read_only=on' });

  try {
    const linked = new Set(
      (await pool.query<{ id: string }>('SELECT "stripeCustomerId" AS id FROM "User" WHERE "stripeCustomerId" IS NOT NULL'))
        .rows.map((r) => r.id),
    );
    const deleted = new Map<string, { deletedAt: Date; deletedBy: string; plan: string }>();
    for (const r of (await pool.query<{ email: string; deletedAt: Date; deletedBy: string; plan: string }>(
      'SELECT lower("email") AS email, "deletedAt", "deletedBy", "plan" FROM "DeletedAccount" WHERE "email" IS NOT NULL ORDER BY "deletedAt"',
    )).rows) deleted.set(r.email, r);

    let scanned = 0;
    let orphans = 0;
    let matched = 0;
    for (const status of STATUSES) {
      for await (const sub of stripe.subscriptions.list({ status, limit: 100, expand: ['data.customer'] })) {
        scanned++;
        const customer = sub.customer as Stripe.Customer | Stripe.DeletedCustomer;
        if (linked.has(customer.id)) continue;
        orphans++;
        const email = 'email' in customer && customer.email ? customer.email.toLowerCase() : null;
        const trace = email ? deleted.get(email) ?? null : null;
        if (trace) matched++;
        const item = sub.items.data[0];
        console.log(JSON.stringify({
          subscription: sub.id,
          status: sub.status,
          customer: customer.id,
          email,
          amount: item?.price?.unit_amount != null ? `${item.price.unit_amount / 100} ${item.price.currency}` : null,
          interval: item?.price?.recurring?.interval ?? null,
          currentPeriodEnd: item?.current_period_end ? new Date(item.current_period_end * 1000).toISOString() : null,
          deletedAccount: trace
            ? { deletedAt: trace.deletedAt.toISOString(), deletedBy: trace.deletedBy, plan: trace.plan }
            : null,
        }));
      }
    }
    console.error(
      `${scanned} abonnements en cours lus · ${orphans} sans compte MTC · dont ${matched} rapprochés de DeletedAccount ` +
        `(les autres : e-mail anonymisé après 90 j, ou client jamais relié à un compte)`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
