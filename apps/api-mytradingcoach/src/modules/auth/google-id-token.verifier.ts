import { Injectable, UnauthorizedException } from '@nestjs/common';
import { OAuth2Client } from 'google-auth-library';

/** Identité Google extraite d'un ID token vérifié. */
export interface GoogleIdentity {
  /** `sub` : identifiant Google stable du compte (jamais l'e-mail, qui peut changer). */
  googleId: string;
  /** E-mail en minuscules, toujours vérifié chez Google (sinon refus). */
  email: string;
  name: string | null;
}

/** Raison d'un refus, pour les logs (jamais le token ni l'e-mail). */
export type GoogleTokenRefusal = 'invalid_token' | 'email_not_verified';

export class GoogleTokenRefusedException extends UnauthorizedException {
  constructor(readonly reason: GoogleTokenRefusal) {
    super(
      reason === 'email_not_verified'
        ? { code: 'GOOGLE_EMAIL_NOT_VERIFIED', message: "Ton adresse Google n'est pas vérifiée" }
        : { code: 'GOOGLE_TOKEN_INVALID', message: 'Connexion Google invalide ou expirée, réessaie' },
    );
  }
}

const GOOGLE_ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];

/**
 * Vérifie l'ID token renvoyé par Google Identity Services : signature (clés publiques Google,
 * mises en cache par la lib), `aud` = client ID de l'environnement, `iss`, expiration, puis
 * `email_verified === true`. Isolé dans un provider pour être remplacé dans les tests.
 */
@Injectable()
export class GoogleIdTokenVerifier {
  private readonly client = new OAuth2Client();

  async verify(idToken: string, clientId: string): Promise<GoogleIdentity> {
    let payload;
    try {
      const ticket = await this.client.verifyIdToken({ idToken, audience: clientId });
      payload = ticket.getPayload();
    } catch {
      // Signature, audience, émetteur ou expiration : la lib lève, on ne relaie pas son message.
      throw new GoogleTokenRefusedException('invalid_token');
    }
    if (!payload?.sub || !payload.email || !GOOGLE_ISSUERS.includes(payload.iss)) {
      throw new GoogleTokenRefusedException('invalid_token');
    }
    if (payload.email_verified !== true) throw new GoogleTokenRefusedException('email_not_verified');
    return {
      googleId: payload.sub,
      email: payload.email.trim().toLowerCase(),
      name: payload.name?.trim().slice(0, 100) || null,
    };
  }
}
