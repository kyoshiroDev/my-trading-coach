import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '@app/environments/environment';

/** Configuration publique renvoyée par `GET /auth/google/config` (#618). */
export interface GoogleAuthConfig {
  enabled: boolean;
  clientId: string | null;
}

/** Sous-ensemble de l'API Google Identity Services utilisé ici (pas de paquet de types). */
interface GoogleIdApi {
  initialize(options: {
    client_id: string;
    callback: (response: { credential?: string }) => void;
    ux_mode: 'popup';
    context: 'signin' | 'signup' | 'use';
    itp_support: boolean;
    auto_select: boolean;
    cancel_on_tap_outside: boolean;
  }): void;
  renderButton(
    parent: HTMLElement,
    options: {
      type: 'standard';
      theme: 'outline' | 'filled_blue' | 'filled_black';
      size: 'large';
      text: GoogleButtonText;
      shape: 'rectangular' | 'pill';
      logo_alignment: 'left' | 'center';
      width: number;
      locale: string;
    },
  ): void;
}

export type GoogleButtonText = 'signin_with' | 'signup_with' | 'continue_with';

declare global {
  interface Window {
    google?: { accounts?: { id?: GoogleIdApi } };
  }
}

const GIS_SRC = 'https://accounts.google.com/gsi/client';
/** Largeurs acceptées par le bouton Google (px). */
export const GOOGLE_BUTTON_MIN_WIDTH = 200;
export const GOOGLE_BUTTON_MAX_WIDTH = 400;

/**
 * Connexion Google côté front : config lue sur l'API (activation et client ID par environnement,
 * rien en dur), script GIS chargé à la demande seulement si la fonction est active. Rien de Google
 * dans le bundle initial (`/register` est chargé au démarrage, budget serré).
 */
@Injectable({ providedIn: 'root' })
export class GoogleIdentityService {
  private readonly http = inject(HttpClient);
  private configPromise?: Promise<GoogleAuthConfig>;
  private scriptPromise?: Promise<GoogleIdApi>;

  /** Config mise en cache le temps de l'onglet ; une erreur réseau désactive le bouton. */
  config(): Promise<GoogleAuthConfig> {
    this.configPromise ??= firstValueFrom(
      this.http.get<{ data: GoogleAuthConfig }>(`${environment.apiUrl}/auth/google/config`),
    )
      .then((res) => res.data)
      .catch(() => {
        this.configPromise = undefined; // nouvel essai à la prochaine page
        return { enabled: false, clientId: null };
      });
    return this.configPromise;
  }

  /**
   * Affiche le bouton officiel Google dans `parent`, à la largeur `width` (bornée 200-400 px par
   * Google). `onCredential` reçoit l'ID token après le choix du compte. Renvoie `false` si la
   * connexion Google est inactive ou le script injoignable. Rappelable (redimensionnement) : le
   * contenu précédent est remplacé.
   */
  async renderButton(
    parent: HTMLElement,
    text: GoogleButtonText,
    onCredential: (credential: string) => void,
    width: number,
  ): Promise<boolean> {
    const config = await this.config();
    if (!config.enabled || !config.clientId) return false;
    let api: GoogleIdApi;
    try {
      api = await this.loadScript();
    } catch {
      return false;
    }
    // Un seul rappel global chez Google : réinitialisé à chaque bouton affiché (connexion,
    // inscription), le dernier écran ouvert reçoit le jeton.
    api.initialize({
      client_id: config.clientId,
      callback: (response) => {
        if (response.credential) onCredential(response.credential);
      },
      ux_mode: 'popup',
      context: text === 'signin_with' ? 'signin' : 'signup',
      itp_support: true,
      auto_select: false,
      cancel_on_tap_outside: true,
    });
    parent.replaceChildren();
    // Bouton personnalisé « Continuer en tant que… » : Google l'affiche dès qu'une session Google
    // a déjà accepté le site. Aucune option ne le désactive en taille `large` et largeur ≥ 200 px
    // (doc « personalized button ») : il reçoit donc les mêmes réglages que le bouton standard.
    api.renderButton(parent, {
      type: 'standard',
      theme: 'outline',
      size: 'large',
      text,
      shape: 'rectangular',
      logo_alignment: 'left',
      width: Math.round(Math.min(GOOGLE_BUTTON_MAX_WIDTH, Math.max(GOOGLE_BUTTON_MIN_WIDTH, width))),
      locale: 'fr',
    });
    return true;
  }

  private loadScript(): Promise<GoogleIdApi> {
    this.scriptPromise ??= new Promise<GoogleIdApi>((resolve, reject) => {
      const ready = () => {
        const api = window.google?.accounts?.id;
        if (api) resolve(api);
        else reject(new Error('GIS indisponible'));
      };
      if (window.google?.accounts?.id) return ready();
      const script = document.createElement('script');
      script.src = GIS_SRC;
      script.async = true;
      script.defer = true;
      script.onload = ready;
      script.onerror = () => {
        this.scriptPromise = undefined; // bloqueur, réseau : nouvel essai possible
        script.remove();
        reject(new Error('GIS non chargé'));
      };
      document.head.appendChild(script);
    });
    return this.scriptPromise;
  }
}
