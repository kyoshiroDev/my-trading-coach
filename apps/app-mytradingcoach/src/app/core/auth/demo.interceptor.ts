import { HttpErrorResponse, HttpHandlerFn, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { DemoService } from '../services/demo.service';

/**
 * Capte les 403 « mode démo » (mutations bloquées par DemoReadOnlyGuard côté API)
 * et déclenche l'invite de conversion. Couvre TOUTES les actions d'écriture sans
 * toucher chaque bouton → un visiteur démo qui tente quoi que ce soit est invité
 * à créer son compte.
 */
export const demoInterceptor: HttpInterceptorFn = (
  req: HttpRequest<unknown>,
  next: HttpHandlerFn,
) => {
  const demo = inject(DemoService);
  return next(req).pipe(
    catchError((err: unknown) => {
      if (
        err instanceof HttpErrorResponse &&
        err.status === 403 &&
        typeof err.error?.message === 'string' &&
        err.error.message.includes('mode démo')
      ) {
        demo.promptSignup();
      }
      return throwError(() => err);
    }),
  );
};
