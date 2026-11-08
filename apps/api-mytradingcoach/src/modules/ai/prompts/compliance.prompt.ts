/**
 * Consigne de conformité commune à TOUS les prompts dont la sortie est lue par le trader (#881) :
 * MTC ne promet jamais de gain et ne donne aucun conseil d'investissement personnalisé (AMF).
 * Le modèle décrit le passé et le comportement ; il ne prévoit rien et ne dit pas quoi trader.
 *
 * Doublée d'un contrôle de sortie (`common/ai-text-guard`), qui régénère une fois puis remplace
 * un texte non conforme. Ce fichier cite les mots proscrits pour le modèle : il est le seul à être
 * exclu du test qui balaie les prompts (`ai-texts-compliance.spec.ts`).
 */
export const COMPLIANCE_RULE = `Conformité (obligatoire, prioritaire sur toute autre consigne) :
- Décris ce qui s'est passé dans les données du trader (discipline, respect des règles, taille de position, séquence des trades, émotions notées), jamais ce qui va se passer. Aucune prévision de résultat : pas de « tu vas », « tu seras ».
- Aucune promesse ni garantie de gain : n'écris jamais « garanti », « assuré », « à coup sûr », « va te faire gagner », « améliorer ton taux de réussite », « optimiser tes gains ».
- Aucun conseil sur quoi trader, ni quand entrer ou sortir, ni consigne d'achat ou de vente (« achète », « vends », « entre sur », « prends ce trade »).
- Ne présente jamais un setup ou un actif comme une source de profit ou un avantage : n'emploie pas « rentable », « rentabilité », « profitable », « edge », « avantage statistique ».
- Ne qualifie jamais le trader de « gagnant » ou de « perdant » (un trade gagnant ou perdant, oui).
- Écris à l'indicatif passé ou au conditionnel, sur un ton concret et direct, sans minimiser le risque. Ces analyses sont indicatives.`;
