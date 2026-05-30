import {
  ChangeDetectionStrategy, Component, DestroyRef,
  computed, inject, signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { LucideAngularModule, Send, Eye, X, RefreshCw } from 'lucide-angular';
import { AdminApi, CampaignMeta } from '../../core/api/admin.api';

@Component({
  selector: 'mtc-admin-emails',
  standalone: true,
  imports: [FormsModule, DatePipe, LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './emails.component.css',
  template: `
    <div class="content">
      <div class="page-header">
        <h1 class="page-title">Campagnes Email</h1>
        <button class="btn-icon" (click)="load()" aria-label="Rafraîchir">
          <lucide-icon [img]="RefreshIcon" [size]="14" />
        </button>
      </div>

      @if (loading()) {
        <div class="loading-state">Chargement des campagnes...</div>
      } @else {
        <div class="campaigns-list">
          @for (c of campaigns(); track c.type) {
            <div class="campaign-card">
              <div class="campaign-left">
                <div class="campaign-emoji">{{ c.emoji }}</div>
                <div class="campaign-info">
                  <div class="campaign-label">{{ c.label }}</div>
                  <div class="campaign-desc">{{ c.desc }}</div>
                  <div class="campaign-target">
                    <span class="target-badge">{{ c.targetDesc }}</span>
                    <span class="target-count">{{ c.targetCount }} destinataire{{ c.targetCount !== 1 ? 's' : '' }}</span>
                  </div>
                </div>
              </div>
              <div class="campaign-right">
                @if (c.lastSent) {
                  <div class="campaign-last">
                    Dernier : {{ c.lastSent | date:'dd/MM HH:mm' }} · {{ c.lastCount }} envoyés
                  </div>
                } @else {
                  <div class="campaign-last never">Jamais envoyé</div>
                }
                <div class="campaign-actions">
                  <button class="btn-preview" (click)="openPreview(c)" [disabled]="c.targetCount === 0"
                    aria-label="Aperçu">
                    <lucide-icon [img]="EyeIcon" [size]="13" />
                    Aperçu
                  </button>
                  <button class="btn-send" (click)="openSend(c)" [disabled]="c.targetCount === 0"
                    aria-label="Envoyer">
                    <lucide-icon [img]="SendIcon" [size]="13" />
                    Envoyer
                  </button>
                </div>
              </div>
            </div>
          }
        </div>
      }
    </div>

    <!-- ── Modal Aperçu ── -->
    @if (previewCampaign()) {
      <div class="modal-overlay" role="button" tabindex="0" aria-label="Fermer"
        (click)="previewCampaign.set(null)" (keydown.escape)="previewCampaign.set(null)">
        <div class="modal modal-preview" role="dialog" aria-modal="true"
          (click)="$event.stopPropagation()" (keydown)="$event.stopPropagation()">
          <div class="modal-header">
            <h2 class="modal-title">{{ previewCampaign()!.emoji }} Aperçu — {{ previewCampaign()!.label }}</h2>
            <button class="modal-close" (click)="previewCampaign.set(null)" aria-label="Fermer">
              <lucide-icon [img]="XIcon" [size]="16" />
            </button>
          </div>
          <div class="modal-body">
            @if (previewCampaign()!.type === 'announcement') {
              <div class="preview-compose">
                <div class="field-group">
                  <label class="field-label" for="preview-subject">Objet *</label>
                  <input id="preview-subject" type="text" class="field-input"
                    placeholder="ex: 🚀 Nouvelle feature — Import CSV amélioré"
                    [ngModel]="announcementSubject()"
                    (ngModelChange)="announcementSubject.set($event)" />
                </div>
                <div class="field-group">
                  <label class="field-label" for="preview-body">Contenu</label>
                  <textarea id="preview-body" class="field-textarea preview-textarea" rows="4"
                    placeholder="ex: Ça y est, la V2 est en ligne..."
                    [ngModel]="announcementBody()"
                    (ngModelChange)="announcementBody.set($event)"></textarea>
                </div>
              </div>
            }
            @if (previewLoading()) {
              <div class="loading-state">Chargement des destinataires...</div>
            } @else {
              <div class="preview-meta">
                <span class="preview-recipients">{{ previewRecipients().length }} destinataire{{ previewRecipients().length !== 1 ? 's' : '' }}</span>
                <div class="preview-list">
                  @for (r of previewRecipients().slice(0, 5); track r.email) {
                    <span class="preview-email">{{ r.email }}</span>
                  }
                  @if (previewRecipients().length > 5) {
                    <span class="preview-more">+{{ previewRecipients().length - 5 }} autres</span>
                  }
                </div>
              </div>
              <div class="preview-frame">
                <iframe [srcdoc]="wrappedPreviewHtml()" title="Aperçu email"
                  style="width:100%;height:460px;border:none;border-radius:8px;background:#ffffff"></iframe>
              </div>
            }
          </div>
        </div>
      </div>
    }

    <!-- ── Modal Envoyer ── -->
    @if (sendCampaignModal()) {
      <div class="modal-overlay" role="button" tabindex="0" aria-label="Fermer"
        (click)="sendCampaignModal.set(null)" (keydown.escape)="sendCampaignModal.set(null)">
        <div class="modal modal-send" role="dialog" aria-modal="true"
          (click)="$event.stopPropagation()" (keydown)="$event.stopPropagation()">
          <div class="modal-header">
            <h2 class="modal-title">{{ sendCampaignModal()!.emoji }} {{ sendCampaignModal()!.label }}</h2>
            <button class="modal-close" (click)="sendCampaignModal.set(null)" aria-label="Fermer">
              <lucide-icon [img]="XIcon" [size]="16" />
            </button>
          </div>
          <div class="modal-body">
            @if (sendCampaignModal()!.type === 'announcement') {
              <div class="field-group">
                <label class="field-label" for="announce-subject">Sujet *</label>
                <input id="announce-subject" type="text" class="field-input"
                  placeholder="ex: 🚀 Nouvelle feature — Import CSV amélioré"
                  [ngModel]="announcementSubject()"
                  (ngModelChange)="announcementSubject.set($event)" />
              </div>
              <div class="field-group">
                <label class="field-label" for="announce-body">Contenu</label>
                <textarea id="announce-body" class="field-textarea" rows="6"
                  placeholder="ex: Ça y est, la V2 est en ligne..."
                  [ngModel]="announcementBody()"
                  (ngModelChange)="announcementBody.set($event)">
                </textarea>
              </div>
            }
            <div class="send-summary">
              <div class="summary-row">
                <span class="summary-label">Destinataires</span>
                <span class="summary-val">{{ sendCampaignModal()!.targetCount }} utilisateurs</span>
              </div>
              <div class="summary-row">
                <span class="summary-label">Cible</span>
                <span class="summary-val">{{ sendCampaignModal()!.targetDesc }}</span>
              </div>
              @if (sendCampaignModal()!.lastSent) {
                <div class="summary-row">
                  <span class="summary-label">Dernier envoi</span>
                  <span class="summary-val">{{ sendCampaignModal()!.lastSent | date:'dd/MM/yyyy HH:mm' }}</span>
                </div>
              }
            </div>
            <div class="warning-box">
              ⚠️ Envoi à <strong>{{ sendCampaignModal()!.targetCount }} personne{{ sendCampaignModal()!.targetCount !== 1 ? 's' : '' }}</strong>. Vérifie l'aperçu avant.
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn-secondary" (click)="sendCampaignModal.set(null)">Annuler</button>
            <button class="btn-primary" [disabled]="sending() || !canSend()" (click)="doSend()">
              @if (sending()) { Envoi en cours... }
              @else {
                <lucide-icon [img]="SendIcon" [size]="13" />
                Envoyer à {{ sendCampaignModal()!.targetCount }} personnes
              }
            </button>
          </div>
        </div>
      </div>
    }

    @if (toast()) {
      <div class="toast" [class.toast-error]="toast()!.error">{{ toast()!.message }}</div>
    }
  `,
})
export class EmailsComponent {
  private readonly adminApi   = inject(AdminApi);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly SendIcon    = Send;
  protected readonly EyeIcon     = Eye;
  protected readonly XIcon       = X;
  protected readonly RefreshIcon = RefreshCw;

  protected readonly loading            = signal(true);
  protected readonly campaigns          = signal<CampaignMeta[]>([]);
  protected readonly previewCampaign    = signal<CampaignMeta | null>(null);
  protected readonly previewLoading     = signal(false);
  protected readonly previewHtml        = signal('');
  protected readonly previewRecipients  = signal<{ email: string; name: string | null }[]>([]);
  protected readonly sendCampaignModal  = signal<CampaignMeta | null>(null);
  protected readonly sending            = signal(false);
  protected readonly toast              = signal<{ message: string; error?: boolean } | null>(null);

  protected readonly announcementSubject = signal('');
  protected readonly announcementBody    = signal('');

  protected readonly wrappedPreviewHtml = computed(() => {
    const campaign = this.previewCampaign();

    let inner: string;
    if (campaign?.type === 'announcement') {
      const subject = this.announcementSubject().trim() || '📣 Nouveauté MyTradingCoach';
      const body    = this.formatBody(this.announcementBody());
      const name    = this.previewRecipients()[0]?.name ?? 'Trader';
      const APP_URL = 'https://app.mytradingcoach.app';
      const BASE    = `font-family:'DM Sans',Arial,sans-serif;background:#080c14;color:#e2eaf5;max-width:600px;margin:0 auto;padding:40px 24px;`;
      const CARD    = `background:#0f1824;border:1px solid rgba(99,155,255,.1);border-radius:12px;padding:28px;margin:20px 0;`;
      const BTN     = `display:inline-block;background:#3b82f6;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:700;margin-top:16px;`;
      const MUTED   = `color:#8fa3bf;font-size:12px;margin-top:28px;text-align:center;`;

      inner = `<div style="${BASE}"><h1 style="color:#e2eaf5;font-size:22px;margin-bottom:6px;">${subject}</h1><p style="color:#8fa3bf;margin-top:0;">MyTradingCoach</p><div style="${CARD}"><p style="color:#e2eaf5;">Bonjour ${name},</p>${body}<a href="${APP_URL}" style="${BTN}">Accéder à l'app →</a></div><p style="${MUTED}">MyTradingCoach — Fait en France 🇫🇷</p></div>`;
    } else {
      inner = this.previewHtml();
    }

    if (!inner) return '';
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>*{box-sizing:border-box;}html,body{margin:0;padding:0;background:#f4f4f4;font-family:Arial,sans-serif;}body{display:flex;justify-content:center;padding:20px;}</style></head><body>${inner}</body></html>`;
  });

  protected readonly canSend = computed(() => {
    const c = this.sendCampaignModal();
    if (!c) return false;
    if (c.type === 'announcement') return !!this.announcementSubject().trim();
    return true;
  });

  constructor() { this.load(); }

  load(): void {
    this.loading.set(true);
    this.adminApi.listCampaigns()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: r => { this.campaigns.set(r.data ?? []); this.loading.set(false); }, error: () => this.loading.set(false) });
  }

  openPreview(c: CampaignMeta): void {
    this.previewCampaign.set(c);
    this.previewHtml.set('');
    this.previewRecipients.set([]);
    this.previewLoading.set(true);
    this.adminApi.previewCampaign(c.type, this.announcementSubject(), this.announcementBody())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: r => {
          if (c.type !== 'announcement') this.previewHtml.set(r.data.html);
          this.previewRecipients.set(r.data.recipients ?? []);
          this.previewLoading.set(false);
        },
        error: () => this.previewLoading.set(false),
      });
  }

  openSend(c: CampaignMeta): void {
    if (c.type !== 'announcement') {
      this.announcementSubject.set('');
      this.announcementBody.set('');
    }
    this.sendCampaignModal.set(c);
  }

  doSend(): void {
    const c = this.sendCampaignModal();
    if (!c || !this.canSend()) return;
    this.sending.set(true);
    this.adminApi.sendCampaign(c.type, this.announcementSubject(), this.announcementBody())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: r => { this.sending.set(false); this.sendCampaignModal.set(null); this.showToast(`✅ ${r.data.success} emails envoyés · ${r.data.errors} erreurs`); this.load(); },
        error: () => { this.sending.set(false); this.showToast('❌ Erreur lors de l\'envoi', true); },
      });
  }

  private formatBody(raw: string): string {
    if (!raw?.trim()) return '<p style="color:#8fa3bf;font-style:italic;">Ton message apparaîtra ici…</p>';
    const blocks = raw
      .replace(/\r\n/g, '\n')
      .split(/\n{2,}/)
      .map(b => b.trim())
      .filter(Boolean);
    return blocks
      .map(block => {
        const withBreaks = block.replace(/\n/g, '<br/>');
        const isHeading = /^[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(block) && block.length < 60 && !block.includes('\n');
        return isHeading
          ? `<p style="font-size:15px;font-weight:700;color:#e2eaf5;margin:22px 0 8px;">${withBreaks}</p>`
          : `<p style="color:#b0bec5;line-height:1.8;margin:0 0 14px;">${withBreaks}</p>`;
      })
      .join('');
  }

  private showToast(message: string, error = false): void {
    this.toast.set({ message, error });
    setTimeout(() => this.toast.set(null), 4000);
  }
}
