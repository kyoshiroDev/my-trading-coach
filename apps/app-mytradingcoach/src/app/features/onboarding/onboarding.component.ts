import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { Subject, of } from 'rxjs';
import { catchError, debounceTime, distinctUntilChanged, map, switchMap } from 'rxjs/operators';
import { UsersApi } from '../../core/api/users.api';
import { TradesApi, CreateTradeDto, InstrumentSearchResult } from '../../core/api/trades.api';
import { TradesStore } from '../../core/stores/trades.store';
import { AccountsApi, CreateAccountPayload, DrawdownType } from '../../core/api/accounts.api';
import { AuthService } from '../../core/auth/auth.service';
import {
  ACCOUNT_CURRENCIES,
  AccountCurrency,
  DEFAULT_ACCOUNT_CURRENCY,
  formatMoney,
} from '@mtc/shared';
import { LucideDynamicIcon } from '@lucide/angular';
import { TradeFormComponent } from '../journal/trade-form.component';
import { CsvImportComponent, ImportResult } from '../journal/csv-import.component';
import { SetupsStore } from '../../core/stores/setups.store';
import {
  SetupFormModalComponent,
  SetupFormValue,
} from '../../shared/components/setup-form-modal/setup-form-modal.component';
import { TradovateConnectModalComponent } from '../../shared/components/tradovate-connect/tradovate-connect-modal.component';
import { TradovateAccountPickerComponent } from '../../shared/components/tradovate-connect/tradovate-account-picker.component';
import { TradovateStore } from '../../core/stores/tradovate.store';
import { ToastService } from '../../core/services/toast.service';
import {
  FeesState,
  TRADOVATE_RETURN_PARAMS,
  excludedAccountsMessage,
  feesLine,
  feesState,
  parseTradovateReturn,
  tradesLine,
  tradovateErrorMessage,
} from '../../core/utils/tradovate-return.util';
import {
  TRADING_STYLES,
  SESSIONS,
  ASSET_SUGGESTIONS,
  TradingStyle,
  TradingSession,
} from './onboarding.constants';
import { apiErrorMessage } from '../../core/utils/api-error';
import {
  DISCORD_URL,
  GOALS,
  MARKETS,
  accountPayload,
  numericOnly,
  parseCapital,
  type AccountMode,
  type Goal,
  type Market,
  type OnboardingProgress,
  type Step,
} from './onboarding.model';
import { clearProgress, loadProgress, saveProgress } from './onboarding-progress';

