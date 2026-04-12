import { HttpHandlerFn, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { BehaviorSubject, catchError, filter, switchMap, take, throwError } from 'rxjs';
import { AuthService } from './auth.service';

let isRefreshing = false;
const refreshToken$ = new BehaviorSubject<string | null>(null);

export const authInterceptor: HttpInterceptorFn = (req: HttpRequest<unknown>, next: HttpHandlerFn) => {
  const auth = inject(AuthService);
  const token = auth.getAccessToken();

  const isRefreshCall = req.url.includes('/auth/refresh');
  const isAuthCall = req.url.includes('/auth/login') || req.url.includes('/auth/register') || req.url.includes('/auth/logout');

  const baseReq = req.clone({ withCredentials: true });
  const authReq = token && !isRefreshCall && !isAuthCall
    ? baseReq.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
    : baseReq;

  return next(authReq).pipe(
    catchError((err) => {
      if (err.status !== 401 || isRefreshCall) {
        return throwError(() => err);
      }

      if (isRefreshing) {
        // Attendre que le refresh en cours se termine, puis retenter
        return refreshToken$.pipe(
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

      isRefreshing = true;
      refreshToken$.next(null);

      return auth.refreshToken().pipe(
        switchMap(() => {
          isRefreshing = false;
          const newToken = auth.getAccessToken() ?? '';
          refreshToken$.next(newToken);
          return next(req.clone({
            withCredentials: true,
            setHeaders: { Authorization: `Bearer ${newToken}` },
          }));
        }),
        catchError((refreshErr) => {
          isRefreshing = false;
          refreshToken$.next(null);
          auth.logout();
          return throwError(() => refreshErr);
        }),
      );
    }),
  );
};
