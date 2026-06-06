import { Directive, ElementRef, HostListener, inject, input } from '@angular/core';

/**
 * Filtre une saisie pour n'autoriser que des nombres décimaux.
 * - chiffres
 * - UN seul séparateur décimal : virgule OU point (les deux acceptés à la frappe)
 * - optionnel : signe négatif en tête (désactivé par défaut)
 *
 * Usage : <input type="text" inputmode="decimal" mtcNumericInput />
 *
 * La valeur dans le DOM est nettoyée en temps réel ; le binding (input) du
 * composant reçoit donc déjà une valeur valide. La normalisation virgule → point
 * se fait à l'envoi (util parseDecimal), pas dans le champ (l'utilisateur voit
 * ce qu'il tape).
 */
@Directive({
  selector: '[mtcNumericInput]',
  standalone: true,
})
export class NumericInputDirective {
  /** Autoriser un nombre négatif (défaut: false). */
  readonly allowNegative = input(false, { alias: 'mtcAllowNegative' });
  /** Nombre max de décimales (défaut: illimité = -1). */
  readonly maxDecimals = input(-1, { alias: 'mtcMaxDecimals' });

  private readonly el = inject<ElementRef<HTMLInputElement>>(ElementRef);

  @HostListener('input')
  onInput(): void {
    const input = this.el.nativeElement;
    const cleaned = this.sanitize(input.value);
    if (cleaned !== input.value) {
      input.value = cleaned;
      // Re-dispatch pour que le binding signal du composant lise la valeur nettoyée.
      input.dispatchEvent(new Event('input', { bubbles: false }));
    }
  }

  /** Empêche le collage de contenu non numérique. */
  @HostListener('paste', ['$event'])
  onPaste(e: ClipboardEvent): void {
    const text = e.clipboardData?.getData('text') ?? '';
    if (this.sanitize(text) !== text) {
      e.preventDefault();
      const input = this.el.nativeElement;
      input.value = this.sanitize((input.value ?? '') + text);
      input.dispatchEvent(new Event('input', { bubbles: false }));
    }
  }

  private sanitize(raw: string): string {
    if (!raw) return '';
    let s = raw;

    // Signe négatif : garder seulement s'il est autorisé ET en tête.
    let neg = '';
    if (this.allowNegative() && s.startsWith('-')) neg = '-';
    s = s.replace(/-/g, '');

    // Ne garder que chiffres, point et virgule.
    s = s.replace(/[^0-9.,]/g, '');

    // Un seul séparateur décimal : on garde le PREMIER, on retire les suivants.
    const firstSep = s.search(/[.,]/);
    if (firstSep !== -1) {
      const head = s.slice(0, firstSep + 1);
      const tail = s.slice(firstSep + 1).replace(/[.,]/g, '');
      s = head + tail;
    }

    // Limiter les décimales si demandé.
    const max = this.maxDecimals();
    if (max >= 0) {
      const sep = s.search(/[.,]/);
      if (sep !== -1) s = s.slice(0, sep + 1 + max);
    }

    return neg + s;
  }
}
