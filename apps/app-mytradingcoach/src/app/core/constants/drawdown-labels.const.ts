/**
 * Vocabulaire du drawdown (PROMPT-drawdown-max-par-compte), le même sur le tableau de bord, Mes
 * comptes, la fiche règles du plan, l'onboarding, le débrief et la séance :
 * - « Drawdown max » = baisse MESURÉE (plus forte baisse depuis un sommet, trade par trade) ;
 * - « Marge avant le plancher » = distance restante entre le solde et le plancher de la règle
 *   (ce que les prop firms affichent souvent comme « drawdown ») ; libellé imposé par contexte-com.md ;
 * - « Règle de drawdown » = TAILLE de la règle fixée par la prop firm (ex. 2 000 $). Jamais
 *   « Drawdown max » pour la règle.
 */
export const DRAWDOWN_LABELS = {
  max: {
    label: 'Drawdown max',
    help: 'Plus forte baisse depuis un sommet, trade par trade, sur la période. Tous comptes : le compte le plus touché.',
  },
  margin: {
    label: 'Marge avant le plancher',
    help: 'Distance entre ton solde actuel et le plancher fixé par la règle de drawdown du compte. C\'est ce que ta prop firm affiche souvent comme « drawdown ».',
  },
  rule: {
    label: 'Règle de drawdown',
    help: 'Taille de la règle fixée par ta prop firm. Le plancher se calcule à partir d\'elle.',
  },
} as const;
