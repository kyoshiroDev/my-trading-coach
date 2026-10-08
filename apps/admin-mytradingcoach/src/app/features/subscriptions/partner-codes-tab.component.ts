import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, of } from 'rxjs';
import {
  AdminApi,
  type AdminPartnerCode,
  type AdminPartnerCodeUsers,
  type PartnerCodeInput,
} from '../../core/api/admin.api';
import { PRICING_EUR } from '../../core/constants/pricing.const';
import { annualDurationHelp, partnerPreview, usageLabel } from '../../core/utils/offers.util';

const CODE_PATTERN = /^[A-Z0-9_-]{3,20}$/;

/**
 * Onglet « Codes partenaires » (#525) : création et modification (aperçu en une phrase avant
 * validation), liste avec « utilisés / max », activation, abonnés par code. Les coupons Stripe
 * sont créés par l'API ; modifier un code ne change rien pour ceux qui l'ont déjà.
 */
@Component({
  selector: 'mtc-admin-partner-codes-tab',
  imports: [DatePipe, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './offers-tabs.css',
  templateUrl: './partner-codes-tab.component.html',
})
export class PartnerCodesTabComponent {
  private readonly adminApi = inject(AdminApi);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly PREMIUM = PRICING_EUR.PREMIUM;
  protected readonly usageLabel = usageLabel;

  protected readonly codes = signal<AdminPartnerCode[] | null>(null);
  protected readonly loadError = signal(false);

  // ── Formulaire (création, ou modification si `editingId`) ──
  protected readonly editingId = signal<string | null>(null);
  protected readonly code = signal('');
  protected readonly label = signal('');
  protected readonly priceMonthly = signal<number | null>(29);
  protected readonly priceAnnual = signal<number | null>(290);
  protected readonly lifetime = signal(true);
  protected readonly months = signal<number | null>(3);
  protected readonly unlimited = signal(false);
  protected readonly maxPeople = signal<number | null>(10);
  protected readonly expiresAt = signal('');
  protected readonly saving = signal(false);
  protected readonly formError = signal<string | null>(null);
  protected readonly formOk = signal<string | null>(null);

  protected readonly durationMonths = computed(() => (this.lifetime() ? null : this.months()));
  protected readonly maxRedemptions = computed(() => (this.unlimited() ? null : this.maxPeople()));
  protected readonly preview = computed(() =>
    partnerPreview({
      priceMonthlyEur: this.priceMonthly(),
      priceAnnualEur: this.priceAnnual(),
      durationMonths: this.durationMonths(),
      maxRedemptions: this.maxRedemptions(),
      expiresAt: this.expiresAt(),
    }),
  );
  protected readonly durationHelp = computed(() => annualDurationHelp(this.durationMonths()));
  /** Raison du blocage du formulaire, ou null s'il est valide. */
  protected readonly invalid = computed<string | null>(() => {
    if (!this.editingId() && !CODE_PATTERN.test(this.code().trim().toUpperCase())) {
      return 'Code : 3 à 20 caractères, lettres, chiffres, tiret ou souligné.';
    }
    if (!this.label().trim()) return 'Libellé requis (nom du partenaire, visible seulement ici).';
    const m = this.priceMonthly();
    const y = this.priceAnnual();
    if (!m || m < 1 || m >= this.PREMIUM.monthly || !Number.isInteger(m)) return `Prix mensuel : entier entre 1 et ${this.PREMIUM.monthly - 1} €.`;
    if (!y || y < 1 || y >= this.PREMIUM.annual || !Number.isInteger(y)) return `Prix annuel : entier entre 1 et ${this.PREMIUM.annual - 1} €.`;
    if (!this.lifetime() && !(this.months() && this.months()! >= 1)) return 'Durée : « À vie » ou un nombre de mois ≥ 1.';
    if (!this.unlimited() && !(this.maxPeople() && this.maxPeople()! >= 1)) return 'Personnes : « Illimité » ou un nombre ≥ 1.';
    return null;
  });

  // ── Abonnés d'un code ──
  protected readonly openUsersId = signal<string | null>(null);
  protected readonly users = signal<AdminPartnerCodeUsers | null>(null);

  constructor() {
    this.load();
  }

  protected load(): void {
    this.adminApi
      .partnerCodes()
      .pipe(catchError(() => of(null)), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => {
        this.loadError.set(!r);
        if (r) this.codes.set(r.data);
      });
  }

  protected num(v: string): number | null {
    const n = Number(v);
    return v.trim() === '' || Number.isNaN(n) ? null : n;
  }

  protected edit(c: AdminPartnerCode): void {
    this.editingId.set(c.id);
    this.code.set(c.code);
    this.label.set(c.label);
    this.priceMonthly.set(c.priceMonthlyEur);
    this.priceAnnual.set(c.priceAnnualEur);
    this.lifetime.set(c.durationMonths === null);
    this.months.set(c.durationMonths ?? 3);
    this.unlimited.set(c.maxRedemptions === null);
    this.maxPeople.set(c.maxRedemptions ?? 10);
    this.expiresAt.set(c.expiresAt ? c.expiresAt.slice(0, 10) : '');
    this.formError.set(null);
    this.formOk.set(null);
  }

  protected resetForm(): void {
    this.editingId.set(null);
    this.code.set('');
    this.label.set('');
    this.priceMonthly.set(29);
    this.priceAnnual.set(290);
    this.lifetime.set(true);
    this.months.set(3);
    this.unlimited.set(false);
    this.maxPeople.set(10);
    this.expiresAt.set('');
    this.formError.set(null);
  }

  protected submit(): void {
    if (this.invalid() || this.saving()) return;
    const body: Omit<PartnerCodeInput, 'code'> = {
      label: this.label().trim(),
      priceMonthlyEur: this.priceMonthly()!,
      priceAnnualEur: this.priceAnnual()!,
      durationMonths: this.durationMonths(),
      maxRedemptions: this.maxRedemptions(),
      expiresAt: this.expiresAt() ? new Date(`${this.expiresAt()}T23:59:59`).toISOString() : null,
    };
    const id = this.editingId();
    const request = id
      ? this.adminApi.updatePartnerCode(id, body)
      : this.adminApi.createPartnerCode({ ...body, code: this.code().trim().toUpperCase() });
    this.saving.set(true);
    this.formError.set(null);
    request.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.saving.set(false);
        this.formOk.set(id ? 'Code modifié (sans effet sur les abonnés existants).' : 'Code créé, coupons Stripe prêts.');
        this.resetForm();
        this.load();
      },
      error: (err: { error?: { message?: string | string[] } }) => {
        this.saving.set(false);
        const m = err?.error?.message;
        this.formError.set((Array.isArray(m) ? m[0] : m) ?? "L'enregistrement a échoué. Réessaie.");
      },
    });
  }

  protected toggleActive(c: AdminPartnerCode): void {
    this.adminApi
      .updatePartnerCode(c.id, { active: !c.active })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: () => this.load(), error: () => this.formError.set('Activation impossible. Réessaie.') });
  }

  protected toggleUsers(c: AdminPartnerCode): void {
    if (this.openUsersId() === c.id) {
      this.openUsersId.set(null);
      return;
    }
    this.openUsersId.set(c.id);
    this.users.set(null);
    this.adminApi
      .partnerCodeUsers(c.id)
      .pipe(catchError(() => of(null)), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => this.users.set(r?.data ?? null));
  }
}
