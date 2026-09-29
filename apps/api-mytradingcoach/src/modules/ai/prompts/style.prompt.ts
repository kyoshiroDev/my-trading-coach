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

/**
 * Qualite du francais des textes generes.
 *
 * Ajoutee le 2026-09-28 en meme temps que le passage du calendrier eco sur le modele
 * rapide (`ECO_MODEL`) : la comparaison des deux modeles sur le prompt reel a montre que
 * le modele rapide produit un contenu juste mais glisse sur la langue, la ou le modele
 * d'analyse ne glissait pas. Deux fautes relevees dans une seule reponse, toutes deux
 * affichees telles quelles a l'utilisateur :
 *   - « Nasdaq 100 amplifiait les mouvements » (imparfait au lieu du present)
 *   - « Pair dominee par USD » (anglicisme, au lieu de « paire »)
 *
 * Le vocabulaire de marche reste en anglais parce que c'est ainsi que les traders le
 * lisent (« breakout », « stop », « drawdown ») : la regle vise la langue de la phrase,
 * pas les termes du metier. A reserver aux prompts qui redigent de la PROSE ; les prompts
 * de traduction de libelles n'en ont pas besoin.
 *
 * La regle est ecrite en francais ACCENTUE, et ce n'est pas cosmetique : une premiere version
 * redigee sans accents (« Redige dans un francais correct ») a produit « Le pair reagira »,
 * soit l'anglicisme que la regle interdit nommement, plus un accent manquant. Le modele imite
 * le registre de la consigne. Ne pas desaccentuer ce texte.
 */
export const FRENCH_RULE = `Écris dans un français correct, accentué et naturel. Conjugue au présent de l'indicatif pour décrire un fait actuel, jamais à l'imparfait. Accorde les noms et les adjectifs. N'emploie aucun anglicisme dans la phrase : écris « une paire » et non « un pair », « un graphique » et non « un chart », « un ton » et non « une tone ». Les termes techniques de trading d'usage courant en anglais (breakout, stop, drawdown, spread, range) restent en anglais et prennent un s au pluriel.`;
