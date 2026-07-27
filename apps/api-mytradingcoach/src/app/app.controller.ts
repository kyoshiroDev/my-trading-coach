import { Controller, Get, Header } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';

@Controller()
export class AppController {
  @Public()
  @Get('health')
  health() {
    return { status: 'ok' };
  }

  // Sous-domaine API non indexable : robots.txt à la racine (exclu du préfixe /api dans main.ts).
  // Supprime le 404 GSC sur api.mytradingcoach.app/ et empêche Google de re-crawler le sous-domaine.
  @Public()
  @Get('robots.txt')
  @Header('Content-Type', 'text/plain')
  robots(): string {
    return 'User-agent: *\nDisallow: /\n';
  }
}
