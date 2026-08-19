import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpClient } from '@angular/common/http';
import {
  LucideAngularModule,
  X,
  Upload,
  CheckCircle,
  AlertCircle,
  Zap,
  FileText,
  Check,
} from 'lucide-angular';
import { environment } from '../../../environments/environment';
import { parseDecimal } from '../../core/utils/parse-decimal';
import { SelectedAccountStore } from '../../core/stores/selected-account.store';
import { SetupsStore } from '../../core/stores/setups.store';

interface ImportResult {
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
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './csv-import.component.css',
  template: `
    @if (open()) {
      <div
        class="overlay"
        role="button"
        tabindex="-1"
        (click)="onOverlayClick($event)"
        (keydown.escape)="dismissed.emit()"
      >
        <div class="modal" data-testid="csv-import-modal">
          <div class="modal-header">
            <span class="modal-title">Importer CSV</span>
            <button class="close-btn" (click)="dismissed.emit()">
              <lucide-icon [img]="XIcon" [size]="16" />
            </button>
          </div>

          @if (result()) {
            <div class="result-block">
              @if (result()!.created > 0) {
                <lucide-icon
                  [img]="CheckCircleIcon"
                  [size]="32"
                  color="var(--green)"
                />
                <p class="result-title">
                  {{ result()!.created }} trade(s) importé(s) !
                </p>
              } @else {
                <p class="result-title">Aucun nouveau trade</p>
              }
              @if (result()!.duplicates > 0) {
                <p class="result-sub">
                  {{ result()!.duplicates }} doublon(s) ignoré(s) (déjà présents)
                </p>
              }
              @if (result()!.failed > 0) {
                <p class="result-sub">
                  {{ result()!.failed }} ligne(s) ignorée(s) (format invalide)
                </p>
              }
              @if (result()!.feesImported; as f) {
                @if (f.merged === false) {
                  <!-- Fichier de frais fourni mais inexploitable : le dire, plutôt que
                       de laisser croire à un P&L net alors qu'il est brut. -->
                  <p class="result-sub result-fees-warn" data-testid="import-fees-warning">
                    ⚠ Frais non rapprochés · P&L brut affiché
                    <span class="result-fees-hint">
                      Ton Cash history n'a pas pu être lu : réexporte-le depuis Tradovate
                      (Transaction ID · Delta · Cash Change Type), ou saisis le total des frais.
                    </span>
                  </p>
                } @else {
                  <p class="result-sub result-fees">
                    Frais importés : {{ f.assigned.toFixed(2) }} $ sur {{ f.count }} trade(s)
                    @if (!f.reconciled) {
                      <span class="result-fees-warn"> · frais partiellement rapprochés</span>
                    }
                  </p>
                }
              }
              <!-- Note informative (non bloquante) : les exports broker n'ont ni SL ni TP → R:R et note d'exécution indispo. -->
              @if (result()!.created > 0) {
                <p class="import-no-stop-note">
                  Tes trades n'ont ni stop loss ni take profit : c'est normal, ton broker ne les exporte pas.
                  Le R:R et la note d'exécution resteront indisponibles pour ces trades.
                </p>
              }
              <button class="btn-primary" (click)="reset()">
                Importer un autre fichier
              </button>
              <button class="btn-ghost" (click)="dismissed.emit()">
                Fermer
              </button>
            </div>
          } @else if (error()) {
            <div class="result-block">
              <lucide-icon
                [img]="AlertCircleIcon"
                [size]="32"
                color="var(--red)"
              />
              <p class="result-title">Erreur d'importation</p>
              <p class="result-sub">{{ error() }}</p>
              <button class="btn-primary" (click)="reset()">Réessayer</button>
            </div>
          } @else {
            <!-- Écran de sélection unique (source → panneau inline → options → footer). PROMPT-164. -->
            <div class="import-screen">

              <!-- 1. Sélecteur de source (masqué en onboarding : allowFeesFile=false) -->
              @if (allowFeesFile()) {
                <div class="import-field">
                  <span class="import-label">Source</span>
                  <div class="src-grid">
                    <button type="button" class="src-btn" [class.active]="source() === 'tradovate'"
                            (click)="setSource('tradovate')">
                      @if (source() === 'tradovate') {
                        <lucide-icon [img]="CheckIcon" [size]="14" class="src-check" />
                      }
                      <lucide-icon [img]="ZapIcon" [size]="18" class="src-ic" />
                      <span class="src-name">Tradovate</span>
                      <span class="src-tag src-tag-green">Frais exacts</span>
                    </button>
                    <button type="button" class="src-btn" [class.active]="source() === 'other'"
                            (click)="setSource('other')">
                      @if (source() === 'other') {
                        <lucide-icon [img]="CheckIcon" [size]="14" class="src-check" />
                      }
                      <lucide-icon [img]="FileTextIcon" [size]="18" class="src-ic" />
                      <span class="src-name">Autre broker</span>
                      <span class="src-sub">Binance · MT4/5 · Bybit · MEXC · IBKR</span>
                    </button>
                  </div>
                </div>
              }

              <!-- 2. Panneau selon la source (dropzone direct en onboarding) -->
              @if (allowFeesFile() && source() === 'tradovate') {
                <!-- Tradovate : deux fichiers inline -->
                <div class="import-field">
                  <label class="import-label" for="tvTradesInput">
                    Fichier des trades <span class="src-tag">Performance · requis</span>
                  </label>
                  @if (selectedFile()) {
                    <div class="file-pill">
                      <lucide-icon [img]="UploadIcon" [size]="16" color="var(--blue)" />
                      <span class="file-name">{{ selectedFile()!.name }}</span>
                      <button class="file-x" (click)="clearTradesFile()" aria-label="Retirer le fichier">
                        <lucide-icon [img]="XIcon" [size]="14" />
                      </button>
                    </div>
                  } @else {
                    <button class="file-choose" (click)="tvTradesInput.click()">Choisir un fichier</button>
                  }
                  <input #tvTradesInput id="tvTradesInput" type="file" data-testid="import-trades-input"
                    accept=".csv,.txt,.xlsx,.xls" style="display:none" (change)="onFileChange($event)" />
                </div>

                <div class="import-field">
                  <label class="import-label" for="tvFeesInput">
                    Fichier des frais <span class="src-tag src-tag-green">Cash history · optionnel</span>
                  </label>
                  @if (feesFile()) {
                    <div class="file-pill">
                      <lucide-icon [img]="UploadIcon" [size]="16" color="var(--blue)" />
                      <span class="file-name">{{ feesFile()!.name }}</span>
                      <button class="file-x" (click)="clearFeesFile()" aria-label="Retirer le fichier">
                        <lucide-icon [img]="XIcon" [size]="14" />
                      </button>
                    </div>
                    @if (!feesFileValid()) {
                      <p class="import-help import-warn">
                        Ce fichier ne ressemble pas à un Cash history Tradovate. Vérifie l'export.
                      </p>
                    }
                  } @else {
                    <button class="file-choose" (click)="tvFeesInput.click()">Choisir un fichier</button>
                  }
                  <input #tvFeesInput id="tvFeesInput" type="file" data-testid="import-fees-input"
                    accept=".csv,.txt,.xlsx,.xls" style="display:none" (change)="onFeesFileChange($event)" />
                </div>

                <p class="import-help">
                  Ajoute le Cash history et tes frais sont exacts au centime, sans saisie manuelle.
                </p>
              } @else {
                <!-- Autre broker / onboarding : dropzone -->
                <div
                  class="drop-zone"
                  role="button"
                  tabindex="0"
                  [class.drag-over]="isDragging()"
                  (dragover)="onDragOver($event)"
                  (dragleave)="isDragging.set(false)"
                  (drop)="onDrop($event)"
                  (click)="fileInput.click()"
                  (keydown.enter)="fileInput.click()"
                  (keydown.space)="fileInput.click()"
                >
                  <lucide-icon [img]="UploadIcon" [size]="28" color="var(--text-3)" />
                  <p class="drop-title">Glisse ton CSV ici</p>
                  <p class="drop-sub">Tradovate · Binance · MetaTrader · Bybit · ou tout autre broker</p>
                  <span class="drop-btn">Parcourir</span>
                </div>
                <p class="drop-hint">
                  CSV ou Excel · exporte tes <strong>trades fermés</strong> depuis ton broker · jusqu'à 2000 trades
                </p>
                @if (selectedFile()) {
                  <div class="file-pill">
                    <lucide-icon [img]="UploadIcon" [size]="16" color="var(--blue)" />
                    <span class="file-name">{{ selectedFile()!.name }}</span>
                    <button class="file-x" (click)="clearFile()" aria-label="Retirer le fichier">
                      <lucide-icon [img]="XIcon" [size]="14" />
                    </button>
                  </div>
                }
                <input #fileInput type="file" accept=".csv,.txt,.xlsx,.xls" style="display:none" (change)="onFileChange($event)" />
              }

              <!-- 3. Options communes (compte / émotion / setup) -->
              <!-- Compte cible (corrige le rattachement multi-compte) -->
              @if (accountStore.activeAccounts().length > 0) {
                <div class="import-field">
                  <label class="import-label" for="importAccount">Importer dans le compte</label>
                  <select
                    id="importAccount"
                    class="import-select"
                    [value]="accountId()"
                    (change)="accountId.set($any($event.target).value)"
                  >
                    <option value="" disabled>Choisis le compte</option>
                    @for (a of accountStore.activeAccounts(); track a.id) {
                      <option [value]="a.id">{{ a.label }}</option>
                    }
                  </select>
                </div>
              }

              <!-- Émotion en lot (optionnel, override de l'humeur de session) -->
              <div class="import-field">
                <label class="import-label" for="importEmotion">Émotion (optionnel, appliquée à tout le lot)</label>
                <select
                  id="importEmotion"
                  class="import-select"
                  [value]="emotion()"
                  (change)="emotion.set($any($event.target).value)"
                >
                  <option value="">- Non renseignée</option>
                  @for (e of EMOTIONS; track e) {
                    <option [value]="e">{{ emotionEmoji(e) }} {{ e }}</option>
                  }
                </select>
                <p class="import-help">Laisse « Non renseignée » pour hériter de l'humeur de ta session ; tu pourras affiner trade par trade ensuite.</p>
              </div>

              <!-- Setup en lot (setups actifs du user) -->
              @if (setups().length > 0) {
                <div class="import-field">
                  <label class="import-label" for="importSetup">Setup (appliqué à tous les trades)</label>
                  <div class="import-setup-row">
                    <span class="setup-dot" [style.background]="selectedSetupColor()"></span>
                    <select
                      id="importSetup"
                      class="import-select"
                      [value]="setupId()"
                      (change)="setupId.set($any($event.target).value)"
                    >
                      @for (s of setups(); track s.id) {
                        <option [value]="s.id">{{ s.title }}</option>
                      }
                    </select>
                  </div>
                </div>
              }

              <!-- 4. Validation + footer -->
              @if (!canImport()) {
                <p class="import-help import-warn">Choisis le compte de destination pour importer.</p>
              }
              <div class="modal-footer">
                <button class="btn-ghost" (click)="dismissed.emit()">Annuler</button>
                <button
                  class="btn-primary"
                  data-testid="import-submit"
                  (click)="upload()"
                  [disabled]="!canSubmit() || isLoading()"
                >
                  @if (isLoading()) {
                    <span class="spinner spinner-sm"></span> Import…
                  } @else {
                    Importer
                  }
                </button>
              </div>
            </div>
          }
        </div>
      </div>
    }
  `,
})
export class CsvImportComponent {
  readonly open = input(false);
  /** Affiche le sélecteur « Fichier des frais » (Tradovate Cash history). Onboarding → false. */
  readonly allowFeesFile = input(true);
  readonly dismissed = output<void>();
  readonly imported = output<void>();

  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly accountStore = inject(SelectedAccountStore);
  private readonly setupsStore = inject(SetupsStore);

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
  // Source d'import sélectionnée (PROMPT-164) : Tradovate (2 fichiers) présélectionné, ou autre broker (dropzone).
  protected readonly source = signal<'tradovate' | 'other'>('tradovate');

