import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs/operators';
import { AuthService } from '../auth/auth.service';
import { UserStore } from '../stores/user.store';
import { PUSH_BROWSER, type BrowserEnv } from '../push/push-browser';
import { devicePlace, isAndroid, isInAppBrowser, isIos, isIosOtherBrowser } from '../push/push-device';
import { ProductEventsService, type InstallEvent } from '../services/product-events.service';
import { INSTALL_STORAGE } from './install-storage';
import { InstallCapture, type InstallSheet } from './install-capture';

/**
 * Ce que l'appareil permet pour installer l'app (maquette `mockup-installation-pwa.html`) :
 * - `installed`      : ouverte depuis l'écran d'accueil (ou installation confirmée dans cet onglet) ;
 * - `can-prompt`     : le navigateur a fourni son invite (`beforeinstallprompt`, Chrome, Edge) ;
 * - `android-manual` : Android sans invite (pas encore reçue, ou navigateur sans) : menu ⋮ ;
 * - `ios-manual`     : Safari sur iPhone ou iPad : Partager, puis Sur l'écran d'accueil ;
 * - `ios-other`      : iPhone sur Chrome ou Firefox, qui ne savent pas installer : ouvrir Safari ;
 * - `in-app-browser` : navigateur intégré (Instagram, X, TikTok) : ouvrir le vrai navigateur ;
 * - `unsupported`    : ordinateur sans invite (Firefox, Safari Mac).
 */
export type InstallState =
  | 'installed'
  | 'can-prompt'
  | 'android-manual'
  | 'ios-manual'
  | 'ios-other'
  | 'in-app-browser'
  | 'unsupported';

/** Ce qui déclenche la proposition : liaison d'un plan prop firm (Premium) ou import réussi (Gratuit). */
export type InstallTrigger = 'plan-linked' | 'import';

export type { InstallSheet } from './install-capture';

export const LATER_DAYS = 7;
const DAY_MS = 24 * 3600 * 1000;
/** Délai avant d'ouvrir la feuille : la modale qui vient d'enregistrer (plan, import) se ferme d'abord. */
export const OPEN_DELAY_MS = 600;
/** Invitation aux alertes après un lancement depuis l'écran d'accueil : jamais au premier affichage. */
export const PUSH_INVITE_DELAY_MS = 3000;

/** Diagnostic de l'appareil seul. L'ordre compte : installée, puis navigateur intégré, puis iPhone. */
export function installState(env: BrowserEnv, canPrompt: boolean, installedNow: boolean): InstallState {
  if (env.standalone || installedNow) return 'installed';
  if (isInAppBrowser(env)) return 'in-app-browser';
  if (isIos(env)) return isIosOtherBrowser(env) ? 'ios-other' : 'ios-manual';
  if (canPrompt) return 'can-prompt';
  return isAndroid(env) ? 'android-manual' : 'unsupported';
}

/** États qui ouvrent le parcours de lui-même. Ordinateur : jamais (QR code sur la landing). */
export function autoEligible(state: InstallState, env: BrowserEnv): boolean {
  if (state === 'installed' || state === 'unsupported') return false;
  return devicePlace(env) !== 'desktop';
}

/**
 * Règles de fréquence, communes au parcours et à l'invitation aux alertes : jamais si « Ne plus me
 * proposer » (définitif sur cet appareil), jamais avant la fin du report de « Plus tard » (7 jours),
 * une fois par session au plus.
 */
export function frequencyAllows(s: { never: boolean; laterUntil: number | null; shownThisSession: boolean }, now: number): boolean {
  if (s.never || s.shownThisSession) return false;
  return s.laterUntil === null || now >= s.laterUntil;
}

/** Déclencheur adapté au plan : liaison d'un plan prop firm pour un Premium, import pour un Gratuit. */
export function triggerMatchesPlan(trigger: InstallTrigger, premium: boolean): boolean {
  return trigger === 'plan-linked' ? premium : !premium;
}

/**
 * Parcours d'installation de l'app sur l'écran d'accueil, CHARGÉ À LA DEMANDE (budget du bundle) :
 * par les écrans déclencheurs (import, liaison d'un plan, Profil, eux-mêmes paresseux), par `App`
 * au lancement depuis l'écran d'accueil, ou par `InstallCapture` sur `appinstalled`. Les
 * événements du navigateur reçus avant son chargement sont gardés par `InstallCapture` (bundle
 * initial). La feuille est chargée par `App` (`@defer`). Jamais à l'arrivée : seulement après une
 * liaison de plan prop firm (Premium) ou un import réussi (Gratuit), ou depuis le Profil.
 * Choix gardés sur l'appareil (`InstallStorage`), aucune route API. Compte démo : parcours
 * visible, aucun événement envoyé (les alertes, elles, restent en lecture seule dans le Profil).
 */
@Injectable({ providedIn: 'root' })
export class InstallPromptService {
  private readonly browser = inject(PUSH_BROWSER);
  private readonly storage = inject(INSTALL_STORAGE);
  private readonly auth = inject(AuthService);
  private readonly userStore = inject(UserStore);
  private readonly router = inject(Router);
  private readonly events = inject(ProductEventsService);

  private readonly capture = inject(InstallCapture);

  /** Proposition reçue pendant l'onboarding : montrée à la première page hors onboarding. */
  private pending: InstallTrigger | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  /** Recalculé à chaque lecture de `state` : l'environnement change après une installation. */
  private readonly tick = signal(0);
  readonly state = computed<InstallState>(() => {
    this.tick();
    return installState(this.browser.env(), this.capture.prompt() !== null, this.capture.installed());
  });
  /** Feuille ouverte : l'état vit dans `InstallCapture`, que `App` lit sans charger ce service. */
  readonly sheet = this.capture.sheet;
  /** Ouverte depuis le Profil : ni règle de fréquence, ni « Ne plus me proposer ». */
  readonly fromSettings = signal(false);

