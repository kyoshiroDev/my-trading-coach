import { HttpHandlerFn, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, filter, switchMap, take, throwError } from 'rxjs';
import { AuthService } from './auth.service';
import { AuthInterceptorState } from './auth-interceptor.state';

export const authInterceptor: HttpInterceptorFn = (req: HttpRequest<unknown>, next: HttpHandlerFn) => {
  const auth  = inject(AuthService);
  const state = inject(AuthInterceptorState);
  const token = auth.getAccessToken();

  const isRefreshCall = req.url.includes('/auth/refresh');
  const isAuthCall    = req.url.includes('/auth/login') || req.url.includes('/auth/register') || req.url.includes('/auth/logout');

  const baseReq = req.clone({ withCredentials: true });
  const authReq = token && !isRefreshCall && !isAuthCall
    ? baseReq.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
    : baseReq;

  return next(authReq).pipe(
    catchError((err) => {
      if (err.status !== 401 || isRefreshCall) {
        return throwError(() => err);
      }

      if (state.isRefreshing) {
        return state.token$.pipe(
          filter((t): t is string => t !== null),
          take(1),
          switchMap((newToken) =>
            next(req.clone({
              withCredentials: true,
              setHeaders: { Authorization: `Bearer ${newToken}` },
            })),
          ),
        );
      }

      state.isRefreshing = true;
      state.token$.next(null);

      return auth.refreshToken().pipe(
        switchMap(() => {
          state.isRefreshing = false;
          const newToken = auth.getAccessToken() ?? '';
          state.token$.next(newToken);
          return next(req.clone({
            withCredentials: true,
            setHeaders: { Authorization: `Bearer ${newToken}` },
          }));
        }),
        catchError((refreshErr) => {
          state.isRefreshing = false;
          state.token$.next(null);
          auth.logout();
          return throwError(() => refreshErr);
        }),
      );
    }),
  );
};
