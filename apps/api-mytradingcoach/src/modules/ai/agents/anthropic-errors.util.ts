import { HttpException, HttpStatus, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';

export function handleAnthropicError(err: unknown, logger: Logger): never {
  if (err instanceof Anthropic.APIError) {
    const type = (err.error as { error?: { type?: string } } | null)?.error?.type;
    switch (type) {
      case 'overloaded_error':
        throw new HttpException(
          "L'IA est momentanément surchargée, réessaie dans quelques minutes.",
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      case 'rate_limit_error':
        throw new HttpException(
          'Trop de requêtes, réessaie dans quelques secondes.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      case 'invalid_request_error':
        throw new HttpException(
          'Crédit API insuffisant, contacte le support.',
          HttpStatus.PAYMENT_REQUIRED,
        );
      default:
        logger.error(`Anthropic API error [${type ?? err.status}]: ${err.message}`);
        throw new HttpException(
          "L'IA est temporairement indisponible.",
          HttpStatus.BAD_GATEWAY,
        );
    }
  }
  logger.error('Unknown AI error', err);
  throw new HttpException("L'IA est temporairement indisponible.", HttpStatus.BAD_GATEWAY);
}
