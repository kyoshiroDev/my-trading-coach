import { DestroyRef, Injectable, inject, signal } from '@angular/core';

/** Son d'une alerte : du plus doux au plus pressant. */
export type AlertSound = 'tilt' | 'warning' | 'critical' | 'reached';

/** Une note : fréquence (Hz), début et durée (s) depuis le déclenchement. */
interface Note {
  freq: number;
  at: number;
  dur: number;
}

/**
 * Motifs sonores, générés par le navigateur (Web Audio) : aucun fichier à charger.
 * - tilt : une note grave et douce (une question, pas une alarme) ;
 * - warning : deux bips moyens ;
 * - critical : trois bips aigus rapprochés (critique ou dépassé) ;
 * - reached : arpège montant (bonne nouvelle).
 */
export const ALERT_SOUNDS: Record<AlertSound, Note[]> = {
  tilt: [{ freq: 392, at: 0, dur: 0.35 }],
  warning: [{ freq: 660, at: 0, dur: 0.14 }, { freq: 660, at: 0.22, dur: 0.14 }],
  critical: [{ freq: 880, at: 0, dur: 0.12 }, { freq: 880, at: 0.18, dur: 0.12 }, { freq: 880, at: 0.36, dur: 0.2 }],
  reached: [{ freq: 523, at: 0, dur: 0.14 }, { freq: 659, at: 0.14, dur: 0.14 }, { freq: 784, at: 0.28, dur: 0.3 }],
};

const STORAGE_KEY = 'mtc.alertSound';
const VOLUME = 0.18;

type AudioCtor = typeof AudioContext;

/**
 * Son des alertes prop firm et du nudge anti-tilt (#370, #371). Activé par défaut, coupable
 * depuis le panneau de la session live (préférence de cet appareil, gardée en local).
 *
 * Les navigateurs bloquent le son tant que l'utilisateur n'a pas interagi avec la page : le
 * contexte audio est créé au premier clic ou à la première touche, puis réutilisé. Avant ce
 * geste, une alerte reste silencieuse (le toast et la notification, eux, s'affichent).
 */
@Injectable({ providedIn: 'root' })
export class AlertSoundService {
  readonly enabled = signal(this.readEnabled());

  private ctx: AudioContext | null = null;

  constructor() {
    if (typeof document === 'undefined') return;
    const stop = () => {
      document.removeEventListener('pointerdown', unlock, true);
      document.removeEventListener('keydown', unlock, true);
    };
    const unlock = () => {
      this.ensureContext();
      stop();
    };
    document.addEventListener('pointerdown', unlock, true);
    document.addEventListener('keydown', unlock, true);
    // Service détruit (déconnexion de l'injecteur, tests) : plus d'écouteur orphelin sur la page.
    inject(DestroyRef).onDestroy(stop);
  }

  toggle(): void {
    const next = !this.enabled();
    this.enabled.set(next);
    try { localStorage.setItem(STORAGE_KEY, next ? 'on' : 'off'); } catch { /* stockage indisponible */ }
    // Réactivation par un clic : c'est aussi le geste qui débloque l'audio, on le confirme d'un son.
    if (next) this.play('warning');
  }

  play(sound: AlertSound): void {
    if (!this.enabled()) return;
    const ctx = this.ensureContext();
    if (!ctx || ctx.state === 'suspended') return; // pas encore de geste de l'utilisateur
    const start = ctx.currentTime + 0.01;
    for (const n of ALERT_SOUNDS[sound]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = n.freq;
      // Attaque et extinction courtes : pas de « clic » au début ni à la fin de la note.
      gain.gain.setValueAtTime(0, start + n.at);
      gain.gain.linearRampToValueAtTime(VOLUME, start + n.at + 0.015);
      gain.gain.linearRampToValueAtTime(0, start + n.at + n.dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start + n.at);
      osc.stop(start + n.at + n.dur + 0.02);
    }
  }

  private ensureContext(): AudioContext | null {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);
      return this.ctx;
    }
    const Ctor = typeof window === 'undefined'
      ? undefined
      : ((window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor }).AudioContext
        ?? (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext);
    if (!Ctor) return null;
    try {
      this.ctx = new Ctor();
    } catch {
      return null;
    }
    return this.ctx;
  }

  private readEnabled(): boolean {
    try {
      return localStorage.getItem(STORAGE_KEY) !== 'off';
    } catch {
      return true;
    }
  }
}
