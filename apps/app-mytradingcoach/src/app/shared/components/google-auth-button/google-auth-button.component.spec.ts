import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { GoogleAuthButtonComponent } from './google-auth-button.component';
import { GoogleIdentityService } from '../../../core/auth/google-identity.service';
import TEMPLATE from './google-auth-button.component.html?raw';

const google = { config: vi.fn(), renderButton: vi.fn() };
const realUA = navigator.userAgent;

function setUA(ua: string) {
  Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true });
}

async function render() {
  TestBed.configureTestingModule({ providers: [{ provide: GoogleIdentityService, useValue: google }] });
  TestBed.overrideComponent(GoogleAuthButtonComponent, {
    set: { template: TEMPLATE, styleUrl: undefined as unknown as string, styleUrls: [] },
  });
  const fixture = TestBed.createComponent(GoogleAuthButtonComponent);
  fixture.detectChanges();
  await fixture.whenStable();
  await new Promise((r) => setTimeout(r));
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('GoogleAuthButtonComponent (#618)', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => setUA(realUA));

  it('connexion Google inactive → rien affiché, script jamais chargé', async () => {
    google.config.mockResolvedValue({ enabled: false, clientId: null });
    const el = await render();
    expect(el.textContent?.trim()).toBe('');
    expect(el.querySelector('.google-slot')?.classList).toContain('gone');
    expect(google.renderButton).not.toHaveBeenCalled();
  });

  it('active → bouton officiel rendu et séparateur « ou »', async () => {
    google.config.mockResolvedValue({ enabled: true, clientId: 'x.apps.googleusercontent.com' });
    google.renderButton.mockResolvedValue(true);
    const el = await render();
    expect(google.renderButton).toHaveBeenCalledWith(expect.any(HTMLElement), 'continue_with', expect.any(Function), expect.any(Number));
    expect(el.querySelector('.separator')?.textContent).toContain('ou');
  });

  it('navigateur intégré Instagram → invitation à ouvrir le navigateur, pas de bouton', async () => {
    setUA('Mozilla/5.0 (iPhone) AppleWebKit Instagram 300.0');
    google.config.mockResolvedValue({ enabled: true, clientId: 'x.apps.googleusercontent.com' });
    const el = await render();
    expect(el.textContent).toContain('ouvre cette page dans ton navigateur');
    expect(google.renderButton).not.toHaveBeenCalled();
  });

  it('script Google injoignable (bloqueur) → rien affiché, le formulaire e-mail reste seul', async () => {
    google.config.mockResolvedValue({ enabled: true, clientId: 'x.apps.googleusercontent.com' });
    google.renderButton.mockResolvedValue(false);
    const el = await render();
    expect(el.querySelector('.separator')).toBeNull();
    expect(el.querySelector('.google-slot')?.classList).toContain('gone');
  });
});
