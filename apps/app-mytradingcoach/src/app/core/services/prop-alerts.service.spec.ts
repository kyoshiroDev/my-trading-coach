import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { PropAlertsService, propAlertMessage, type PropAlertEvent } from './prop-alerts.service';
import { ToastService } from './toast.service';

const ev = (p: Partial<PropAlertEvent> = {}): PropAlertEvent => ({
  accountId: 'a', accountLabel: 'Apex 50k', currency: 'USD', kind: 'drawdown', level: 'warning',
  remaining: 450, limit: 2000, breach: null, ...p,
});

describe('propAlertMessage', () => {
  it('drawdown : ce qui reste, ou plancher atteint', () => {
    expect(propAlertMessage(ev())).toBe('Apex 50k : plus que $450 avant le plancher de drawdown.');
    expect(propAlertMessage(ev({ level: 'breached', remaining: -20 }))).toContain('plancher de drawdown atteint');
  });

  it('perte journalière : ce qui reste, et la sanction de la firm une fois atteinte', () => {
    expect(propAlertMessage(ev({ kind: 'daily_loss', remaining: 250, limit: 1000 })))
      .toBe("Apex 50k : plus que $250 de perte permise aujourd'hui (limite $1,000).");
    expect(propAlertMessage(ev({ kind: 'daily_loss', level: 'breached', limit: 1000, breach: 'trading_paused_for_day' })))
      .toContain('coupe le trading jusqu’à la prochaine séance');
    expect(propAlertMessage(ev({ kind: 'daily_loss', level: 'breached', limit: 1000, breach: 'account_failed' })))
      .toContain('échec du compte');
  });
});

describe('PropAlertsService.handle', () => {
  const notifications: { title: string; opts: NotificationOptions }[] = [];
  class FakeNotification {
    static permission: NotificationPermission = 'granted';
    static requestPermission = vi.fn(async () => 'granted' as NotificationPermission);
    constructor(title: string, opts: NotificationOptions) { notifications.push({ title, opts }); }
  }

  function setup() {
    const toast = { warning: vi.fn(), error: vi.fn() };
    TestBed.configureTestingModule({ providers: [{ provide: ToastService, useValue: toast }] });
    return { svc: TestBed.inject(PropAlertsService), toast };
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    notifications.length = 0;
    FakeNotification.permission = 'granted';
    vi.stubGlobal('Notification', FakeNotification);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('avertissement : toast d’alerte temporaire + notification système', () => {
    const { svc, toast } = setup();
    svc.handle(ev());
    expect(toast.warning).toHaveBeenCalledWith('Apex 50k : plus que $450 avant le plancher de drawdown.');
    expect(notifications).toEqual([{ title: 'MyTradingCoach · alerte prop firm', opts: expect.objectContaining({ tag: 'a:drawdown' }) }]);
  });

  it('critique ou dépassé : toast qui reste jusqu’à fermeture', () => {
    const { svc, toast } = setup();
    svc.handle(ev({ level: 'critical' }));
    expect(toast.error).toHaveBeenCalledWith(expect.any(String), { duration: null });
  });

  it('notifications non autorisées : toast seulement', () => {
    FakeNotification.permission = 'denied';
    const { svc, toast } = setup();
    svc.handle(ev());
    expect(toast.warning).toHaveBeenCalled();
    expect(notifications).toHaveLength(0);
  });
});
