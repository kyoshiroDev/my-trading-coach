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
import { Subject, of } from 'rxjs';
import { catchError, debounceTime, distinctUntilChanged, map, switchMap } from 'rxjs/operators';
import { UsersApi } from '../../core/api/users.api';
import { TradesApi, CreateTradeDto, InstrumentSearchResult } from '../../core/api/trades.api';
import { TradesStore } from '../../core/stores/trades.store';
import { AccountsApi, CreateAccountPayload, DrawdownType } from '../../core/api/accounts.api';
import { AuthService } from '../../core/auth/auth.service';
import { LucideAngularModule, Bitcoin } from 'lucide-angular';
import { TradeFormComponent } from '../journal/trade-form.component';
import { CsvImportComponent, ImportResult } from '../journal/csv-import.component';
import { SetupsStore } from '../../core/stores/setups.store';
import {
  SetupFormModalComponent,
  SetupFormValue,
} from '../../shared/components/setup-form-modal/setup-form-modal.component';
import {
  TRADING_STYLES,
  SESSIONS,
  ASSET_SUGGESTIONS,
  TradingStyle,
  TradingSession,
} from './onboarding.constants';

type Market = 'CRYPTO' | 'FOREX' | 'ACTIONS' | 'MULTI';
type Goal   = 'DISCIPLINE' | 'PERFORMANCE' | 'PSYCHOLOGIE';
type Step   = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

type MarketOption = {
  value: Market;
  label: string;
  emoji?: string;
  icon?: typeof Bitcoin;
  iconColor?: string;
  desc: string;
};

const MARKETS: MarketOption[] = [
  { value: 'CRYPTO',  label: 'Crypto',          icon: Bitcoin, iconColor: '#F7931A', desc: 'Bitcoin, Ethereum, altcoins' },
  { value: 'FOREX',   label: 'Forex',            emoji: '💱',                        desc: 'EUR/USD, paires de devises' },
  { value: 'ACTIONS', label: 'Actions',          emoji: '📈',                        desc: 'Actions, ETF, indices' },
  { value: 'MULTI',   label: 'Multi-marchés',    emoji: '🌐',                        desc: 'Je trade plusieurs marchés' },
];

const GOALS: { value: Goal; label: string; emoji: string; desc: string }[] = [
  { value: 'DISCIPLINE',  label: 'Travailler ma discipline',  emoji: '🎯', desc: 'Respecter mon plan et éviter les trades impulsifs' },
  { value: 'PSYCHOLOGIE', label: 'Maîtriser ma psychologie',  emoji: '🧠', desc: 'Gérer mes émotions, éviter FOMO et revenge trades' },
  { value: 'PERFORMANCE', label: 'Améliorer ma performance',  emoji: '📈', desc: 'Optimiser mon win rate et ma rentabilité globale' },
];

const DISCORD_URL = 'https://discord.gg/TDK2npvkSN';

/**
 * Progression du wizard, conservée localement (PROMPT-186 #8).
 *
 * Le wizard bloque toutes les routes tant qu'il n'est pas terminé — c'est voulu —
 * mais un simple rechargement repartait à l'étape 1 : marché, objectif et capital
 * étaient à ressaisir, puisque rien n'est persisté côté serveur avant l'étape 5.
 * Un débutant interrompu (onglet fermé, réseau, curiosité) payait plein pot.
 */
const PROGRESS_KEY = 'mtc.onboarding.progress';

type AccountMode = 'PERSO' | 'PROPFIRM';

/** `null` si vide ou illisible — distingue « non renseigne » de « zero ». */
function parseNumber(raw: string): number | null {
  const v = parseFloat(raw.replace(',', '.'));
  return isNaN(v) ? null : v;
}

/** Filtre la saisie sur place (chiffres, point, virgule) et renvoie la valeur nettoyee. */
function numericOnly(input: HTMLInputElement): string {
  input.value = input.value.replace(/[^\d.,]/g, '');
  return input.value;
}

interface OnboardingProgress {
  step: Step;
  market: Market | null;
  goal: Goal | null;
  currency: 'USD' | 'EUR';
  capital: string;
  accountMode: AccountMode;
  broker: string;
  profitTarget: string;
  maxDrawdown: string;
  drawdownType: DrawdownType;
  style: TradingStyle | null;
  strategy: string;
  sessions: TradingSession[];
  assets: string[];
  favorite: string | null;
}

