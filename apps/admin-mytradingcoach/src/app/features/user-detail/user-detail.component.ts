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

/** Emoji d'humeur (enum MoodState) — pas de pipe émoji côté admin. */
const MOOD_EMOJI: Record<string, string> = {
  CONFIDENT: '😎', FOCUSED: '🎯', NEUTRAL: '😐', TIRED: '😴', STRESSED: '😰',
};

/** Palette des parts du donut conso IA (alignée sur le thème graphes admin). */
const DONUT_PALETTE = ['#00d4aa', '#4a9eff', '#a78bfa', '#f5a623', '#34d399', '#ff5563'];

/** Libellés du profil trader (valeurs d'onboarding → FR). */
const MARKET_LABELS: Record<string, string> = { CRYPTO: 'Crypto', FOREX: 'Forex', ACTIONS: 'Actions', MULTI: 'Multi-marchés' };
const GOAL_LABELS: Record<string, string> = { DISCIPLINE: 'Discipline', PERFORMANCE: 'Performance', PSYCHOLOGIE: 'Psychologie' };
const STYLE_LABELS: Record<string, string> = { SCALPING: 'Scalping', DAY_TRADING: 'Day trading', SWING: 'Swing', POSITION: 'Long terme' };
const SESSION_LABELS: Record<string, string> = { LONDON: 'Londres', NEW_YORK: 'New York', ASIAN: 'Asie' };
function lbl(map: Record<string, string>, v: string | null | undefined): string {
  return v ? (map[v] ?? v) : '—';
}

export interface Signal { cls: 'ok' | 'warn' | 'bad'; ic: string; text: string; sub: string; }

/**
 * Construit les signaux de la fiche (pure, testable).
 * Activation = usage réel (trades). Les connexions restent affichées comme
 * engagement, jamais nommées « activation ».
 */
