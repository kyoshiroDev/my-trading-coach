import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { SetupsApi, Setup, CreateSetupDto, UpdateSetupDto } from '../api/setups.api';

/**
 * Setups du user (signaux) + CRUD optimiste avec rollback.
 * Source unique pour le sélecteur de trade, le Profil et l'import CSV.
 */
@Injectable({ providedIn: 'root' })
export class SetupsStore {
  private readonly api = inject(SetupsApi);

  readonly setups = signal<Setup[]>([]);
  readonly loaded = signal(false);
  readonly isLoading = signal(false);

  readonly active = computed(() =>
    this.setups().filter((s) => !s.archived).sort((a, b) => a.sortOrder - b.sortOrder),
  );
  readonly archived = computed(() =>
    this.setups().filter((s) => s.archived).sort((a, b) => a.sortOrder - b.sortOrder),
  );

  /** Réinitialise le store (logout) : évite d'afficher les setups du user précédent. */
  reset(): void {
    this.setups.set([]);
    this.loaded.set(false);
    this.isLoading.set(false);
  }

  /** Charge la liste (une fois, sauf force). */
  load(force = false): void {
    if ((this.loaded() || this.isLoading()) && !force) return;
    this.isLoading.set(true);
    this.api.list().subscribe({
      next: (res) => {
        this.setups.set(res.data ?? []);
        this.loaded.set(true);
        this.isLoading.set(false);
      },
      error: () => this.isLoading.set(false),
    });
  }

  create(dto: CreateSetupDto, onDone?: (s: Setup) => void, onError?: (msg: string) => void): void {
    // Pas optimiste (id serveur requis) : on ajoute à la réponse.
    this.api.create(dto).subscribe({
      next: (res) => {
        const created: Setup = { ...res.data, tradeCount: res.data.tradeCount ?? 0 };
        this.setups.update((list) => [...list, created]);
        onDone?.(created);
      },
      error: (e) => onError?.(this.msg(e)),
    });
  }

  update(id: string, dto: UpdateSetupDto, onDone?: () => void, onError?: (msg: string) => void): void {
    const prev = this.setups();
    this.setups.update((list) => list.map((s) => (s.id === id ? { ...s, ...dto } : s)));
    this.api.update(id, dto).subscribe({
      next: (res) => {
        this.setups.update((list) => list.map((s) => (s.id === id ? { ...s, ...res.data } : s)));
        onDone?.();
      },
      error: (e) => {
        this.setups.set(prev); // rollback
        onError?.(this.msg(e));
      },
    });
  }

  archive(id: string, onError?: (msg: string) => void): void {
    this.toggleArchived(id, true, () => this.api.archive(id), onError);
  }
  restore(id: string, onError?: (msg: string) => void): void {
    this.toggleArchived(id, false, () => this.api.restore(id), onError);
  }

  remove(id: string, onError?: (msg: string) => void): void {
    const prev = this.setups();
    this.setups.update((list) => list.filter((s) => s.id !== id)); // optimiste
    this.api.delete(id).subscribe({
      error: (e) => {
        this.setups.set(prev); // rollback
        onError?.(this.msg(e));
      },
    });
  }

  private toggleArchived(
    id: string,
    archived: boolean,
    call: () => ReturnType<SetupsApi['archive']>,
    onError?: (msg: string) => void,
  ): void {
    const prev = this.setups();
    this.setups.update((list) => list.map((s) => (s.id === id ? { ...s, archived } : s)));
    call().subscribe({
      error: (e) => {
        this.setups.set(prev); // rollback
        onError?.(this.msg(e));
      },
    });
  }

  private msg(e: unknown): string {
    return (e instanceof HttpErrorResponse && e.error?.message) || 'Une erreur est survenue.';
  }
}
