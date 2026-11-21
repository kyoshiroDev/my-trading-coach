import type { Plan } from './enums';

/** Programme ambassadeur : formes JSON des statistiques (API, app trader, admin) (#1073). */

/** Filleul tel que le voit l'ambassadeur (S2 #1063) : pseudo masqué, ni id, ni nom, ni e-mail. */
export interface AmbassadorReferral {
  pseudo: string;
  plan: Plan;
  createdAt: string;
  isActive: boolean;
  /** 20 % du montant mensuel réellement payé (fondateur, annuel ÷ 12, code partenaire) ; 0 sans abonnement actif. */
  monthlyCommission: number;
  /** Abonnement Premium `active` : « Payant » (un essai ou une pause n'en est pas un). */
  paying: boolean;
}

/** Filleul vu par l'admin (fiche ambassadeur) : identité en plus. */
export interface AdminAmbassadorReferral extends AmbassadorReferral {
  id: string;
  name: string | null;
  email: string;
}

/**
 * Statistiques d'un ambassadeur : `GET /ambassador/stats` (filleuls masqués) et
 * `GET /admin/ambassadors/:id/stats` (`AdminAmbassadorStats`, filleuls identifiés).
 */
export interface AmbassadorStats<R extends AmbassadorReferral = AmbassadorReferral> {
  referralCode: string;
  referrals: R[];
  total: number;
  free: number;
  premium: number;
  /** Commissions par période `AAAA-MM` (hors annulées). */
  earningsByMonth: Record<string, number>;
  totalEarned: number;
  pendingPayout: number;
}

export type AdminAmbassadorStats = AmbassadorStats<AdminAmbassadorReferral>;