  constructor() {
    // Installation confirmée avant le chargement de ce fichier : comptée maintenant.
    if (this.capture.installed()) this.markDone();
    const sub = this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((e) => this.onNavigate(e.urlAfterRedirects));
    // Chargé par `App` au lancement depuis l'écran d'accueil : la page courante compte aussi.
    queueMicrotask(() => this.onNavigate(this.router.url));
    inject(DestroyRef).onDestroy(() => {
      sub.unsubscribe();
      this.clearTimer();
    });
  }

  private get env(): BrowserEnv {
    return this.browser.env();
  }

  /** Plateforme des événements (android, ios, ios-other, desktop). */
  place(): string {
    return devicePlace(this.env);
  }

  /** Proposition automatique après un déclencheur. Ne fait rien si une règle s'y oppose. */
  offer(trigger: InstallTrigger): void {
    if (!this.auth.currentUser()) return;
    if (!triggerMatchesPlan(trigger, this.userStore.isPremium())) return;
    if (this.router.url.startsWith('/onboarding')) {
      this.pending = trigger;
      return;
    }
    this.tryOpen();
  }

  private onNavigate(url: string): void {
    if (this.pending && !url.startsWith('/onboarding')) {
      this.pending = null;
      this.tryOpen();
    }
    // Lancement depuis l'écran d'accueil : installation comptée une fois par appareil, puis
    // invitation aux alertes (la feuille vérifie elle-même que le push est ouvert côté serveur).
    if (this.env.standalone && this.auth.currentUser()) {
      this.markDone();
      this.schedulePushInvite();
    }
  }

  private tryOpen(): void {
    const state = this.state();
    if (!autoEligible(state, this.env) || this.sheet() || this.timer) return;
    if (!frequencyAllows(this.frequency('install'), Date.now())) return;
    this.storage.markSession('install');
    this.timer = setTimeout(() => {
      this.timer = null;
      this.open('install', false);
    }, OPEN_DELAY_MS);
  }

  private schedulePushInvite(): void {
    if (this.sheet() || this.timer) return;
    if (!frequencyAllows(this.frequency('push'), Date.now())) return;
    this.storage.markSession('push');
    this.timer = setTimeout(() => {
      this.timer = null;
      this.sheet.set('push');
    }, PUSH_INVITE_DELAY_MS);
  }

  /** Ligne « Installer l'app » du Profil : rouvre le parcours de l'appareil, sans règle de fréquence. */
  openFromSettings(): void {
    if (this.state() === 'installed' || this.state() === 'unsupported') return;
    this.clearTimer();
    this.open('install', true);
  }

  private open(sheet: InstallSheet, fromSettings: boolean): void {
    this.fromSettings.set(fromSettings);
    this.sheet.set(sheet);
    if (sheet === 'install') this.track(this.state() === 'in-app-browser' ? 'inapp_seen' : 'install_shown');
  }

  /** Bouton « Installer » : l'invite du navigateur (Android, ordinateur). */
  async install(): Promise<void> {
    const e = this.capture.prompt();
    if (!e) return;
    this.track('install_click');
    // Une invite ne sert qu'une fois : le navigateur en renverra une si l'utilisateur la refuse.
    this.capture.prompt.set(null);
    try {
      await e.prompt();
      const choice = await e.userChoice;
      if (choice.outcome === 'accepted') this.close();
    } catch {
      // Invite refusée par le navigateur (déjà utilisée) : la feuille reste, avec l'aide manuelle.
    }
  }

  /**
   * « Je l'ai fait » (iPhone) : revérifie le mode application. Dans Safari, l'app ajoutée s'ouvre
   * depuis son icône, pas dans cet onglet : `false` = afficher « Ouvre MTC depuis son icône ».
   * La proposition est alors repoussée comme « Plus tard », sans compter un report.
   */
  iosDone(): boolean {
    this.track('install_click');
    this.tick.update((n) => n + 1);
    if (this.state() === 'installed') {
      this.close();
      return true;
    }
    this.storage.setLaterUntil('install', Date.now() + LATER_DAYS * DAY_MS);
    return false;
  }

  /** « Plus tard » (ou fermeture) : plus de proposition automatique pendant 7 jours. */
  later(): void {
    const sheet = this.sheet();
    if (!sheet) return;
    if (!this.fromSettings()) this.storage.setLaterUntil(sheet, Date.now() + LATER_DAYS * DAY_MS);
    if (sheet === 'install') this.track('install_later');
    this.close();
  }

  /** « Ne plus me proposer » : définitif sur cet appareil. La ligne du Profil reste. */
  never(): void {
    this.storage.setNever('install');
    this.track('install_never');
    this.close();
  }

  /**
   * Invitation aux alertes sans objet (push coupé côté serveur, non pris en charge, refusé, déjà
   * actif) : fermée sans rien afficher. Déjà actif : plus jamais vérifiée sur cet appareil.
   */
  pushNotNeeded(subscribed: boolean): void {
    if (subscribed) this.storage.setNever('push');
    this.close();
  }

  close(): void {
    this.sheet.set(null);
    this.fromSettings.set(false);
  }

  private markDone(): void {
    if (this.storage.isDone()) return;
    if (!this.auth.currentUser()) return;
    this.storage.setDone();
    this.track('install_done');
  }

  private frequency(sheet: InstallSheet) {
    return {
      never: this.storage.isNever(sheet),
      laterUntil: this.storage.laterUntil(sheet),
      shownThisSession: this.storage.shownThisSession(sheet),
    };
  }

  private track(event: InstallEvent): void {
    if (this.auth.currentUser()?.isDemo) return;
    this.events.track(event, this.place());
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
