import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Component, Input, NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { ResultsShareComponent, CHART_MAX_BYTES } from './results-share.component';
import { referralDisplay, type ResultsCardData } from '@app/shared/components/results-card/results-card.util';
import { ReferralApi } from '@app/core/api/referral.api';
import { ToastService } from '@app/core/services/toast.service';
import TEMPLATE from './results-share.component.html?raw';

// Isolé (NEEDS_ISOLATION) : le module html-to-image est remplacé.
const toBlob = vi.fn();
vi.mock('html-to-image', () => ({
  toBlob: (...args: unknown[]) => toBlob(...args),
  getFontEmbedCSS: vi.fn().mockResolvedValue(''),
}));

/**
 * Carte factice à @Input classiques : en JIT sous vitest, un parent n'alimente pas les entrées
 * SIGNAL de la vraie carte (couverte par sa propre spec). Même sélecteur, même contenu utile.
 */
@Component({
  selector: 'mtc-results-card',
  template: '<span class="link">{{ link }}</span>@if (chartUrl) {<img class="chart" alt="" [src]="chartUrl" />}',
})
class FakeResultsCardComponent {
  @Input() format: 'square' | 'story' = 'square';
  @Input() data!: ResultsCardData;
  @Input() chartUrl: string | null = null;
  get link(): string { return referralDisplay(this.data?.referralCode); }
}

const DATA = {
  pnlLabel: '+$342.00',
  pnlPositive: true,
  winRateLabel: '67%',
  tradesCount: 6,
  moodEmoji: '😎',
  moodLabel: 'Confiant',
  dateLabel: 'Vendredi 2 octobre',
  dateLabelLong: 'Vendredi 2 octobre 2026',
};

const referralApi = { getMyReferral: vi.fn() };
const toast = { error: vi.fn() };

function mount(disabled = false) {
  TestBed.configureTestingModule({
    providers: [
      { provide: ReferralApi, useValue: referralApi },
      { provide: ToastService, useValue: toast },
    ],
  });
  TestBed.overrideComponent(ResultsShareComponent, {
    set: {
      template: TEMPLATE,
      imports: [FakeResultsCardComponent],
      styleUrls: [],
      styleUrl: undefined as unknown as string,
      schemas: [NO_ERRORS_SCHEMA],
    },
  });
  const fixture = TestBed.createComponent(ResultsShareComponent);
  const cmp = fixture.componentInstance as unknown as Record<string, unknown>;
  cmp['data'] = signal(DATA);
  cmp['date'] = signal(new Date(2026, 9, 2));
  cmp['disabled'] = signal(disabled);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  /** Laisse s'enchaîner rendu → afterNextRender → génération (promesses). */
  const settle = async () => {
    for (let i = 0; i < 8; i++) {
      TestBed.tick(); // détection + hooks afterNextRender (que detectChanges seul ne lance pas)
      await new Promise((r) => setTimeout(r, 0));
    }
  };
  const $ = <T extends Element = HTMLElement>(id: string) => el.querySelector<T>(`[data-testid="${id}"]`);
  return { fixture, el, settle, $ };
}

async function openModal() {
  const ctx = mount();
  ctx.$<HTMLButtonElement>('results-share-open')!.click();
  await ctx.settle();
  return ctx;
}

function pickFile(input: HTMLInputElement, file: File) {
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new Event('change'));
}

