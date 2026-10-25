import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpContext } from '@angular/common/http';
import { SILENT_ERRORS } from '@mtc/front-ui';
import { type Observable, map } from 'rxjs';
import { environment } from '@app/environments/environment';

export interface DiscordLinkCode {
  /** « ABCD-EFGH », à taper dans Discord : `/verify code:ABCD-EFGH`. */
  code: string;
  expiresAt: string;
}

/**
 * Liaison du compte Discord par code à usage unique (#741). En `SILENT_ERRORS` : le bloc Discord du
 * Profil affiche son propre message, le toast global de l'intercepteur en ferait un second.
 */
const SILENT = () => ({ context: new HttpContext().set(SILENT_ERRORS, true) });

@Injectable({ providedIn: 'root' })
export class DiscordApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/discord`;

  status(): Observable<{ linked: boolean }> {
    return this.http.get<{ data: { linked: boolean } }>(`${this.base}/link`, SILENT()).pipe(map((r) => r.data));
  }

  createCode(): Observable<DiscordLinkCode> {
    return this.http.post<{ data: DiscordLinkCode }>(`${this.base}/link-code`, {}, SILENT()).pipe(map((r) => r.data));
  }
}
