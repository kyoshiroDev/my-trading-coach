import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { EquityGlow } from '../../dashboard-charts.util';

/** Courbe d'équité « glow » (SVG) : aire, tendance pointillée, point final pulsé. */
@Component({
  selector: 'mtc-equity-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './equity-chart.component.css',
  template: `
    @let eg = glow();
    <svg class="mtc-equity" [attr.viewBox]="'0 0 ' + eg.W + ' ' + eg.H" preserveAspectRatio="none">
      <defs>
        <linearGradient id="mtcEqFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" [attr.stop-color]="eg.color" stop-opacity="0.35" />
          <stop offset="100%" [attr.stop-color]="eg.color" stop-opacity="0" />
        </linearGradient>
        <filter id="mtcEqGlow" x="-20%" y="-50%" width="140%" height="200%">
          <feGaussianBlur stdDeviation="3.4" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <path [attr.d]="eg.area" fill="url(#mtcEqFill)" />
      <path [attr.d]="eg.trend" fill="none" stroke="rgba(143,163,191,.4)" stroke-width="1" stroke-dasharray="3 4" />
      <path [attr.d]="eg.line" fill="none" [attr.stroke]="eg.color" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round" filter="url(#mtcEqGlow)" />
      <circle class="mtc-eq-pulse" [attr.cx]="eg.lastX" [attr.cy]="eg.lastY" r="7" [attr.fill]="eg.color" opacity="0.25" />
      <circle [attr.cx]="eg.lastX" [attr.cy]="eg.lastY" r="3.4" [attr.fill]="eg.color" />
    </svg>
  `,
})
export class EquityChartComponent {
  readonly glow = input.required<EquityGlow>();
}
