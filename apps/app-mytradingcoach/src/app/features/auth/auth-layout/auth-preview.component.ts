import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * Aperçu « Éval Apex 50K · En séance » de la colonne de présentation : données de démonstration
 * figées, format de la carte Drawdown validé le 20/10 (départ 50 000 $, limite du plan 48 000 $,
 * point « marge min »). Statique à dessein : la vraie carte de suivi (`mtc-live-prop-firm`) lit ses
 * stores et ouvre le socket Tradovate, et `mtc-perf-chart` mettrait Chart.js dans le bundle initial.
 */
@Component({
  selector: 'mtc-auth-preview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './auth-preview.component.css',
  templateUrl: './auth-preview.component.html',
})
export class AuthPreviewComponent {}
