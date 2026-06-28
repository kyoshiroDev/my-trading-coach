import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  StreamableFile,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

@Injectable()
export class ResponseInterceptor<T>
  implements NestInterceptor<T, { data: T } | StreamableFile>
{
  intercept(
    _context: ExecutionContext,
    next: CallHandler,
  ): Observable<{ data: T } | StreamableFile> {
    return next.handle().pipe(
      // Les fichiers (PDF relevé ambassadeur, etc.) doivent être streamés tels
      // quels : les emballer dans { data } casserait le téléchargement binaire.
      map((data) => (data instanceof StreamableFile ? data : { data })),
    );
  }
}
