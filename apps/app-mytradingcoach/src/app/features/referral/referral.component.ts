import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ReferralApi, MyReferral, FilleulStatus } from '../../core/api/referral.api';

const GOAL = 12; // 12 filleuls payants = 1 an offert

@Component({
  selector: 'mtc-referral',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, DecimalPipe, RouterLink],
  styleUrl: './referral.component.css',
  template: `
    <div class="content">
      <div class="page-head">
        <div>
          <h1 class="page-title">🎁 Parrainage</h1>
          <p class="page-sub">Invite des traders, gagnez tous les deux. Aucun statut ni paperasse requis.</p>
        </div>
        @if (data(); as d) {
          <div class="link-card">
            <div class="link-lbl">Ton lien de parrainage</div>
            <div class="link-row">
              <span class="link-url">{{ d.link }}</span>
              <button class="copy-btn" (click)="copy(d.link)">{{ copied() ? '✓ Copié' : 'Copier' }}</button>
            </div>
            <div class="share-row">
              <button class="share-chip" (click)="share('whatsapp', d.link)">WhatsApp</button>
              <button class="share-chip" (click)="share('x', d.link)">X</button>
              <button class="share-chip" (click)="share('discord', d.link)">{{ discordCopied() ? '✓ Copié' : 'Discord' }}</button>
            </div>
          </div>
        }
      </div>

      @if (isLoading()) {
        <div class="state-box">Chargement…</div>
      } @else if (error()) {
        <div class="state-box error">Impossible de charger ton parrainage. Réessaie plus tard.</div>
      } @else if (data(); as d) {

        <!-- Comment ça marche -->
        <div class="how">
          <div class="how-title">Comment ça marche</div>
          <div class="steps">
            <div class="step">
              <div class="step-n">1</div>
              <div class="step-t">Partage ton lien</div>
              <div class="step-d">Envoie ton lien à un trader. Il garde ton code automatiquement à l'inscription.</div>
            </div>
            <div class="step">
              <div class="step-n">2</div>
              <div class="step-t">Il s'abonne, il économise</div>
              <div class="step-d">Ton filleul profite de <b class="hl-blue">-10% sur l'abonnement annuel</b>.</div>
            </div>
            <div class="step">
              <div class="step-n">3</div>
              <div class="step-t">Tu gagnes un mois</div>
              <div class="step-d">Dès qu'il devient abonné payant, tu reçois <b class="hl-green">1 mois offert</b>.</div>
            </div>
          </div>
          <div class="how-note">⊙ Récompense créditée quand ton filleul paie, pas à la simple inscription. Un mois offert par filleul payant.</div>
        </div>

        <!-- Stats -->
        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-lbl">Filleuls invités</div>
            <div class="stat-val">{{ d.invited }}</div>
            <div class="stat-foot">inscrits via ton lien</div>
            <div class="stat-ic">👥</div>
          </div>
          <div class="stat-card">
            <div class="stat-lbl">Filleuls abonnés</div>
            <div class="stat-val hl-green">{{ d.subscribed }}</div>
            <div class="stat-foot">payants</div>
            <div class="stat-ic">✅</div>
          </div>
          <div class="stat-card">
            <div class="stat-lbl">Mois offerts gagnés</div>
            <div class="stat-val hl-blue">{{ d.freeMonthsEarned }}</div>
            <div class="stat-foot">depuis le début</div>
            <div class="stat-ic">🎁</div>
          </div>
          <div class="stat-card">
            <div class="stat-lbl">Crédit dispo</div>
            <div class="stat-val hl-yellow">{{ d.creditAvailable | number:'1.0-2' }}€</div>
            <div class="stat-foot">sur ton prochain renouvellement</div>
            <div class="stat-ic">⏳</div>
          </div>
        </div>

        <!-- Objectif -->
        <div class="goal-card">
          <div class="goal-head">
            <div class="goal-title">Objectif : 1 an offert</div>
            <div class="goal-count">{{ d.subscribed }} / {{ GOAL }} filleuls payants</div>
          </div>
          <div class="goal-track"><div class="goal-fill" [style.width.%]="goalPercent()"></div></div>
          <div class="goal-foot">
            @if (goalRemaining() > 0) {
              Encore {{ goalRemaining() }} filleul{{ goalRemaining() > 1 ? 's' : '' }} payant{{ goalRemaining() > 1 ? 's' : '' }} et tu débloques 12 mois offerts cumulés.
            } @else {
              Objectif atteint : 12 mois offerts cumulés.
            }
          </div>
        </div>

        <!-- Mes filleuls -->
        <div class="card">
          <div class="card-head"><div class="card-title">Mes filleuls</div></div>
          @if (d.filleuls.length === 0) {
            <div class="state-box muted">Partage ton lien pour voir tes filleuls ici.</div>
          } @else {
            <div class="f-list">
              @for (f of d.filleuls; track f.pseudo + f.date) {
                <div class="f-row">
                  <div class="f-av">{{ avatar(f.pseudo) }}</div>
                  <div class="f-mid">
                    <div class="f-name">{{ f.pseudo }}</div>
                    <div class="f-date">{{ f.date | date:'d MMM yyyy' }}</div>
                  </div>
                  <span class="f-status" [class]="statusClass(f.status)">{{ statusLabel(f.status) }}</span>
                  <span class="f-reward" [class.r-yes]="f.rewarded" [class.r-no]="!f.rewarded">
                    {{ f.rewarded ? '+1 mois' : (f.status === 'essai' ? 'en attente' : '—') }}
                  </span>
                </div>
              }
            </div>
          }
        </div>

        <!-- Cross-link ambassadeur -->
        <a class="cross" routerLink="/devenir-ambassadeur">
          <div class="cross-txt"><b>Tu as une audience ?</b> Le programme Ambassadeur te verse une commission cash récurrente plutôt que des mois offerts.</div>
          <span class="cross-link">Voir le programme Ambassadeur →</span>
        </a>
      }
    </div>
  `,
})
export class ReferralComponent implements OnInit {
  private readonly api = inject(ReferralApi);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly GOAL = GOAL;
  protected readonly data = signal<MyReferral | null>(null);
  protected readonly isLoading = signal(true);
  protected readonly error = signal(false);
  protected readonly copied = signal(false);
  protected readonly discordCopied = signal(false);

