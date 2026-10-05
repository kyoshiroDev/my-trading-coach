import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { PropAlertsService, TILT_TOAST_MS, propAlertMessage, tiltMessage, type PropAlertEvent, type TiltAlertEvent } from './prop-alerts.service';
import { ToastService } from './toast.service';
import { AlertSoundService } from './alert-sound.service';

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

describe('propAlertMessage : consistency et bonnes nouvelles', () => {
  it('consistency : ce qui reste aujourd’hui, ou le profit à rattraper', () => {
    expect(propAlertMessage(ev({ kind: 'consistency', remaining: 150, limit: 800, maxShare: 0.4 })))
      .toBe("Apex 50k : encore $150 de gain maximum aujourd'hui pour respecter la consistency (une journée ≤ 40 % du profit).");
    expect(propAlertMessage(ev({ kind: 'consistency', level: 'breached', remaining: -100, limit: 800, maxShare: 0.4, extraProfit: 250 })))
      .toBe('Apex 50k : ta journée dépasse la règle de consistency (une journée ≤ 40 % du profit) : il faudra environ $250 de profit en plus pour la respecter.');
  });

  it('objectif atteint, payout possible : présentés comme une estimation', () => {
    expect(propAlertMessage(ev({ kind: 'objective', level: 'reached' }))).toContain('objectif atteint selon l\'estimation');
    expect(propAlertMessage(ev({ kind: 'payout', level: 'reached' }))).toContain('payout possible');
  });
});

const tilt = (p: Partial<TiltAlertEvent> = {}): TiltAlertEvent => ({
  accountId: 'a', accountLabel: 'Apex 50k', signal: 'revenge', ref: 't1', minutes: 1.4, moodStart: null, ...p,
});

describe('tiltMessage : le fait, l’humeur si elle pèse, une question', () => {
  it('revenge, avec une humeur fatiguée notée en pré-session', () => {
    expect(tiltMessage(tilt({ moodStart: 'TIRED' })))
      .toBe('Apex 50k : trade repris 1 min après une perte. Tu avais noté « fatigué » en pré-session. Une pause de 10 minutes ?');
  });

  it('humeur neutre ou positive : non mentionnée', () => {
    expect(tiltMessage(tilt({ moodStart: 'FOCUSED' }))).not.toContain('pré-session');
  });

  it('taille et surtrading : comparés à l’habitude du trader', () => {
    expect(tiltMessage(tilt({ signal: 'size', quantity: 5, medianQuantity: 2 })))
      .toBe('Apex 50k : 5 contrats juste après une perte, plus du double de ta taille habituelle (2). Une pause avant le prochain ?');
    expect(tiltMessage(tilt({ signal: 'overtrading', count: 7, medianCount: 3 })))
      .toBe("Apex 50k : 7 trades aujourd'hui, plus du double d'une journée habituelle (3). Tu suis toujours ton plan ?");
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
    const toast = { warning: vi.fn(), error: vi.fn(), success: vi.fn() };
    const sound = { play: vi.fn() };
    TestBed.configureTestingModule({
      providers: [{ provide: ToastService, useValue: toast }, { provide: AlertSoundService, useValue: sound }],
    });
    return { svc: TestBed.inject(PropAlertsService), toast, sound };
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

  it('bonne nouvelle : toast de succès qui reste, notification « bonne nouvelle »', () => {
    const { svc, toast } = setup();
    svc.handle(ev({ kind: 'payout', level: 'reached' }));
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('payout possible'), { duration: null });
    expect(notifications[0].title).toBe('MyTradingCoach · bonne nouvelle');
  });

  it('anti-tilt : avertissement de 15 s, notification « pause ? »', () => {
    const { svc, toast } = setup();
    svc.handleTilt(tilt());
    expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining('trade repris'), { duration: TILT_TOAST_MS });
    expect(notifications[0]).toEqual({ title: 'MyTradingCoach · pause ?', opts: expect.objectContaining({ tag: 'a:tilt:revenge' }) });
  });

  it('un son par gravité : avertissement, critique ou dépassé, bonne nouvelle, anti-tilt', () => {
    const { svc, sound } = setup();
    svc.handle(ev());
    svc.handle(ev({ level: 'critical' }));
    svc.handle(ev({ level: 'breached' }));
    svc.handle(ev({ kind: 'payout', level: 'reached' }));
    svc.handleTilt(tilt());
    expect(sound.play.mock.calls.map((c) => c[0])).toEqual(['warning', 'critical', 'critical', 'reached', 'tilt']);
  });

  it('notifications non autorisées : toast seulement', () => {
    FakeNotification.permission = 'denied';
    const { svc, toast } = setup();
    svc.handle(ev());
    expect(toast.warning).toHaveBeenCalled();
    expect(notifications).toHaveLength(0);
  });
});
