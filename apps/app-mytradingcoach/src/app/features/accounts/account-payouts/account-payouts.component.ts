import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ConfirmService } from '@mtc/front-ui';
import { formatMoney } from '@mtc/shared';
import { AccountPayout, AccountsApi } from '@app/core/api/accounts.api';
import { ToastService } from '@app/core/services/toast.service';
import { apiErrorMessage } from '@app/core/utils/api-error';

/** Date du jour au format d'un champ date (`AAAA-MM-JJ`), dans le fuseau du navigateur. */
export function todayInput(now = new Date()): string {
  return now.toLocaleDateString('fr-CA');
}

/**
 * Payouts d'un compte funded, au dépli de sa ligne dans Mes comptes. Compte connecté au broker :
 * liste des payouts détectés, rien à saisir. Compte sans connexion : saisie d'un payout (date et
 * montant), retiré du solde, des courbes et de la marge ; un payout saisi se supprime.
 * Émet `changed` après un ajout ou une suppression : le parent recharge les comptes.
 */
@Component({
  selector: 'mtc-account-payouts',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './account-payouts.component.html',
  styleUrl: './account-payouts.component.css',
})
export class AccountPayoutsComponent implements OnInit {
  readonly accountId = input.required<string>();
  readonly currency = input<string>('USD');
  /** Compte connecté au broker : payouts détectés, saisie masquée. */
  readonly connected = input(false);
  readonly changed = output<void>();

  private readonly api = inject(AccountsApi);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly payouts = signal<AccountPayout[] | null>(null);
  protected readonly loadError = signal(false);
  protected readonly saving = signal(false);
  protected readonly date = signal(todayInput());
  protected readonly amount = signal<number | null>(null);
  protected readonly today = todayInput();

  ngOnInit(): void {
    this.load();
  }

  protected load(): void {
    this.loadError.set(false);
    this.api
      .listPayouts(this.accountId())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => this.payouts.set(res.data ?? []),
        error: () => this.loadError.set(true),
      });
  }

  protected money(v: number): string {
    return formatMoney(v, this.currency(), { decimals: 2, sign: false });
  }

  /** `2026-10-05` → « 05/10/2026 » (date de séance, sans fuseau). */
  protected day(d: string): string {
    return `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
  }

  protected canSubmit(): boolean {
    const a = this.amount();
    return !this.saving() && !!this.date() && this.date() <= this.today && a != null && a > 0;
  }

  protected onAmount(e: Event): void {
    const v = (e.target as HTMLInputElement).value;
    this.amount.set(v === '' ? null : Number(v));
  }

  protected onDate(e: Event): void {
    this.date.set((e.target as HTMLInputElement).value);
  }

  protected add(): void {
    if (!this.canSubmit()) return;
    this.saving.set(true);
    this.api
      .addPayout(this.accountId(), { tradeDate: this.date(), amount: this.amount()! })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.saving.set(false);
          this.amount.set(null);
          this.toast.success(`Payout de ${this.money(res.data.amount)} enregistré.`);
          this.load();
          this.changed.emit();
        },
        error: (err) => {
          this.saving.set(false);
          this.toast.error(apiErrorMessage(err, "Le payout n'a pas pu être enregistré."));
        },
      });
  }

  protected async remove(p: AccountPayout): Promise<void> {
    const ok = await this.confirm.ask({
      title: 'Supprimer ce payout ?',
      message: `Le payout de ${this.money(p.amount)} du ${this.day(p.tradeDate)} ne sera plus retiré du solde du compte.`,
      confirmLabel: 'Supprimer',
      danger: true,
    });
    if (!ok) return;
    this.api
      .removePayout(this.accountId(), p.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.afterRemove(),
        // Déjà supprimé : c'est le but recherché (cf. angular.md).
        error: (err) => (err?.status === 404 ? this.afterRemove() : this.toast.error(apiErrorMessage(err, "Le payout n'a pas pu être supprimé."))),
      });
  }

  private afterRemove(): void {
    this.toast.success('Payout supprimé.');
    this.load();
    this.changed.emit();
  }
}
