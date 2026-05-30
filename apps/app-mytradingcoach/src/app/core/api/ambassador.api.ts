import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface ReferralUser {
  id: string;
  name: string | null;
  email: string;
  plan: 'FREE' | 'STARTER' | 'PREMIUM';
  createdAt: string;
  isActive: boolean;
}

export interface AmbassadorStats {
  referralCode: string;
  referrals: ReferralUser[];
  total: number;
  free: number;
  starter: number;
  premium: number;
  earningsByMonth: Record<string, number>;
  totalEarned: number;
  pendingPayout: number;
}

@Injectable({ providedIn: 'root' })
export class AmbassadorApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/ambassador`;

  getStats(): Observable<{ data: AmbassadorStats }> {
    return this.http.get<{ data: AmbassadorStats }>(`${this.base}/stats`);
  }

  getNewCount(since: string): Observable<{ data: { count: number } }> {
    return this.http.get<{ data: { count: number } }>(`${this.base}/new-count`, {
      params: { since },
    });
  }
}