/**
 * Profil, bloc Discord (#741) : la liaison passe par un code à usage unique généré ici, tapé
 * ensuite dans le serveur (`/verify code:`). Avant, le bot reliait le compte dont on tapait
 * l'e-mail, sans preuve que la personne y était connectée.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal, NO_ERRORS_SCHEMA } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { EMPTY, of, throwError } from 'rxjs';
import { ProfileComponent } from './profile.component';
import { UserStore } from '../../core/stores/user.store';
import { AuthService } from '../../core/auth/auth.service';
import { BillingApi } from '../../core/api/billing.api';
import { UsersApi } from '../../core/api/users.api';
import { TradesApi } from '../../core/api/trades.api';
import { SetupsStore } from '../../core/stores/setups.store';
import { AnalyticsApi } from '../../core/api/analytics.api';
import { DiscordApi } from '../../core/api/discord.api';
import { ToastService } from '../../core/services/toast.service';
import { ConfirmService } from '@mtc/front-ui';

const CODE = { code: 'ABCD-EFGH', expiresAt: '2026-10-25T10:10:00.000Z' };

function mount(
  opts: { demo?: boolean; linked?: boolean; createCode?: () => unknown; unlink?: () => unknown; confirm?: boolean } = {},
) {
  const discordApi = {
    status: vi.fn(() => of({ linked: opts.linked ?? false })),
    createCode: vi.fn(opts.createCode ?? (() => of(CODE))),
    unlink: vi.fn(opts.unlink ?? (() => of({ linked: false }))),
  };
  const confirm = { ask: vi.fn(async () => opts.confirm ?? true) };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      {
        provide: UserStore,
        useValue: {
          user: () => ({ currency: 'EUR', notificationsEmail: true, debriefAutomatic: true, marketingConsent: false }),
          isPremium: () => false, isDemo: () => opts.demo ?? false, isInTrial: () => false,
          displayName: () => 'Test', startingCapital: () => 0, refreshUser: vi.fn(),
        },
      },
      { provide: AuthService, useValue: { currentUser: signal(null), setCurrentUser: vi.fn(), logout: vi.fn() } },
      { provide: BillingApi, useValue: { offers: () => EMPTY } },
      { provide: UsersApi, useValue: { getAiUsage: vi.fn(() => of({ data: null })) } },
      { provide: TradesApi, useValue: { getUserAssets: vi.fn(() => of({ data: [] })) } },
      { provide: SetupsStore, useValue: { active: signal([]), archived: signal([]), load: vi.fn(), loaded: signal(true) } },
      { provide: AnalyticsApi, useValue: { getBySetup: vi.fn(() => of({ data: [] })) } },
      { provide: DiscordApi, useValue: discordApi },
      { provide: ConfirmService, useValue: confirm },
    ],
  });
  TestBed.overrideComponent(ProfileComponent, {
    set: {
      template: '<div></div>', imports: [], styleUrls: [],
      styleUrl: undefined as unknown as string, schemas: [NO_ERRORS_SCHEMA],
    },
  });
  const toast = TestBed.inject(ToastService);
  const toastError = vi.spyOn(toast, 'error');
  const toastSuccess = vi.spyOn(toast, 'success');
  const fixture = TestBed.createComponent(ProfileComponent);
  fixture.detectChanges();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { cmp: fixture.componentInstance as any, discordApi, confirm, toastError, toastSuccess };
}

describe('Profil : liaison Discord par code (#741)', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('état lu à l’ouverture : « Relié » ou « Non relié »', () => {
    expect(mount({ linked: true }).cmp.discordLinked()).toBe(true);
    TestBed.resetTestingModule();
    expect(mount({ linked: false }).cmp.discordLinked()).toBe(false);
  });

  it('compte démo : aucun appel (bloc masqué, l’API refuserait de toute façon)', () => {
    const { discordApi, cmp } = mount({ demo: true });
    expect(discordApi.status).not.toHaveBeenCalled();
    expect(cmp.discordLinked()).toBeNull();
  });

  it('« Générer un code » → code affiché', () => {
    const { cmp, discordApi } = mount();
    cmp.generateDiscordCode();
    expect(discordApi.createCode).toHaveBeenCalledTimes(1);
    expect(cmp.discordCode()).toEqual(CODE);
    expect(cmp.generatingDiscordCode()).toBe(false);
  });

  it('échec (limite atteinte…) → message du serveur en toast, aucun code affiché', () => {
    const { cmp, toastError } = mount({
      createCode: () => throwError(() => ({ error: { message: 'Trop de requêtes, réessaie plus tard.' } })),
    });
    cmp.generateDiscordCode();
    expect(toastError).toHaveBeenCalledWith('Trop de requêtes, réessaie plus tard.');
    expect(cmp.discordCode()).toBeNull();
    expect(cmp.generatingDiscordCode()).toBe(false);
  });

  it('« Copier » copie le code seul, sans la commande', async () => {
    const writeText = vi.fn(async (_text: string) => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { cmp, toastSuccess } = mount();
    cmp.generateDiscordCode();
    await cmp.copyDiscordCode();
    expect(writeText).toHaveBeenCalledWith('ABCD-EFGH');
    // Contre-épreuve : l'ancien comportement copiait « /verify code:ABCD-EFGH ».
    expect(writeText.mock.calls[0][0]).not.toContain('/verify');
    expect(toastSuccess).toHaveBeenCalled();
  });

  it('« Délier mon Discord » confirmé → API appelée, état « Non relié », code effacé', async () => {
    const { cmp, discordApi, confirm, toastSuccess } = mount({ linked: true });
    cmp.generateDiscordCode();
    await cmp.unlinkDiscord();
    expect(confirm.ask).toHaveBeenCalledTimes(1);
    expect(discordApi.unlink).toHaveBeenCalledTimes(1);
    expect(cmp.discordLinked()).toBe(false);
    expect(cmp.discordCode()).toBeNull();
    expect(cmp.unlinkingDiscord()).toBe(false);
    expect(toastSuccess).toHaveBeenCalledWith('Ton Discord est délié');
  });

  it('contre-épreuve : confirmation annulée → aucun appel, toujours relié', async () => {
    const { cmp, discordApi } = mount({ linked: true, confirm: false });
    await cmp.unlinkDiscord();
    expect(discordApi.unlink).not.toHaveBeenCalled();
    expect(cmp.discordLinked()).toBe(true);
  });

  it('contre-épreuve : Discord a échoué (503) → message du serveur, toujours affiché « Relié »', async () => {
    const message = "Ton Discord n'a pas pu être délié\u00a0: le retrait de ton rôle a échoué côté Discord.";
    const { cmp, toastError } = mount({ linked: true, unlink: () => throwError(() => ({ error: { message } })) });
    await cmp.unlinkDiscord();
    expect(toastError).toHaveBeenCalledWith(message);
    expect(cmp.discordLinked()).toBe(true);
    expect(cmp.unlinkingDiscord()).toBe(false);
  });
});
