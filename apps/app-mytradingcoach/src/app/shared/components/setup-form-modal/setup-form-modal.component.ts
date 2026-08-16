import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  output,
  signal,
} from '@angular/core';

export interface SetupFormValue {
  title: string;
  color: string;
  description: string;
}

export interface EditableSetup {
  id: string;
  title: string;
  color: string;
  description: string | null;
}

// Palette des couleurs (alignée sur le backend SETUP_PALETTE + le proto).
export const SETUP_PALETTE = [
  '#10b981', '#3b82f6', '#60a5fa', '#22d3ee',
  '#f59e0b', '#8b5cf6', '#a78bfa', '#ef4444',
];

/**
 * Modale de formulaire setup PARTAGÉE (Profil, wizard, import CSV).
 * Émet `save` / `cancel` : la persistance est gérée par le parent (store).
 */
@Component({
  selector: 'mtc-setup-form-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './setup-form-modal.component.css',
  template: `
    <div class="stp-ov open" role="button" tabindex="0"
      (click)="cancelled.emit()" (keyup.escape)="cancelled.emit()">
      <div class="stp-modal" role="dialog" aria-modal="true"
        [attr.aria-label]="isEdit() ? 'Modifier le setup' : 'Nouveau setup'"
        (click)="$event.stopPropagation()" (keydown)="$event.stopPropagation()">
        <div class="stp-mh">
          <h3>{{ isEdit() ? 'Modifier le setup' : 'Nouveau setup' }}</h3>
          <button class="stp-mx" type="button" (click)="cancelled.emit()" aria-label="Fermer">×</button>
        </div>

        <div class="stp-mb">
          <div class="stp-fld">
            <div class="stp-fld-label">Nom du setup</div>
            <input class="stp-inp" maxlength="40" [value]="title()"
              (input)="title.set($any($event.target).value)"
              placeholder="ex. ORB 5min, Liquidity grab…" />
            <div class="stp-hp">C'est le label de la chip que tu sélectionnes sur chaque trade.</div>
          </div>

          <div class="stp-fld">
            <div class="stp-fld-label">Couleur</div>
            <div class="stp-sws">
              @for (c of PALETTE; track c) {
                <button type="button" class="stp-sw" [class.sel]="color() === c"
                  [style.background]="c" [attr.aria-label]="'Couleur ' + c"
                  (click)="color.set(c)"></button>
              }
            </div>
            <div class="stp-pvc">
              <span class="cd" [style.background]="color()"></span>
              <span>{{ title().trim() || 'Aperçu' }}</span>
            </div>
          </div>

          <div class="stp-fld">
            <div class="stp-fld-label">Description <span class="opt">(optionnelle)</span></div>
            <textarea class="stp-inp" maxlength="160" [value]="description()"
              (input)="description.set($any($event.target).value)"
              placeholder="Conditions d'entrée, contexte… ce que ce setup veut dire pour toi."></textarea>
          </div>
        </div>

        <div class="stp-mf">
          <span></span>
          <div class="stp-fr">
            <button class="stp-bc" type="button" (click)="cancelled.emit()">Annuler</button>
            <button class="stp-bs" type="button" [disabled]="!canSave()" (click)="onSave()">
              Enregistrer
            </button>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class SetupFormModalComponent {
  readonly editSetup = input<EditableSetup | null>(null);
  readonly save = output<SetupFormValue>();
  readonly cancelled = output<void>();

  protected readonly PALETTE = SETUP_PALETTE;
  protected readonly title = signal('');
  protected readonly color = signal(SETUP_PALETTE[0]);
  protected readonly description = signal('');

  constructor() {
    // Pré-remplit en édition, reset en création.
    effect(() => {
      const s = this.editSetup();
      this.title.set(s?.title ?? '');
      this.color.set(s?.color ?? SETUP_PALETTE[0]);
      this.description.set(s?.description ?? '');
    });
  }

  protected readonly isEdit = computed(() => !!this.editSetup());
  protected readonly canSave = computed(() => {
    const t = this.title().trim();
    return t.length > 0 && t.length <= 40;
  });

  protected onSave(): void {
    if (!this.canSave()) return;
    this.save.emit({
      title: this.title().trim(),
      color: this.color(),
      description: this.description().trim(),
    });
  }
}
