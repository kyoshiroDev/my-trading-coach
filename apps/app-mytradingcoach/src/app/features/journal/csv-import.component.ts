import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  LucideDynamicIcon,
  LucideX as X,
  LucideUpload as Upload,
  LucideCheckCircle as CheckCircle,
  LucideAlertCircle as AlertCircle,
  LucideZap as Zap,
  LucideFileText as FileText,
  LucideCheck as Check,
  LucideLink2 as Link2,
} from '@lucide/angular';
import { parseDecimal } from '../../core/utils/parse-decimal';
import { SelectedAccountStore } from '../../core/stores/selected-account.store';
import { SetupsStore } from '../../core/stores/setups.store';
import { ToastService } from '../../core/services/toast.service';
import { TradovateStore } from '../../core/stores/tradovate.store';
import { TradovateConnectModalComponent } from '../../shared/components/tradovate-connect/tradovate-connect-modal.component';
import { apiErrorMessage } from '../../core/utils/api-error';
import { TradesApi } from '../../core/api/trades.api';

export interface ImportResult {
  created: number;
  duplicates: number;
  failed: number;
  total: number;
  /** Présent dès qu'un fichier de frais (Tradovate Cash history) a été fourni. */
  feesImported?: {
    assigned: number;
    expected: number;
    reconciled: boolean;
    /** false = fichier fourni mais inexploitable → import sans frais, P&L brut. */
    merged?: boolean;
    count: number;
  };
}

// Émotions (mêmes valeurs que le form de trade) appliquées à tout le lot.
const EMOTIONS = ['CONFIDENT', 'FOCUSED', 'NEUTRAL', 'STRESSED', 'FEAR', 'REVENGE'] as const;
const EMOTION_EMOJIS: Record<string, string> = {
  CONFIDENT: '😎', FOCUSED: '🎯', NEUTRAL: '😐', STRESSED: '😰', FEAR: '😨', REVENGE: '🤬',
};

