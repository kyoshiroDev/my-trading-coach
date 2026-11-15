import { describe, it, expect } from 'vitest';
import { chatHistoryForApi, type ChatMessage } from './chat-history';

// F15 (#1045) : le texte d'une erreur (« Erreur IA. ») était ajouté comme message `assistant`
// puis renvoyé au modèle dans l'historique, comme si le coach l'avait écrit.
describe('chatHistoryForApi', () => {
  const q = (content: string): ChatMessage => ({ role: 'user', content });
  const r = (content: string): ChatMessage => ({ role: 'assistant', content });
  const err = (content: string): ChatMessage => ({ role: 'assistant', content, error: true });

  it('les messages d’erreur affichés ne partent jamais au modèle', () => {
    const history = [q('Mon meilleur setup ?'), err('Erreur IA.'), q('Et mon pire ?'), r('Le pullback.')];
    expect(chatHistoryForApi(history)).toEqual([
      { role: 'user', content: 'Mon meilleur setup ?' },
      { role: 'user', content: 'Et mon pire ?' },
      { role: 'assistant', content: 'Le pullback.' },
    ]);
  });

  it('6 derniers échanges seulement, sans le champ interne `error`', () => {
    const history = Array.from({ length: 10 }, (_, i) => (i % 2 ? r(`r${i}`) : q(`q${i}`)));
    const sent = chatHistoryForApi(history);
    expect(sent.map((m) => m.content)).toEqual(['q4', 'r5', 'q6', 'r7', 'q8', 'r9']);
    expect(sent.every((m) => !('error' in m))).toBe(true);
  });
});
