import {
  ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePipe, DecimalPipe } from '@angular/common';
import type { ChartConfiguration } from 'chart.js';
import { AdminApi, AdminAmbassador, AdminAmbassadorDetail, AdminAmbassadorPromoteResult } from '../../core/api/admin.api';
import { ChartCanvasComponent } from '../../shared/components/chart-canvas/chart-canvas.component';
import { CHART_COLORS, gridAxis, noLegend } from '../../shared/charts/chart-theme';
import { PRICING_EUR } from '../../core/constants/pricing.const';
import { apiErrorMessage } from '@mtc/shared';
import { ConfirmService, DialogDirective } from '@mtc/front-ui';

@Component({
  selector: 'mtc-admin-ambassadeurs',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DialogDirective, DatePipe, DecimalPipe, ChartCanvasComponent],
  styleUrl: './ambassadeurs.component.css',
  template: `
    <div class="screen">
      <div class="page-head">
        <div class="page-title">Ambassadeurs</div>
      </div>

      <div class="kpi-strip">
        <div class="kpi"><div class="kpi-top purple"></div><div class="kpi-label">Ambassadeurs</div><div class="kpi-value purple">{{ ambassadors().length }}</div><div class="kpi-sub">actifs</div></div>
        <div class="kpi"><div class="kpi-top blue"></div><div class="kpi-label">Total référés</div><div class="kpi-value blue">{{ totalReferrals() }}</div><div class="kpi-sub">via liens</div></div>
        <div class="kpi"><div class="kpi-top blue"></div><div class="kpi-label">Référés Premium</div><div class="kpi-value blue">{{ totalPremium() }}</div><div class="kpi-sub">{{ pricing.PREMIUM.monthly }}€/mois</div></div>
        <div class="kpi"><div class="kpi-top amber"></div><div class="kpi-label">Commissions dues</div><div class="kpi-value amber">{{ totalPending() | number:'1.2-2' }}€</div><div class="kpi-sub">à verser</div></div>
        <div class="kpi"><div class="kpi-top teal"></div><div class="kpi-label">Total payé</div><div class="kpi-value teal">{{ totalPaid() | number:'1.2-2' }}€</div><div class="kpi-sub">versé</div></div>
      </div>

      <div class="card">
        <div class="card-head"><span class="card-label">Ambassadeurs</span><button type="button" class="card-action" data-testid="add-ambassador-btn" (click)="openAdd()">+ Ajouter un ambassadeur</button></div>
        @if (loading()) {
          <div class="empty">Chargement…</div>
        } @else if (ambassadors().length === 0) {
          <div class="empty">Aucun ambassadeur configuré</div>
        } @else {
          <table class="tbl">
            <thead><tr><th>Ambassadeur</th><th>Code / Lien</th><th>Taux</th><th>Référés</th><th>Premium</th><th class="num">Dû</th><th class="num">Total payé</th><th class="actions-col">Actions</th></tr></thead>
            <tbody>
              @for (amb of ambassadors(); track amb.id) {
                <tr [class.row-selected]="selectedId() === amb.id" (click)="selectAmbassador(amb)">
                  <td data-label="Ambassadeur"><div class="u-cell"><div class="u-av amb-av">{{ (amb.name || amb.email).slice(0,2).toUpperCase() }}</div><div><div class="u-name">{{ amb.name ?? '-' }}</div><div class="u-mail">{{ amb.email }}</div></div></div></td>
                  <td data-label="Code / Lien"><div class="code-cell"><span class="pill teal-pill">{{ amb.referralCode }}</span><button class="pill" (click)="$event.stopPropagation(); copyLink(amb.referralCode)">Copier lien</button></div><div class="amb-link">mytradingcoach.app?ref={{ amb.referralCode }}</div></td>
                  <td data-label="Taux" class="td-mono blue">20%</td>
                  <td data-label="Référés" class="td-mono">{{ amb.totalReferrals }}</td>
                  <td data-label="Premium" class="td-mono">{{ amb.premiumReferrals }} P</td>
                  <td data-label="Dû" class="td-mono num amber">{{ amb.pendingPayout | number:'1.2-2' }}€</td>
                  <td data-label="Total payé" class="td-mono num">{{ (amb.totalEarned - amb.pendingPayout) | number:'1.2-2' }}€</td>
                  <td data-label="Actions"><div class="row-actions"><button class="btn pay-btn" [disabled]="amb.pendingPayout === 0" (click)="$event.stopPropagation(); payAmbassador(amb)">✓ Payer</button><button class="btn revoke-btn" (click)="$event.stopPropagation(); askRevoke(amb)">Retirer</button></div></td>
                </tr>
              }
            </tbody>
          </table>
        }
      </div>

      @if (selectedDetail(); as detail) {
        <div class="card fill">
          <div class="card-head"><span class="card-label">Détail · {{ selectedAmbassador()?.name ?? selectedAmbassador()?.email }}</span>
            <button class="btn" [disabled]="detail.pendingPayout === 0 || paying()" (click)="paySelected()">{{ paying() ? 'En cours…' : '✓ Marquer tout payé (' + (detail.pendingPayout | number:'1.2-2') + '€)' }}</button></div>
          <div class="card-body">
            <div class="mini-stats">
              <div class="mini"><span class="mini-v blue">{{ detail.total }}</span><span class="mini-l">Inscrits</span></div>
              <div class="mini"><span class="mini-v green">{{ detail.premium }}</span><span class="mini-l">Premium</span></div>
              <div class="mini"><span class="mini-v">{{ detail.free }}</span><span class="mini-l">Free</span></div>
              <div class="mini"><span class="mini-v amber">{{ detail.pendingPayout | number:'1.2-2' }}€</span><span class="mini-l">À payer</span></div>
              <div class="mini"><span class="mini-v green">{{ detail.totalEarned | number:'1.2-2' }}€</span><span class="mini-l">Total gagné</span></div>
            </div>

            <div class="grid-2">
              <div>
                <div class="card-label sect">Gains par mois</div>
                <div class="chart-box amb-chart"><mtc-admin-chart [config]="earningsConfig()" /></div>
              </div>
              <div>
                <div class="card-label sect">Référés ({{ detail.referrals.length }})</div>
                @if (detail.referrals.length === 0) {
                  <div class="empty">Aucun référé encore</div>
                } @else {
                  <table class="tbl ref-tbl">
                    <thead><tr><th>Email</th><th>Plan</th><th>Actif</th><th>Inscrit</th></tr></thead>
                    <tbody>
                      @for (ref of detail.referrals; track ref.id) {
                        <tr>
                          <td data-label="Email" class="td-mono">{{ ref.email }}</td>
                          <td data-label="Plan"><span class="badge" [class.b-premium]="ref.plan==='PREMIUM'" [class.b-free]="ref.plan==='FREE'">{{ ref.plan }}</span></td>
                          <td data-label="Actif"><span [class.act-on]="ref.isActive" [class.act-off]="!ref.isActive">{{ ref.isActive ? '✓' : '-' }}</span></td>
                          <td data-label="Inscrit" class="td-mono muted">{{ ref.createdAt | date:'dd/MM/yyyy' }}</td>
                        </tr>
                      }
                    </tbody>
                  </table>
                }
              </div>
            </div>

            <div class="sql-wrap">
              <div class="card-label sect">SQL · marquer payé manuellement</div>
              <div class="sql-block"><span class="kw">UPDATE</span> <span class="str">"ReferralCommission"</span> <span class="kw">SET</span> status = <span class="str">'paid'</span><br><span class="kw">WHERE</span> "ambassadorId" = <span class="str">'{{ selectedId() }}'</span><br><span class="kw">AND</span> status = <span class="str">'pending'</span>;</div>
            </div>
          </div>
        </div>
      }

      @if (showAdd()) {
        <div class="modal-overlay" role="button" tabindex="-1" (click)="closeAdd()" (keydown.escape)="closeAdd()">
          <div class="modal" role="dialog" aria-modal="true" mtcDialog (mtcDialogClose)="closeAdd()" (click)="$event.stopPropagation()" (keydown)="$event.stopPropagation()">
            <div class="modal-head"><h3 class="modal-title">Ajouter un ambassadeur</h3><button class="modal-x" (click)="closeAdd()">✕</button></div>
            @if (addResult(); as r) {
              <div class="modal-body">
                <p class="ok-text">✓ <strong>{{ r.name ?? r.email }}</strong> est désormais ambassadeur.</p>
                <div class="result-row"><span class="result-lbl">Code</span><span class="pill teal-pill">{{ r.referralCode }}</span></div>
                <div class="result-row"><span class="result-lbl">Lien</span><span class="result-link td-mono">{{ r.referralLink }}</span></div>
              </div>
              <div class="modal-foot">
                <button class="btn" (click)="copyResultLink(r.referralLink)">{{ linkCopied() ? '✓ Copié' : '⧉ Copier le lien' }}</button>
                <button class="btn btn-primary" (click)="closeAdd()">Fermer</button>
              </div>
            } @else {
              <div class="modal-body">
                <label class="field">
                  <span class="field-lbl">Email de l'utilisateur</span>
                  <input class="field-input" type="email" data-testid="add-ambassador-email" placeholder="email@exemple.com" [value]="addEmail()" (input)="addEmail.set($any($event.target).value)" />
                </label>
                <label class="field">
                  <span class="field-lbl">Code de parrainage <span class="opt">(optionnel)</span></span>
                  <input class="field-input" type="text" data-testid="add-ambassador-code" placeholder="laisser vide pour générer automatiquement" [value]="addCode()" (input)="addCode.set($any($event.target).value)" />
                </label>
                @if (addError(); as e) { <p class="err-text" data-testid="add-ambassador-error">{{ e }}</p> }
              </div>
              <div class="modal-foot">
                <button class="btn" (click)="closeAdd()">Annuler</button>
                <button class="btn btn-primary" data-testid="add-ambassador-submit" [disabled]="!addEmail().trim() || adding()" (click)="submitAdd()">{{ adding() ? 'En cours…' : 'Ajouter' }}</button>
              </div>
            }
          </div>
        </div>
      }

      @if (revokeTarget(); as target) {
        <div class="modal-overlay" role="button" tabindex="-1" (click)="cancelRevoke()" (keydown.escape)="cancelRevoke()">
          <div class="modal" role="dialog" aria-modal="true" mtcDialog (mtcDialogClose)="cancelRevoke()" (click)="$event.stopPropagation()" (keydown)="$event.stopPropagation()">
            <div class="modal-head"><h3 class="modal-title">Retirer l'ambassadeur</h3><button class="modal-x" (click)="cancelRevoke()">✕</button></div>
            <div class="modal-body">
              <p class="confirm-text">Retirer le statut ambassadeur de <strong>{{ target.name ?? target.email }}</strong> ? Son rôle repasse à <strong>USER</strong> et son code <strong>{{ target.referralCode }}</strong> est libéré. Les commissions déjà enregistrées sont conservées.</p>
            </div>
            <div class="modal-foot">
              <button class="btn" (click)="cancelRevoke()">Annuler</button>
              <button class="btn revoke-btn" data-testid="revoke-confirm" [disabled]="revoking()" (click)="confirmRevoke()">{{ revoking() ? 'En cours…' : 'Retirer' }}</button>
            </div>
          </div>
        </div>
      }
    </div>
  `,
})
export class AmbassadeursComponent implements OnInit {
  private readonly api = inject(AdminApi);
  private readonly confirm = inject(ConfirmService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly ambassadors = signal<AdminAmbassador[]>([]);
  protected readonly loading = signal(true);
  protected readonly selectedId = signal<string | null>(null);
  protected readonly selectedDetail = signal<AdminAmbassadorDetail | null>(null);
  protected readonly selectedAmbassador = signal<AdminAmbassador | null>(null);
  protected readonly paying = signal(false);
  protected readonly pricing = PRICING_EUR;

  // Ajout d'un ambassadeur
  protected readonly showAdd = signal(false);
  protected readonly addEmail = signal('');
  protected readonly addCode = signal('');
  protected readonly adding = signal(false);
  protected readonly addError = signal<string | null>(null);
  protected readonly addResult = signal<AdminAmbassadorPromoteResult | null>(null);
  protected readonly linkCopied = signal(false);

  // Retrait d'un ambassadeur
  protected readonly revokeTarget = signal<AdminAmbassador | null>(null);
  protected readonly revoking = signal(false);

  protected readonly totalReferrals = computed(() => this.ambassadors().reduce((s, a) => s + a.totalReferrals, 0));
  protected readonly totalPremium = computed(() => this.ambassadors().reduce((s, a) => s + a.premiumReferrals, 0));
  protected readonly totalPending = computed(() => this.ambassadors().reduce((s, a) => s + a.pendingPayout, 0));
  protected readonly totalPaid = computed(() => this.ambassadors().reduce((s, a) => s + a.totalEarned - a.pendingPayout, 0));

  protected readonly earningsConfig = computed<ChartConfiguration>(() => {
    const earnings = this.selectedDetail()?.earningsByMonth ?? {};
    const months = Object.entries(earnings).sort((a, b) => a[0].localeCompare(b[0]));
    return {
      type: 'bar',
      data: { labels: months.map(([m]) => this.formatMonth(m)), datasets: [{ label: '€', data: months.map(([, v]) => v), backgroundColor: CHART_COLORS.purple, borderRadius: 4, barThickness: 22 }] },
      options: { maintainAspectRatio: false, plugins: noLegend, scales: { x: { grid: { display: false } }, y: { grid: gridAxis, beginAtZero: true, ticks: { callback: (v) => '€' + v } } } },
    } as ChartConfiguration;
  });

  ngOnInit() { this.loadAmbassadors(); }

  private loadAmbassadors(): void {
    this.loading.set(true);
    this.api.getAmbassadors().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (res) => { this.ambassadors.set(res.data); this.loading.set(false); if (res.data.length > 0) this.selectAmbassador(res.data[0]); },
      error: () => this.loading.set(false),
    });
  }

  protected selectAmbassador(amb: AdminAmbassador): void {
    this.selectedId.set(amb.id);
    this.selectedAmbassador.set(amb);
    this.selectedDetail.set(null);
    this.api.getAmbassadorDetail(amb.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({ next: (res) => this.selectedDetail.set(res.data) });
  }

  protected copyLink(code: string): void {
    navigator.clipboard.writeText(`https://mytradingcoach.app?ref=${code}`);
  }

  // ── Ajouter un ambassadeur ──────────────────────────────────────────────
  protected openAdd(): void {
    this.addEmail.set('');
    this.addCode.set('');
    this.addError.set(null);
    this.addResult.set(null);
    this.linkCopied.set(false);
    this.showAdd.set(true);
  }
  protected closeAdd(): void {
    this.showAdd.set(false);
  }
  protected submitAdd(): void {
    const email = this.addEmail().trim();
    if (!email || this.adding()) return;
    const code = this.addCode().trim() || undefined;
    this.adding.set(true);
    this.addError.set(null);
    this.api.promoteAmbassador(email, code).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (res) => {
        this.adding.set(false);
        this.addResult.set(res.data);
        this.loadAmbassadors();
      },
      error: (err: { status?: number; error?: { message?: string } }) => {
        this.adding.set(false);
        if (err.status === 404) this.addError.set('Aucun utilisateur avec cet email.');
        else if (err.status === 409) this.addError.set('Ce code est déjà utilisé, choisis-en un autre.');
        else this.addError.set(apiErrorMessage(err, 'Une erreur est survenue.'));
      },
    });
  }
  protected copyResultLink(link: string): void {
    navigator.clipboard.writeText(link);
    this.linkCopied.set(true);
  }

  // ── Retirer un ambassadeur ──────────────────────────────────────────────
  protected askRevoke(amb: AdminAmbassador): void {
    this.revokeTarget.set(amb);
  }
  protected cancelRevoke(): void {
    this.revokeTarget.set(null);
  }
  protected confirmRevoke(): void {
    const target = this.revokeTarget();
    if (!target || this.revoking()) return;
    this.revoking.set(true);
    this.api.revokeAmbassador(target.email).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.revoking.set(false);
        this.revokeTarget.set(null);
        this.loadAmbassadors();
      },
      error: () => this.revoking.set(false),
    });
  }

  protected async payAmbassador(amb: AdminAmbassador): Promise<void> {
    if (amb.pendingPayout === 0) return;
    const amount = amb.pendingPayout.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
    const confirmed = await this.confirm.ask({
      title: `Marquer ${amount} comme payé ?`,
      message: `Versement à ${amb.name ?? amb.email}. À faire uniquement une fois le virement envoyé : l'opération n'est pas annulable ici.`,
      confirmLabel: 'Marquer comme payé',
      danger: true,
    });
    if (!confirmed) return;
    this.paying.set(true);
    this.api.markAmbassadorPaid(amb.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => { this.paying.set(false); this.loadAmbassadors(); },
      error: () => this.paying.set(false),
    });
  }
  protected paySelected(): void {
    const amb = this.selectedAmbassador();
    if (amb) this.payAmbassador(amb);
  }

  protected formatMonth(month: string): string {
    const [year, m] = month.split('-');
    return new Date(+year, +m - 1, 1).toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' });
  }
}
