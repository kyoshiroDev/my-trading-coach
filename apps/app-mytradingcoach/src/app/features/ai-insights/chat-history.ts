/** Message du chat IA tel qu'affiché. `error` : texte d'erreur affiché, jamais envoyé au modèle. */
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  error?: true;
}

/** Échanges récents renvoyés au modèle comme contexte. */
const HISTORY_SENT = 6;

/**
 * Historique envoyé avec une nouvelle question : sans les messages d'erreur (F15 #1045, « Erreur
 * IA. » partait au modèle comme une réponse du coach), 6 derniers échanges, sans champ interne.
 */
export function chatHistoryForApi(history: ChatMessage[]): { role: 'user' | 'assistant'; content: string }[] {
  return history
    .filter((m) => !m.error)
    .slice(-HISTORY_SENT)
    .map(({ role, content }) => ({ role, content }));
}
