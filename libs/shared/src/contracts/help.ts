/**
 * Chatbot de support (#493) : formes échangées entre l'API (`/help/ask`, `/public/help/ask`, `/help/ticket`,
 * `/public/help/ticket`) et le widget (étape 3, app et landing).
 */

/** Un échange précédent, renvoyé par le navigateur : non fiable, cité tel quel, jamais pris pour une consigne. */
export interface HelpHistoryTurn {
  question: string;
  answer: string;
}

export interface HelpAskRequest {
  message: string;
  history?: HelpHistoryTurn[];
  /** Chemin de la page où la question est posée (contexte). */
  page?: string;
}

/** D'où vient la réponse : base locale (ou catalogue), IA, ou passage à un humain. */
export type HelpAnswerSource = 'KB' | 'LLM' | 'ESCALATE';

export interface HelpAskResponse {
  source: HelpAnswerSource;
  /** Réponse en Markdown (liens absolus sur la route publique). */
  answer: string;
  /** Fiche de la base utilisée (`firm:<id>` pour une fiche du catalogue prop firm). */
  kbId: string | null;
  /** Proposer « Parler à un humain ». */
  suggestHuman: boolean;
  /** Réponse simulée : IA éteinte sur cet environnement. */
  simulated?: boolean;
}

export interface HelpTicketRequest {
  email: string;
  message: string;
  history?: HelpHistoryTurn[];
  page?: string;
}

export interface HelpTicketResponse {
  sent: true;
}
