import { FOUNDER_REFUND_DAYS } from '@mtc/shared';
import type { CheckoutSummary } from '@app/core/api/billing.api';

/** Icône d'une garantie (rendue par la page avec @lucide/angular). */
export type AssuranceIcon = 'refund' | 'cancel' | 'secure' | 'trial';

export interface CheckoutCopy {
  eyebrow: string;
  title: string;
  lead: string;
  /** Prix récurrent de l'intervalle (€, sans décimales si entier). */
  price: string;
  per: string;
  /** Prix normal barré, absent sans remise. */
  was: string | null;
  note: string;
  assurances: { icon: AssuranceIcon; strong: string; text: string }[];
  /** Libellé et montant de la ligne « ensuite » du total. */
  thenLabel: string;
  thenAmount: string;
  /** Bouton de paiement (le montant du jour est ajouté par la page quand il y en a un). */
  cta: string;
  /** Fin de phrase de la mention légale : « … à {legal} jusqu'à résiliation ». */
  legal: string;
}

const eur = (n: number) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n);
const short = (n: number) => (Number.isInteger(n) ? `${n}` : n.toFixed(2).replace('.', ','));
const longDate = (d: Date) => d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });

const FOUNDER_LEAD =
  'Tout MyTradingCoach Premium, y compris les nouveautés à venir, à un prix qui ne bougera plus tant que tu restes abonné.';
const PREMIUM_LEAD = 'Le coach IA, les analyses avancées et les alertes prop firm, en plus de tout ce que tu as déjà en gratuit.';
const SECURE = { icon: 'secure', strong: 'Paiement sécurisé par Stripe.', text: 'Ta carte n’est jamais stockée chez nous.' } as const;

/**
 * Textes de la page de paiement selon l'offre (fondateur, code partenaire, Premium avec ou sans
 * essai, mensuel ou annuel). Une seule page pour tous les paiements ; seuls les textes changent.
 */
export function checkoutCopy(s: CheckoutSummary, now: Date = new Date()): CheckoutCopy {
  const yearly = s.interval === 'year';
  const per = yearly ? '/ an' : '/ mois';
  const perWord = yearly ? 'par an' : 'par mois';
  const discounted = s.recurringEur < s.normalEur;
  const trialEnd = longDate(new Date(now.getTime() + s.trialDays * 86_400_000));
  const monthlyEquivalent = yearly ? ` Soit ${eur(s.recurringEur / 12)} par mois.` : '';
  const cancel = (lost: string | null) => ({
    icon: 'cancel' as const,
    strong: 'Résiliable en un clic',
    text: lost ? `depuis ton profil. Si tu résilies, ${lost} est perdu.` : 'depuis ton profil, à tout moment.',
  });
  const trial = s.trialDays > 0
    ? { icon: 'trial' as const, strong: `Annule avant le ${trialEnd}`, text: 'et tu ne paies rien. On te prévient avant la fin de l’essai.' }
    : null;
  const then = s.trialDays > 0
    ? { thenLabel: `À partir du ${trialEnd}`, thenAmount: `${eur(s.recurringEur)} ${per}` }
    : { thenLabel: yearly ? 'Puis chaque année' : 'Puis chaque mois', thenAmount: eur(s.recurringEur) };
  const legalStart = s.trialDays > 0 ? ` à partir du ${trialEnd}` : '';

  if (s.offer === 'founder') {
    return {
      eyebrow: s.seatsLeft !== null ? `Offre fondateur · ${s.seatsLeft} place${s.seatsLeft > 1 ? 's' : ''} restante${s.seatsLeft > 1 ? 's' : ''}` : 'Offre fondateur',
      title: 'Premium, au prix fondateur',
      lead: FOUNDER_LEAD,
      price: short(s.recurringEur), per, was: `${short(s.normalEur)} €`,
      note: `Prix bloqué tant que ton abonnement reste actif.${monthlyEquivalent}`,
      assurances: [
        { icon: 'refund', strong: `Satisfait ou remboursé ${FOUNDER_REFUND_DAYS} jours`, text: 'sur le premier paiement, sans justification.' },
        cancel('le prix fondateur'),
        SECURE,
      ],
      ...then,
      cta: 'Devenir fondateur',
      legal: `prélever ${eur(s.recurringEur)} ${perWord}`,
    };
  }

  if (s.offer === 'partner') {
    const duration = s.partnerDurationMonths === null
      ? 'conservé tant que ton abonnement reste actif'
      : `pendant ${s.partnerDurationMonths} mois, puis ${eur(s.normalEur)} ${perWord}`;
    return {
      eyebrow: `Code partenaire ${s.partnerCode ?? ''}`.trim(),
      title: 'Premium, au tarif partenaire',
      lead: 'Ton code te donne tout Premium à un tarif réduit.',
      price: short(s.recurringEur), per, was: `${short(s.normalEur)} €`,
      note: s.trialDays > 0
        ? `${s.trialDays} jours offerts, puis tarif partenaire ${duration}.`
        : `Tarif partenaire ${duration}.${monthlyEquivalent}`,
      assurances: [...(trial ? [trial] : []), cancel('le tarif partenaire'), SECURE],
      ...then,
      cta: s.trialDays > 0 ? 'Commencer mon mois offert' : 'Passer à Premium',
      legal: `prélever ${eur(s.recurringEur)} ${perWord}${legalStart}`,
    };
  }

  const referral = s.referralDiscount ? ' −10 % la première année grâce à ton parrainage.' : '';
  return {
    eyebrow: s.trialDays > 0 ? 'Premium · 1 mois offert' : yearly ? 'Premium annuel · 2 mois offerts' : 'Premium',
    title: 'Passe à Premium',
    lead: PREMIUM_LEAD,
    price: short(s.recurringEur), per,
    was: yearly ? `${short(s.normalEur / 10 * 12)} €` : discounted ? `${short(s.normalEur)} €` : null,
    note: s.trialDays > 0
      ? `${s.trialDays} jours offerts. Aucun prélèvement avant le ${trialEnd}.${referral}`
      : yearly ? `Soit ${eur(s.recurringEur / 12)} par mois, 10 mois payés pour 12.${referral}` : `Sans engagement.${referral}`,
    assurances: [...(trial ? [trial] : []), cancel(null), SECURE],
    ...then,
    cta: s.trialDays > 0 ? 'Commencer mon mois offert' : 'Passer à Premium',
    legal: `prélever ${eur(s.recurringEur)} ${perWord}${legalStart}`,
  };
}
