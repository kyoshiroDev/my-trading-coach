import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { ALERT_SOUNDS, AlertSoundService } from './alert-sound.service';

/** Contexte audio factice : on compte les notes jouées. */
class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  /** Un vrai navigateur crée le contexte suspendu tant que la page n'a reçu aucun geste. */
  static initialState: 'running' | 'suspended' = 'running';
  state: 'running' | 'suspended' = FakeAudioContext.initialState;
  currentTime = 0;
  destination = {};
  oscillators: { freq: number }[] = [];
  constructor() { FakeAudioContext.instances.push(this); }
  resume = vi.fn(async () => undefined);
  createOscillator() {
    const o = { type: '', frequency: { value: 0 }, connect: vi.fn(), start: vi.fn(), stop: vi.fn() };
    this.oscillators.push(o.frequency as unknown as { freq: number });
    return o;
  }
  createGain() {
    return { gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() }, connect: vi.fn() };
  }
}

describe('AlertSoundService', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    FakeAudioContext.instances = [];
    FakeAudioContext.initialState = 'running';
    localStorage.removeItem('mtc.alertSound');
    vi.stubGlobal('AudioContext', FakeAudioContext);
  });
  afterEach(() => vi.unstubAllGlobals());

  const unlock = () => document.dispatchEvent(new Event('pointerdown'));

  it('audio encore bloqué par le navigateur : aucune note, sans erreur', () => {
    FakeAudioContext.initialState = 'suspended';
    const svc = TestBed.inject(AlertSoundService);
    svc.play('warning');
    expect(FakeAudioContext.instances).toHaveLength(1);
    expect(FakeAudioContext.instances[0].oscillators).toHaveLength(0);
    expect(FakeAudioContext.instances[0].resume).toHaveBeenCalledTimes(0);
    svc.play('warning');
    expect(FakeAudioContext.instances[0].resume, 'nouvel essai de reprise au son suivant').toHaveBeenCalledTimes(1);
  });

  it('après un clic : joue le motif de la gravité demandée', () => {
    const svc = TestBed.inject(AlertSoundService);
    unlock();
    svc.play('critical');
    expect(FakeAudioContext.instances[0].oscillators).toHaveLength(ALERT_SOUNDS.critical.length);
  });

  it('coupé : silence, et la préférence est gardée sur l’appareil', () => {
    const svc = TestBed.inject(AlertSoundService);
    unlock();
    svc.toggle();
    expect(svc.enabled()).toBe(false);
    expect(localStorage.getItem('mtc.alertSound')).toBe('off');
    svc.play('critical');
    expect(FakeAudioContext.instances[0].oscillators).toHaveLength(0);
  });

  it('réactivé : un son de confirmation', () => {
    localStorage.setItem('mtc.alertSound', 'off');
    const svc = TestBed.inject(AlertSoundService);
    unlock();
    expect(svc.enabled()).toBe(false);
    svc.toggle();
    expect(svc.enabled()).toBe(true);
    expect(FakeAudioContext.instances[0].oscillators).toHaveLength(ALERT_SOUNDS.warning.length);
  });

  it('navigateur sans Web Audio : aucune erreur', () => {
    vi.stubGlobal('AudioContext', undefined);
    const svc = TestBed.inject(AlertSoundService);
    unlock();
    expect(() => svc.play('reached')).not.toThrow();
  });
});
