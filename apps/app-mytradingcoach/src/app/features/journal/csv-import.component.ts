import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpClient } from '@angular/common/http';
import {
  LucideAngularModule,
  X,
  Upload,
  CheckCircle,
  AlertCircle,
} from 'lucide-angular';
import { UserStore } from '../../core/stores/user.store';
import { environment } from '../../../environments/environment';

interface ImportResult {
  created: number;
  failed: number;
  total: number;
}

@Component({
  selector: 'mtc-csv-import',
  standalone: true,
  imports: [RouterLink, LucideAngularModule],
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

          @if (!userStore.isPremium()) {
            <div class="paywall">
              <div class="paywall-icon">⚡</div>
              <div class="paywall-title">Fonctionnalité Premium</div>
              <div class="paywall-desc">
                L'import CSV avec analyse IA est disponible avec le plan
                Premium.
              </div>
              <a
                routerLink="/settings"
                class="btn-upgrade"
                (click)="dismissed.emit()"
              >
                Essayer 7 jours gratuit →
              </a>
            </div>
          } @else if (result()) {
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
            <p class="drop-hint">Fichiers CSV ou TXT · max 5 Mo</p>
            <input
              #fileInput
              type="file"
              accept=".csv,.txt"
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

  protected readonly userStore = inject(UserStore);
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
    if (file) this.upload(file);
  }

  onFileChange(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) this.upload(file);
  }

  private upload(file: File) {
    const formData = new FormData();
    formData.append('file', file, file.name);
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
  }
}
