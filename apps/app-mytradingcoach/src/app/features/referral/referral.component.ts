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
import {
  LucideDynamicIcon,
  LucideUsers as Users,
  LucideCircleCheck as CircleCheck,
  LucideGift as Gift,
  LucideWallet as Wallet,
} from '@lucide/angular';
import { ReferralApi, MyReferral, FilleulStatus } from '../../core/api/referral.api';
import { ToastService } from '../../core/services/toast.service';
import { ErrorStateComponent } from '@mtc/front-ui';

const GOAL = 12; // 12 filleuls payants = 1 an offert

@Component({
  selector: 'mtc-referral',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ErrorStateComponent, DatePipe, DecimalPipe, RouterLink, LucideDynamicIcon],
  styleUrl: './referral.component.css',
  template: `
    <div class="content">
      <div class="page-head">
        <h1 class="page-title">🎁 Parrainage</h1>
        <p class="page-sub">Invite des traders, gagnez tous les deux. Aucun statut ni paperasse requis.</p>
      </div>

      @if (isLoading()) {
        <div class="state-box">Chargement…</div>
      } @else if (error()) {
        <mtc-error-state message="Ton parrainage n’a pas pu être chargé. Vérifie ta connexion puis réessaie." (retry)="load()" />
      } @else if (data(); as d) {

        <!-- HÉRO : lien (action) + objectif -->
        <div class="hero">
          <div class="link-card">
            <div class="link-lbl">Ton lien de parrainage</div>
            <div class="link-row">
              <input class="link-input" type="text" readonly [value]="d.link" aria-label="Ton lien de parrainage" />
              <button class="btn btn-blue" data-testid="referral-copy" (click)="copy(d.link)">Copier</button>
            </div>
            <div class="hero-note">Ton filleul démarre avec <b>-10%</b> sur sa première année, et tu gagnes <b>1 mois offert</b> dès qu'il s'abonne.</div>
          </div>

          <div class="goal">
            <div class="goal-head">
              <span class="l">Objectif : 1 an offert</span>
              <span class="r">{{ d.subscribed }} / {{ GOAL }}</span>
            </div>
            <div class="goal-bar"><div class="goal-fill" [style.width.%]="goalPercent()"></div></div>
            <div class="goal-foot">
              @if (goalRemaining() > 0) {
                Encore {{ goalRemaining() }} filleul{{ goalRemaining() > 1 ? 's' : '' }} payant{{ goalRemaining() > 1 ? 's' : '' }} et tu débloques 12 mois offerts cumulés.
              } @else {
                Objectif atteint : 12 mois offerts cumulés.
              }
            </div>
          </div>
        </div>

        <!-- STATS -->
        <div class="stats">
          <div class="stat-card">
            <div class="stat-text">
              <span class="stat-lbl">Filleuls invités</span>
              <div class="stat-v v-blue">{{ d.invited }}</div>
              <div class="stat-foot">via ton lien</div>
            </div>
            <span class="stat-ic v-blue"><svg [lucideIcon]="UsersIcon" [size]="24"></svg></span>
          </div>
          <div class="stat-card">
            <div class="stat-text">
              <span class="stat-lbl">Filleuls abonnés</span>
              <div class="stat-v v-green">{{ d.subscribed }}</div>
              <div class="stat-foot">payants</div>
            </div>
            <span class="stat-ic v-green"><svg [lucideIcon]="CircleCheckIcon" [size]="24"></svg></span>
          </div>
          <div class="stat-card">
            <div class="stat-text">
              <span class="stat-lbl">Mois offerts gagnés</span>
              <div class="stat-v v-violet">{{ d.freeMonthsEarned }}</div>
              <div class="stat-foot">depuis le début</div>
            </div>
            <span class="stat-ic v-violet"><svg [lucideIcon]="GiftIcon" [size]="24"></svg></span>
          </div>
          <div class="stat-card">
            <div class="stat-text">
              <span class="stat-lbl">Crédit dispo</span>
              <div class="stat-v v-amber">{{ d.creditAvailable | number:'1.0-2' }}€</div>
              <div class="stat-foot">prochain renouvellement</div>
            </div>
            <span class="stat-ic v-amber"><svg [lucideIcon]="WalletIcon" [size]="24"></svg></span>
          </div>
        </div>

        <!-- COMMENT ÇA MARCHE -->
        <div class="card mb">
          <div class="card-title">Comment ça marche</div>
          <div class="steps">
            <div class="step">
              <div class="step-n">1</div>
              <h4>Partage ton lien</h4>
              <p>Envoie ton lien à un trader. Son code est attribué automatiquement à l'inscription.</p>
            </div>
            <div class="step">
              <div class="step-n">2</div>
              <h4>Il s'abonne, il économise</h4>
              <p>Ton filleul profite de <em>-10% sur sa première année, mensuel ou annuel</em>.</p>
            </div>
            <div class="step">
              <div class="step-n">3</div>
              <h4>Tu gagnes un mois</h4>
              <p>Dès qu'il devient abonné payant, tu reçois <em>1 mois offert</em>.</p>
            </div>
          </div>
          <div class="how-note">Récompense créditée quand ton filleul paie, pas à la simple inscription. Un mois offert par filleul payant.</div>
        </div>

        <!-- MES FILLEULS -->
        <div class="card mb">
          <div class="filleuls-head">
            <div class="card-title nomb">Mes filleuls</div>
            <span class="count-pill">{{ d.filleuls.length }}</span>
          </div>
          @if (d.filleuls.length === 0) {
            <div class="empty">Partage ton lien pour voir tes filleuls ici.</div>
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
                    {{ f.rewarded ? '+1 mois' : (f.status === 'essai' ? 'en attente' : '-') }}
                  </span>
                </div>
              }
            </div>
          }
        </div>

        <!-- CTA AMBASSADEUR -->
        <a class="amb" routerLink="/devenir-ambassadeur">
          <div class="t"><b>Tu as une audience ?</b> Le programme Ambassadeur te verse une commission cash récurrente plutôt que des mois offerts.</div>
          <span class="amb-link">Voir le programme Ambassadeur →</span>
        </a>
      }
    </div>
  `,
})
export class ReferralComponent implements OnInit {
  private readonly api = inject(ReferralApi);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toast = inject(ToastService);

  protected readonly UsersIcon = Users;
  protected readonly CircleCheckIcon = CircleCheck;
  protected readonly GiftIcon = Gift;
  protected readonly WalletIcon = Wallet;

  protected readonly GOAL = GOAL;
  protected readonly data = signal<MyReferral | null>(null);
  protected readonly isLoading = signal(true);
  protected readonly error = signal(false);

  protected readonly goalPercent = computed(() =>
    Math.min(100, Math.round(((this.data()?.subscribed ?? 0) / GOAL) * 100)),
  );
  protected readonly goalRemaining = computed(() =>
    Math.max(0, GOAL - (this.data()?.subscribed ?? 0)),
  );

  ngOnInit(): void {
    this.load();
  }

  protected load(): void {
    this.isLoading.set(true);
    this.error.set(false);
    this.api.getMyReferral()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => { this.data.set(res.data); this.isLoading.set(false); },
        error: () => { this.error.set(true); this.isLoading.set(false); },
      });
  }

  /** Feedback transitoire → toast. L'échec du presse-papiers était muet. */
  protected copy(link: string): void {
    navigator.clipboard.writeText(link).then(
      () => this.toast.success('Lien copié'),
      () => this.toast.error('Copie impossible : sélectionne le lien et copie-le à la main.'),
    );
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
