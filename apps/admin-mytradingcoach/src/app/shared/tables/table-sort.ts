import { computed, signal, type Signal } from '@angular/core';

export type SortDir = 1 | -1;
export type SortAccessor<T> = (row: T) => string | number;

/**
 * Helper de tri de tableau, réutilisable et réactif (signals).
 * Le parsing des valeurs (récence d'activité, heures de session, dates…) est
 * délégué aux accessors fournis par l'écran consommateur.
 *
 * @example
 * const sort = new TableSort<User>(
 *   { n: u => u.name.toLowerCase(), act: u => actHours(u.act), reg: u => regTime(u.reg) },
 *   'act',                 // tri par défaut : activité (récence)
 *   ['ses', 'reg'],        // ces colonnes partent en "plus grand d'abord"
 * );
 * readonly rows = sort.connect(this.users);  // Signal<User[]> trié
 * // template : (click)="sort.toggle('act')"  [class.active]="sort.isActive('act')"  {{ sort.caret('act') }}
 */
export class TableSort<T> {
  readonly key = signal<string>('');
  readonly dir = signal<SortDir>(1);

  constructor(
    private readonly accessors: Record<string, SortAccessor<T>>,
    defaultKey: string,
    private readonly descFirstKeys: readonly string[] = [],
  ) {
    this.key.set(defaultKey);
  }

  /** Renvoie un Signal trié dérivé de la source. */
  connect(source: Signal<readonly T[]>): Signal<T[]> {
    return computed(() => this.apply(source()));
  }

  /** Tri immédiat d'un tableau (lecture des signals key/dir → réactif si dans un computed). */
  apply(rows: readonly T[]): T[] {
    const acc = this.accessors[this.key()];
    const out = [...rows];
    if (!acc) return out;
    const d = this.dir();
    return out.sort((a, b) => {
      const x = acc(a);
      const y = acc(b);
      return (x < y ? -1 : x > y ? 1 : 0) * d;
    });
  }

  /** Clic d'en-tête : inverse si déjà actif, sinon active (sens par défaut selon descFirstKeys). */
  toggle(k: string): void {
    if (k === this.key()) {
      this.dir.update((v) => (v * -1) as SortDir);
    } else {
      this.key.set(k);
      this.dir.set(this.descFirstKeys.includes(k) ? -1 : 1);
    }
  }

  isActive(k: string): boolean {
    return this.key() === k;
  }

  /** Chevron à afficher dans l'en-tête (▲/▼ si actif, vide sinon). */
  caret(k: string): string {
    return this.key() === k ? (this.dir() > 0 ? '▲' : '▼') : '';
  }
}