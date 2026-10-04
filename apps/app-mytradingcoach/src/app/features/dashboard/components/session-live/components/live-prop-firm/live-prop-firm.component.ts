import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { LucideDynamicIcon, LucideShieldCheck as ShieldCheck } from '@lucide/angular';
import { catchError, of } from 'rxjs';
import { formatMoney } from '@mtc/shared';
import { TradovateApi } from '@app/core/api/tradovate.api';
import { SelectedAccountStore } from '@app/core/stores/selected-account.store';
import { TradovateStore } from '@app/core/stores/tradovate.store';
import { UserStore } from '@app/core/stores/user.store';
import { TradovateLiveSocketService } from '@app/core/services/tradovate-live-socket.service';
import { relativeTime } from '@app/core/utils/tradovate-return.util';
import { progressTitle } from '@app/features/accounts/account-progress.util';
import { barWidth, drawdownTone, objectiveRatio } from './live-prop-firm.util';

/**
 * Suivi prop firm de la session live (FREE) : à la place de « Trade rapide » quand le compte de
 * la session est synchronisé, ses trades arrivent seuls. Solde et equity lus chez le broker,
 * marge avant le plancher et avancement vers l'objectif, calculés par l'API avec les règles
 * officielles du plan relié. Le temps réel vient du WebSocket Tradovate (`tradovate:balance`
 * → rechargement des comptes) : ce panneau ne fait qu'une relecture du solde à l'ouverture.
 */
@Component({
  selector: 'mtc-live-prop-firm',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LucideDynamicIcon, RouterLink],
  templateUrl: './live-prop-firm.component.html',
  styleUrl: './live-prop-firm.component.css',
})
export class LivePropFirmComponent {
  readonly accountId = input.required<string>();
  /** « Saisir un trade à la main » : le parent réaffiche Trade rapide. */
  readonly manualEntry = output<void>();

  private readonly accounts = inject(SelectedAccountStore);
  private readonly tv = inject(TradovateStore);
  private readonly tradovateApi = inject(TradovateApi);
  private readonly userStore = inject(UserStore);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly live = inject(TradovateLiveSocketService);

  protected readonly ShieldIcon = ShieldCheck;

  protected readonly account = computed(
    () => this.accounts.accounts().find((a) => a.id === this.accountId()) ?? null,
  );
  protected readonly metrics = computed(() => this.account()?.metrics ?? null);
  protected readonly broker = computed(() => this.metrics()?.broker ?? null);
  protected readonly drawdown = computed(() => this.metrics()?.drawdown ?? null);
  protected readonly rule = computed(() => this.drawdown()?.rule ?? null);

  protected readonly ddTone = computed(() => drawdownTone(this.drawdown()));
  protected readonly ddWidth = computed(() => barWidth(this.drawdown()?.pct));

  protected readonly objRatio = computed(() => {
    const m = this.metrics();
    return m ? objectiveRatio(m) : null;
  });
  protected readonly objWidth = computed(() => barWidth(this.objRatio()));
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

  /** Montant dans la devise du compte, sans conversion. */
  protected money(value: number | null | undefined, sign = false): string {
    return formatMoney(value ?? 0, this.account()?.currency ?? null, { decimals: 0, sign });
  }

  protected ddKindLabel(kind: string): string {
    switch (kind) {
      case 'trailing_eod': return 'trailing fin de journée';
      case 'trailing_intraday': return 'trailing intraday';
      default: return 'statique';
    }
  }
}
