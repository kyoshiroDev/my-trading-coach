import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { httpResource } from '@angular/common/http';
import { map } from 'rxjs';
import { environment } from '../../../environments/environment';
import { UserDetailData } from '../../core/api/admin.api';
import { ActivityCalendarComponent } from './activity-calendar.component';

/** Libellés courts/longs des features IA (clés réelles d'AiUsageLog). */
const FEATURE_LABELS: Record<string, { full: string; short: string }> = {
  chat: { full: 'Chat Coach', short: 'Chat' },
  chat_coach: { full: 'Chat Coach', short: 'Chat' },
  debrief: { full: 'Weekly Debrief', short: 'Débrief' },
  weekly_debrief: { full: 'Weekly Debrief', short: 'Débrief' },
  eco_calendar: { full: 'Calendrier éco', short: 'Éco' },
  eco: { full: 'Calendrier éco', short: 'Éco' },
  daily_recap: { full: 'Daily recap', short: 'Recap' },
  recap: { full: 'Daily recap', short: 'Recap' },
  insights: { full: 'IA Insights', short: 'Insights' },
  ai_insights: { full: 'IA Insights', short: 'Insights' },
  market_news: { full: 'News marché', short: 'News' },
};
function featLabel(key: string): { full: string; short: string } {
  return FEATURE_LABELS[key] ?? { full: key, short: key.replace(/_/g, ' ') };
}

