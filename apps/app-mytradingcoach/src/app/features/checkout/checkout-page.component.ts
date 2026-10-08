import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  LucideDynamicIcon,
  LucideArrowLeft as ArrowLeft,
  LucideCheck as Check,
  LucideClock as Clock,
  LucideLock as Lock,
  LucideRotateCcw as RotateCcw,
  LucideShieldCheck as ShieldCheck,
} from '@lucide/angular';
import {
  loadStripe,
  type Appearance,
  type StripeCheckoutLoadActionsSuccess,
  type StripeExpressCheckoutElementConfirmEvent,
} from '@stripe/stripe-js';
import type { CheckoutSummary } from '@app/core/api/billing.api';
import { BillingService, CHECKOUT_PLANS, type CheckoutPlan } from '@app/core/services/billing.service';
import { UserStore } from '@app/core/stores/user.store';
import { apiErrorMessage } from '@app/core/utils/api-error';
import { environment } from '@app/environments/environment';
import { checkoutCopy, type AssuranceIcon } from './checkout-copy';

const FEATURES = [
  'Coach IA personnel et chat',
  'Débrief de ta semaine, chaque dimanche',
  'Analyses avancées et score trader',
  'Alertes prop firm avant la casse',
  'Anti-tilt en séance',
  'Comptes de trading illimités',
];

/** Formulaire Stripe aux couleurs du panneau clair de la page (exception validée à « dark only »). */
const APPEARANCE: Appearance = {
  theme: 'stripe',
  variables: {
    colorPrimary: '#3b82f6',
    colorBackground: '#ffffff',
    colorText: '#0f172a',
    colorTextSecondary: '#475569',
    colorTextPlaceholder: '#94a3b8',
    colorDanger: '#dc2626',
    fontFamily: 'Inter, sans-serif',
    fontSizeBase: '14px',
    borderRadius: '10px',
    spacingUnit: '4px',
  },
  rules: {
    '.Input': { border: '1px solid #e2e8f0', boxShadow: 'none', padding: '11px 14px', backgroundColor: '#f8fafc' },
    '.Input:focus': { border: '1px solid #3b82f6', boxShadow: '0 0 0 3px rgba(59, 130, 246, 0.15)', backgroundColor: '#ffffff' },
    '.Label': { fontSize: '12px', color: '#475569', marginBottom: '6px' },
    '.AccordionItem': { border: '1px solid #e2e8f0', boxShadow: 'none' },
  },
};

const eur = (n: number) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n);

/**
 * Page de paiement de l'app (`/paiement?plan=…&cta=…&promo=…`), commune à toutes les offres :
 * récapitulatif à gauche, formulaire Stripe intégré (Checkout Elements) à droite. La session est
 * créée par l'API ; si elle renvoie une URL (clé publiable absente), repli sur la page Stripe.
 */
