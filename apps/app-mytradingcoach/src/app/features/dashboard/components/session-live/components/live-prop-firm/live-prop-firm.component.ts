import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import {
  LucideBell as Bell,
  LucideBellOff as BellOff,
  LucideDynamicIcon,
  LucideShieldCheck as ShieldCheck,
} from '@lucide/angular';
import { catchError, of } from 'rxjs';
import { formatMoney, needsPlanLink } from '@mtc/shared';
import { TradovateApi } from '@app/core/api/tradovate.api';
import { SelectedAccountStore } from '@app/core/stores/selected-account.store';
import { TradovateStore } from '@app/core/stores/tradovate.store';
import { UserStore } from '@app/core/stores/user.store';
import { TradovateLiveSocketService } from '@app/core/services/tradovate-live-socket.service';
import { PropAlertsService } from '@app/core/services/prop-alerts.service';
import { AlertSoundService } from '@app/core/services/alert-sound.service';
import { PlanModalComponent } from '@app/shared/components/plan-modal/plan-modal.component';
import { relativeTime } from '@app/core/utils/tradovate-return.util';
import { progressTitle } from '@app/features/accounts/account-progress.util';
import { AccountPlanWizardComponent } from '@app/features/accounts/account-plan-wizard/account-plan-wizard.component';
import { barWidth, drawdownTone, missedAlert, missedAlertPct, objectiveRatio } from './live-prop-firm.util';

/**
 * Suivi prop firm de la session live (FREE) : à la place de « Trade rapide » quand le compte de
 * la session est synchronisé, ses trades arrivent seuls. Session live v3 : equity sur une ligne,
 * puis trois jauges, le risque avant le gain (perte du jour → marge plancher → objectif).
 * Solde et equity lus chez le broker, marge avant le plancher et avancement vers l'objectif,
 * calculés par l'API avec les règles officielles du plan relié. Le temps réel vient du WebSocket Tradovate (`tradovate:balance`
 * → rechargement des comptes) : ce panneau ne fait qu'une relecture du solde à l'ouverture.
 */
@Component({
  selector: 'mtc-live-prop-firm',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LucideDynamicIcon, RouterLink, PlanModalComponent, AccountPlanWizardComponent],
  templateUrl: './live-prop-firm.component.html',
  styleUrl: './live-prop-firm.component.css',
})
export class LivePropFirmComponent {
  readonly accountId = input.required<string>();
  /** P&L réalisé de la session (trades clôturés, frais déduits), affiché sous l'equity en PC. */
  readonly realized = input<number | null>(null);
  /** Séance en cours : l'encart « tu aurais été alerté » ne revient qu'une fois par seuil et par séance. */
  readonly sessionId = input<string | null>(null);

  private readonly accounts = inject(SelectedAccountStore);
  private readonly tv = inject(TradovateStore);
  private readonly tradovateApi = inject(TradovateApi);
  protected readonly userStore = inject(UserStore);
  protected readonly alerts = inject(PropAlertsService);
  protected readonly sound = inject(AlertSoundService);
  protected readonly showPlanModal = signal(false);
  /** « Quel est ce compte ? » ouvert depuis l'appel à l'action (compte sans plan, #612). */
  protected readonly planWizardOpen = signal(false);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly live = inject(TradovateLiveSocketService);

  protected readonly ShieldIcon = ShieldCheck;
  protected readonly BellIcon = Bell;
  protected readonly BellOffIcon = BellOff;

  protected readonly account = computed(
    () => this.accounts.accounts().find((a) => a.id === this.accountId()) ?? null,
  );
  protected readonly metrics = computed(() => this.account()?.metrics ?? null);
  /** Compte prop firm sans plan, ou laissé à « Plus tard » : l'appel à l'action remplace les jauges. */
  protected readonly needsPlan = computed(() => {
    const a = this.account();
    return !!a && needsPlanLink(a);
  });
  protected readonly broker = computed(() => this.metrics()?.broker ?? null);
  protected readonly drawdown = computed(() => this.metrics()?.drawdown ?? null);
  protected readonly rule = computed(() => this.drawdown()?.rule ?? null);

  protected readonly ddTone = computed(() => drawdownTone(this.drawdown()));

  /** Perte journalière (PREMIUM) : l'API ne la calcule que pour un compte Premium. */
  protected readonly dailyLoss = computed(() => this.metrics()?.dailyLoss ?? null);
  protected readonly dlTone = computed(() => drawdownTone(this.dailyLoss()));
  /** Barre de la perte du jour = part CONSOMMÉE de la limite (pct = marge restante). */
  protected readonly dlWidth = computed(() => {
    const dl = this.dailyLoss();
    return dl ? barWidth(dl.breached ? 1 : 1 - dl.pct) : 0;
  });
  /** Consistency du plan, avec le gain max du jour (calculé par l'API pour le Premium seulement). */
  protected readonly consistency = computed(() => {
    const r = this.metrics()?.progress?.requirements.find((x) => x.key === 'consistency');
    return r && r.dayCap != null && r.todayPnl != null ? { cap: r.dayCap, today: r.todayPnl, maxShare: r.required } : null;
  });
  /** Plan relié et compte gratuit : la couche Premium (perte journalière + alertes) en teaser. */
  protected readonly premiumTeaser = computed(() => !this.userStore.isPremium() && !!this.account()?.propFirmPlanId);
  protected readonly ddWidth = computed(() => barWidth(this.drawdown()?.pct));

