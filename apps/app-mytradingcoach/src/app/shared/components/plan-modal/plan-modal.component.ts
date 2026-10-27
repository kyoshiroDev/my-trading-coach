import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  OnInit,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, debounceTime, distinctUntilChanged, switchMap, of, catchError, map } from 'rxjs';
import {
  LucideDynamicIcon,
  LucideCheck as Check,
  LucideX as X,
  LucideZap as Zap,
} from '@lucide/angular';
import { PRICING } from '@app/core/constants/pricing.const';
import { ProductEventsService } from '@app/core/services/product-events.service';
import { BillingService } from '@app/core/services/billing.service';
import { OfferIntentService, type OfferIntent } from '@app/core/services/offer-intent.service';
import { BillingApi, type CheckoutPlan, type PartnerValidation } from '@app/core/api/billing.api';
import { OffersStore } from '@app/core/stores/offers.store';
import { UserStore } from '@app/core/stores/user.store';
import { DialogDirective, ErrorStateComponent } from '@mtc/front-ui';
import { FOUNDER_INELIGIBLE_MESSAGES, PLAN_BENEFITS, founderSeatsLabel, type FounderIneligibility } from '@mtc/shared';

type Interval = 'monthly' | 'yearly';
/** Offre choisie : jamais deux à la fois (fondateur, code partenaire ou prix normal). */
export type OfferChoice = 'founder' | 'partner' | 'premium';

const CODE_PATTERN = /^[A-Z0-9_-]{3,20}$/;

/** « à vie » · « pendant 3 mois, puis 49 €/mois » (ou /an). */
export function partnerDurationLabel(durationMonths: number | null, interval: Interval): string {
  if (durationMonths === null) return 'à vie';
  const normal = interval === 'yearly' ? `${PRICING.premium.yearly} €/an` : `${PRICING.premium.monthly} €/mois`;
  return `pendant ${durationMonths} mois, puis ${normal}`;
}

