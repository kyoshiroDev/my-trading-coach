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

  // Ne pas ajouter le Bearer sur la route refresh (évite boucle infinie)
  const isRefreshCall = req.url.includes('/auth/refresh');

  const authReq = token && !isRefreshCall
    ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
    : req;

  return next(authReq).pipe(
    catchError((err) => {
      if (err.status === 401 && !isRefreshCall && !isRefreshing && auth.getRefreshToken()) {
        isRefreshing = true;
        return auth.refreshToken().pipe(
          switchMap(() => {
            isRefreshing = false;
            const newToken = auth.getAccessToken();
            const retryReq = req.clone({
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