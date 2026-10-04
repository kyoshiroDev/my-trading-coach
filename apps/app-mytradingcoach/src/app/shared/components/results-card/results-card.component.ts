import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RESULTS_CARD_SIZE, ResultsCardData, ResultsCardFormat, referralDisplay } from './results-card.util';

/**
 * Carte de résultats (débrief de fin de session) rendue à taille réelle — 1080×1080 ou
 * 1080×1920 — pour être convertie en PNG côté client. Maquettes : artefact Design
 * « Carte de résultats — partage Instagram » (Main.dc / ResultsCardStory.dc).
 */
@Component({
  selector: 'mtc-results-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './results-card.component.css',
  templateUrl: './results-card.component.html',
  host: {
    '[class.story]': "format() === 'story'",
    '[class.split]': '!!chartUrl()',
    '[style.width.px]': 'size().width',
    '[style.height.px]': 'size().height',
  },
})
export class ResultsCardComponent {
  readonly format = input<ResultsCardFormat>('square');
  readonly data = input.required<ResultsCardData>();
  /**
   * Screenshot de graphique fourni par l'utilisateur (URL locale `blob:`), facultatif.
   * Présent → deux panneaux : côte à côte en carré, empilés en Story (une moitié de
   * 540×1920 rendrait un graphique paysage illisible).
   */
  readonly chartUrl = input<string | null>(null);

  protected readonly size = computed(() => RESULTS_CARD_SIZE[this.format()]);
  protected readonly link = computed(() => referralDisplay(this.data().referralCode));
  /** « +$12,345.67 » ou « +1,234.50 USDT » ne tiennent pas à 142 px sur 920 px utiles. */
  protected readonly pnlLength = computed(() => {
    const n = this.data().pnlLabel.length;
    return n > 13 ? 'xlong' : n > 9 ? 'long' : 'normal';
  });
}