@Component({
  selector: 'mtc-plan-modal',
  imports: [DialogDirective, LucideDynamicIcon, ErrorStateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './plan-modal.component.html',
  styleUrl: './plan-modal.component.css',
})
export class PlanModalComponent implements OnInit {
  closed = output<void>();
  /** Point de clic (#525) : `modale` par défaut, `cadenas`, `profil`, ou celui du lien d'arrivée. */
  readonly cta = input<string>('modale');
  /** Offre visée par le lien d'arrivée (plan=founder, promo=CODE) : présélectionnée. */
  readonly preset = input<OfferIntent | null>(null);

  protected readonly PRICING = PRICING;
  /** Avantages Premium : liste partagée avec la landing et les e-mails (`@mtc/shared`). */
  protected readonly premiumBenefits = PLAN_BENEFITS.premium;

  // Icônes lucide, comme partout ailleurs dans l'app : les glyphes texte (✕ ⚡ ✓) ne
  // suivaient ni la graisse ni l'alignement du reste de l'interface.
  protected readonly XIcon = X;
  protected readonly ZapIcon = Zap;
  protected readonly CheckIcon = Check;

  // L'essai 30j n'est accordé qu'au mensuel au prix normal ou avec un code partenaire ;
  // l'annuel et le fondateur sont facturés immédiatement.
  protected interval = signal<Interval>('monthly');
  private readonly billing = inject(BillingService);
  private readonly billingApi = inject(BillingApi);
  private readonly events = inject(ProductEventsService);
  private readonly intent = inject(OfferIntentService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly offersStore = inject(OffersStore);

  /** La page de paiement prend le relais aussitôt (navigation) : pas d'attente dans la modale. */
  protected readonly isLoading = signal(false);
  /** Essai déjà consommé (ou Premium offert reçu) : le checkout facture tout de suite, ne rien promettre. */
  private readonly userStore = inject(UserStore);
  protected readonly trialAvailable = this.userStore.trialAvailable;
  /**
   * Essai d'inscription en cours (#769) : date de fin (JJ/MM), sinon `null`. S'abonner maintenant
   * facture tout de suite : la modale le dit au lieu de promettre un essai.
   */
  protected readonly signupTrialEnd = computed(() => {
    const store = this.userStore;
    const end = store.signupTrialDaysLeft() !== null ? store.user()?.trialEndsAt : null;
    return end ? new Date(end).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) : null;
  });

  // ── Code partenaire : validation en direct ──
  protected readonly code = signal('');
  protected readonly validation = signal<PartnerValidation | null>(null);
  protected readonly validating = signal(false);
  private readonly code$ = new Subject<string>();
  protected readonly validPartner = computed(() => {
    const v = this.validation();
    return v?.valid ? v : null;
  });

  // ── Choix de l'offre ──
  /**
   * Offres reçues (#578) : avant, AUCUN choix n'est possible. Sinon, pendant le chargement (≥ 1 s
   * en 4G lente), le prix normal paraissait seul proposé et un clic partait en Premium au lieu du
   * fondateur demandé par le lien.
   */
  protected readonly offersReady = computed(() => this.offersStore.status() === 'loaded');
  protected readonly offersError = computed(() => this.offersStore.status() === 'error');
  /** Le lien d'arrivée demande l'offre fondateur : le prix normal n'est jamais choisi à sa place. */
  private readonly wantsFounder = computed(() => this.preset()?.plan === 'founder');
  /**
   * Lien fondateur, offre inaccessible à ce compte (fermée, complète, déjà abonné…) : la raison,
   * avec le message du checkout, puis l'utilisateur choisit lui-même.
   */
  protected readonly founderRefusal = computed(() => {
    if (!this.wantsFounder() || !this.offersReady() || this.founderAvailable()) return null;
    const o = this.offersStore.offers();
    const reason = o?.founder.ineligibleReason;
    const key: FounderIneligibility =
      reason && reason in FOUNDER_INELIGIBLE_MESSAGES
        ? (reason as FounderIneligibility)
        : o && o.founderOffer.open && o.founderOffer.seatsLeft <= 0
          ? 'sold_out'
          : 'closed';
    return FOUNDER_INELIGIBLE_MESSAGES[key];
  });
  protected readonly founderAvailable = this.offersStore.founderAvailable;
  /**
   * Réservation fondateur pendant le Premium offert (#769) : date (JJ/MM) du premier prélèvement,
   * donnée par l'API (règle des 48 h de Stripe), sinon `null` (paiement immédiat).
   */
  protected readonly founderChargeDate = computed(() => {
    const at = this.offersStore.offers()?.founder.firstChargeAt;
    return at ? new Date(at).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) : null;
  });
  protected readonly founderOffer = computed(() => this.offersStore.offers()?.founderOffer ?? null);
  /** Compteur de places (libellé partagé : « 200 places disponibles » tant qu'aucune n'est prise). */
  protected readonly seatsLabel = computed(() => {
    const f = this.founderOffer();
    return f ? founderSeatsLabel(f.seatsLeft, f.seatsTotal) : null;
  });
  /** Choix explicite de l'utilisateur (prime sur la présélection). */
  private readonly picked = signal<OfferChoice | null>(null);
  /**
   * Présélection : le code du lien s'il est valide, sinon le fondateur (mis en avant) s'il est
   * accessible, sinon le prix normal — SAUF lien fondateur : pas de présélection, l'utilisateur
   * choisit après avoir lu pourquoi le fondateur n'est pas accessible. `null` = aucun choix.
   */
  private readonly defaultChoice = computed<OfferChoice | null>(() => {
    if (!this.offersReady()) return null;
    const partner = this.validPartner();
    if (partner && this.preset()?.promo) return 'partner';
    if (this.founderAvailable()) return 'founder';
    if (partner) return 'partner';
    return this.wantsFounder() ? null : 'premium';
  });
  protected readonly choice = computed<OfferChoice | null>(() => {
    if (!this.offersReady()) return null;
    const c = this.picked() ?? this.defaultChoice();
    const fallback = (): OfferChoice | null => (this.wantsFounder() ? null : 'premium');
    if (c === 'founder' && !this.founderAvailable()) return this.validPartner() ? 'partner' : fallback();
    if (c === 'partner' && !this.validPartner()) return this.founderAvailable() ? 'founder' : fallback();
    return c;
  });
  /** Le bouton d'action ne part que sur un choix fait, offres reçues. */
  protected readonly canConfirm = computed(() => this.choice() !== null && !this.isLoading());
  /** Deux offres remisées proposées ensemble : on rappelle qu'elles ne se cumulent pas. */
  protected readonly showsBoth = computed(() => this.founderAvailable() && !!this.validPartner());

  constructor() {
    this.events.track('plan_modal_open');
    this.code$
      .pipe(
        map((c) => c.trim().toUpperCase()),
        debounceTime(400),
        distinctUntilChanged(),
        switchMap((c) => {
          if (!CODE_PATTERN.test(c)) {
            this.validating.set(false);
            return of(null);
          }
          this.validating.set(true);
          return this.billingApi.validatePartnerCode(c).pipe(
            map((res) => res.data),
            catchError(() =>
              of<PartnerValidation>({
                valid: false,
                code: c,
                reason: 'error',
                message: 'Impossible de vérifier ce code pour le moment. Réessaie dans un instant.',
              }),
            ),
          );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((v) => {
        this.validating.set(false);
        this.validation.set(v);
        // Un code saisi à la main et valide : c'est l'offre que l'utilisateur vise.
        if (v?.valid && this.typedByUser) this.picked.set('partner');
      });
  }

  private typedByUser = false;

  ngOnInit(): void {
    // L'échec est affiché ici (mtc-error-state) : pas de toast en double.
    this.offersStore.load({ silent: true });
    const promo = this.preset()?.promo;
    if (promo) {
      this.code.set(promo);
      this.code$.next(promo);
    }
  }

  protected setInterval(value: Interval) {
    this.interval.set(value);
  }

  protected retryOffers() {
    this.offersStore.refresh({ silent: true });
  }

  protected pick(choice: OfferChoice) {
    this.picked.set(choice);
  }

  protected onCodeInput(value: string) {
    this.typedByUser = true;
    this.code.set(value.toUpperCase());
    if (!value.trim()) this.validation.set(null);
    this.code$.next(value);
  }

  /** Recompose l'id attendu par l'API checkout (prix fondateur ou prix normal). */
  protected planId(): CheckoutPlan {
    const tier = this.choice() === 'founder' ? 'founder' : 'premium';
    return `${tier}_${this.interval()}`;
  }

  /** Pourcentage d'économie de l'annuel vs 12× mensuel (~17%). */
  protected savingsPct(): number {
    const p = PRICING.premium;
    return Math.round((1 - p.yearly / (p.monthly * 12)) * 100);
  }

  protected partnerLabel(): string {
    const p = this.validPartner();
    return p ? partnerDurationLabel(p.durationMonths, this.interval()) : '';
  }

  /** Essai accordé pour le choix courant (jamais en fondateur ni en annuel). */
  protected trialFor(choice: OfferChoice | null): boolean {
    return choice !== 'founder' && this.interval() === 'monthly' && this.trialAvailable();
  }

  /** Libellé prix sous le CTA selon l'offre et l'intervalle. */
  protected ctaPriceLabel(): string {
    const yearly = this.interval() === 'yearly';
    const choice = this.choice();
    if (choice === 'founder') {
      const f = PRICING.founder;
      return yearly ? `${f.yearly} €/an` : `${f.monthly} €/mois`;
    }
    if (choice === 'partner') {
      const p = this.validPartner()!;
      return `${yearly ? `${p.priceAnnualEur} €/an` : `${p.priceMonthlyEur} €/mois`} ${this.partnerLabel()} avec ${p.code}`;
    }
    const p = PRICING.premium;
    return yearly ? `${p.yearly}€/an (économise ${p.savings}€)` : `${p.monthly}€/mois`;
  }

  protected close() {
    this.closed.emit();
  }

  protected onOverlayClick(event: MouseEvent) {
    if (event.target === event.currentTarget) this.close();
  }

  protected confirmPlan() {
    // Garde aussi côté code (clavier, double appui) : jamais de checkout sans choix sur offres reçues.
    if (!this.canConfirm()) return;
    this.events.track('trial_click');
    const choice = this.choice();
    this.intent.clear();
    this.billing.startCheckout(this.planId(), {
      cta: this.preset()?.cta ?? this.cta(),
      promo: choice === 'partner' ? this.validPartner()!.code : null,
    });
  }
}
