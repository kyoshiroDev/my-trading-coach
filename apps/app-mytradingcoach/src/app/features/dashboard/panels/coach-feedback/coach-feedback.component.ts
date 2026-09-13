import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  LucideDynamicIcon,
  LucideCheckCircle2 as CheckCircle2,
  LucideAlertTriangle as AlertTriangle,
  LucideXCircle as XCircle,
  LucideLock as Lock,
} from '@lucide/angular';
import { CoachInsight } from '../../dashboard-charts.util';

/**
 * Corps de la carte « AI Coach » : insights (Premium), invitation à logger des trades
 * (Premium sans données), ou verrou avec CTA (FREE).
 */
@Component({
  selector: 'mtc-coach-feedback',
  imports: [RouterLink, LucideDynamicIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './coach-feedback.component.css',
  template: `
    @if (premium()) {
      @if (insights().length) {
        <div class="mtc-coach-list">
          @for (i of insights(); track i.text) {
            <div class="mtc-coach-item">
              <svg [lucideIcon]="coachIcon(i.tone)" [size]="16" [style.color]="coachColor(i.tone)" class="mtc-coach-item-ic"></svg>
              <span class="mtc-coach-item-t">{{ i.text }}</span>
            </div>
          }
          <a routerLink="/analytics" class="mtc-coach-btn">Voir mon coaching complet</a>
        </div>
      } @else {
        <div class="mtc-coach-cta">
          <div class="mtc-coach-ic">✨</div>
          <div class="mtc-coach-t">Ton coach analyse tes patterns</div>
          <div class="mtc-coach-s">Enregistre quelques trades pour débloquer tes premiers insights personnalisés.</div>
          <a routerLink="/analytics" class="mtc-coach-btn">Voir mon coaching complet</a>
        </div>
      }
    } @else {
      <div class="mtc-coach-lock">
        <div class="mtc-lock-ic"><svg [lucideIcon]="LockIcon" [size]="20"></svg></div>
        <div class="mtc-lock-t">Coach IA réservé au Premium</div>
        <div class="mtc-lock-s">Analyse de tes patterns, chat coach IA et recommandations personnalisées.</div>
        <button class="mtc-lock-cta" (click)="unlock.emit()">Débloquer à {{ monthlyPrice() }} €/mois</button>
      </div>
    }
  `,
})
export class CoachFeedbackComponent {
  readonly premium = input(false);
  readonly insights = input<CoachInsight[]>([]);
  readonly monthlyPrice = input<number | string>('');
  readonly unlock = output<void>();

  protected readonly LockIcon = Lock;
  protected coachIcon(tone: string) { return tone === 'good' ? CheckCircle2 : tone === 'warn' ? AlertTriangle : XCircle; }
  protected coachColor(tone: string) { return tone === 'good' ? 'var(--green)' : tone === 'warn' ? 'var(--yellow)' : 'var(--red)'; }
}
