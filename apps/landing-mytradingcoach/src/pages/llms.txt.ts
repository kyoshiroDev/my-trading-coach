import type { APIRoute } from 'astro';
import { PLAN_BENEFITS, PREMIUM_PRICE_EUR, PREMIUM_SIGNUP_TRIAL_DAYS, PROP_FIRM_CATALOG_FILES } from '@mtc/shared';
import { FEATURES } from '../config';

/**
 * /llms.txt (SEO phase 1) : résumé court et factuel du site pour les assistants IA qui le lisent.
 * Généré au build pour que prix, durée d'essai, nombre de firmes et contenu des plans (`PLAN_BENEFITS`,
 * ligne `accounts` masquée tant que `FEATURES.multiAccounts` est éteint) viennent de `@mtc/shared`. Aucun effet prouvé sur les moteurs : c'est une convention proposée, pas un standard.
 * Pas de nom de courtier hors Tradovate, aucune promesse de résultat (contexte-com.md, AMF).
 */
const SITE = 'https://www.mytradingcoach.app';

export const GET: APIRoute = () => {
  const { monthly, annual } = PREMIUM_PRICE_EUR;
  const shown = (b: { id: string }) => b.id !== 'accounts' || FEATURES.multiAccounts;
  const list = (items: readonly { id: string; text: string }[]) =>
    items.filter(shown).map((b) => `  - ${b.text.replace(/\u00a0/g, ' ')}`).join('\n');
  const pages = [
    `- [Accueil : suivre sa marge avant la limite de sa prop firm](${SITE}/prop-firm)`,
    ...(FEATURES.multiAccounts ? [`- [Journal de trading prop firm et multi-comptes](${SITE}/journal-trading-prop-firm)`] : []),
    `- [Règles des prop firms futures en 50K, relevées et datées](${SITE}/regles-prop-firm)`,
    `- [Outils gratuits sans compte : marge avant la limite, taille de position, risque/rendement](${SITE}/outils)`,
    `- [Blog : guides sur le journal de trading, le win rate, la psychologie](${SITE}/blog)`,
    `- [Avertissement financier](${SITE}/disclaimer)`,
    `- [Conditions générales d'utilisation](${SITE}/cgu)`,
    `- [Politique de confidentialité](${SITE}/politique-confidentialite)`,
  ];
  const body = `# MyTradingCoach

> Journal de trading en français pour les traders futures, souvent en évaluation ou en compte financé chez une prop firm, qui tradent eux-mêmes. L'outil montre pendant la séance la marge restante avant la limite de drawdown de la firme, et aide à tenir son plan de trading.

## Ce que fait l'outil
- Synchronise les trades d'un compte Tradovate en lecture seule : aucun ordre passé, aucun mouvement d'argent.
- Fréquence de synchronisation : en direct quand MyTradingCoach est ouvert ; application fermée, relevé automatique toutes les 15 minutes environ.
- Comptes compatibles : connexion au compte Tradovate en lecture seule. Fonctionne avec les comptes d'évaluation et financés des prop firms qui tournent sur Tradovate, et avec les comptes simulés ou réels.
- Calcule la marge avant le plancher de drawdown et l'objectif, avec les règles de ${PROP_FIRM_CATALOG_FILES.length} prop firms futures, relevées sur leurs sources officielles et datées.
- Journal de trading (émotions, setups, notes), statistiques et import CSV ; en Premium, coach IA personnel et débrief hebdomadaire.
- Interface et support en français. Hébergé en France.

## Pour qui
- Traders futures francophones en évaluation ou en compte financé chez une prop firm.
- Le calcul des forex et crypto existe, mais ce n'est pas la cible.

## Limites
- Outil d'analyse et de journal : aucun conseil en investissement, aucune recommandation d'achat ou de vente, aucune prévision. Aucun agrément AMF.
- Les chiffres de marge sont indicatifs : la plateforme de la prop firm fait toujours foi.
- MyTradingCoach ne trade pas à la place du trader et n'est affilié à aucune prop firm.

## Offre
- Gratuit, sans carte bancaire :
${list(PLAN_BENEFITS.free)}
- Premium, ${monthly} € par mois ou ${annual} € par an. Tout le Gratuit, plus :
${list(PLAN_BENEFITS.premium)}
- ${PREMIUM_SIGNUP_TRIAL_DAYS} jours de Premium offerts à l'inscription, sans carte, puis retour au plan Gratuit.

## Pages clés
${pages.join('\n')}

## Contact
- support@mytradingcoach.app
`;
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
