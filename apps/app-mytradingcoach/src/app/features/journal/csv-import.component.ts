import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpClient } from '@angular/common/http';
import {
  LucideAngularModule,
  X,
  Upload,
  CheckCircle,
  AlertCircle,
} from 'lucide-angular';
import { environment } from '../../../environments/environment';

interface ImportResult {
  created: number;
  duplicates: number;
  failed: number;
  limitBlocked: number;
  total: number;
}

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
        <div class="modal">
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
              @if (result()!.limitBlocked > 0) {
                <p class="result-sub result-limit">
                  {{ result()!.limitBlocked }} non importé(s) — limite FREE atteinte
                  (30/mois). Passe Starter pour l'illimité.
                </p>
              }
              @if (result()!.failed > 0) {
                <p class="result-sub">
                  {{ result()!.failed }} ligne(s) ignorée(s) (format invalide)
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
          } @else if (selectedFile() && !isLoading()) {
            <div class="confirm-block">
              <div class="file-pill">
                <lucide-icon [img]="UploadIcon" [size]="16" color="var(--blue)" />
                <span class="file-name">{{ selectedFile()!.name }}</span>
                <button class="file-change" (click)="clearFile()">Changer</button>
              </div>

              @switch (feesDisabledReason()) {
                @case ('has_fees_column') {
                  <p class="fees-note">
                    ✓ Frais détectés dans ton fichier — ils sont déjà pris en
                    compte. Pas besoin de les saisir.
                  </p>
                }
                @case ('too_many') {
                  <p class="fees-note">
                    Import volumineux (plus de 100 trades). Les frais ne peuvent
                    pas être saisis en un total global sur autant de trades —
                    importe par période plus courte pour les inclure.
                  </p>
                }
                @default {
                  <div class="fees-field">
                    <label class="fees-label" for="totalFees">
                      Total des frais (optionnel)
                    </label>
                    <div class="fees-input-wrap">
                      <input
                        id="totalFees"
                        type="number"
                        min="0"
                        step="0.01"
                        inputmode="decimal"
                        placeholder="0,00"
                        class="fees-input"
                        [value]="totalFees()"
                        (input)="totalFees.set($any($event.target).value)"
                      />
                      <span class="fees-unit">€</span>
                    </div>
                    <p class="fees-help">
                      Indique le total des commissions de ton broker pour cet import
                      (ex. 7,28). Le P&amp;L sera affiché net de frais. Laisse vide si
                      déjà inclus.
                    </p>
                  </div>
                }
              }

              <button class="btn-primary" (click)="upload()">Importer</button>
            </div>
          } @else {
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
              <lucide-icon
                [img]="UploadIcon"
                [size]="28"
                color="var(--text-3)"
              />
              <p class="drop-title">
                @if (isLoading()) {
                  Analyse en cours...
                } @else {
                  Glisse ton CSV ici
                }
              </p>
              <p class="drop-sub">
                @if (isLoading()) {
                  L'IA structure tes trades…
                } @else {
                  Tradovate · Binance · MetaTrader · Bybit · ou tout autre
                  broker
                }
              </p>
              @if (!isLoading()) {
                <span class="drop-btn">Parcourir</span>
              } @else {
                <div class="spinner"></div>
              }
            </div>
            <p class="drop-hint">
              CSV ou Excel · exporte tes <strong>trades fermés</strong> depuis ton
              broker · jusqu'à 2000 trades
            </p>
            <input
              #fileInput
              type="file"
              accept=".csv,.txt,.xlsx,.xls"
              style="display:none"
              (change)="onFileChange($event)"
            />
          }
        </div>
      </div>
    }
  `,
})
export class CsvImportComponent {
  readonly open = input(false);
  readonly dismissed = output<void>();
  readonly imported = output<void>();

  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly XIcon = X;
  protected readonly UploadIcon = Upload;
  protected readonly CheckCircleIcon = CheckCircle;
  protected readonly AlertCircleIcon = AlertCircle;

  protected readonly isDragging = signal(false);
  protected readonly isLoading = signal(false);
  protected readonly result = signal<ImportResult | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly selectedFile = signal<File | null>(null);
  protected readonly totalFees = signal<string>('');
  // null = champ frais actif ; sinon raison de désactivation.
  protected readonly feesDisabledReason = signal<null | 'has_fees_column' | 'too_many'>(null);

  /** Au-delà : un total global réparti au prorata donnerait des frais faux. */
  private readonly FEES_INPUT_MAX_TRADES = 100;

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
    this.selectedFile.set(null);
    this.totalFees.set('');
    this.feesDisabledReason.set(null);
  }

  // Étape 2 : confirmation → upload avec les frais éventuels.
  protected upload() {
    const file = this.selectedFile();
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file, file.name);

    const fees = parseFloat(this.totalFees().replace(',', '.'));
    if (this.feesDisabledReason() === null && Number.isFinite(fees) && fees > 0) {
      formData.append('totalFees', String(fees));
    }

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
  }
}
