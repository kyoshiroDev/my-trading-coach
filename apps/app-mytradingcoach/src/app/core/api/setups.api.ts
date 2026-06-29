import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface Setup {
  id: string;
  title: string;
  color: string;
  description: string | null;
  sortOrder: number;
  archived: boolean;
  tradeCount: number;
}

export interface CreateSetupDto {
  title: string;
  color: string;
  description?: string;
}
export type UpdateSetupDto = Partial<CreateSetupDto>;

@Injectable({ providedIn: 'root' })
export class SetupsApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/setups`;

  list(): Observable<{ data: Setup[] }> {
    return this.http.get<{ data: Setup[] }>(this.base);
  }
  create(dto: CreateSetupDto): Observable<{ data: Setup }> {
    return this.http.post<{ data: Setup }>(this.base, dto);
  }
  update(id: string, dto: UpdateSetupDto): Observable<{ data: Setup }> {
    return this.http.patch<{ data: Setup }>(`${this.base}/${id}`, dto);
  }
  archive(id: string): Observable<{ data: Setup }> {
    return this.http.patch<{ data: Setup }>(`${this.base}/${id}/archive`, {});
  }
  restore(id: string): Observable<{ data: Setup }> {
    return this.http.patch<{ data: Setup }>(`${this.base}/${id}/restore`, {});
  }
  delete(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/${id}`);
  }
}
