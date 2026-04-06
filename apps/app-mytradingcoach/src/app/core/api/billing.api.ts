import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class BillingApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/billing`;

  checkout(plan: 'monthly' | 'yearly') {
    return this.http.post<{ data: { url: string } }>(`${this.base}/checkout`, { plan });
  }

  portal() {
    return this.http.get<{ data: { url: string } }>(`${this.base}/portal`);
  }
}