  // Defaults appliqués à tout le lot.
  protected readonly accountId = signal<string>('');
  // Émotion de lot optionnelle (PROMPT-163) : '' = non renseignée (rien envoyé → héritera de la session).
  protected readonly emotion = signal<string>('');
  protected readonly setupId = signal<string>('');
  // Setups actifs du user (store partagé, liste dynamique).
  protected readonly setups = this.setupsStore.active;

  /** Couleur du setup sélectionné (pastille à côté du select). */
  protected readonly selectedSetupColor = computed(
    () => this.setups().find((s) => s.id === this.setupId())?.color ?? 'transparent',
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
      if (this.open()) untracked(() => this.initAccountSelection());
    });
  }

  /** Sélecteur de source (PROMPT-164). Passer à « Autre » retire le fichier de frais (Tradovate-only). */
  protected setSource(s: 'tradovate' | 'other'): void {
    this.source.set(s);
    this.error.set(null);
    if (s === 'other') this.clearFeesFile();
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
    const reader = new FileReader();
    reader.onload = () => {
      const header = String(reader.result ?? '').split(/\r?\n/)[0]?.toLowerCase() ?? '';
      this.feesFileValid.set(
        header.includes('transaction id') && header.includes('cash change type'),
      );
    };
    reader.onerror = () => this.feesFileValid.set(false);
    reader.readAsText(file);
  }

  protected clearFeesFile() {
    this.feesFile.set(null);
    this.feesFileValid.set(false);
  }

  // Étape 2 : confirmation → upload avec les frais éventuels.
  protected upload() {
    const file = this.selectedFile();
    if (!file || !this.canImport()) return;

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

    this.http
      .post<{ data: ImportResult }>(
        `${environment.apiUrl}/trades/import`,
        formData,
      )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.result.set(res.data);
          this.isLoading.set(false);
          // Refresh coordonné des stores globalement périmés par l'import (PROMPT-175) :
          // - comptes : l'import a pu créer le compte par défaut → sinon dashboard « 0 compte / $0 ».
          // - setups : le `tradeCount` par setup change → sinon « jamais utilisé » sur le Profil.
          // Les trades/summary sont rechargés par le parent (journal) ou l'effet du dashboard.
          this.accountStore.load();
          this.setupsStore.load(true);
          this.imported.emit();
        },
        error: (err) => {
          this.error.set(err.error?.message ?? "Erreur lors de l'importation");
          this.isLoading.set(false);
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
    this.clearFeesFile();
  }
}
