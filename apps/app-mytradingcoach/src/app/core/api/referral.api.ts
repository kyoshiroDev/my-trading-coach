import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export type FilleulStatus = 'payant' | 'essai' | 'inscrit';

export interface ReferralFilleul {
  pseudo: string;
  date: string;
  status: FilleulStatus;
  rewarded: boolean;
}

export interface MyReferral {
  referralCode: string;
  link: string;
  invited: number;
  subscribed: number;
  freeMonthsEarned: number;
  creditAvailable: number;
  filleuls: ReferralFilleul[];
}

export interface ApplyAmbassadorDto {
  socials: string;
  message?: string;
}

@Injectable({ providedIn: 'root' })
export class ReferralApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/referral`;

  getMyReferral(): Observable<{ data: MyReferral }> {
    return this.http.get<{ data: MyReferral }>(`${this.base}/me`);
  }

  applyAmbassador(dto: ApplyAmbassadorDto): Observable<{ data: { success: boolean } }> {
    return this.http.post<{ data: { success: boolean } }>(
      `${this.base}/ambassador/apply`,
      dto,
    );
  }

  /** Relevé de commissions ambassadeur (PDF). Renvoie le blob pour telechargement. */
  generateStatement(): Observable<Blob> {
    return this.http.post(`${this.base}/ambassador/statement`, {}, { responseType: 'blob' });
  }
}
