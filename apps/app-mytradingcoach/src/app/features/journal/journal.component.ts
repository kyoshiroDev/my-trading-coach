import {
  ChangeDetectionStrategy, Component, DestroyRef,
  computed, effect, inject, signal, untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePipe, DecimalPipe, TitleCasePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { forkJoin, of, map, catchError } from 'rxjs';
import {
  LucideDynamicIcon,
  LucideX as X,
  LucidePencil as Pencil,
  LucideUpload as Upload,
  LucideChevronDown as ChevronDown,
  LucideChevronRight as ChevronRight,
  LucideCalendar as Calendar,
  LucideTrash2 as Trash2,
  LucideArrowRightLeft as ArrowRightLeft,
} from '@lucide/angular';
import { TradesStore, Trade } from '../../core/stores/trades.store';
import { CreateTradeDto, TradesApi } from '../../core/api/trades.api';
import { SelectedAccountStore } from '../../core/stores/selected-account.store';
import { SetupsStore } from '../../core/stores/setups.store';
import { TopbarComponent } from '../../shared/components/topbar/topbar.component';
import { TradeFormComponent } from './trade-form.component';
import { CsvImportComponent } from './csv-import.component';
import { MoneyPipe, PnlColorPipe, PnlFormatPipe, EmotionEmojiPipe } from '../../shared/pipes';
import { InfoTooltipComponent } from '../../shared/components/info-tooltip/info-tooltip.component';
import { MixedCurrencyNoticeComponent } from '../../shared/components/mixed-currency-notice/mixed-currency-notice.component';
import { MoneyService } from '../../core/services/money.service';
import { ToastService } from '../../core/services/toast.service';
import { TradovateLiveSocketService } from '../../core/services/tradovate-live-socket.service';
import { apiErrorMessage } from '../../core/utils/api-error';
import { DialogDirective } from '@mtc/front-ui';
import {
  DatePreset, DayGroup, FilterEmotion, FilterExecution, FilterResult, FilterSide,
  gradeLabel, gradeTooltip, groupByDay, groupByWeek, presetRange,
} from './journal.grouping';


@Component({
  selector: 'mtc-journal',
  imports: [
    DialogDirective,
    DatePipe, DecimalPipe, TitleCasePipe, LucideDynamicIcon,
    TopbarComponent, TradeFormComponent, CsvImportComponent,
    PnlColorPipe, PnlFormatPipe, MoneyPipe, EmotionEmojiPipe, InfoTooltipComponent,
    MixedCurrencyNoticeComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './journal.component.css',
  templateUrl: './journal.component.html',
})
export class JournalComponent {
  protected readonly tradesStore = inject(TradesStore);
  private readonly tradesApi     = inject(TradesApi);
  private readonly destroyRef    = inject(DestroyRef);
  private readonly selectedAccount = inject(SelectedAccountStore);
  protected readonly setupsStore = inject(SetupsStore);
  private readonly toast         = inject(ToastService);
  private readonly tradovateLive = inject(TradovateLiveSocketService);
  /** Devises mêlées en « Tous les comptes » → pas de totaux, lignes dans la devise de leur compte. */
  protected readonly money = inject(MoneyService);

  constructor() {
    this.setupsStore.load();
    // Liste paginée ET KPIs rechargés côté serveur à tout changement de filtre
    // (compte, preset/dates, side, setup). Les KPIs viennent de l'agrégat backend
    // → stables, indépendants de « Charger plus ».
    effect(() => this.refreshJournal());

    // Trades Tradovate poussés en direct : le journal ouvert se met à jour.
    this.tradovateLive.imported$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.refreshJournal());

    // Fige l'ouverture de la semaine la plus récente dès son apparition : sans override
    // explicite, elle se replierait au prochain trade plus récent (défaut positionnel).
    effect(() => {
      const weeks = this.tradesByWeek();
      untracked(() => this.freezeNewWeeks(weeks));
    });

    // Un echec ne doit ni survivre a la fermeture de la modale, ni suivre
    // l'utilisateur sur une autre journee. `deleteDay` ecrit son message SANS
    // toucher a la cle : cet effet ne le rejoue donc pas dans son dos.
    effect(() => {
      this.confirmDeleteDayKey();
      untracked(() => this.deleteDayError.set(null));
    });
  }

  /**
   * Pose un override explicite pour chaque semaine vue pour la première fois, à la
   * valeur que le défaut lui donne À CET INSTANT. Une semaine ouverte le reste donc
   * quand une plus récente la pousse d'un cran ; une semaine repliée reste repliée.
   * L'utilisateur garde la main : `toggleWeek` écrase l'override.
   */
  private freezeNewWeeks(weeks: { key: string }[]): void {
    const nouvelles = weeks
      .map((w, i) => ({ key: w.key, index: i }))
      .filter((w) => !this.seenWeeks.has(w.key));
    if (!nouvelles.length) return;

    const map = this.weekOverrides();
    const next = new Map(map);
    let changed = false;
    for (const { key, index } of nouvelles) {
      this.seenWeeks.add(key);
      if (next.has(key)) continue; // choix utilisateur déjà enregistré
      next.set(key, index !== 0);
      changed = true;
    }
    if (changed) this.weekOverrides.set(next);
  }

  /** Filtres serveur dérivés des signaux (n'inclut que les valeurs définies). */
  private readonly journalFilters = computed<Record<string, string>>(() => {
    const f: Record<string, string> = {};
    const acc = this.selectedAccount.accountParam();
    if (acc) f['accountId'] = acc;
    const side = this.filterSide();
    if (side !== 'ALL') f['side'] = side;
    const setup = this.filterSetup();
    if (setup) f['setupId'] = setup;
    const result = this.filterResult();
    if (result !== 'ALL') f['result'] = result;
    const exec = this.filterExecution();
    if (exec !== 'ALL') f['executionGrade'] = exec;
    const emo = this.filterEmotion();
    if (emo !== 'ALL') f['emotion'] = emo;
    const { dateFrom, dateTo } = this.dateRange();
    if (dateFrom) f['dateFrom'] = dateFrom;
    if (dateTo) f['dateTo'] = dateTo;
    return f;
  });

  /** Range ISO dérivé du preset (voir `presetRange`). */
  private readonly dateRange = computed(() =>
    presetRange(this.datePreset(), this.dateFrom(), this.dateTo()),
  );

  /** Reset + recharge liste et KPIs avec les filtres courants. */
  private refreshJournal(): void {
    const filters = this.journalFilters();
    this.tradesStore.reset();
    this.tradesStore.loadTrades(filters);
    this.tradesStore.loadStats(filters);
  }

  /** Recharge seulement les KPIs (la liste est déjà mise à jour de façon optimiste). */
  private refreshStats(): void {
    this.tradesStore.loadStats(this.journalFilters());
  }

  protected readonly XIcon            = X;
  protected readonly PencilIcon       = Pencil;
  protected readonly UploadIcon       = Upload;
  protected readonly ChevronDownIcon  = ChevronDown;
  protected readonly ChevronRightIcon = ChevronRight;
  protected readonly CalendarIcon     = Calendar;
  protected readonly TrashIcon        = Trash2;
  protected readonly ReassignIcon     = ArrowRightLeft;

  protected readonly gradeLabel = gradeLabel;
  protected readonly gradeTooltip = gradeTooltip;

  protected readonly showModal        = signal(false);
  protected readonly showImport       = signal(false);
  protected readonly isSubmitting     = signal(false);
  protected readonly submitError      = signal<string | null>(null);
  protected readonly selectedTrade    = signal<Trade | null>(null);
  // On memorise la CLE du jour, pas le DayGroup lui-même : ces groupes sont
  // recalcules a chaque changement du store, et un instantane pris a l'ouverture de
  // la modale se perime des qu'un trade part. Il annoncait alors un nombre faux et,
  // pire, `deleteDay` rejouait des ids deja supprimes (cf. deleteDay).
  protected readonly confirmDeleteDayKey = signal<string | null>(null);
  protected readonly confirmDeleteDay = computed(() => {
    const key = this.confirmDeleteDayKey();
    return key === null ? null : this.tradesByDay().find((d) => d.key === key) ?? null;
  });
  protected readonly isDeletingDay    = signal(false);
  protected readonly deleteDayError   = signal<string | null>(null);
  // Réaffectation d'une journée vers un autre compte.
  // Meme regle que `confirmDeleteDayKey` : la cle, jamais l'objet. Un instantane du
  // DayGroup se perime des que le store bouge, et `reassignTo` deplacerait alors des
  // ids obsoletes.
  protected readonly reassignDayKey   = signal<string | null>(null);
  protected readonly reassignDay = computed(() => {
    const key = this.reassignDayKey();
    return key === null ? null : this.tradesByDay().find((d) => d.key === key) ?? null;
  });
  protected readonly isReassigning    = signal(false);
  protected readonly activeAccounts   = computed(() => this.selectedAccount.activeAccounts());
  protected readonly currentAccountId = computed(() => this.selectedAccount.selectedAccountId());
  // Réaffectation utile seulement s'il existe un compte cible ≠ compte courant.
  protected readonly canReassign      = computed(() =>
    this.activeAccounts().some((a) => a.id !== this.currentAccountId()),
  );
  protected readonly filterSide      = signal<FilterSide>('ALL');
  protected readonly filterSetup     = signal<string | null>(null);
  protected readonly filterResult    = signal<FilterResult>('ALL');
  protected readonly filterExecution = signal<FilterExecution>('ALL');
  protected readonly filterEmotion   = signal<FilterEmotion>('ALL');
  protected readonly collapsedDays  = signal<Set<string>>(new Set());
  // Repli des semaines : override explicite de l'utilisateur (clé → repliée?). Par défaut,
  // seule la semaine la plus récente (index 0) est dépliée ; les autres repliées. Survit à
  // la pagination (les semaines plus anciennes révélées restent repliées par défaut).
  protected readonly weekOverrides = signal<Map<string, boolean>>(new Map());
  /**
   * Semaines déjà rencontrées. Le défaut de `isWeekCollapsed` est POSITIONNEL
   * (`index !== 0`) : il se réévalue donc quand la liste bouge. Logger un trade dans une
   * semaine plus récente décalait l'ancienne à l'index 1 et la repliait toute seule —
   * le journal semblait s'être vidé alors qu'on venait d'y ajouter quelque chose.
   * On fige l'état d'ouverture au moment où une semaine apparaît, pour qu'il ne dépende
   * plus que de l'utilisateur.
   */
  private readonly seenWeeks = new Set<string>();

  /** Vrai dès qu'un filtre (hors période/compte) est actif → affiche « Réinitialiser ». */
  protected readonly hasActiveFilters = computed(() =>
    this.filterSide() !== 'ALL' ||
    this.filterSetup() !== null ||
    this.filterResult() !== 'ALL' ||
    this.filterExecution() !== 'ALL' ||
    this.filterEmotion() !== 'ALL',
  );

  protected resetFilters(): void {
    this.filterSide.set('ALL');
    this.filterSetup.set(null);
    this.filterResult.set('ALL');
    this.filterExecution.set('ALL');
    this.filterEmotion.set('ALL');
  }
  protected readonly datePreset     = signal<DatePreset>('all');
  protected readonly showCustomDate = signal(false);
  protected readonly dateFrom       = signal('');
  protected readonly dateTo         = signal('');

  // ── Vue par jour ──────────────────────────────────────────────────────────
  // Le filtrage (période/side/setup) est désormais fait côté serveur : on groupe
  // simplement les trades renvoyés. « Charger plus » révèle des jours plus anciens
  // dans le même filtre, sans changer les KPIs (qui viennent de l'agrégat backend).

  protected readonly tradesByDay = computed(() => groupByDay(this.tradesStore.trades()));

  // ── Vue par semaine (niveau au-dessus des jours) ────────────────────────────
  // Regroupe les DayGroup en semaines ISO (lundi → dimanche). Les agrégats sont
  // recalculés sur TOUS les trades de la semaine (win rate juste, pas une moyenne
  // de moyennes ; BE exclus via computeTradeStats). Même base de date que les jours.

  protected readonly tradesByWeek = computed(() => groupByWeek(this.tradesByDay()));

  // ── Stats période ─────────────────────────────────────────────────────────
  // KPIs issus de l'agrégat backend (ensemble filtré complet, hors pagination).
  // Remappés sur les libellés du template ; null si aucun trade → état vide.

  protected readonly periodStats = computed(() => {
    const s = this.tradesStore.stats();
    if (!s || s.totalTrades === 0) return null;
    return {
      count:            s.totalTrades,
      totalPnl:         s.pnlNet,
      totalPnlBrut:     s.pnlBrut,
      totalCommissions: s.fees,
      winRate:          s.winRate,
      bestTrade:        s.bestTrade,
      worstTrade:       s.worstTrade,
    };
  });

  // ── Actions ───────────────────────────────────────────────────────────────

  toggleDay(key: string): void {
    this.collapsedDays.update(set => {
      const next = new Set(set);
      if (next.has(key)) { next.delete(key); } else { next.add(key); }
      return next;
    });
  }

  /** Repli effectif d'une semaine : override utilisateur sinon défaut (repliée si pas la plus récente). */
  protected isWeekCollapsed(key: string, index: number): boolean {
    const o = this.weekOverrides();
    return o.has(key) ? o.get(key)! : index !== 0;
  }

  toggleWeek(key: string, index: number): void {
    const collapsed = this.isWeekCollapsed(key, index);
    this.weekOverrides.update(map => {
      const next = new Map(map);
      next.set(key, !collapsed);
      return next;
    });
  }

  setDatePreset(preset: DatePreset): void {
    this.datePreset.set(preset);
    if (preset !== 'custom') this.showCustomDate.set(false);
  }

  toggleCustomDate(): void {
    this.datePreset.set('custom');
    this.showCustomDate.update(v => !v);
  }

  onDateFrom(e: Event): void {
    this.dateFrom.set((e.target as HTMLInputElement).value);
  }

  onDateTo(e: Event): void {
    this.dateTo.set((e.target as HTMLInputElement).value);
  }

  openModal(): void {
    this.selectedTrade.set(null);
    this.showModal.set(true);
    this.submitError.set(null);
  }

  protected openEditModal(trade: Trade): void {
    this.selectedTrade.set(trade);
    this.showModal.set(true);
    this.submitError.set(null);
  }

  closeModal(): void {
    this.showModal.set(false);
    this.selectedTrade.set(null);
    this.submitError.set(null);
  }

  submitTrade(dto: CreateTradeDto): void {
    const edit = this.selectedTrade();
    this.isSubmitting.set(true);
    this.submitError.set(null);

    // Création : rattacher le trade au compte sélectionné (sauf « Tous »). Le backend
    // garde son fallback (session active → compte par défaut) si accountId absent.
    const accountId = this.selectedAccount.accountParam();
    const payload: CreateTradeDto = !edit && accountId ? { ...dto, accountId } : dto;

    const obs = edit
      ? this.tradesApi.update(edit.id, dto)
      : this.tradesApi.create(payload);

    obs.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (res: { data: Trade }) => {
        if (edit) { this.tradesStore.updateTrade(res.data); } else { this.tradesStore.addTrade(res.data); }
        this.refreshStats(); // KPIs recalculés côté serveur sur l'ensemble filtré
        this.closeModal();
        this.isSubmitting.set(false);
        this.toast.success(edit ? 'Trade modifié' : 'Trade enregistré');
      },
      error: (err: HttpErrorResponse) => {
        const msg = (err?.error as { message?: string | string[] })?.message ?? 'Erreur';
        this.submitError.set(Array.isArray(msg) ? msg.join(', ') : String(msg));
        this.isSubmitting.set(false);
      },
    });
  }

  /** Retire la ligne du store et rafraichit les agregats. */
  private forgetTrade(id: string): void {
    this.tradesStore.removeTrade(id);
    this.refreshStats();
  }

  deleteTrade(id: string): void {
    this.tradesApi.delete(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => { this.forgetTrade(id); this.toast.success('Trade supprimé'); },
        // AVANT : aucun handler `error`. Un refus partait dans le vide et la ligne
        // restait affichee — l'utilisateur cliquait sans rien voir se passer.
        // Feedback transitoire d'une action ponctuelle → toast.
        error: (err: HttpErrorResponse) => {
          // 404 : le trade n'est deja plus la (autre onglet, suppression precedente).
          // L'objectif est atteint : on retire la ligne au lieu de crier a l'erreur.
          if (err?.status === 404) { this.forgetTrade(id); this.toast.success('Trade supprimé'); return; }
          this.toast.error(apiErrorMessage(err, "Ce trade n'a pas pu être supprimé."));
        },
      });
  }

  /**
   * Supprime tous les trades d'une journee.
   *
   * Deux defauts corriges ici, constates ensemble sur dev :
   *
   * 1. Le `forkJoin` s'arretait a la PREMIERE erreur. Les suppressions parties en
   *    parallele aboutissaient quand meme cote serveur, mais la branche d'erreur ne
   *    retirait aucune ligne : l'ecran continuait d'afficher des trades qui
   *    n'existaient plus, et seul un rechargement revelait la verite.
   * 2. Cette branche d'erreur ne faisait que relacher le spinner. Modale figee
   *    ouverte, aucun message — l'echec etait invisible.
   *
   * On traite donc chaque suppression separement et on rend compte du resultat reel :
   * ce qui est parti disparait, ce qui resiste est nomme.
   */
  protected deleteDay(day: DayGroup): void {
    const ids = day.trades.map(t => t.id);
    if (!ids.length) { this.confirmDeleteDayKey.set(null); return; }

    this.isDeletingDay.set(true);
    this.deleteDayError.set(null);

    forkJoin(
      ids.map(id =>
        this.tradesApi.delete(id).pipe(
          map(() => ({ id, parti: true })),
          // Un 404 vaut succes : le trade n'est plus la, c'est ce qu'on voulait.
          catchError((err: HttpErrorResponse) => of({ id, parti: err?.status === 404 })),
        ),
      ),
    )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((resultats) => {
        resultats.filter(r => r.parti).forEach(r => this.tradesStore.removeTrade(r.id));
        this.refreshStats();
        this.isDeletingDay.set(false);

        const restants = resultats.filter(r => !r.parti).length;
        if (restants === 0) {
          this.confirmDeleteDayKey.set(null);
          this.toast.success(ids.length > 1 ? `${ids.length} trades supprimés` : 'Trade supprimé');
          return;
        }
        // Échec partiel : message DANS la modale (pas un toast) — elle reste ouverte sur
        // les trades restants et porte le « Réessayer » ; l'information est actionnable ici.

        // Modale laissee ouverte : elle se recalcule sur les trades restants, donc
        // elle montre exactement ce qui n'est pas parti, et « Reessayer » porte sur
        // eux seuls.
        this.deleteDayError.set(
          restants > 1
            ? `${restants} trades n'ont pas pu être supprimés.`
            : "1 trade n'a pas pu être supprimé.",
        );
      });
  }

  protected openReassign(day: DayGroup): void {
    this.reassignDayKey.set(day.key);
  }

  protected reassignTo(day: DayGroup, accountId: string): void {
    if (this.isReassigning()) return;
    const ids = day.trades.map((t) => t.id);
    // La journee a pu se vider entre l'ouverture et le clic : deplacer zero trade
    // afficherait un refus du back pour une liste vide.
    if (!ids.length) { this.reassignDayKey.set(null); return; }

    this.isReassigning.set(true);
    this.tradesApi.reassign(ids, accountId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.isReassigning.set(false);
          // Fermeture EXPLICITE : hors filtre par compte, la journee existe toujours
          // apres le deplacement, donc la modale ne se refermerait pas d'elle-meme.
          this.reassignDayKey.set(null);
          // Les trades changent de compte → recharger liste + KPIs du filtre courant.
          this.refreshJournal();
          const cible = this.activeAccounts().find((a) => a.id === accountId)?.label;
          const n = ids.length > 1 ? `${ids.length} trades déplacés` : 'Trade déplacé';
          this.toast.success(cible ? `${n} vers ${cible}` : n);
        },
        // Modale laissée ouverte pour réessayer ; le message est un toast.
        error: (err: HttpErrorResponse) => {
          this.isReassigning.set(false);
          this.toast.error(apiErrorMessage(err, 'Erreur lors du déplacement.'));
        },
      });
  }

  loadMore(): void { this.tradesStore.loadMore(); }

  onImported(): void {
    this.showImport.set(false);
    this.refreshJournal();
  }
}