@Component({
  selector: 'mtc-admin-user-detail',
  standalone: true,
  imports: [DatePipe, RouterLink, ActivityCalendarComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './user-detail.component.css',
  template: `
    <div class="screen">
      <a class="ud-back" routerLink="/users">← Utilisateurs</a>

      @if (detail.isLoading()) {
        <div class="card"><div class="empty">Chargement…</div></div>
      } @else if (detail.error()) {
        <div class="card"><div class="empty">⚠ Utilisateur introuvable</div></div>
      } @else if (data(); as d) {

        <!-- En-tête identité -->
        <div class="card ud-head">
          <div class="ud-av">{{ initials() }}</div>
          <div>
            <div class="ud-name">{{ d.identity.name ?? d.identity.email }}</div>
            <div class="ud-mailrow">
              <span class="ud-mail">{{ pseudo() }} · {{ d.identity.email }}</span>
              <span class="ud-badges">
                <span class="badge" [class.b-premium]="d.identity.plan==='PREMIUM'" [class.b-starter]="d.identity.plan==='STARTER'" [class.b-free]="d.identity.plan==='FREE'">{{ d.identity.plan }}</span>
                <span class="badge" [class.b-ok]="status()==='actif'" [class.b-free]="status()!=='actif'">● {{ statusLabel() }}</span>
                @if (d.identity.role !== 'USER') { <span class="role-tag purple">{{ d.identity.role }}</span> }
              </span>
            </div>
          </div>
          @if (d.identity.ambassadorRefCode) {
            <span class="badge b-manual ud-ref">🔗 ref={{ d.identity.ambassadorRefCode }}</span>
          }
        </div>

        <!-- KPI strip -->
        <div class="kpi-strip">
          <div class="kpi"><div class="kpi-top purple"></div><div class="kpi-label">Plan</div><div class="kpi-value purple">{{ d.identity.plan }}</div><div class="kpi-sub">{{ planSub() }}</div></div>
          <div class="kpi"><div class="kpi-top blue"></div><div class="kpi-label">Inscrit</div><div class="kpi-value blue">J+{{ d.kpis.daysSinceSignup }}</div><div class="kpi-sub">{{ d.identity.createdAt | date:'dd/MM/yyyy' }}</div></div>
          <div class="kpi"><div class="kpi-top teal"></div><div class="kpi-label">Dernière connexion</div><div class="kpi-value teal">{{ lastConn() }}</div><div class="kpi-sub">activité</div></div>
          <div class="kpi"><div class="kpi-top teal"></div><div class="kpi-label">Jours actifs</div><div class="kpi-value teal">{{ d.kpis.activeDays }}<span class="kpi-frac"> /{{ d.kpis.totalDays }}</span></div><div class="kpi-sub">{{ activationPct() }}% d'activation</div></div>
          <div class="kpi"><div class="kpi-top blue"></div><div class="kpi-label">Temps session</div><div class="kpi-value blue">{{ sessionTime() }}</div><div class="kpi-sub">cumulé</div></div>
          <div class="kpi"><div class="kpi-top amber"></div><div class="kpi-label">Coût IA</div><div class="kpi-value amber">{{ '$' + d.kpis.ai.usd.toFixed(2) }}</div><div class="kpi-sub">{{ aiSub() }}</div></div>
        </div>

        <!-- Ligne fiche -->
        <div class="fiche-row">
          <div class="card">
            <div class="card-head"><span class="card-label">Connexions par jour</span></div>
            <div class="card-body">
              <mtc-admin-activity-calendar [activeDates]="d.activeDates" [createdAt]="d.identity.createdAt" />
            </div>
          </div>
          <div class="fiche-rgrid">
            <div class="fiche-rstack">
              <div class="card">
                <div class="card-head"><span class="card-label">Informations</span></div>
                <div class="card-body"><div class="empty">Infos (étape 6)</div></div>
              </div>
              <div class="card">
                <div class="card-head"><span class="card-label">Signaux</span></div>
                <div class="card-body"><div class="empty">Signaux (étape 6)</div></div>
              </div>
            </div>
            <div class="card r-ia">
              <div class="card-head"><span class="card-label">Consommation IA</span><span class="card-action ud-static">{{ aiHead() }}</span></div>
              <div class="card-body">
                @if (d.aiByFeature.length === 0) {
                  <div class="empty-ai">Aucun appel IA — {{ d.identity.plan === 'FREE' ? 'plan FREE (IA réservée au Premium)' : 'pas encore utilisé' }}.</div>
                } @else {
                  <div class="vchart">
                    @for (b of aiBars(); track b.feature) {
                      <div class="vbar" [title]="b.full + ' · ' + b.kTokens + 'k tok · $' + b.costUsd.toFixed(2)">
                        <div class="vbar-col"><div class="vbar-fill" [style.height.%]="b.heightPct"></div></div>
                        <div class="vbar-lbl"><div class="vbar-name">{{ b.short }}</div><div class="vbar-v">{{ b.kTokens }}k</div></div>
                      </div>
                    }
                  </div>
                }
              </div>
            </div>
          </div>
        </div>

        <!-- Dernières sessions -->
        <div class="card">
          <div class="card-head"><span class="card-label">Dernières sessions</span><span class="card-action ud-static">lecture seule</span></div>
          <div class="card-body"><div class="empty">Sessions (étape 6)</div></div>
        </div>
      }
    </div>
  `,
})
export class UserDetailComponent {
  private readonly route = inject(ActivatedRoute);

  protected readonly id = toSignal(
    this.route.paramMap.pipe(map((p) => p.get('id') ?? '')),
    { initialValue: '' },
  );

  protected readonly detail = httpResource<{ data: UserDetailData }>(() => {
    const id = this.id();
    return id ? `${environment.apiUrl}/admin/users/${id}` : undefined;
  });

  protected readonly data = computed(() => this.detail.value()?.data ?? null);

  protected readonly initials = computed(() => {
    const i = this.data()?.identity;
    return (i?.name ?? i?.email ?? '??').slice(0, 2).toUpperCase();
  });
  protected readonly pseudo = computed(() => {
    const i = this.data()?.identity;
    const base = i?.name ?? i?.email.split('@')[0] ?? '';
    return '@' + base.toLowerCase().replace(/\s+/g, '');
  });

  /** never | inactif | actif (dernière activité < 7j). */
  protected readonly status = computed<'never' | 'inactif' | 'actif'>(() => {
    const d = this.data();
    if (!d || d.kpis.activeDays === 0) return 'never';
    const last = d.kpis.lastConnection ? Date.parse(d.kpis.lastConnection) : null;
    return last && Date.now() - last < 7 * 86_400_000 ? 'actif' : 'inactif';
  });
  protected readonly statusLabel = computed(() =>
    ({ never: 'Jamais connecté', inactif: 'Inactif', actif: 'Actif' })[this.status()],
  );

  protected readonly planSub = computed(() => {
    const d = this.data();
    if (!d) return '';
    if (d.identity.subscriptionStatus) return 'payant';
    return d.identity.plan === 'FREE' ? 'gratuit' : 'accès manuel';
  });
  protected readonly activationPct = computed(() => {
    const k = this.data()?.kpis;
    return k && k.totalDays ? Math.round((k.activeDays / k.totalDays) * 100) : 0;
  });
  protected readonly lastConn = computed(() => {
    const iso = this.data()?.kpis.lastConnection;
    return iso ? this.relTime(iso) : 'Jamais';
  });
  protected readonly sessionTime = computed(() => this.fmtMinutes(this.data()?.kpis.sessionTimeMinutes ?? null));
  protected readonly aiSub = computed(() => {
    const ai = this.data()?.kpis.ai;
    return ai && ai.tokens ? `${Math.round(ai.tokens / 1000)}k tokens` : 'aucun appel';
  });
  protected readonly aiHead = computed(() => {
    const ai = this.data()?.kpis.ai;
    return ai && ai.tokens ? `$${ai.usd.toFixed(2)} · ${Math.round(ai.tokens / 1000)}k tokens` : '—';
  });
  protected readonly aiBars = computed(() => {
    const feats = this.data()?.aiByFeature ?? [];
    const max = Math.max(...feats.map((f) => f.tokens), 1);
    return feats.map((f) => {
      const l = featLabel(f.feature);
      return {
        feature: f.feature,
        full: l.full,
        short: l.short,
        costUsd: f.costUsd,
        kTokens: Math.round(f.tokens / 1000),
        heightPct: Math.max(4, Math.round((f.tokens / max) * 100)),
      };
    });
  });

  private relTime(iso: string): string {
    const min = Math.floor((Date.now() - Date.parse(iso)) / 60_000);
    if (min < 1) return "à l'instant";
    if (min < 60) return `${min}min`;
    const h = Math.floor(min / 60);
    if (h < 24) return `${h}h`;
    return `${Math.floor(h / 24)}j`;
  }
  private fmtMinutes(mins: number | null): string {
    if (mins === null) return '—';
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return h === 0 ? `${m}min` : m === 0 ? `${h}h` : `${h}h${m}min`;
  }
}
