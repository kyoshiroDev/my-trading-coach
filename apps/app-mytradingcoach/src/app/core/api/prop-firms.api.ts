import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '@app/environments/environment';
import type { PropFirmCatalogFirm, PropFirmPlanDetail } from '@mtc/shared';

export type { PropFirmCatalogFirm, PropFirmPlanDetail };

@Injectable({ providedIn: 'root' })
export class PropFirmsApi {
  private readonly http = inject(HttpClient);

  /** Catalogue des plans prop firm (firms + plans actifs), pour choisir le plan d'un compte. */
  getCatalog(): Observable<{ data: PropFirmCatalogFirm[] }> {
    return this.http.get<{ data: PropFirmCatalogFirm[] }>(`${environment.apiUrl}/prop-firms`);
  }

  /** Règles complètes d'un plan (retiré du catalogue compris). */
  getPlan(id: string): Observable<{ data: PropFirmPlanDetail }> {
    return this.http.get<{ data: PropFirmPlanDetail }>(`${environment.apiUrl}/prop-firms/plans/${encodeURIComponent(id)}`);
  }
}
