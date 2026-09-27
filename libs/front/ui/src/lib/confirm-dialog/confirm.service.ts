import { Injectable, signal } from '@angular/core';

export interface ConfirmOptions {
  title: string;
  /** Explication de ce qui va se passer (montant, nom, conséquence). */
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Action destructive ou irréversible : bouton de confirmation rouge. */
  danger?: boolean;
}

interface PendingConfirm extends ConfirmOptions {
  resolve: (confirmed: boolean) => void;
}

/**
 * Demande de confirmation accessible, à la place de `window.confirm()` (non stylé, validé par
 * réflexe, et bloquant). Afficher `<mtc-confirm-dialog />` une fois dans le composant racine.
 *
 *   if (!(await this.confirm.ask({ title: 'Supprimer ?', message: '…', danger: true }))) return;
 */
@Injectable({ providedIn: 'root' })
export class ConfirmService {
  private readonly _pending = signal<PendingConfirm | null>(null);
  /** Demande en cours, lue par ConfirmDialogComponent. */
  readonly pending = this._pending.asReadonly();

  ask(options: ConfirmOptions): Promise<boolean> {
    // Une nouvelle demande annule la précédente (jamais deux dialogues empilés).
    this._pending()?.resolve(false);
    return new Promise((resolve) => this._pending.set({ ...options, resolve }));
  }

  /** Ferme le dialogue avec la réponse de l'utilisateur. */
  answer(confirmed: boolean): void {
    const pending = this._pending();
    this._pending.set(null);
    pending?.resolve(confirmed);
  }
}
