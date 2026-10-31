import { Controller, Get, HttpCode, Post, Query, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
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

  /**
   * Désinscription en un clic (RFC 8058, #791) : appelée par le client mail (bouton « Se désabonner »
   * de Gmail), jeton dans l'URL, corps `List-Unsubscribe=One-Click` (non lu : le jeton suffit). Même
   * portée que le lien GET. 200 sans page, réponse identique si le jeton est inconnu.
   * Limite large : les requêtes arrivent des serveurs de Gmail ou Yahoo, peu d'IP pour beaucoup de
   * monde ; le jeton (64 hex) ne se devine pas.
   */
  @Public()
  @Post('unsubscribe')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 120 } })
  async unsubscribeOneClick(@Query('token') token: string, @Query('scope') scope: string): Promise<void> {
    await this.emails.unsubscribe(token, scope === 'service' ? 'service' : undefined);
  }

  /** Lien du texte de l'e-mail (et anciens e-mails déjà envoyés) : page de confirmation. */
  @Public()
  @Get('unsubscribe')
  async unsubscribe(@Query('token') token: string, @Query('scope') scope: string, @Res() res: Response) {
    const serviceOnly = scope === 'service';
    await this.emails.unsubscribe(token, serviceOnly ? 'service' : undefined);
    const message = serviceOnly
      ? "Tu ne recevras plus les conseils pour bien démarrer. Les e-mails liés à ton compte (sécurité, paiement) continuent d'arriver."
      : "Tu ne recevras plus d'emails marketing ni de conseils de MyTradingCoach. Tu peux te réinscrire à tout moment depuis tes paramètres.";
    res.type('html').send(
      `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Désinscription</title></head>
       <body style="margin:0;background:#080c14;font-family:'Inter',-apple-system,Arial,sans-serif;color:#e2eaf5;">
         <div style="max-width:480px;margin:80px auto;padding:32px;background:#0f1824;border:1px solid rgba(99,155,255,.12);border-radius:16px;text-align:center;">
           <div style="font-size:15px;font-weight:700;margin-bottom:16px;color:#22d3ee;">MyTradingCoach</div>
           <h1 style="font-size:20px;margin:0 0 12px;">Tu es désinscrit</h1>
           <p style="font-size:14px;color:#9db4ce;line-height:1.7;margin:0;">
             ${message}
           </p>
         </div>
       </body></html>`,
    );
  }
}
