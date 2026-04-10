import { HttpHandlerFn, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, switchMap, throwError } from 'rxjs';
import { AuthService } from './auth.service';
import { Router } from '@angular/router';

let isRefreshing = false;

export const authInterceptor: HttpInterceptorFn = (req: HttpRequest<unknown>, next: HttpHandlerFn) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const token = auth.getAccessToken();

  const isRefreshCall = req.url.includes('/auth/refresh');
  const isAuthCall = req.url.includes('/auth/login') || req.url.includes('/auth/register') || req.url.includes('/auth/logout');

  // Toujours envoyer les cookies (pour le refresh_token httpOnly)
  const baseReq = req.clone({ withCredentials: true });

  const authReq = token && !isRefreshCall && !isAuthCall
    ? baseReq.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
    : baseReq;

  return next(authReq).pipe(
    catchError((err) => {
      if (err.status === 401 && !isRefreshCall && !isRefreshing) {
        isRefreshing = true;
        return auth.refreshToken().pipe(
          switchMap(() => {
            isRefreshing = false;
            const newToken = auth.getAccessToken();
            const retryReq = req.clone({
              withCredentials: true,
              setHeaders: { Authorization: `Bearer ${newToken}` },
            });
            return next(retryReq);
          }),
          catchError((refreshErr) => {
            isRefreshing = false;
            auth.logout();
            return throwError(() => refreshErr);
          }),
        );
      }

      if (err.status === 401 && !isRefreshCall) {
        auth.logout();
        router.navigate(['/login']);
      }

      return throwError(() => err);
    }),
  );
};