export function buildSignals(
  d: UserDetailData,
  status: 'never' | 'inactif' | 'actif',
  lastConn: string,
  engagementPct: number,
): Signal[] {
  const k = d.kpis;
  const trades = d.usage.totalTrades;
  const never = k.activeDays === 0;
  const list: Signal[] = [];

  // 1. Activation = a-t-il loggé / importé des trades ?
  if (trades > 0) {
    list.push({ cls: 'ok', ic: '✓', text: 'Activé · a loggé des trades', sub: `${trades} trade${trades > 1 ? 's' : ''} au total` });
  } else {
    list.push({ cls: 'warn', ic: '!', text: 'Inscrit mais 0 trade · pas encore activé', sub: 'aucun trade logué ni importé' });
  }

  // 2. Engagement = connexions (info, distinct de l'activation)
  if (never) {
    list.push({ cls: 'bad', ic: '✕', text: 'Jamais connecté', sub: `inscrit il y a ${k.daysSinceSignup}j` });
  } else {
    list.push({ cls: 'ok', ic: '✓', text: `Connecté ${k.activeDays}j sur ${k.totalDays}`, sub: `${engagementPct}% de présence` });
    if (status === 'actif') {
      list.push({ cls: 'ok', ic: '✓', text: 'Connexion récente', sub: lastConn });
    } else {
      list.push({ cls: 'warn', ic: '!', text: `Inactif depuis ${lastConn}`, sub: 'risque de churn' });
    }
  }

  // 3. Warning Premium sans session (conservé)
  if (d.identity.plan !== 'FREE' && d.sessions.length === 0) {
    list.push({ cls: 'warn', ic: '!', text: 'Premium sans session', sub: 'accès accordé, jamais utilisé' });
  }
  return list;
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
                <span class="badge" [class.b-premium]="d.identity.plan==='PREMIUM'" [class.b-free]="d.identity.plan==='FREE'">{{ d.identity.plan }}</span>
                <span class="badge" [class.b-ok]="status()==='actif'" [class.b-free]="status()!=='actif'">● {{ statusLabel() }}</span>
                @if (d.identity.role !== 'USER') { <span class="role-tag purple">{{ d.identity.role }}</span> }
              </span>
            </div>
          </div>
          @if (d.identity.ambassadorRefCode) {
            <span class="badge b-manual ud-ref">🔗 ref={{ d.identity.ambassadorRefCode }}</span>
          }
        </div>

        <!-- Bandeau KPI usage réel (trades) — compact, liseré coloré conservé -->
        <div class="kpi-strip cols-4 ud-kpis">
          <div class="kpi">
            <div class="kpi-top teal"></div>
            <div class="kpi-label">Total trades</div>
            <div class="kpi-value teal">{{ d.usage.totalTrades }}</div>
            <div class="kpi-sub">{{ d.usage.totalTrades === 0 ? 'aucun trade' : 'loggés / importés' }}</div>
          </div>
          <div class="kpi">
            <div class="kpi-top blue"></div>
            <div class="kpi-label">Trades ce mois</div>
            <div class="kpi-value blue">{{ d.usage.tradesThisMonth }}</div>
            <div class="kpi-sub">mois en cours</div>
          </div>
          <div class="kpi">
            <div class="kpi-top" [class.green]="d.usage.totalPnl > 0" [class.red]="d.usage.totalPnl < 0" [class.teal]="d.usage.totalPnl === 0"></div>
            <div class="kpi-label">P&amp;L total</div>
            <div class="kpi-value" [class.green]="d.usage.totalPnl > 0" [class.red]="d.usage.totalPnl < 0" [class.teal]="d.usage.totalPnl === 0">{{ pnlDisplay() }}</div>
            <div class="kpi-sub">sur trades clos</div>
          </div>
          <div class="kpi">
            <div class="kpi-top amber"></div>
            <div class="kpi-label">Win rate</div>
            <div class="kpi-value amber">{{ d.usage.winRate }}%</div>
            <div class="kpi-sub">trades gagnants</div>
          </div>
        </div>

        <!-- Rangée : Profil trader | Compte & engagement -->
        <div class="ud-g2">
          <!-- Profil trader (onboarding) en grille compacte 2 colonnes -->
          <div class="card">
            <div class="card-head"><span class="card-label">Profil trader</span><span class="card-action ud-static">onboarding</span></div>
            <div class="card-body">
              @if (hasProfile()) {
                <div class="pgrid">
                  <div class="pf"><div class="pf-l">Marché</div><div class="pf-v">{{ marketLabel() }}</div></div>
                  <div class="pf"><div class="pf-l">Objectif</div><div class="pf-v">{{ goalLabel() }}</div></div>
                  <div class="pf"><div class="pf-l">Style</div><div class="pf-v">{{ styleLabel() }}</div></div>
                  <div class="pf"><div class="pf-l">Capital de départ</div><div class="pf-v">{{ capitalLabel() }}</div></div>
                  <div class="pf"><div class="pf-l">Sessions</div><div class="pf-v">{{ sessionsLabel() }}</div></div>
                  @if (frequencyLabel()) {
                    <div class="pf"><div class="pf-l">Fréquence</div><div class="pf-v">{{ frequencyLabel() }}</div></div>
                  }
                  <div class="pf full"><div class="pf-l">Approche</div><div class="pf-v">{{ strategyLabel() }}</div></div>
                  <div class="pf full"><div class="pf-l">Actifs les plus tradés</div><div class="pf-v">{{ topAssetsLabel() }}</div></div>
                  @if (profile()?.strategyDescription) {
                    <div class="pf full"><div class="pf-l">Description</div><div class="pf-v pf-desc">{{ profile()?.strategyDescription }}</div></div>
                  }
                </div>
              } @else {
                <div class="empty-ai">Profil non renseigné (onboarding incomplet).</div>
              }
            </div>
          </div>

          <!-- Compte & engagement : liste de stats fusionnée (zéro doublon) -->
          <div class="card">
            <div class="card-head"><span class="card-label">Compte &amp; engagement</span></div>
            <div class="card-body">
              <div class="slist">
                <div class="srow"><span class="s-l">Plan</span><span class="s-v" [class.purple]="d.identity.plan !== 'FREE'">{{ d.identity.plan }} · {{ planSub() }}</span></div>
                <div class="srow"><span class="s-l">Rôle / Source</span><span class="s-v">{{ d.identity.role }} · {{ sourceLabel() }}</span></div>
                <div class="srow"><span class="s-l">Inscrit</span><span class="s-v">{{ d.identity.createdAt | date:'dd/MM/yyyy' }} · J+{{ d.kpis.daysSinceSignup }}</span></div>
                <div class="srow"><span class="s-l">Dernière activité</span><span class="s-v" [class.teal]="status() === 'actif'">{{ d.identity.lastActivityAt ? lastActivity() : 'jamais' }}</span></div>
                <div class="srow"><span class="s-l">Jours actifs</span><span class="s-v green">{{ d.kpis.activeDays }} / {{ d.kpis.totalDays }} · {{ engagementPct() }}%</span></div>
                <div class="srow"><span class="s-l">Temps de session cumulé</span><span class="s-v">{{ sessionTime() }}</span></div>
                <div class="srow"><span class="s-l">Coût IA</span><span class="s-v amber">{{ '$' + d.kpis.ai.usd.toFixed(2) }} · {{ aiSub() }}</span></div>
                @if (d.sessions.length === 0) {
                  <div class="srow"><span class="s-l">Dernières sessions</span><span class="s-v">aucune</span></div>
                }
              </div>
            </div>
          </div>
        </div>

        <!-- Rangée : Signaux | Connexions | Consommation IA -->
        <div class="ud-g3">
          <div class="card">
            <div class="card-head"><span class="card-label">Signaux</span></div>
            <div class="card-body">
              @for (s of signals(); track s.text) {
                <div class="sig"><div class="sig-ic" [class]="s.cls">{{ s.ic }}</div><div><div class="sig-tx">{{ s.text }}</div><div class="sig-sub">{{ s.sub }}</div></div></div>
              }
            </div>
          </div>

          <div class="card">
            <div class="card-head"><span class="card-label">Connexions · {{ calMonthLabel() }}</span></div>
            <div class="card-body">
              <mtc-admin-activity-calendar [activeDates]="d.activeDates" [createdAt]="d.identity.createdAt" [compact]="true" />
            </div>
          </div>

          <div class="card ud-fill">
            <div class="card-head"><span class="card-label">Consommation IA</span><span class="card-action ud-static">{{ aiHead() }}</span></div>
            <div class="card-body">
              @if (d.aiByFeature.length === 0) {
                <div class="ud-ai-empty">Aucun appel IA — {{ d.identity.plan === 'FREE' ? 'plan FREE (IA réservée au Premium)' : 'pas encore utilisé' }}.</div>
              } @else {
                <div class="donut" [style.background]="donutGradient()">
                  <div class="donut-c"><b>{{ '$' + d.kpis.ai.usd.toFixed(2) }}</b><span>{{ totalKTokens() }}k tokens</span></div>
                </div>
                <div class="leg">
                  @for (seg of aiSegments(); track seg.feature) {
                    <div class="leg-row" [title]="seg.full + ' · $' + seg.costUsd.toFixed(2)">
                      <span class="leg-dot" [style.background]="seg.color"></span>{{ seg.short }} <span class="v">{{ seg.tokLabel }}</span>
                    </div>
                  }
                </div>
              }
            </div>
          </div>
        </div>

        <!-- Dernières sessions : table compacte, affichée uniquement si données -->
        @if (d.sessions.length > 0) {
          <div class="card ud-sessions">
            <div class="card-head"><span class="card-label">Dernières sessions</span><span class="card-action ud-static">lecture seule</span></div>
            <div class="card-body">
              <table class="tbl">
                <thead><tr><th>Date</th><th>Trades</th><th>P&amp;L</th><th>Win rate</th><th>Humeur</th><th>Durée</th></tr></thead>
                <tbody>
                  @for (s of d.sessions; track s.date) {
                    <tr>
                      <td data-label="Date" class="td-mono">{{ s.date | date:'dd/MM' }}</td>
                      <td data-label="Trades">{{ s.trades }}</td>
                      <td data-label="P&L" class="td-mono" [class.pnl-pos]="s.pnl >= 0" [class.pnl-neg]="s.pnl < 0">{{ s.pnl >= 0 ? '+' : '' }}{{ s.pnl.toFixed(2) }}$</td>
                      <td data-label="Win rate" class="td-mono">{{ s.winRate }}%</td>
                      <td data-label="Humeur">{{ moodEmoji(s.emotion) }}</td>
                      <td data-label="Durée" class="td-mono">{{ fmtDuration(s.durationMinutes) }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </div>
        }
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
  /** Présence = jours connectés / jours depuis inscription. NE PAS confondre
   *  avec l'activation (= a-t-il loggé des trades), basée sur l'usage réel. */
  protected readonly engagementPct = computed(() => {
    const k = this.data()?.kpis;
    return k && k.totalDays ? Math.round((k.activeDays / k.totalDays) * 100) : 0;
  });

  // ── Profil trader ──
  protected readonly profile = computed(() => this.data()?.profile ?? null);
  protected readonly hasProfile = computed(() => {
    const p = this.profile();
    return !!p && !!(
      p.market || p.goal || p.tradingStyle ||
      p.tradingStrategy.length || p.tradingSessions.length || p.startingCapital
    );
  });
  protected readonly marketLabel  = computed(() => lbl(MARKET_LABELS, this.profile()?.market));
  protected readonly goalLabel    = computed(() => lbl(GOAL_LABELS, this.profile()?.goal));
  protected readonly styleLabel   = computed(() => lbl(STYLE_LABELS, this.profile()?.tradingStyle));
  protected readonly sessionsLabel = computed(() => {
    const s = this.profile()?.tradingSessions ?? [];
    return s.length ? s.map((x) => SESSION_LABELS[x] ?? x).join(', ') : '—';
  });
  protected readonly strategyLabel = computed(() => {
    const t = this.profile()?.tradingStrategy ?? [];
    return t.length ? t.join(', ') : '—';
  });
  protected readonly capitalLabel = computed(() => {
    const p = this.profile();
    if (!p || !p.startingCapital) return '—';
    const sym = p.currency === 'EUR' ? '€' : '$';
    return `${sym}${p.startingCapital.toLocaleString('en-US')}`;
  });
  protected readonly frequencyLabel = computed<string | null>(() => {
    const p = this.profile();
    if (!p || p.tradesPerDayMin == null) return null;
    const max = p.tradesPerDayMax;
    return max != null && max !== p.tradesPerDayMin
      ? `${p.tradesPerDayMin}-${max} trades/jour`
      : `${p.tradesPerDayMin} trades/jour`;
  });
  protected readonly topAssetsLabel = computed(() => {
    const a = this.data()?.topAssets ?? [];
    return a.length ? a.map((x) => `${x.asset} (${x.count})`).join(', ') : '—';
  });

  // ── Usage ──
  protected readonly pnlDisplay = computed(() => {
    const p = this.data()?.usage.totalPnl ?? 0;
    return `${p >= 0 ? '+' : ''}${p.toFixed(2)}$`;
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
  /** Total tokens en milliers (centre du donut). */
  protected readonly totalKTokens = computed(() =>
    Math.round((this.data()?.kpis.ai.tokens ?? 0) / 1000),
  );

  /** Parts du donut conso IA (une part par feature, part = % des tokens). */
  protected readonly aiSegments = computed(() => {
    const feats = this.data()?.aiByFeature ?? [];
    const total = feats.reduce((s, f) => s + f.tokens, 0) || 1;
    let acc = 0;
    return feats.map((f, i) => {
      const start = (acc / total) * 100;
      acc += f.tokens;
      const end = (acc / total) * 100;
      const l = featLabel(f.feature);
      return {
        feature: f.feature,
        full: l.full,
        short: l.short,
        costUsd: f.costUsd,
        color: DONUT_PALETTE[i % DONUT_PALETTE.length],
        tokLabel: f.tokens >= 1000 ? `${Math.round(f.tokens / 1000)}k` : `${f.tokens}`,
        start,
        end,
      };
    });
  });

  /** Fond conic-gradient du donut, calé sur les parts (zéro lib). */
  protected readonly donutGradient = computed(() => {
    const segs = this.aiSegments();
    if (!segs.length) return '';
    const stops = segs
      .map((s) => `${s.color} ${s.start.toFixed(2)}% ${s.end.toFixed(2)}%`)
      .join(', ');
    return `conic-gradient(${stops})`;
  });

  /** Signaux dérivés (icône ok/warn/bad) — délégué à une fonction pure testable. */
  protected readonly signals = computed<Signal[]>(() => {
    const d = this.data();
    if (!d) return [];
    return buildSignals(d, this.status(), this.lastConn(), this.engagementPct());
  });

  /** Source d'acquisition : ?ref=CODE (parrainage) ou inscription directe. */
  protected readonly sourceLabel = computed(() => {
    const ref = this.data()?.identity.ambassadorRefCode;
    return ref ? `?ref=${ref}` : 'directe';
  });

  /** Dernière activité en relatif (« il y a 19h ») — même donnée que le KPI d'avant. */
  protected readonly lastActivity = computed(() => {
    const iso = this.data()?.identity.lastActivityAt;
    return iso ? this.relTime(iso) : 'jamais';
  });

  /** Mois courant (FR) — libellé indicatif du calendrier de connexions. */
  protected readonly calMonthLabel = computed(() =>
    new Date().toLocaleDateString('fr-FR', { month: 'long' }),
  );

  protected moodEmoji(mood: string | null): string {
    return mood ? (MOOD_EMOJI[mood] ?? '·') : '·';
  }
  protected fmtDuration(mins: number | null): string {
    if (mins === null) return '—';
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return h > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${m}min`;
  }

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
