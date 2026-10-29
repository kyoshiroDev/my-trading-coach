/**
 * Aperçu des e-mails de l'essai d'inscription (#769, B2) : J+11 (`trial_ending`) et fin d'essai
 * (`trial_ended`), rendus par les VRAIS gabarits du moteur de campagnes. Le cron des campagnes ne
 * tourne qu'en prod : c'est le moyen de les relire avant l'envoi réel.
 *
 * - Écrit `<sortie>/trial_ending.html` et `<sortie>/trial_ended.html` (à ouvrir dans un navigateur).
 * - Avec `--to <adresse>` : envoie aussi les deux e-mails à cette adresse, sujet préfixé « [APERÇU] »,
 *   même expéditeur et même adresse de réponse que l'envoi réel. Aucune écriture en base, rien ne
 *   compte dans le plafond ni dans les envois de la campagne. Refusé si `FRONTEND_URL` est l'app de prod.
 *
 * Liens et logo : `FRONTEND_URL` et `API_URL` de l'env chargé, sinon ceux de dev. Le lien de
 * désinscription porte un jeton d'exemple (il ne désinscrit personne).
 *
 * Usage (env de dev chargé, RESEND_API_KEY seulement pour l'envoi) :
 *   pnpm exec tsx --env-file=apps/api-mytradingcoach/.env --tsconfig tools/scripts/tsconfig.check.json \
 *     tools/scripts/ops/preview-trial-emails.ts --out <dossier> [--to <adresse>] [--name <prénom>]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Resend } from 'resend';
import {
  type CampaignBuildCtx,
  type CampaignContent,
  trialEndedTemplate,
  trialEndingTemplate,
} from '@api/modules/resend/campaigns/campaign-templates';

const PROD_FRONTEND_URL = 'https://app.mytradingcoach.app';
const DEV_FRONTEND_URL = 'https://dev.app.mytradingcoach.app';
const DEV_API_URL = 'https://dev.api.mytradingcoach.app';
const DAY = 24 * 3600e3;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** Les deux e-mails, rendus comme le cron les rend (`EmailDispatchService.dispatch`). */
function renderTrialEmails(opts: { userName: string; appUrl: string; apiUrl: string; now: Date }) {
  const unsubUrl = `${opts.apiUrl.replace(/\/+$/, '')}/api/emails/unsubscribe?token=apercu-token&scope=service`;
  const ctx: CampaignBuildCtx = { userName: opts.userName, appUrl: opts.appUrl, unsubUrl };
  // J+11 : l'essai finit 3 jours plus tard (borne haute de la fenêtre du segment `trial_ending`).
  const emails: [string, CampaignContent][] = [
    ['trial_ending', trialEndingTemplate({ ...ctx, trial: { endsAt: new Date(opts.now.getTime() + 3 * DAY) } })],
    ['trial_ended', trialEndedTemplate(ctx)],
  ];
  return emails;
}

async function main(): Promise<void> {
  const out = arg('out');
  const to = arg('to');
  if (!out) throw new Error('Usage : … preview-trial-emails.ts --out <dossier> [--to <adresse>] [--name <prénom>]');

  // Le logo des gabarits lit `process.env.FRONTEND_URL` au rendu : la valeur retenue y est remise.
  const appUrl = process.env['FRONTEND_URL'] || DEV_FRONTEND_URL;
  process.env['FRONTEND_URL'] = appUrl;
  const apiUrl = process.env['API_URL'] || DEV_API_URL;
  const emails = renderTrialEmails({ userName: arg('name') ?? 'Greg', appUrl, apiUrl, now: new Date() });

  const dir = resolve(out);
  mkdirSync(dir, { recursive: true });
  for (const [key, mail] of emails) {
    writeFileSync(join(dir, `${key}.html`), mail.html);
    console.log(`${key} : « ${mail.subject} » → ${join(dir, `${key}.html`)}`);
  }
  console.log(`Liens vers ${appUrl}`);
  if (!to) return;

  if (appUrl.replace(/\/+$/, '') === PROD_FRONTEND_URL) {
    throw new Error("FRONTEND_URL = l'app de prod : envoi d'aperçu refusé (à lancer avec l'env de dev).");
  }
  const key = process.env['RESEND_API_KEY'];
  if (!key) throw new Error('RESEND_API_KEY absent : envoi impossible.');
  const resend = new Resend(key);
  const from = `MyTradingCoach <${process.env['MAIL_FROM'] ?? 'noreply@mytradingcoach.app'}>`;
  const replyTo = process.env['MAIL_SAV'] ?? 'hello@mytradingcoach.app';
  for (const [name, mail] of emails) {
    const { error } = await resend.emails.send({ from, to, replyTo, subject: `[APERÇU] ${mail.subject}`, html: mail.html });
    if (error) throw new Error(`Envoi ${name} refusé par Resend : ${error.name}`);
    console.log(`${name} envoyé`);
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