  protected readonly goalPercent = computed(() =>
    Math.min(100, Math.round(((this.data()?.subscribed ?? 0) / GOAL) * 100)),
  );
  protected readonly goalRemaining = computed(() =>
    Math.max(0, GOAL - (this.data()?.subscribed ?? 0)),
  );

  ngOnInit(): void {
    this.api.getMyReferral()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => { this.data.set(res.data); this.isLoading.set(false); },
        error: () => { this.error.set(true); this.isLoading.set(false); },
      });
  }

  protected copy(link: string): void {
    navigator.clipboard.writeText(link).then(() => {
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    });
  }

  protected share(platform: 'whatsapp' | 'x' | 'discord', link: string): void {
    const text = `Je trade avec MyTradingCoach. Inscris-toi avec mon lien et profite de -10% sur l'abonnement annuel :`;
    if (platform === 'whatsapp') {
      window.open(`https://wa.me/?text=${encodeURIComponent(`${text} ${link}`)}`, '_blank', 'noopener');
    } else if (platform === 'x') {
      window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(link)}`, '_blank', 'noopener');
    } else {
      // Discord n'a pas d'intent de partage : on copie le lien.
      navigator.clipboard.writeText(link).then(() => {
        this.discordCopied.set(true);
        setTimeout(() => this.discordCopied.set(false), 2000);
      });
    }
  }

  protected avatar(pseudo: string): string {
    return pseudo.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || '??';
  }
  protected statusLabel(s: FilleulStatus): string {
    return s === 'payant' ? 'Abonné payant' : s === 'essai' ? 'En essai' : 'Inscrit';
  }
  protected statusClass(s: FilleulStatus): string {
    return s === 'payant' ? 'st-paid' : s === 'essai' ? 'st-trial' : 'st-signed';
  }
}
