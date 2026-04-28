import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthUser } from '../auth/auth.service';

export interface UpdateMeDto {
  name?: string;
  email?: string;
}

export interface CompleteOnboardingDto {
  market?: 'CRYPTO' | 'FOREX' | 'ACTIONS' | 'MULTI' | null;
  goal?: 'DISCIPLINE' | 'PERFORMANCE' | 'PSYCHOLOGIE' | null;
  startingCapital?: number;
  currency?: 'USD' | 'EUR';
}

export interface UpdatePreferencesDto {
  currency?: 'USD' | 'EUR' | 'GBP';
  notificationsEmail?: boolean;
  debriefAutomatic?: boolean;
}

@Injectable({ providedIn: 'root' })
export class UsersApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/users`;

  getMe(): Observable<{ data: AuthUser }> {
    return this.http.get<{ data: AuthUser }>(`${this.base}/me`);
  }

  updateMe(dto: UpdateMeDto): Observable<{ data: AuthUser }> {
    return this.http.patch<{ data: AuthUser }>(`${this.base}/me`, dto);
  }

  completeOnboarding(dto: CompleteOnboardingDto): Observable<{ data: AuthUser }> {
    return this.http.patch<{ data: AuthUser }>(`${this.base}/onboarding`, dto);
  }

  updatePreferences(dto: UpdatePreferencesDto): Observable<{ data: AuthUser }> {
    return this.http.patch<{ data: AuthUser }>(`${this.base}/preferences`, dto);
  }

  deleteMe(): Observable<void> {
    return this.http.delete<void>(`${this.base}/me`);
  }
}
