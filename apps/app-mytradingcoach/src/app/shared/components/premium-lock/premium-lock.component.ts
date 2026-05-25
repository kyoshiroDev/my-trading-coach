import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'mtc-premium-lock',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './premium-lock.component.css',
  imports: [RouterLink],
  template: `
    <div class="premium-lock" data-testid="premium-lock">
      <div class="pl-content">
        <span class="pl-icon">✦</span>
        <div class="pl-text">
          <div class="pl-title">{{ title() }}</div>
          @if (subtitle()) {
            <div class="pl-sub">{{ subtitle() }}</div>
          }
        </div>
        <a routerLink="/parametres" [queryParams]="{ upgrade: true }" class="pl-btn">
          Essayer 7 jours →
        </a>
      </div>
    </div>
  `,
})
export class PremiumLockComponent {
  readonly title    = input<string>('Fonctionnalité Premium');
  readonly subtitle = input<string>('');
}