describe('mtc-results-share', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    referralApi.getMyReferral.mockReturnValue(of({ data: { referralCode: 'GREG4X2' } }));
    toBlob.mockResolvedValue(new Blob(['png'], { type: 'image/png' }));
    URL.createObjectURL = vi.fn(() => 'blob:card');
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => {
    delete (navigator as { canShare?: unknown }).canShare;
    delete (navigator as { share?: unknown }).share;
  });

  it('rien à partager : bouton désactivé, aucun appel ni génération', async () => {
    const { $, settle } = mount(true);
    const btn = $<HTMLButtonElement>('results-share-open')!;
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toContain('Rien à partager aujourd’hui');
    btn.click();
    await settle();
    expect(referralApi.getMyReferral).not.toHaveBeenCalled();
    expect(toBlob).not.toHaveBeenCalled();
  });

  it('génère un PNG 1080×1080 avec le code de parrainage réel, sans pixelRatio de l’écran', async () => {
    const { el } = await openModal();
    expect(referralApi.getMyReferral).toHaveBeenCalledTimes(1);
    expect(toBlob).toHaveBeenCalled(); // jsdom s'annonce WebKit : + 1 rendu de chauffe
    const [node, options] = toBlob.mock.calls.at(-1) as [HTMLElement, Record<string, unknown>];
    expect(options).toMatchObject({ width: 1080, height: 1080, pixelRatio: 1 });
    expect(node.textContent).toContain('mytradingcoach.app/?ref=GREG4X2');
    expect(el.querySelector('.rs-preview img')!.getAttribute('src')).toBe('blob:card');
  });

  it('Story : nouveau rendu en 1080×1920', async () => {
    const { $, settle } = await openModal();
    $<HTMLButtonElement>('rs-format-story')!.click();
    await settle();
    expect(toBlob.mock.calls.at(-1)![1]).toMatchObject({ width: 1080, height: 1920 });
  });

  it('desktop (pas de partage de fichiers) : Télécharger + Ouvrir Instagram, puis rappel du lien', async () => {
    const { el, $, settle } = await openModal();
    expect($('rs-share')).toBeNull();
    const download = $<HTMLAnchorElement>('rs-download')!;
    expect(download.getAttribute('download')).toBe('mytradingcoach-debrief-2026-10-02-post.png');
    expect(el.querySelector('a[href="https://www.instagram.com"]')!.getAttribute('target')).toBe('_blank');

    download.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await settle();
    expect(el.querySelector('.rs-hint')!.textContent).toContain('sticker lien');
  });

  it('mobile : un seul bouton qui ouvre le partage natif avec le fichier et le lien', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { canShare: () => true, share });
    const { el, $, settle } = await openModal();
    expect($('rs-download')).toBeNull();
    $<HTMLButtonElement>('rs-share')!.click();
    await settle();
    const arg = share.mock.calls[0][0] as { files: File[]; text: string };
    expect(arg.files[0].name).toBe('mytradingcoach-debrief-2026-10-02-post.png');
    expect(arg.files[0].type).toBe('image/png');
    expect(arg.text).toContain('https://mytradingcoach.app/?ref=GREG4X2');
    expect(el.querySelector('.rs-hint')).not.toBeNull();
  });

  it('partage annulé par l’utilisateur : ni erreur ni rappel', async () => {
    const share = vi.fn().mockRejectedValue(new DOMException('cancel', 'AbortError'));
    Object.assign(navigator, { canShare: () => true, share });
    const { el, $, settle } = await openModal();
    $<HTMLButtonElement>('rs-share')!.click();
    await settle();
    expect(toast.error).not.toHaveBeenCalled();
    expect(el.querySelector('.rs-hint')).toBeNull();
  });

  it('parrainage indisponible : carte avec le domaine seul plutôt qu’aucune carte', async () => {
    referralApi.getMyReferral.mockReturnValue(throwError(() => new Error('500')));
    await openModal();
    const node = toBlob.mock.calls.at(-1)![0] as HTMLElement;
    expect(node.textContent).toContain('mytradingcoach.app');
    expect(node.textContent).not.toContain('?ref=');
  });

  it('échec de génération : message et bouton Réessayer, pas d’écran figé', async () => {
    toBlob.mockRejectedValueOnce(new Error('boom'));
    const { el } = await openModal();
    expect(el.querySelector('.rs-error')!.textContent).toContain('n’a pas pu être générée');
    expect(el.querySelector('.rs-retry')).not.toBeNull();
  });

  describe('graphique optionnel', () => {
    it('refuse un fichier qui n’est pas une image, avec un message clair', async () => {
      const { $, settle } = await openModal();
      const renders = toBlob.mock.calls.length;
      pickFile($<HTMLInputElement>('rs-chart-input')!, new File(['x'], 'notes.pdf', { type: 'application/pdf' }));
      await settle();
      expect($('rs-chart-error')!.textContent).toContain('pas une image');
      expect(toBlob.mock.calls.length).toBe(renders); // pas de nouveau rendu
    });

    it('refuse une image de plus de 10 Mo', async () => {
      const { $, settle } = await openModal();
      const big = new File(['x'], 'chart.png', { type: 'image/png' });
      Object.defineProperty(big, 'size', { value: CHART_MAX_BYTES + 1 });
      pickFile($<HTMLInputElement>('rs-chart-input')!, big);
      await settle();
      expect($('rs-chart-error')!.textContent).toContain('10 Mo max');
    });

    it('image valide : réduite en local puis composée à côté de la carte, retirable', async () => {
      HTMLImageElement.prototype.decode = vi.fn().mockResolvedValue(undefined);
      vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(3200);
      vi.spyOn(HTMLImageElement.prototype, 'naturalHeight', 'get').mockReturnValue(1800);
      const drawImage = vi.fn();
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as never);
      vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb) => {
        cb(new Blob(['small'], { type: 'image/png' }));
      });

      const { $, settle } = await openModal();
      URL.createObjectURL = vi.fn(() => 'blob:chart');
      const renders = toBlob.mock.calls.length;
      pickFile($<HTMLInputElement>('rs-chart-input')!, new File(['x'], 'chart.png', { type: 'image/png' }));
      await settle();

      expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 1600, 900); // côté long ramené à 1600
      expect(toBlob.mock.calls.length).toBeGreaterThan(renders);
      const node = toBlob.mock.calls.at(-1)![0] as HTMLElement;
      expect(node.querySelector('img.chart')!.getAttribute('src')).toBe('blob:chart');
      expect($('rs-chart-error')).toBeNull();

      $<HTMLButtonElement>('rs-chart-remove')!.click();
      await settle();
      expect((toBlob.mock.calls.at(-1)![0] as HTMLElement).querySelector('img.chart')).toBeNull();
      vi.restoreAllMocks();
    });

    it('image illisible par le navigateur (ex. HEIC) : message, pas de crash muet', async () => {
      const { $, settle } = await openModal();
      HTMLImageElement.prototype.decode = vi.fn().mockRejectedValue(new Error('decode'));
      pickFile($<HTMLInputElement>('rs-chart-input')!, new File(['x'], 'IMG.heic', { type: 'image/heic' }));
      await settle();
      expect($('rs-chart-error')!.textContent).toContain('n’a pas pu être lue');
      expect($('rs-chart-remove')).toBeNull();
    });
  });
});
