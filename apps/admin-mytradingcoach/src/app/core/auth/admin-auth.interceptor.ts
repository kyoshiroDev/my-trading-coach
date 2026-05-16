import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { AdminAuthService } from './admin-auth.service';

export const adminAuthInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AdminAuthService);
  const token = auth.getAccessToken();
  const isAuth = req.url.includes('/auth/');
  const authReq = token && !isAuth
    ? req.clone({ withCredentials: true, setHeaders: { Authorization: `Bearer ${token}` } })
    : req.clone({ withCredentials: true });
  return next(authReq).pipe(
    catchError(err => {
      if (err.status === 401 && !isAuth) auth.logout();
      return throwError(() => err);
    }),
  );
};