@Component({
  selector: 'mtc-csv-import',
  imports: [LucideDynamicIcon, TradovateConnectModalComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './csv-import.component.css',
  templateUrl: './csv-import.component.html',
})
export class CsvImportComponent {
  readonly open = input(false);
  /** Affiche le sélecteur « Fichier des frais » (Tradovate Cash history). Aussi vrai
   *  dans l'onboarding : la confirmation « sans frais » y est donc active également. */
  readonly allowFeesFile = input(true);
  readonly dismissed = output<void>();
  /** Émet le résultat : l'onboarding en fait son écran de confirmation (il ferme la
   *  modale avant que l'utilisateur ait pu le lire). */
  readonly imported = output<ImportResult>();
  private readonly tradesApi = inject(TradesApi);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toast = inject(ToastService);
  protected readonly accountStore = inject(SelectedAccountStore);
  private readonly setupsStore = inject(SetupsStore);
  protected readonly tv = inject(TradovateStore);
  protected readonly LinkIcon = Link2;

  // ── Tradovate : synchro API en option principale, CSV en repli (PROMPT-211) ──
  /** L'utilisateur a choisi le repli « importer un fichier CSV Tradovate ». */
  protected readonly tvCsvOpen = signal(false);
  /** Compte pour lequel l'écran de réassurance Tradovate est ouvert. */
  protected readonly tvConnectTarget = signal<{ id: string; label: string } | null>(null);
  /** Mode « connexion recommandée » : source Tradovate, hors onboarding, CSV non déroulé. */
  protected readonly tvReco = computed(
    () => this.allowFeesFile() && this.source() === 'tradovate' && !this.tvCsvOpen(),
  );
  /** Compte cible choisi dans « Compte » (la connexion est PAR compte). */
  protected readonly tvTarget = computed(() => {
    const a = this.accountStore.activeAccounts().find((x) => x.id === this.accountId());
    return a ? { id: a.id, label: a.label } : null;
  });
  /** connect : pas encore connecté · sync : déjà connecté · reconnect : jeton expiré · finish : choix du compte Tradovate en attente. */
  protected readonly tvState = computed<'connect' | 'sync' | 'reconnect' | 'finish'>(() => {
    const t = this.tvTarget();
    const c = t ? this.tv.byAccount().get(t.id) : undefined;
    if (!c) return 'connect';
    if (c.status === 'NEEDS_RECONNECT') return 'reconnect';
    if (c.needsAccountSelection) return 'finish';
    return 'sync';
  });
  protected readonly tvBusy = computed(() => {
    const t = this.tvTarget();
    return !!t && !!this.tv.busy()[t.id];
  });

  protected readonly XIcon = X;
  protected readonly UploadIcon = Upload;
  protected readonly CheckCircleIcon = CheckCircle;
  protected readonly AlertCircleIcon = AlertCircle;
  protected readonly ZapIcon = Zap;
  protected readonly FileTextIcon = FileText;
  protected readonly CheckIcon = Check;
  protected readonly EMOTIONS = EMOTIONS;

  protected readonly isDragging = signal(false);
  protected readonly isLoading = signal(false);
  /** Verrou anti-double-soumission : champ simple (pas un signal) pour être vu
   *  immédiatement par le 2ᵉ clic, sans attendre un cycle de rendu. */
  private uploading = false;
  protected readonly result = signal<ImportResult | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly selectedFile = signal<File | null>(null);
  protected readonly totalFees = signal<string>('');
  // null = champ frais actif ; sinon raison de désactivation.
  protected readonly feesDisabledReason = signal<null | 'has_fees_column' | 'too_many'>(null);
  // Fichier des frais (Tradovate Cash history) : optionnel, remplace la saisie manuelle.
  protected readonly feesFile = signal<File | null>(null);
  // true si l'en-tête ressemble à un Cash history Tradovate (frais exacts par fusion).
  protected readonly feesFileValid = signal(false);
  /**
   * Fichier de frais vide ou illisible — distinct du « mauvais format ». Cas réel
   * (Val) : un export Tradovate raté produit un fichier de 9 octets contenant
   * littéralement « undefined ». Le message générique « ce n'est pas un Cash history »
   * envoyait alors chercher le bon fichier, alors que le bon fichier n'existe pas :
   * c'est l'export côté broker qu'il faut refaire.
   */
  protected readonly feesFileEmpty = signal(false);
  /** Panneau de confirmation « importer sans frais » affiché. */
  protected readonly showFeesConfirm = signal(false);
  /** L'utilisateur a déjà tranché pour CE lot : on ne le redemande pas. */
  private feesConfirmed = false;
  /** Bouton « Choisir un fichier » du champ frais, pour y renvoyer le focus. */
  private readonly feesChooseBtn = viewChild<ElementRef<HTMLButtonElement>>('feesChooseBtn');
  // Source d'import sélectionnée (PROMPT-164) : Tradovate (2 fichiers) présélectionné, ou autre broker (dropzone).
  protected readonly source = signal<'tradovate' | 'other'>('tradovate');

  // Defaults appliqués à tout le lot.
  protected readonly accountId = signal<string>('');
  // Émotion de lot optionnelle (PROMPT-163) : '' = non renseignée (rien envoyé → héritera de la session).
  protected readonly emotion = signal<string>('');
  protected readonly setupId = signal<string>('');
  // Setups actifs du user (store partagé, liste dynamique).
  protected readonly setups = this.setupsStore.active;

  /**
   * Import Tradovate abouti SANS aucun frais : ni Cash history, ni total saisi.
   * Un hint existait avant l'import, plus rien après — l'écart (21,84 $ sur nos
   * fixtures) passait inaperçu et le P&L affiché paraissait net (PROMPT-186 #7).
   * Restreint à Tradovate : chez les autres brokers, les frais sont dans le CSV.
   */
  protected readonly feesReminder = computed(() => {
    const r = this.result();
    if (!r || r.created === 0) return false;
    if (r.feesImported) return false; // frais fusionnés, ou échec déjà signalé
    if (this.source() !== 'tradovate') return false;
    if (this.feesFile()) return false;
    return parseDecimal(this.totalFees()) == null;
  });

  /** Couleur du setup sélectionné (pastille à côté du select). */
  protected readonly selectedSetupColor = computed(
    () => this.setups().find((s) => s.id === this.setupId())?.color ?? 'transparent',
  );

  /**
   * Faut-il demander confirmation avant d'importer ? Mêmes conditions que `feesReminder`,
   * mais AVANT l'import : Tradovate, aucun Cash history, aucun total saisi. Chez les
   * autres brokers les frais sont déjà dans le CSV, la question n'a pas lieu d'être.
   */
  protected readonly needsFeesConfirm = computed(
    () =>
      this.source() === 'tradovate' &&
      this.allowFeesFile() &&
      !this.feesFile() &&
      parseDecimal(this.totalFees()) == null,
  );

  /** Import autorisé : pas de comptes (FREE → compte par défaut backend) OU un compte choisi. */
  protected readonly canImport = computed(
    () => this.accountStore.activeAccounts().length === 0 || this.accountId() !== '',
  );

  /** Bouton Importer actif : fichier des trades présent + compte OK (le Cash history reste optionnel). */
  protected readonly canSubmit = computed(
    () => !!this.selectedFile() && this.canImport(),
  );

  /** Au-delà : un total global réparti au prorata donnerait des frais faux. */
  private readonly FEES_INPUT_MAX_TRADES = 5000;

  constructor() {
    if (!this.accountStore.loaded()) this.accountStore.load();
    this.setupsStore.load();
    // Le setup sélectionné est REVALIDÉ à chaque changement de la liste active, et
    // pas seulement fixé une fois : un setup supprimé ou archivé entre-temps (étape
    // « Tes setups » du wizard, écran Profil, autre onglet) laissait sinon `setupId`
    // figé sur un id fantôme — `<select>` vide à l'écran, et surtout import ENTIER
    // rejeté en 400 par `assertOwnedActive`. C'est le bug remonté par Val.
    effect(() => {
      const active = this.setupsStore.active();
      untracked(() => {
        // Choix utilisateur toujours valide → on n'y touche pas.
        if (this.setupId() && active.some((s) => s.id === this.setupId())) return;
        // Sinon : premier setup actif, ou '' si le user n'en a plus aucun
        // (rien ne part alors dans le FormData, le back choisira le défaut).
        this.setupId.set(active[0]?.id ?? '');
      });
    });
    // À l'ouverture du modal : présélectionne le compte courant (les options sont visibles d'emblée).
    effect(() => {
      if (!this.open()) return;
      untracked(() => {
        this.initAccountSelection();
        // Chaque ouverture repart sur la recommandation (connexion) ; états de connexion à jour.
        this.tvCsvOpen.set(false);
        if (this.allowFeesFile()) this.tv.load();
      });
    });
  }

  /** Sélecteur de source (PROMPT-164). Passer à « Autre » retire le fichier de frais (Tradovate-only). */
  protected setSource(s: 'tradovate' | 'other'): void {
    this.source.set(s);
    this.error.set(null);
    if (s === 'other') this.clearFeesFile();
  }

  protected openTradovateConnect(): void {
    const t = this.tvTarget();
    if (t) this.tvConnectTarget.set(t);
  }

  /** Compte déjà connecté : synchro directe (store partagé) ; le résultat suit le même chemin qu'un import. */
  protected syncTradovate(): void {
    const t = this.tvTarget();
    if (!t) return;
    this.tv.sync(t.id, (r) => {
      if (!r) return; // échec : toast d'erreur déjà affiché par le store
      if (r.created > 0) this.accountStore.load();
      this.imported.emit({
        created: r.created,
        duplicates: r.duplicates,
        failed: r.failed,
        total: r.total,
        feesImported: r.feesImported,
      });
    });
  }

  protected emotionEmoji(e: string): string {
    return EMOTION_EMOJIS[e] ?? '😐';
  }

  /** Pré-sélectionne le compte courant (si c'est un compte réel, pas « Tous »). */
  private initAccountSelection(): void {
    const sel = this.accountStore.selectedAccountId();
    const real = sel !== 'all' && this.accountStore.activeAccounts().some((a) => a.id === sel);
    this.accountId.set(real ? sel : '');
  }

  onOverlayClick(e: MouseEvent) {
    if ((e.target as HTMLElement).classList.contains('overlay'))
      this.dismissed.emit();
  }

  onDragOver(e: DragEvent) {
    e.preventDefault();
    this.isDragging.set(true);
  }

  onDrop(e: DragEvent) {
    e.preventDefault();
    this.isDragging.set(false);
    const file = e.dataTransfer?.files[0];
    if (file) this.selectFile(file);
  }

  onFileChange(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) this.selectFile(file);
  }

  // Étape 1 : sélection → on affiche le champ frais (pas d'upload immédiat).
  private selectFile(file: File) {
    this.selectedFile.set(file);
    this.error.set(null);
    this.totalFees.set('');
    this.feesDisabledReason.set(null);
    this.feesConfirmed = false;
    this.showFeesConfirm.set(false);
    this.initAccountSelection();

    // Lecture légère (en-tête + nb de lignes) pour décider si le champ frais
    // doit être désactivé. Excel (.xlsx) non lisible ici → le back protège.
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? '');
      const lines = text.split(/\r?\n/).filter((l) => l.trim());
      if (lines.length < 2) return;

      const header = lines[0].toLowerCase();
      const hasFeesColumn = /\b(commission|comm\.|fee|fees|frais)\b/.test(header);
      const tradeCount = lines.length - 1;

      if (hasFeesColumn) this.feesDisabledReason.set('has_fees_column');
      else if (tradeCount > this.FEES_INPUT_MAX_TRADES) this.feesDisabledReason.set('too_many');
    };
    reader.onerror = () => {
      /* échec lecture → on n'empêche rien, le back reste le filet de sécurité */
    };
    reader.readAsText(file);
  }

  protected clearFile() {
    this.clearTradesFile();
    this.clearFeesFile();
  }

  // Retire uniquement le fichier des trades (conserve le fichier des frais en mode Tradovate).
  protected clearTradesFile() {
    this.selectedFile.set(null);
    this.totalFees.set('');
    this.feesDisabledReason.set(null);
  }

  // Fichier des frais (Cash history) : lecture légère de l'en-tête pour valider et,
  // si valide, masquer la saisie manuelle (les frais viennent du fichier).
  onFeesFileChange(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    this.feesFile.set(file);
    this.feesFileValid.set(false);
    this.feesFileEmpty.set(false);
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? '').trim();
      // Vide AVANT le test d'en-tête : sur du vide il échouerait de toute façon, et
      // c'est le diagnostic qui change, pas seulement le message. Deux critères, car un
      // export raté n'est pas forcément un fichier de 0 octet : trop court pour porter
      // un en-tête, ou aucune virgule donc aucune structure CSV (le cas « undefined »).
      if (text.length < 20 || !text.includes(',')) {
        this.feesFileEmpty.set(true);
        return;
      }
      const header = text.split(/\r?\n/)[0]?.toLowerCase() ?? '';
      this.feesFileValid.set(
        header.includes('transaction id') && header.includes('cash change type'),
      );
    };
    // Illisible : même signal côté utilisateur, l'export est à refaire.
    reader.onerror = () => {
      this.feesFileValid.set(false);
      this.feesFileEmpty.set(true);
    };
    reader.readAsText(file);
  }

  protected clearFeesFile() {
    this.feesFile.set(null);
    this.feesFileValid.set(false);
    this.feesFileEmpty.set(false);
    this.feesConfirmed = false;
  }

  /**
   * Clic sur « Importer ». Si le lot Tradovate part sans aucun frais, on interpose UNE
   * confirmation douce — jamais un blocage : « Importer quand même » est à un clic et
   * le bouton Importer n'est jamais désactivé pour cette raison.
   */
  protected upload() {
    if (this.needsFeesConfirm() && !this.feesConfirmed && !this.uploading) {
      this.showFeesConfirm.set(true);
      return;
    }
    this.doUpload();
  }

  /** « Importer quand même » : le choix est tranché pour ce lot, on n'insiste plus. */
  protected importAnyway(): void {
    this.feesConfirmed = true;
    this.showFeesConfirm.set(false);
    this.doUpload();
  }

  /** « Ajouter le Cash history » : on referme et on renvoie l'utilisateur sur le champ. */
  protected addFeesFromConfirm(): void {
    this.showFeesConfirm.set(false);
    // Focus après le rendu : le bouton n'existe que lorsque le panneau est refermé.
    setTimeout(() => this.feesChooseBtn()?.nativeElement.focus(), 0);
  }

  // Étape 2 : confirmation → upload avec les frais éventuels.
  private doUpload() {
    const file = this.selectedFile();
    if (!file || !this.canImport()) return;
    // Verrou SYNCHRONE, posé avant tout await : `[disabled]="isLoading()"` ne protège
    // pas d'un double-clic natif, dont les deux événements partent avant le re-render
    // Angular — d'où deux imports concurrents et un historique dupliqué (PROMPT-186 #1).
    // La contrainte d'unicité en base reste le filet définitif ; ceci évite l'aller-retour.
    if (this.uploading) return;
    this.uploading = true;

    const formData = new FormData();
    formData.append('file', file, file.name);

    // Fichier des frais (Tradovate Cash history) → frais exacts par fusion. Prioritaire
    // sur la saisie manuelle : quand il est fourni, on n'envoie pas totalFees.
    const feesFile = this.feesFile();
    if (feesFile) {
      formData.append('fees', feesFile, feesFile.name);
    } else {
      const fees = parseDecimal(this.totalFees());
      if (this.feesDisabledReason() === null && fees != null && fees > 0) {
        formData.append('totalFees', String(fees));
      }
    }

    // Defaults du lot : compte cible (si choisi), émotion (override, rien si non renseignée), setup.
    if (this.accountId()) formData.append('accountId', this.accountId());
    if (this.emotion()) formData.append('emotion', this.emotion());
    if (this.setupId()) formData.append('setupId', this.setupId());

    this.isLoading.set(true);
    this.error.set(null);

    this.tradesApi
      .importCsv<ImportResult>(formData)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.result.set(res.data);
          this.isLoading.set(false);
          this.uploading = false;
          // Refresh coordonné des stores globalement périmés par l'import (PROMPT-175) :
          // - comptes : l'import a pu créer le compte par défaut → sinon dashboard « 0 compte / $0 ».
          // - setups : le `tradeCount` par setup change → sinon « jamais utilisé » sur le Profil.
          // Les trades/summary sont rechargés par le parent (journal) ou l'effet du dashboard.
          this.accountStore.load();
          this.setupsStore.load(true);
          // Bref signal transitoire ; le récap détaillé (trades, frais, avertissements) reste
          // un bloc à relire — il n'est PAS remplacé par ce toast (PROMPT-210).
          const n = res.data.created;
          this.toast.success(n > 0 ? `Import terminé · ${n} trade${n > 1 ? 's' : ''} importé${n > 1 ? 's' : ''}` : 'Import terminé');
          this.imported.emit(res.data);
        },
        error: (err) => {
          this.error.set(apiErrorMessage(err, "Erreur lors de l'importation"));
          this.isLoading.set(false);
          this.uploading = false;
        },
      });
  }

  reset() {
    this.result.set(null);
    this.error.set(null);
    this.selectedFile.set(null);
    this.totalFees.set('');
    this.feesDisabledReason.set(null);
    this.source.set('tradovate');
    this.uploading = false;
    // Nouveau lot = nouvelle décision : sans ça, un import « quand même » aurait
    // dispensé de confirmation tous les imports suivants de la session.
    this.feesConfirmed = false;
    this.showFeesConfirm.set(false);
    this.clearFeesFile();
  }
}
