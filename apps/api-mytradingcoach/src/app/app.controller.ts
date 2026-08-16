import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
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
  // @Res() : on écrit la réponse nous-mêmes pour CONTOURNER le ResponseInterceptor global qui
  // emballe tout dans { data: ... } (sinon Google recevrait du JSON, pas un robots.txt valide).
  @Public()
  @Get('robots.txt')
  robots(@Res() res: Response): void {
    res.type('text/plain').send('User-agent: *\nDisallow: /\n');
  }
}
