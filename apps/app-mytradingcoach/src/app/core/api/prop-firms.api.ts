import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '@app/environments/environment';
import type { PropFirmCatalogFirm } from '@mtc/shared';

export type { PropFirmCatalogFirm };

@Injectable({ providedIn: 'root' })
export class PropFirmsApi {
  private readonly http = inject(HttpClient);

  /** Catalogue des plans prop firm (firms + plans actifs), pour choisir le plan d'un compte. */
  getCatalog(): Observable<{ data: PropFirmCatalogFirm[] }> {
    return this.http.get<{ data: PropFirmCatalogFirm[] }>(`${environment.apiUrl}/prop-firms`);
  }
}
