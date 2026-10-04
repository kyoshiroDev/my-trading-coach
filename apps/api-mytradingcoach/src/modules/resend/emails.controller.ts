import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { EmailsService } from './emails.service';

/**
 * Endpoints publics liés aux emails. La désinscription est sans authentification
 * (lien cliquable depuis un email) : seul le token unique identifie le user.
 */
@Controller('emails')
export class EmailsController {
  constructor(private readonly emails: EmailsService) {}

  @Public()
  @Get('unsubscribe')
  async unsubscribe(@Query('token') token: string, @Res() res: Response) {
    await this.emails.unsubscribe(token);
    res.type('html').send(
      `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Désinscription</title></head>
       <body style="margin:0;background:#080c14;font-family:'Inter',-apple-system,Arial,sans-serif;color:#e2eaf5;">
         <div style="max-width:480px;margin:80px auto;padding:32px;background:#0f1824;border:1px solid rgba(99,155,255,.12);border-radius:16px;text-align:center;">
           <div style="font-size:15px;font-weight:700;margin-bottom:16px;color:#22d3ee;">MyTradingCoach</div>
           <h1 style="font-size:20px;margin:0 0 12px;">Tu es désinscrit</h1>
           <p style="font-size:14px;color:#9db4ce;line-height:1.7;margin:0;">
             Tu ne recevras plus d'emails marketing de MyTradingCoach.
             Tu peux te réinscrire à tout moment depuis tes paramètres.
           </p>
         </div>
       </body></html>`,
    );
  }
}
