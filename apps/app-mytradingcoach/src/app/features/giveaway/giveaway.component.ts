import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideDynamicIcon, LucideGift as Gift, LucideTrophy as Trophy, LucideCircleCheck as CircleCheck } from '@lucide/angular';
import { ErrorStateComponent } from '@mtc/front-ui';
import {
  GIVEAWAY_DRAW_HOUR,
  GIVEAWAY_MIN_ACCOUNT_AGE_DAYS,
  GIVEAWAY_PREMIUM_MIN_PAID_INVOICES,
  GIVEAWAY_PREMIUM_MIN_PAID_MONTHS,
  GIVEAWAY_WIN_COOLDOWN_MONTHS,
  giveawayDrawDayLabel, type GiveawayAppState, type GiveawayMyReason } from '@mtc/shared';
import { GiveawayStateService } from '../../core/services/giveaway-state.service';
import { environment } from '@app/environments/environment';

const MINUTE = 60_000;

/** « 1er décembre » : jour du tirage et mois Paris de la date donnée. */
export function drawDayLabel(iso: string): string {
  const month = new Date(iso).toLocaleDateString('fr-FR', { month: 'long', timeZone: 'Europe/Paris' });
  return `${giveawayDrawDayLabel()}\u00a0${month}`;
}

/** Date longue Paris avec « 1er » : « 1er mars 2027 », « 15 mars 2027 ». */
export function longDateLabel(iso: string): string {
  const d = new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' });
  return /^1\s/.test(d) ? `1er\u00a0${d.slice(2)}` : d;
}

/** « février 2027 » pour la période « 2027-02 ». */
export function periodLabel(period: string): string {
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** Compte à rebours lisible : « 12 j 4 h », « 3 h 20 min », « moins d'une minute ». */
export function countdownLabel(targetIso: string, now: number): string {
  const ms = Math.max(0, new Date(targetIso).getTime() - now);
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / MINUTE);
  if (days > 0) return `${days}\u00a0j ${hours}\u00a0h`;
  if (hours > 0) return `${hours}\u00a0h ${minutes}\u00a0min`;
  return minutes > 0 ? `${minutes}\u00a0min` : 'moins d’une minute';
}

/**
 * Page « Concours du mois » (PROMPT-tirage-mensuel, lot B) : lots, compte à rebours, statut de
 * l'utilisateur (progression vers les trades requis), compteurs réels, gagnants (nom selon l'accord,
 * message seulement validé), conditions et lien vers le règlement.
 */
@Component({
  selector: 'mtc-giveaway',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ErrorStateComponent, RouterLink, LucideDynamicIcon],
  styleUrl: './giveaway.component.css',
  templateUrl: './giveaway.component.html',
})
export class GiveawayComponent {
  private readonly store = inject(GiveawayStateService);
  protected readonly GiftIcon = Gift;
  protected readonly TrophyIcon = Trophy;
  protected readonly CheckIcon = CircleCheck;
  protected readonly rulesUrl = `${environment.landingUrl}/reglement-tirage`;
  protected readonly drawHour = GIVEAWAY_DRAW_HOUR;
  protected readonly minAccountDays = GIVEAWAY_MIN_ACCOUNT_AGE_DAYS;
  protected readonly premiumMonths = GIVEAWAY_PREMIUM_MIN_PAID_MONTHS;
  protected readonly premiumInvoices = GIVEAWAY_PREMIUM_MIN_PAID_INVOICES;
  protected readonly cooldownMonths = GIVEAWAY_WIN_COOLDOWN_MONTHS;
  protected readonly periodLabel = periodLabel;

  protected readonly state = this.store.state;
  protected readonly loadError = this.store.loadError;
  private readonly now = signal(Date.now());

  protected readonly nextDrawLabel = computed(() => {
    const s = this.state();
    return s ? drawDayLabel(s.nextDrawAt) : '';
  });
  protected readonly countdown = computed(() => {
    const s = this.state();
    return s ? countdownLabel(s.nextDrawAt, this.now()) : '';
  });
  /** Progression vers les trades requis (0-100). */
  protected readonly progress = computed(() => {
    const s = this.state();
    if (!s) return 0;
    return Math.min(100, Math.round((s.me.tradesThisMonth / s.minTrades) * 100));
  });
  protected readonly tradesLeft = computed(() => {
    const s = this.state();
    return s ? Math.max(0, s.minTrades - s.me.tradesThisMonth) : 0;
  });
  protected readonly hasWinners = computed(() => {
    const s = this.state();
    return !!s && s.winnersFree + s.winnersPremium > 0;
  });

  constructor() {
    // Rechargé à chaque ouverture : la progression suit les trades saisis depuis la connexion.
    this.store.load();
    // Horloge locale du compte à rebours (aucun appel à l'API).
    const timer = setInterval(() => this.now.set(Date.now()), MINUTE);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  protected reload(): void {
    this.store.load();
  }

  /** Phrase honnête selon la situation de l'utilisateur. */
  protected statusText(s: GiveawayAppState): string {
    const next = drawDayLabel(s.nextDrawAt);
    const left = Math.max(0, s.minTrades - s.me.tradesThisMonth);
    const reasons: Record<GiveawayMyReason, string> = {
      in: `Tu es dans le tirage du ${next}.`,
      need_trades: `Encore ${left}\u00a0trade${left > 1 ? 's' : ''} pour participer au tirage du ${next}.`,
      premium_too_recent: `Tu participeras au tirage Premium dès ta ${GIVEAWAY_PREMIUM_MIN_PAID_INVOICES}e\u00a0échéance payée (abonnement annuel\u00a0: ${GIVEAWAY_PREMIUM_MIN_PAID_MONTHS}\u00a0mois après le paiement).`,
      account_too_recent: `Ton compte pourra participer quand il aura plus de ${GIVEAWAY_MIN_ACCOUNT_AGE_DAYS}\u00a0jours.`,
      recent_winner: 'Tu as gagné récemment\u00a0: tu pourras rejouer dans quelques mois.',
      cancel_scheduled: 'Ton abonnement se termine bientôt\u00a0: le tirage Premium est réservé aux abonnements qui continuent.',
      pool_off: s.me.pool === 'PREMIUM'
        ? 'Le tirage Premium n’est pas ouvert pour le moment.'
        : 'Le tirage des comptes gratuits n’est pas ouvert pour le moment.',
      not_eligible: 'Ton compte ne participe pas au tirage.',
    };
    return reasons[s.me.reason];
  }
}