  // ── Encart du gratuit « avec Premium, tu aurais été alerté » (#769, B4) ──
  // Mêmes seuils que les alertes Premium, sur la marge avant le plancher (la perte du jour n'est
  // calculée que pour le Premium). Aucune alerte n'est envoyée : un texte discret, jamais bloquant.
  /** Plus haut seuil atteint pendant la séance et plus haut seuil déjà fermé (rangs 0, 1, 2). */
  private readonly missed = signal({ reached: 0, closed: 0 });
  private readonly missedEligible = computed(
    () => !this.userStore.isPremium() && !this.userStore.isDemo() && !!this.account()?.propFirmPlanId && !this.needsPlan(),
  );
  /** Seuil (en %) à afficher, ou `null` : rien de nouveau depuis la dernière fermeture. */
  protected readonly missedBanner = computed(() => {
    const m = this.missed();
    return this.missedEligible() && m.reached > m.closed ? missedAlertPct(m.reached) : null;
  });

  protected closeMissed(): void {
    this.missed.update((m) => ({ ...m, closed: m.reached }));
    this.saveMissed();
  }

  private missedKey(): string | null {
    const id = this.sessionId();
    return id ? `mtc_missed_alert:${id}` : null;
  }

  private loadMissed(): void {
    const key = this.missedKey();
    if (!key) return;
    try {
      const raw = JSON.parse(localStorage.getItem(key) ?? 'null') as { reached?: number; closed?: number } | null;
      if (raw) this.missed.set({ reached: Number(raw.reached) || 0, closed: Number(raw.closed) || 0 });
    } catch {
      /* stockage indisponible : l'encart vit le temps de la page */
    }
  }

  private saveMissed(): void {
    const key = this.missedKey();
    if (!key) return;
    try {
      localStorage.setItem(key, JSON.stringify(this.missed()));
    } catch {
      /* stockage indisponible */
    }
  }

  protected readonly objRatio = computed(() => {
    const m = this.metrics();
    return m ? objectiveRatio(m) : null;
  });
  protected readonly objWidth = computed(() => barWidth(this.objRatio()));
  /** « +$730 / $3,000 » : exigence de profit du plan, sinon objectif saisi ; null si inconnu. */
  protected readonly objAmounts = computed(() => {
    const m = this.metrics();
    const req = m?.progress?.requirements.find((r) => r.key === 'profit' || r.key === 'cycle_profit');
    if (req && req.required > 0) return { current: req.current, target: req.required };
    return m?.objective ? { current: m.objective.current, target: m.objective.target } : null;
  });
  /** Equity en direct (solde + latent chez le broker), sinon solde estimé. */
  protected readonly equity = computed(() => this.broker()?.equity ?? this.metrics()?.currentBalance ?? null);
  protected readonly objTitle = computed(() => {
    const a = this.account();
    const m = this.metrics();
    if (!a || !m) return null;
    if (m.progress) return progressTitle(m.progress, a.currency);
    if (!m.objective) return null;
    return m.objective.pct >= 1
      ? 'Objectif atteint'
      : `Objectif : ${this.money(m.objective.current)} / ${this.money(m.objective.target)}`;
  });

  /** Relevé broker le plus récent (equity ou solde), « il y a 2 min ». */
  protected readonly brokerAge = computed(() => {
    const b = this.broker();
    if (!b) return null;
    const at = [b.equityAt, b.balanceAt].filter((x): x is string => !!x).sort().at(-1) ?? null;
    return at ? relativeTime(at) : null;
  });

  private refreshed = false;

  constructor() {
    // Encart du gratuit (#769, B4) : état de la séance relu, puis tout nouveau seuil franchi est retenu.
    effect(() => {
      this.sessionId();
      untracked(() => this.loadMissed());
    });
    effect(() => {
      const hit = this.missedEligible() ? missedAlert(this.drawdown()) : null;
      untracked(() => {
        if (!hit || hit.rank <= this.missed().reached) return;
        this.missed.update((m) => ({ ...m, reached: hit.rank }));
        this.saveMissed();
      });
    });
    // Connexions Tradovate pas encore chargées (on arrive directement sur la session).
    if (!this.tv.loaded()) this.tv.load();
    // Une relecture du solde à l'ouverture, pour ne pas afficher un relevé d'hier en attendant
    // le premier événement du WebSocket. Le serveur bride en plus à 20 s par compte.
    effect(() => {
      const id = this.accountId();
      if (this.refreshed || this.userStore.isDemo()) return;
      this.refreshed = true;
      untracked(() =>
        this.tradovateApi
          .refreshBalance(id)
          .pipe(catchError(() => of(null)), takeUntilDestroyed(this.destroyRef))
          .subscribe(() => this.accounts.load()),
      );
    });
  }

  /** Plan relié (ou réponse enregistrée) : les comptes repartent du serveur, les jauges suivent. */
  protected onPlanLinked(): void {
    this.planWizardOpen.set(false);
    this.accounts.load();
  }

  /** Montant dans la devise du compte, sans conversion. */
  protected money(value: number | null | undefined, sign = false): string {
    return formatMoney(value ?? 0, this.account()?.currency ?? null, { decimals: 0, sign });
  }

  protected pct(v: number): string {
    return `${Math.round(v * 100)} %`;
  }

  protected ddKindLabel(kind: string): string {
    switch (kind) {
      case 'trailing_eod': return 'trailing fin de journée';
      case 'trailing_intraday': return 'trailing intraday';
      default: return 'statique';
    }
  }
}