@Component({
  selector: 'mtc-checkout-page',
  standalone: true,
  imports: [RouterLink, LucideDynamicIcon],
  templateUrl: './checkout-page.component.html',
  styleUrl: './checkout-page.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CheckoutPageComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly billing = inject(BillingService);
  private readonly userStore = inject(UserStore);
  private readonly destroyRef = inject(DestroyRef);

  private readonly cardRef = viewChild<ElementRef<HTMLElement>>('card');
  private readonly paymentHost = viewChild<ElementRef<HTMLElement>>('paymentHost');
  private readonly expressHost = viewChild<ElementRef<HTMLElement>>('expressHost');

  protected readonly icons = { ArrowLeft, Check, Clock, Lock, RotateCcw, ShieldCheck };
  protected readonly assuranceIcons = {
    refund: RotateCcw, cancel: ShieldCheck, secure: Lock, trial: Clock,
  } satisfies Record<AssuranceIcon, unknown>;
  protected readonly features = FEATURES;
  protected readonly cguUrl = `${environment.landingUrl.replace(/\/$/, '')}/cgu`;

  protected readonly status = signal<'loading' | 'ready' | 'error'>('loading');
  protected readonly fatalError = signal<string | null>(null);
  protected readonly payError = signal<string | null>(null);
  protected readonly paying = signal(false);
  protected readonly showOr = signal(false);
  protected readonly cardMinHeight = signal<number | null>(null);
  protected readonly summary = signal<CheckoutSummary | null>(null);
  protected readonly todayEur = signal<number | null>(null);
  protected readonly email = signal(this.userStore.user()?.email ?? '');

  protected readonly copy = computed(() => {
    const s = this.summary();
    return s ? checkoutCopy(s) : null;
  });
  protected readonly today = computed(() => {
    const s = this.summary();
    const t = this.todayEur() ?? (s ? (s.trialDays > 0 ? 0 : s.recurringEur) : null);
    return t === null ? '' : eur(t);
  });
  protected readonly ctaLabel = computed(() => {
    const c = this.copy();
    const t = this.todayEur();
    if (!c) return 'Payer';
    return t && t > 0 ? `${c.cta} · ${eur(t)}` : c.cta;
  });

  private actions: StripeCheckoutLoadActionsSuccess | null = null;
  private readonly cleanups: (() => void)[] = [];

  constructor() {
    this.destroyRef.onDestroy(() => this.cleanups.forEach((fn) => fn()));
    afterNextRender(() => this.start());
  }

  private start(): void {
    const params = this.route.snapshot.queryParamMap;
    const plan = params.get('plan') as CheckoutPlan | null;
    if (!plan || !CHECKOUT_PLANS.includes(plan)) {
      this.fail('Cette offre est introuvable. Choisis-la à nouveau depuis ton profil.');
      return;
    }
    this.billing.createSession(plan, { cta: params.get('cta'), promo: params.get('promo') }).subscribe({
      next: (res) => {
        const start = res.data;
        if ('url' in start) {
          this.billing.redirect(start.url);
          return;
        }
        this.summary.set(start.summary);
        void this.mount(start.clientSecret, start.publishableKey).catch((err: unknown) =>
          this.fail(err instanceof Error ? err.message : 'Le paiement n’a pas pu se charger.'),
        );
      },
      error: (err: unknown) => this.fail(apiErrorMessage(err, 'Le paiement n’a pas pu démarrer. Réessaie dans un instant.')),
    });
  }

  private async mount(clientSecret: string, publishableKey: string): Promise<void> {
    const stripe = await loadStripe(publishableKey);
    if (!stripe) throw new Error('Stripe n’a pas pu se charger. Vérifie ta connexion.');
    const checkout = stripe.initCheckoutElementsSdk({
      clientSecret,
      elementsOptions: {
        appearance: APPEARANCE,
        fonts: [{ cssSrc: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500&display=swap' }],
      },
    });

    // Apple Pay, Google Pay et Link en boutons express ; le formulaire garde la carte et Klarna.
    const payment = checkout.createPaymentElement({
      layout: { type: 'accordion', defaultCollapsed: false, radios: 'always', spacedAccordionItems: true },
      terms: { card: 'never' },
      wallets: { applePay: 'never', googlePay: 'never', link: 'never' },
    });
    const express = checkout.createExpressCheckoutElement({
      buttonHeight: 44,
      buttonType: { applePay: 'subscribe', googlePay: 'subscribe' },
      layout: { maxColumns: 3, overflow: 'never' },
    } as Parameters<typeof checkout.createExpressCheckoutElement>[0]);
    express.on('ready', (e) => this.showOr.set(Object.values(e.availablePaymentMethods ?? {}).some(Boolean)));
    express.on('confirm', (e) => void this.confirm(e));

    const paymentEl = this.paymentHost()?.nativeElement;
    const expressEl = this.expressHost()?.nativeElement;
    if (paymentEl) payment.mount(paymentEl);
    if (expressEl) express.mount(expressEl);
    this.cleanups.push(() => payment.destroy(), () => express.destroy());

    const loaded = await checkout.loadActions();
    if (loaded.type !== 'success') throw new Error(loaded.error.message);
    this.actions = loaded.actions;
    const session = loaded.actions.getSession();
    if (session.email) this.email.set(session.email);
    this.todayEur.set(session.total.total.minorUnitsAmount / 100);
    this.status.set('ready');
    // Hauteur du formulaire figée une fois chargé : replier la carte (choix Klarna) ne fait rien bouger.
    setTimeout(() => this.lockCardHeight(), 600);
  }

  protected async confirm(expressEvent?: StripeExpressCheckoutElementConfirmEvent): Promise<void> {
    if (!this.actions || this.paying()) return;
    this.paying.set(true);
    this.payError.set(null);
    const res = await this.actions.confirm({
      redirect: 'if_required',
      ...(expressEvent ? { expressCheckoutConfirmEvent: expressEvent } : {}),
    });
    if (res.type === 'error') {
      this.payError.set(res.error.message);
      this.paying.set(false);
      return;
    }
    void this.router.navigate(['/dashboard'], { queryParams: { checkout: 'success' } });
  }

  private lockCardHeight(): void {
    const el = this.cardRef()?.nativeElement;
    if (el) this.cardMinHeight.set(el.offsetHeight);
  }

  private fail(message: string): void {
    this.fatalError.set(message);
    this.status.set('error');
  }
}
