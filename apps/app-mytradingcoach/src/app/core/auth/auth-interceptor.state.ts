import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class AuthInterceptorState {
  isRefreshing = false;
  readonly token$ = new BehaviorSubject<string | null>(null);
}
