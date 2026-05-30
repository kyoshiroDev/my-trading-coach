import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { BehaviorSubject, catchError, filter, switchMap, take, throwError } from 'rxjs';
import { AdminAuthService } from './admin-auth.service';

let isRefreshing = false;
const refreshToken$ = new BehaviorSubject<string | null>(null);

export const adminAuthInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AdminAuthService);
  const token = auth.getAccessToken();

  const isRefreshCall = req.url.includes('/auth/refresh');
  const isAuthCall = req.url.includes('/auth/login') || req.url.includes('/auth/logout');

  const authReq =
    token && !isRefreshCall && !isAuthCall
      ? req.clone({ withCredentials: true, setHeaders: { Authorization: `Bearer ${token}` } })
      : req.clone({ withCredentials: true });

  return next(authReq).pipe(
    catchError(err => {
      if (err.status !== 401 || isRefreshCall || isAuthCall) {
        return throwError(() => err);
      }

      if (isRefreshing) {
        return refreshToken$.pipe(
          filter((t): t is string => t !== null),
          take(1),
          switchMap(newToken =>
            next(
              req.clone({
                withCredentials: true,
                setHeaders: { Authorization: `Bearer ${newToken}` },
              }),
            ),
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
          return next(
            req.clone({
              withCredentials: true,
              setHeaders: { Authorization: `Bearer ${newToken}` },
            }),
          );
        }),
        catchError(refreshErr => {
          isRefreshing = false;
          refreshToken$.next(null);
          auth.logout();
          return throwError(() => refreshErr);
        }),
      );
    }),
  );
};
