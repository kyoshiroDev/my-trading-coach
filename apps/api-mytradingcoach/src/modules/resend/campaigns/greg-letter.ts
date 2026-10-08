// ── Lettre personnelle de Greg ──────────────────────────────────────────────────
// Même forme que ses e-mails envoyés à la main (reconnexion Tradovate, prop firms) : fond blanc,
// style lettre, signature Zoho de Greg avec le logo intégré (`cid:`), expéditeur support@ et
// réponses sur hello@. Pour les campagnes écrites à la 1re personne (founder_launch).

/** Logo de la signature (PNG 40×40 du site), joint en inline : l'image Zoho n'est pas publique. */
const LOGO_PNG_BASE64 =
  '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';

const LOGO_CID = 'logo-mtc';

export const GREG_FROM = 'Grégory · MyTradingCoach <support@mytradingcoach.app>';
export const GREG_REPLY_TO = 'hello@mytradingcoach.app';

export const GREG_LOGO_ATTACHMENT = { filename: 'logo.png', content: LOGO_PNG_BASE64, contentId: LOGO_CID };

/** Aperçu admin (iframe) : le `cid:` ne s'affiche pas hors d'un client mail → image en data URI. */
export const inlineLogoForPreview = (html: string) =>
  html.replaceAll(`cid:${LOGO_CID}`, `data:image/png;base64,${LOGO_PNG_BASE64}`);

const SIGNATURE_HTML = `<table cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid #e8eaed;padding-top:18px;font-family:Arial,sans-serif">
  <tr>
    <td valign="middle" style="vertical-align:middle;padding-right:12px">
      <img src="cid:${LOGO_CID}" alt="MyTradingCoach" width="40" height="40" style="display:block;width:40px;height:40px;border:0">
    </td>
    <td valign="middle" style="vertical-align:middle;border-left:2px solid #3b82f6;padding-left:14px">
      <div style="font-family:Arial,sans-serif;font-weight:800;font-size:15px;color:#111827;margin-bottom:2px">Grégory</div>
      <div style="font-family:Arial,sans-serif;font-size:12.5px;color:#5f6368;margin-bottom:8px">Fondateur — <b style="color:#3b82f6">MyTrading</b><b style="color:#8b5cf6">Coach</b></div>
      <div style="font-family:Arial,sans-serif;font-size:12px;color:#5f6368;line-height:1.6">
        <div><a href="https://mytradingcoach.app" style="color:#1a73e8;text-decoration:none">mytradingcoach.app</a>&nbsp;·&nbsp;<a href="mailto:hello@mytradingcoach.app" style="color:#1a73e8;text-decoration:none">hello@mytradingcoach.app</a></div>
        <div>Le copilote IA pour traders futures &amp; prop firm</div>
      </div>
    </td>
  </tr>
</table>`;

const SIGNATURE_TEXT = `--
Grégory
Fondateur — MyTradingCoach
mytradingcoach.app · hello@mytradingcoach.app
Le copilote IA pour traders futures & prop firm`;

/**
 * Lettre complète : corps (HTML déjà échappé), signature, mention légale éventuelle puis lien de
 * désinscription (obligatoire pour une campagne marketing). Renvoie le HTML et le texte.
 */
export function gregLetter(p: {
  preheader: string;
  bodyHtml: string;
  bodyText: string;
  /** P.S. placé sous la signature (la partie la plus lue d'une lettre). */
  postscriptHtml?: string;
  postscriptText?: string;
  legal?: string;
  unsubUrl: string;
}): { html: string; text: string } {
  const legalHtml = p.legal
    ? `<p style="margin:18px 0 0;font-size:12px;color:#6b7280;font-style:italic">${p.legal}</p>`
    : '';
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:24px;background:#ffffff">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${p.preheader}</div>
<div style="max-width:560px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;color:#1a1a1a">
${p.bodyHtml}
${SIGNATURE_HTML}
${p.postscriptHtml ?? ''}
${legalHtml}
<p style="margin:18px 0 0;font-size:12px;color:#6b7280">Tu reçois cet e-mail parce que tu as un compte MyTradingCoach. <a href="${p.unsubUrl}" style="color:#6b7280">Me désinscrire des e-mails</a></p>
</div></body></html>`;
  const text = [p.bodyText, SIGNATURE_TEXT, p.postscriptText ?? '', p.legal ?? '', `Me désinscrire des e-mails : ${p.unsubUrl}`]
    .filter(Boolean)
    .join('\n\n');
  return { html, text };
}
