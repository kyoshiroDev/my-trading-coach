import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { environment } from '../../../environments/environment';

export interface AdminUser {
  id: string;
  email: string;
  name: string | null;
  plan: 'FREE' | 'PREMIUM';
  role: 'ADMIN' | 'USER' | 'BETA_TESTER';
  trialEndsAt: string | null;
  createdAt: string;
  _count: { trades: number };
}

export interface AdminListResponse {
  data: {
    users: AdminUser[];
    total: number;
    page: number;
    limit: number;
  };
}

export interface AdminUpdateDto {
  name?: string;
  plan?: 'FREE' | 'PREMIUM';
  role?: 'USER' | 'BETA_TESTER';
}

@Injectable({ providedIn: 'root' })
export class AdminApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/users/admin`;

  list(page = 1, limit = 20, search?: string) {
    let params = new HttpParams().set('page', page).set('limit', limit);
    if (search) params = params.set('search', search);
    return this.http.get<AdminListResponse>(this.base, { params });
  }

  update(id: string, dto: AdminUpdateDto) {
    return this.http.patch<{ data: AdminUser }>(`${this.base}/${id}`, dto);
  }

  delete(id: string) {
    return this.http.delete<void>(`${this.base}/${id}`);
  }
}
