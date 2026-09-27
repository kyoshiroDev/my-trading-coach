/**
 * Règle de style commune à TOUS les prompts dont la sortie est lue par
 * l'utilisateur (debrief, patterns, conseils, chat, recap 17h30, analyses éco,
 * traductions de news).
 *
 * Le tiret cadratin (U+2014) est perçu comme une marque de texte généré par IA
 * : il a été retiré de toute l'interface, donc les textes produits
 * par le modèle ne doivent pas le réintroduire.
 *
 * À concaténer au prompt système quand il y en a un, sinon au prompt user.
 * La formulation couvre explicitement les chaînes à l'intérieur d'un JSON,
 * puisque la plupart de nos prompts demandent une réponse JSON stricte.
 *
 * Les deux caractères interdits sont écrits en échappement unicode (U+2014
 * cadratin, U+2013 demi-cadratin) : le modèle reçoit bien le caractère réel,
 * mais le dépôt reste vérifiable par un grep unicode sur `apps` qui doit
 * rester vide. Ne pas les réécrire en littéral ici.
 */
export const NO_EM_DASH_RULE = `Dans tout texte que tu rédiges (y compris à l'intérieur des chaînes JSON), n'utilise JAMAIS le tiret cadratin « \u2014 » ni le tiret demi-cadratin « \u2013 ». Emploie à la place une virgule, un deux-points, une parenthèse ou un point.`;