@Component({
  selector: 'mtc-onboarding',
  imports: [
    LucideDynamicIcon, TradeFormComponent, CsvImportComponent, SetupFormModalComponent,
    TradovateConnectModalComponent, TradovateAccountPickerComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './onboarding.component.html',
  styleUrl: './onboarding.component.css',
})
export class OnboardingComponent {
  completed = output<void>();

  private readonly usersApi    = inject(UsersApi);
  private readonly tradesApi   = inject(TradesApi);
  private readonly tradesStore = inject(TradesStore);
  private readonly accountsApi = inject(AccountsApi);
  protected readonly setupsStore = inject(SetupsStore);
  private readonly auth        = inject(AuthService);
  private readonly destroyRef  = inject(DestroyRef);
  private readonly toast       = inject(ToastService);
  private readonly router      = inject(Router);
  protected readonly tvStore   = inject(TradovateStore);

  // ── Connexion Tradovate depuis l'étape 8 ────────────────────────
  /** Compte cible de l'écran de réassurance (ouvert = non null). */
  protected readonly tvTarget = signal<{ id: string; label: string } | null>(null);
  /** Recherche / création du compte cible avant d'ouvrir l'écran de réassurance. */
  protected readonly tvPreparing = signal(false);
  /** Échec non bloquant : l'étape 8 reste utilisable (réessayer, CSV, manuel, zéro). */
  protected readonly tvError = signal<string | null>(null);
  /** Login Tradovate à plusieurs comptes : choix à faire pour ce compte MTC. */
  protected readonly tvPickAccountId = signal<string | null>(null);
  /** Comptes du login écartés (déjà reliés ailleurs), annoncés au-dessus du sélecteur. */
  protected readonly tvExcludedMsg = signal<string | null>(null);
  protected readonly tvPickAccounts = computed(() => {
    const id = this.tvPickAccountId();
    return id ? (this.tvStore.byAccount().get(id)?.availableAccounts ?? []) : [];
  });
  /** Récap de l'écran final, même rôle que `importSummary` pour le CSV. */
  protected readonly tvSummary = signal<{ created: number | null; fees: FeesState | null } | null>(null);
  protected readonly tvRecapMain = computed(() => {
    const t = this.tvSummary();
    if (!t) return '';
    return t.created === null
      ? 'Compte Tradovate connecté'
      : `Compte Tradovate connecté · ${tradesLine(t.created)}`;
  });
  protected readonly tvRecapWarn = computed(() => {
    const t = this.tvSummary();
    if (!t) return null;
    if (t.created === null) {
      return "La première synchronisation n'a pas abouti : relance-la depuis Mes comptes.";
    }
    return t.created > 0 ? (feesLine(t.fees)?.text ?? null) : null;
  });

  // Étape Tes setups (les 6 défauts sont seedés au signup).
  protected readonly showSetupModal = signal(false);
  protected readonly setupMsg = signal<string | null>(null);

  protected readonly MARKETS        = MARKETS;
  protected readonly GOALS          = GOALS;
  protected readonly TRADING_STYLES = TRADING_STYLES;
  protected readonly SESSIONS       = SESSIONS;
  protected readonly discordUrl     = DISCORD_URL;

  protected readonly step         = signal<Step>(1);
  protected readonly tradeChoice  = signal<'choice'|'manual'|'csv'>('choice');
  protected readonly csvOpen      = signal(false);
  /** Résultat du dernier import, affiché en récapitulatif à l'écran final. */
  protected readonly importSummary = signal<ImportResult | null>(null);
  protected readonly selectedMarket   = signal<Market | null>(null);
  protected readonly selectedGoal     = signal<Goal | null>(null);
  /** Devise du compte créé (liste unique `ACCOUNT_CURRENCIES`), jamais une conversion. */
  protected readonly selectedCurrency = signal<AccountCurrency>(DEFAULT_ACCOUNT_CURRENCY);
  protected readonly accountCurrencies = ACCOUNT_CURRENCIES;
  /** Montant du récap d'import, dans la devise du compte créé. */
  protected readonly feesLabel = (n: number) =>
    formatMoney(n, this.selectedCurrency(), { sign: false });
  /**
   * Pré-rempli : l'étape ne bloque plus. Laisser le champ vide aurait
   * cascadé en « CAPITAL $0.00 » — `User.startingCapital` vaut 0 par défaut, le compte
   * créé au premier trade hérite alors d'un `startingBalance` null, et le dashboard
   * comme « Mes comptes » affichent 0. Une valeur ronde ajustable vaut mieux qu'un mur
   * en 3ᵉ écran sur la question la plus sensible du parcours.
   */
  protected readonly capitalInput     = signal('10000');

  // ── Étape 3 : profil de compte ──────────────────────────────────────────────
  /**
   * Perso ou prop firm. Le compte cree implicitement au premier trade
   * (`ensureDefaultAccountId`) etait toujours PERSONAL « Compte principal », quel que
   * soit le profil reel — un trader prop firm demarrait donc avec un compte faux, sans
   * objectif ni drawdown, alors que `TradingAccount` porte deja tous ces champs.
   */
  protected readonly accountMode   = signal<AccountMode>('PERSO');
  protected readonly broker        = signal('');
  protected readonly profitTarget  = signal('');
  protected readonly maxDrawdown   = signal('');
  protected readonly drawdownType  = signal<DrawdownType>('TRAILING');
  /** Le compte a deja ete cree pour cet onboarding : garde-fou anti-doublon. */
  private readonly accountCreated  = signal(false);
  protected readonly isSaving         = signal(false);
  /**
   * Echec d'enregistrement du profil a l'etape Strategie. Non nul = on reste sur
   * l'etape et on rend la main a l'utilisateur (reessayer / continuer quand meme).
   */
  protected readonly profileSaveError = signal<string | null>(null);

  // Étape Stratégie
  protected readonly selectedStyle        = signal<TradingStyle | null>(null);
  protected readonly strategyDescription  = signal('');
  protected readonly selectedSessions     = signal<TradingSession[]>([]);
  /**
   * Style + au moins une session. La description libre reste envoyée au contexte IA
   * mais n'est plus exigée : c'était la seule étape demandant de RÉDIGER,
   * et le minimum de 15 caractères en faisait le décrochage le plus probable du wizard.
   * Les tags d'approche ont été retirés (redondants avec les setups + la description).
   */
  protected readonly strategyValid = computed(
    () => !!this.selectedStyle() && this.selectedSessions().length > 0,
  );

  // Étape Actifs
  protected readonly selectedAssets = signal<string[]>([]);
  protected readonly favoriteAsset  = signal<string | null>(null);
  protected readonly assetQuery     = signal('');
  protected readonly assetResults   = signal<InstrumentSearchResult[]>([]);
  /** Issue de la dernière recherche (≥ 2 caractères) : `null` tant qu'aucune n'a abouti. */
  protected readonly assetSearchStatus = signal<'found' | 'none' | 'unavailable' | null>(null);
  private readonly assetSearch$     = new Subject<string>();
  protected readonly assetSuggestions = computed(
    () => ASSET_SUGGESTIONS[this.selectedMarket() ?? 'MULTI'] ?? ASSET_SUGGESTIONS['MULTI'],
  );
  protected readonly assetsValid = computed(() => this.selectedAssets().length > 0);

  constructor() {
    this.setupsStore.load();
    this.restoreProgress();
    // APRÈS restoreProgress : le retour Tradovate a le dernier mot sur l'étape affichée.
    this.readTradovateReturn();

    // Sauvegarde à chaque changement : l'effet lit les signaux (donc les suit) et
    // n'écrit que dans le stockage local — aucune boucle possible.
    effect(() => {
      const snapshot: OnboardingProgress = {
        step: this.step(),
        market: this.selectedMarket(),
        goal: this.selectedGoal(),
        currency: this.selectedCurrency(),
        capital: this.capitalInput(),
        accountMode: this.accountMode(),
        broker: this.broker(),
        profitTarget: this.profitTarget(),
        maxDrawdown: this.maxDrawdown(),
        drawdownType: this.drawdownType(),
        style: this.selectedStyle(),
        strategy: this.strategyDescription(),
        sessions: this.selectedSessions(),
        assets: this.selectedAssets(),
        favorite: this.favoriteAsset(),
      };
      saveProgress(snapshot);
    });
    this.assetSearch$
      .pipe(
        debounceTime(300),
        map((q) => q.trim()),
        distinctUntilChanged(),
        switchMap((q) =>
          q.length < 2
            ? of(null)
            : this.tradesApi.searchInstruments(q).pipe(
                map((res) => res.data ?? []),
                catchError(() => of('unavailable' as const)),
              ),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((res) => {
        this.assetResults.set(Array.isArray(res) ? res : []);
        this.assetSearchStatus.set(res === null ? null : res === 'unavailable' ? 'unavailable' : res.length ? 'found' : 'none');
      });
  }

  /** Reprend là où l'utilisateur s'était arrêté. Toute anomalie → repart proprement à 1. */
  private restoreProgress(): void {
    const p = loadProgress();
    if (!p) return;
    this.selectedMarket.set(p.market);
    this.selectedGoal.set(p.goal);
    this.selectedCurrency.set(p.currency);
    this.capitalInput.set(p.capital);
    this.accountMode.set(p.accountMode);
    this.broker.set(p.broker);
    this.profitTarget.set(p.profitTarget);
    this.maxDrawdown.set(p.maxDrawdown);
    this.drawdownType.set(p.drawdownType);
    this.selectedStyle.set(p.style);
    this.strategyDescription.set(p.strategy);
    this.selectedSessions.set(p.sessions);
    this.selectedAssets.set(p.assets);
    this.favoriteAsset.set(p.favorite);
    // L'étape 8 se rouvre sur le CHOIX du premier trade : rouvrir d'autorité une
    // modale de saisie ou d'import après un rechargement serait déroutant.
    this.step.set(p.step);
    this.tradeChoice.set('choice');
  }

  /**
   * Retour du consentement Tradovate lancé depuis l'étape 8 (`?tradovate=…&from=wizard`).
   * L'utilisateur revient EXACTEMENT où il était : écran final avec le récap si la connexion a
   * réussi, étape 8 sinon. Jamais au début du wizard, même si la progression locale a disparu
   * (autre onglet, stockage vidé). Les paramètres sont retirés de l'URL une fois lus.
   */
  private readTradovateReturn(): void {
    let params: Record<string, string> = {};
    try {
      params = Object.fromEntries(new URLSearchParams(window.location.search));
    } catch { return; }
    const ret = parseTradovateReturn(params);
    if (!ret || !ret.fromWizard) return;

    if (ret.status === 'connected') {
      this.tvSummary.set({ created: ret.syncFailed ? null : (ret.trades ?? 0), fees: ret.fees });
      if ((ret.trades ?? 0) > 0) this.tradesStore.reset();
      this.step.set(9);
    } else {
      this.step.set(8);
      this.tradeChoice.set('choice');
      if (ret.status === 'select_account' && ret.accountId) {
        this.tvPickAccountId.set(ret.accountId);
        this.tvExcludedMsg.set(excludedAccountsMessage(ret.excluded));
        this.tvStore.load();
      } else {
        this.tvError.set(tradovateErrorMessage(ret.reason, true));
      }
    }

    const cleared = Object.fromEntries(TRADOVATE_RETURN_PARAMS.map((k) => [k, null]));
    this.router.navigate([], { queryParams: cleared, queryParamsHandling: 'merge', replaceUrl: true });
  }

  /** Fin de l'onboarding : la progression n'a plus lieu d'être conservée. */
  protected finish(): void {
    clearProgress();
    this.completed.emit();
  }

  /**
   * « Passer, je remplirai plus tard » : même sortie que `finish()`, donc l'onboarding
   * est marqué terminé et le wizard ne se rouvre pas à chaque chargement. Ce qui a déjà
   * été saisi reste enregistré (le profil est sauvegardé à l'étape stratégie) ; le reste
   * se complète depuis Profil. Le dashboard sait vivre avec un profil partiel.
   */
  protected skip(): void {
    this.finish();
  }

  protected selectMarket(m: Market)          { this.selectedMarket.set(m); }
  protected selectGoal(g: Goal)              { this.selectedGoal.set(g); }
  protected selectCurrency(c: AccountCurrency) { this.selectedCurrency.set(c); }

  // ── Stratégie ──
  protected selectStyle(s: TradingStyle)     { this.selectedStyle.set(s); }
  protected toggleSession(s: TradingSession): void {
    this.selectedSessions.update((arr) =>
      arr.includes(s) ? arr.filter((x) => x !== s) : [...arr, s],
    );
  }
  protected onStrategyDescription(event: Event): void {
    this.strategyDescription.set((event.target as HTMLTextAreaElement).value);
  }

  // ── Actifs ──
  protected addAsset(symbol: string): void {
    const s = symbol.trim().toUpperCase();
    if (!s) return;
    this.selectedAssets.update((list) => {
      if (list.includes(s) || list.length >= 3) return list;
      return [...list, s];
    });
    if (this.favoriteAsset() === null && this.selectedAssets().includes(s)) {
      this.favoriteAsset.set(s);
    }
    this.assetQuery.set('');
    this.assetResults.set([]);
    this.assetSearchStatus.set(null);
  }
  protected removeAsset(symbol: string): void {
    this.selectedAssets.update((list) => list.filter((s) => s !== symbol));
    if (this.favoriteAsset() === symbol) {
      this.favoriteAsset.set(this.selectedAssets()[0] ?? null);
    }
  }
  protected setFavoriteAsset(symbol: string) { this.favoriteAsset.set(symbol); }
  protected onAssetSearch(event: Event): void {
    const v = (event.target as HTMLInputElement).value;
    this.assetQuery.set(v);
    this.assetSearch$.next(v);
  }
  protected submitAssetQuery(): void {
    const q = this.assetQuery().trim();
    if (q) this.addAsset(q);
  }

  protected filterCapital(event: Event): void {
    const input = event.target as HTMLInputElement;
    input.value = input.value.replace(/[^\d.,]/g, '');
    this.capitalInput.set(input.value);
  }

  protected nextStep(): void {
    const s = this.step();
    if (s === 5) {
      this.saveProfileThenGoAssets();        // Stratégie → profil IA enregistré → Actifs
    } else if (s === 6) {
      this.saveAssetsThenGoTrade();          // Actifs enregistrés → étape Setups (7)
    } else if (s < 9) {
      this.step.set((s + 1) as Step);        // ex. Setups (7) → premier trade (8)
    }
  }

  protected prevStep(): void {
    this.profileSaveError.set(null);
    const s = this.step();
    if (s === 8) { this.tradeChoice.set('choice'); this.step.set(7); } // premier trade → Setups
    else if (s > 1 && s < 9) { this.step.set((s - 1) as Step); }
  }

  protected chooseManual() { this.tradeChoice.set('manual'); }
  protected chooseCsv()    { this.tradeChoice.set('csv'); this.csvOpen.set(true); }
  protected backToChoice() { this.tradeChoice.set('choice'); this.csvOpen.set(false); }

  protected finishAndGoDiscord() { this.step.set(9); }

  /**
   * Carte « Connecter mon compte Tradovate » : il faut un TradingAccount cible pour y
   * rattacher la connexion. Normalement créé au checkpoint Stratégie (`createAccountOnce`) ;
   * s'il manque (échec réseau à ce moment-là), on le crée ici avec la déclaration de l'étape 3.
   */
  protected chooseTradovate(): void {
    if (this.tvPreparing()) return;
    this.tvError.set(null);
    this.tvPreparing.set(true);
    this.accountsApi
      .getAll()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          const accounts = res.data ?? [];
          const existing = accounts.find((a) => a.status === 'ACTIVE') ?? accounts[0];
          if (existing) {
            this.openTradovate(existing.id, existing.label);
            return;
          }
          this.accountCreated.set(true);
          this.accountsApi
            .create(this.buildAccountPayload())
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
              next: (created) => this.openTradovate(created.data.id, created.data.label),
              error: (err) => {
                this.accountCreated.set(false);
                this.failTradovate(err);
              },
            });
        },
        error: (err) => this.failTradovate(err),
      });
  }

  private openTradovate(id: string, label: string): void {
    this.tvPreparing.set(false);
    this.tvTarget.set({ id, label });
  }

  private failTradovate(err: unknown): void {
    this.tvPreparing.set(false);
    this.tvError.set(
      `${apiErrorMessage(err, "Ton compte n'a pas pu être préparé.")} Tu peux réessayer ou importer un CSV.`,
    );
  }

  /** Choix du compte Tradovate au retour (login à plusieurs comptes), puis synchro. */
  protected onTradovatePicked(externalId: string): void {
    const accountId = this.tvPickAccountId();
    if (!accountId) return;
    this.tvError.set(null);
    this.tvStore.selectThenSync(accountId, externalId, (r) => {
      // Échec : le store a déjà affiché le toast d'erreur ; le sélecteur reste là pour réessayer.
      if (!r) return;
      this.tvPickAccountId.set(null);
      this.tvSummary.set({ created: r.created, fees: feesState(r) });
      if (r.created > 0) this.tradesStore.reset();
      this.step.set(9);
    });
  }

  // ── Étape Tes setups (7) : réutilise la modale partagée + SetupsStore ──
  protected openSetupModal(): void { this.setupMsg.set(null); this.showSetupModal.set(true); }
  protected onSetupSave(value: SetupFormValue): void {
    this.showSetupModal.set(false);
    // Anti-doublon : un même titre (insensible à la casse) ne peut pas être ajouté 2 fois.
    const title = value.title.trim().toLowerCase();
    if (this.setupsStore.active().some((s) => s.title.trim().toLowerCase() === title)) {
      this.setupMsg.set(`« ${value.title.trim()} » existe déjà.`);
      return;
    }
    this.setupMsg.set(null);
    this.setupsStore.create(
      value,
      undefined,
      (msg) => this.setupMsg.set(msg),
    );
  }
  protected removeSetup(id: string): void {
    // Garde-fou : au moins un setup doit rester, sinon le sélecteur de trade
    // de l'étape suivante est vide et le premier trade échoue (setupId requis).
    if (this.setupsStore.active().length <= 1) {
      this.setupMsg.set('Garde au moins un setup pour pouvoir logger tes trades.');
      return;
    }
    this.setupMsg.set(null);
    this.setupsStore.remove(id, (msg) => this.setupMsg.set(msg));
  }

  // Étape Stratégie (5) → enregistre le profil IA (SANS terminer l'onboarding)
  // puis va aux Actifs (6). Marquer l'onboarding fini ici sauterait les étapes
  // Actifs (6) et Premier trade (7) : le flag n'est posé qu'à l'écran final.
  private saveProfileThenGoAssets(): void {
    this.isSaving.set(true);
    this.usersApi
      .saveOnboardingProfile({
        market: this.selectedMarket(),
        goal: this.selectedGoal(),
        // 0 (champ vidé) → on n'envoie rien : le back ne réécrit que si non-null, donc
        // la valeur déjà en base est préservée au lieu d'être écrasée par un 0.
        startingCapital: this.parseCapital() || undefined,
        // Plus de devise au profil : elle part sur le compte créé (payload compte).
        tradingStyle: this.selectedStyle() ?? undefined,
        strategyDescription: this.strategyDescription().trim() || undefined,
        tradingSessions: this.selectedSessions(),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.auth.setCurrentUser(res.data);
          this.createAccountOnce();
          this.isSaving.set(false);
          this.profileSaveError.set(null);
          this.step.set(6);
        },
        // AVANT : `step.set(6)` ici aussi. L'echec etait donc invisible — l'utilisateur
        // terminait son onboarding avec un profil vide (constate sur dev : market, goal
        // et tradingStyle nuls apres une traversee complete), et depuis l'ajout du
        // compte de trading, l'echec emportait aussi sa creation. On s'arrete et on
        // rend la main : jamais de perte silencieuse, jamais d'impasse non plus.
        error: (err) => {
          this.isSaving.set(false);
          this.profileSaveError.set(
            err?.error?.message ?? "Ton profil n'a pas pu être enregistré.",
          );
        },
      });
  }

  /** « Réessayer » : rejoue le checkpoint tel quel. */
  protected retryProfileSave(): void {
    this.saveProfileThenGoAssets();
  }

  /**
   * « Continuer quand même » : on avance sans le profil, mais on tente tout de meme la
   * creation du compte — c'est un autre endpoint, et la declaration de l'etape 3
   * (capital, regles prop firm) a plus de valeur que les champs de profil. Si elle
   * echoue aussi, `createAccountOnce` se rearme et le back recreera un compte au
   * premier trade.
   */
  protected continueWithoutProfile(): void {
    this.profileSaveError.set(null);
    this.createAccountOnce();
    this.step.set(6);
  }

  /**
   * Cree le compte de trading declare a l'etape 3, UNE SEULE FOIS.
   *
   * Sans ce checkpoint, le compte n'etait cree qu'au premier trade par
   * `ensureDefaultAccountId` : toujours PERSONAL, libelle « Compte principal », sans
   * broker ni regles. Un trader prop firm demarrait donc avec un compte faux.
   *
   * Anti-doublon : `saveProfileThenGoAssets` se redeclenche si l'utilisateur revient de
   * l'etape 6 vers la 5 puis re-avance. Le flag memoire ne suffit pas (rechargement,
   * localStorage vide, autre onglet) : on interroge d'abord le serveur, seule source
   * de verite. Zero compte cote back = aucune creation n'a encore eu lieu.
   *
   * Non bloquant : un echec laisse l'onboarding continuer. Le compte sera cree au
   * premier trade par le back, comme avant — on perd le profil prop firm, pas le
   * parcours.
   */
  private createAccountOnce(): void {
    if (this.accountCreated()) return;
    this.accountCreated.set(true); // pose AVANT l'appel : deux clics rapides ne passent pas

    this.accountsApi
      .getAll()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          if ((res.data?.length ?? 0) > 0) return; // deja un compte : ne rien creer
          this.accountsApi
            .create(this.buildAccountPayload())
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({ error: () => this.accountCreated.set(false) });
        },
        error: () => this.accountCreated.set(false),
      });
  }

  /**
   * Payload du compte issu de l'etape 3. Les champs prop firm ne sont envoyes que
   * renseignes : un `profitTarget: 0` ferait afficher une barre d'objectif vide dans
   * « Mes comptes » au lieu de masquer la carte de regles.
   */
  protected buildAccountPayload(): CreateAccountPayload {
    return accountPayload({
      mode: this.accountMode(),
      capital: this.capitalInput(),
      broker: this.broker(),
      profitTarget: this.profitTarget(),
      maxDrawdown: this.maxDrawdown(),
      drawdownType: this.drawdownType(),
      currency: this.selectedCurrency(),
    });
  }

  // Étape Actifs (6) → persiste actifs + favori puis va au premier trade (7)
  private saveAssetsThenGoTrade(): void {
    this.isSaving.set(true);
    const assets = this.selectedAssets();
    const favorite = this.favoriteAsset();
    this.tradesApi
      .saveUserAssets(assets, favorite)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          // Rafraîchir le store (optimiste, exactement ce qui part en base) pour que
          // profileIncomplete() ne déclenche pas à tort « Complète ton profil » au dashboard.
          const u = this.auth.currentUser();
          if (u) this.auth.setCurrentUser({ ...u, tradingAssets: assets, favoriteAsset: favorite });
          this.isSaving.set(false);
          this.step.set(7);
        },
        // Non bloquant (le wizard avance), mais plus muet : les actifs se complètent depuis Profil.
        error: () => {
          this.isSaving.set(false);
          this.toast.warning('Tes actifs n’ont pas pu être enregistrés : tu pourras les ajouter depuis ton Profil.');
          this.step.set(7);
        },
      });
  }

  // Trade manuel sauvegardé → on crée le trade puis on va à l'étape Discord
  protected onTradeFormSave(dto: CreateTradeDto): void {
    this.isSaving.set(true);
    this.tradesApi
      .create(dto)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => { this.tradesStore.addTrade(res.data); this.isSaving.set(false); this.step.set(9); },
        // Non bloquant (on termine l'onboarding), mais plus muet.
        error: () => {
          this.isSaving.set(false);
          this.toast.error('Ton trade n’a pas pu être enregistré : tu pourras le saisir depuis le journal.');
          this.step.set(9);
        },
      });
  }

  // TradeForm fermé sans sauvegarder → retour au choix
  protected onTradeFormDismissed(): void { this.tradeChoice.set('choice'); }

  // CSV importé → étape Discord. On CONSERVE le résultat : la modale se ferme
  // aussitôt, donc son écran « N trade(s) importé(s) » n'était jamais lu. Sans
  // récapitulatif, l'utilisateur terminait l'onboarding sans la moindre preuve que
  // son import avait fonctionné — et l'avertissement sur les frais
  // non rapprochés restait invisible dans ce chemin.
  protected onCsvImported(result: ImportResult): void {
    this.importSummary.set(result);
    this.csvOpen.set(false);
    this.step.set(9);
  }
  protected onCsvDismissed(): void { this.csvOpen.set(false); this.tradeChoice.set('choice'); }

  /**
   * Aligné sur ce que l'utilisateur LIT (« Étape n sur 7 ») : l'écran de promesse (1)
   * et l'écran final (9) ne sont pas des étapes. `step()/9` affichait 89 % au moment
   * précis où le libellé annonçait « Étape 7 sur 7 ».
   */
  protected get progress(): number {
    return Math.round(Math.min(1, (this.step() - 1) / 7) * 100);
  }

  protected get stepLabel(): string {
    const s = this.step();
    if (s === 1 || s === 9) return '';
    return `Étape ${s - 1} sur 7`;
  }

  protected onBrokerInput(e: Event)       { this.broker.set((e.target as HTMLInputElement).value); }
  protected onProfitTargetInput(e: Event) { this.profitTarget.set(numericOnly(e.target as HTMLInputElement)); }
  protected onMaxDrawdownInput(e: Event)  { this.maxDrawdown.set(numericOnly(e.target as HTMLInputElement)); }
  protected setAccountMode(m: AccountMode) { this.accountMode.set(m); }
  protected setDrawdownType(t: DrawdownType) { this.drawdownType.set(t); }

  private parseCapital(): number {
    return parseCapital(this.capitalInput());
  }
}