@Component({
  selector: 'mtc-onboarding',
  standalone: true,
  imports: [LucideAngularModule, TradeFormComponent, CsvImportComponent, SetupFormModalComponent],
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
  protected readonly selectedCurrency = signal<'USD' | 'EUR'>('USD');
  /**
   * Pré-rempli : l'étape ne bloque plus (PROMPT-198). Laisser le champ vide aurait
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

  // Étape Stratégie
  protected readonly selectedStyle        = signal<TradingStyle | null>(null);
  protected readonly strategyDescription  = signal('');
  protected readonly selectedSessions     = signal<TradingSession[]>([]);
  /**
   * Style + au moins une session. La description libre reste envoyée au contexte IA
   * mais n'est plus exigée (PROMPT-198) : c'était la seule étape demandant de RÉDIGER,
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
  private readonly assetSearch$     = new Subject<string>();
  protected readonly assetSuggestions = computed(
    () => ASSET_SUGGESTIONS[this.selectedMarket() ?? 'MULTI'] ?? ASSET_SUGGESTIONS['MULTI'],
  );
  protected readonly assetsValid = computed(() => this.selectedAssets().length > 0);

  constructor() {
    this.setupsStore.load();
    this.restoreProgress();

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
      try {
        localStorage.setItem(PROGRESS_KEY, JSON.stringify(snapshot));
      } catch { /* stockage indispo (mode privé) : on dégrade sans bruit */ }
    });
    this.assetSearch$
      .pipe(
        debounceTime(300),
        map((q) => q.trim()),
        distinctUntilChanged(),
        switchMap((q) =>
          q.length < 2
            ? of({ data: [] as InstrumentSearchResult[] })
            : this.tradesApi.searchInstruments(q).pipe(catchError(() => of({ data: [] as InstrumentSearchResult[] }))),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((res) => this.assetResults.set(res.data ?? []));
  }

  /** Reprend là où l'utilisateur s'était arrêté. Toute anomalie → repart proprement à 1. */
  private restoreProgress(): void {
    let raw: string | null = null;
    try { raw = localStorage.getItem(PROGRESS_KEY); } catch { return; }
    if (!raw) return;
    try {
      const p = JSON.parse(raw) as Partial<OnboardingProgress>;
      const step = p.step;
      if (typeof step !== 'number' || step < 1 || step > 9) return;
      this.selectedMarket.set(p.market ?? null);
      this.selectedGoal.set(p.goal ?? null);
      this.selectedCurrency.set(p.currency === 'EUR' ? 'EUR' : 'USD');
      this.capitalInput.set(typeof p.capital === 'string' ? p.capital : '');
      this.accountMode.set(p.accountMode === 'PROPFIRM' ? 'PROPFIRM' : 'PERSO');
      this.broker.set(typeof p.broker === 'string' ? p.broker : '');
      this.profitTarget.set(typeof p.profitTarget === 'string' ? p.profitTarget : '');
      this.maxDrawdown.set(typeof p.maxDrawdown === 'string' ? p.maxDrawdown : '');
      this.drawdownType.set(p.drawdownType === 'STATIC' ? 'STATIC' : 'TRAILING');
      this.selectedStyle.set(p.style ?? null);
      this.strategyDescription.set(typeof p.strategy === 'string' ? p.strategy : '');
      this.selectedSessions.set(Array.isArray(p.sessions) ? p.sessions : []);
      this.selectedAssets.set(Array.isArray(p.assets) ? p.assets : []);
      this.favoriteAsset.set(p.favorite ?? null);
      // L'étape 8 se rouvre sur le CHOIX du premier trade : rouvrir d'autorité une
      // modale de saisie ou d'import après un rechargement serait déroutant.
      this.step.set(step as Step);
      this.tradeChoice.set('choice');
    } catch { /* snapshot illisible : on ignore, l'utilisateur repart de l'étape 1 */ }
  }

  private clearProgress(): void {
    try { localStorage.removeItem(PROGRESS_KEY); } catch { /* rien à nettoyer */ }
  }

  /** Fin de l'onboarding : la progression n'a plus lieu d'être conservée. */
  protected finish(): void {
    this.clearProgress();
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
  protected selectCurrency(c: 'USD'|'EUR')   { this.selectedCurrency.set(c); }

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
    const s = this.step();
    if (s === 8) { this.tradeChoice.set('choice'); this.step.set(7); } // premier trade → Setups
    else if (s > 1 && s < 9) { this.step.set((s - 1) as Step); }
  }

  protected chooseManual() { this.tradeChoice.set('manual'); }
  protected chooseCsv()    { this.tradeChoice.set('csv'); this.csvOpen.set(true); }
  protected backToChoice() { this.tradeChoice.set('choice'); this.csvOpen.set(false); }

  protected finishAndGoDiscord() { this.step.set(9); }

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
        currency: this.selectedCurrency(),
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
          this.step.set(6);
        },
        error: () => { this.isSaving.set(false); this.step.set(6); },
      });
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
    const prop = this.accountMode() === 'PROPFIRM';
    const size = this.parseCapital() || null;
    const brokerName = this.broker().trim();

    const payload: CreateAccountPayload = {
      label: prop && brokerName ? `${brokerName} #1` : 'Compte principal',
      type: prop ? 'EVALUATION' : 'PERSONAL',
      accountSize: size,
      startingBalance: size,
      currency: this.selectedCurrency(),
    };
    if (!prop) return payload;

    if (brokerName) payload.broker = brokerName;
    const target = parseNumber(this.profitTarget());
    if (target != null && target > 0) payload.profitTarget = target;
    const dd = parseNumber(this.maxDrawdown());
    if (dd != null && dd > 0) {
      payload.maxDrawdown = dd;
      payload.drawdownType = this.drawdownType();
    }
    return payload;
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
        error: () => { this.isSaving.set(false); this.step.set(7); },
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
        error: () => { this.isSaving.set(false); this.step.set(9); },
      });
  }

  // TradeForm fermé sans sauvegarder → retour au choix
  protected onTradeFormDismissed(): void { this.tradeChoice.set('choice'); }

  // CSV importé → étape Discord. On CONSERVE le résultat : la modale se ferme
  // aussitôt, donc son écran « N trade(s) importé(s) » n'était jamais lu. Sans
  // récapitulatif, l'utilisateur terminait l'onboarding sans la moindre preuve que
  // son import avait fonctionné (PROMPT-186 #4) — et l'avertissement sur les frais
  // non rapprochés (PROMPT-185 #8) restait invisible dans ce chemin.
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
    const raw = this.capitalInput().replace(',', '.');
    const parsed = parseFloat(raw);
    return isNaN(parsed) || parsed < 0 ? 0 : parsed;
  }
}
