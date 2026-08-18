import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const status = exception.getStatus
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;
    const exceptionResponse = exception.getResponse();

    const message =
      typeof exceptionResponse === 'object' &&
      'message' in (exceptionResponse as object)
        ? (exceptionResponse as { message: string | string[] }).message
        : exception.message;

    this.log(status, request, message);

    response.status(status).json({
      statusCode: status,
      message,
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }

  /**
   * Trace côté serveur toute exception HTTP renvoyée au client.
   *
   * Sans ça, un 4xx ne laisse AUCUNE trace : le « Setup invalide » qui a bloqué
   * les imports d'un utilisateur en prod n'était pas diagnosticable a posteriori,
   * seule la base permettait de reconstituer ce qui s'était passé.
   *
   * Métadonnées uniquement (statut, méthode, chemin, user, message) : jamais le
   * corps de la requête, qui transporte mots de passe, tokens et fichiers.
   * `warn` pour les 4xx (erreurs client, attendues) et `error` pour les 5xx, pour
   * que les vraies pannes restent lisibles au milieu des 401 de sessions expirées.
   */
  private log(
    status: number,
    request: Request,
    message: string | string[],
  ): void {
    const userId = (request as Request & { user?: { id?: string } }).user?.id;
    const detail = Array.isArray(message) ? message.join(' · ') : message;
    const line =
      `${status} ${request.method} ${request.url}` +
      `${userId ? ` user=${userId}` : ''} — ${detail}`;

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) this.logger.error(line);
    else this.logger.warn(line);
  }
}
