import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';

/** Réponse d'erreur unique de l'API : le front lit `code` pour choisir l'écran, `message` pour l'afficher. */
interface ErrorBody {
  statusCode: number;
  code?: string;
  message: string | string[];
  timestamp: string;
  path: string;
}

interface NormalizedError {
  status: number;
  code?: string;
  message: string | string[];
}

/**
 * Filtre GLOBAL : toute erreur (HttpException, Prisma, exception inattendue) sort au même
 * format. Avant, seules les HttpException passaient ici ; les autres tombaient dans le filtre
 * par défaut de Nest, qui renvoie un autre format (sans `code`) que le front ne sait pas lire.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    // Filtre global : il peut aussi être appelé pour une passerelle WebSocket, où il n'y a
    // pas de réponse HTTP à écrire. On se contente alors de tracer l'erreur.
    if (host.getType() !== 'http') {
      this.logger.error(`Erreur ${host.getType()}`, exception instanceof Error ? exception.stack : String(exception));
      return;
    }
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const { status, code, message } = this.normalize(exception);

    this.log(status, request, message, exception);

    const body: ErrorBody = {
      statusCode: status,
      ...(code ? { code } : {}),
      message,
      timestamp: new Date().toISOString(),
      // Chemin SANS la query string : elle peut porter un token (lien de réinitialisation, OAuth).
      path: request.path,
    };
    response.status(status).json(body);
  }

  private normalize(exception: unknown): NormalizedError {
    if (exception instanceof HttpException) {
      const res = exception.getResponse();
      const message =
        typeof res === 'object' && 'message' in res
          ? (res as { message: string | string[] }).message
          : exception.message;
      // Code machine optionnel (ex. TRADOVATE_RECONNECT_REQUIRED) : le front choisit l'état
      // d'écran sans parser le message, qui reste destiné à l'utilisateur.
      const code =
        typeof res === 'object' && typeof (res as { code?: unknown }).code === 'string'
          ? (res as { code: string }).code
          : undefined;
      return { status: exception.getStatus(), code, message };
    }

    // Erreurs Prisma connues que les services n'ont pas rattrapées.
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        return { status: HttpStatus.CONFLICT, code: 'CONFLICT', message: 'Cette ressource existe déjà.' };
      }
      if (exception.code === 'P2025') {
        return { status: HttpStatus.NOT_FOUND, code: 'NOT_FOUND', message: 'Ressource introuvable.' };
      }
    }

    // Tout le reste : 500 sans détail technique côté client (le détail part dans les logs).
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL',
      message: 'Une erreur est survenue. Réessaie dans un instant.',
    };
  }

  /**
   * Trace côté serveur toute erreur renvoyée au client.
   *
   * Sans ça, un 4xx ne laisse AUCUNE trace : le « Setup invalide » qui a bloqué
   * les imports d'un utilisateur en prod n'était pas diagnosticable a posteriori,
   * seule la base permettait de reconstituer ce qui s'était passé.
   *
   * Métadonnées uniquement (statut, méthode, chemin, user, message) : jamais le
   * corps de la requête, qui transporte mots de passe, tokens et fichiers.
   * `warn` pour les 4xx (erreurs client, attendues) et `error` avec la pile pour les 5xx,
   * pour que les vraies pannes restent lisibles au milieu des 401 de sessions expirées.
   */
  private log(status: number, request: Request, message: string | string[], exception: unknown): void {
    const userId = (request as Request & { user?: { id?: string } }).user?.id;
    const detail = Array.isArray(message) ? message.join(' · ') : message;
    const line =
      `${status} ${request.method} ${request.path}` +
      `${userId ? ` user=${userId}` : ''} — ${detail}`;

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      const stack = exception instanceof Error ? exception.stack : String(exception);
      this.logger.error(line, stack);
    } else {
      this.logger.warn(line);
    }
  }
}
