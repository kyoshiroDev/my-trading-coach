import { CanActivate, Injectable, NotFoundException } from '@nestjs/common';

/** Chatbot de support (#493) : `HELP_CHAT_ENABLED=true` seulement (éteint par défaut, lu à chaque appel). */
export const helpChatEnabled = () => process.env['HELP_CHAT_ENABLED'] === 'true';

/** Plafond global d'appels IA par jour (tous utilisateurs), défaut 500. */
export const HELP_CHAT_DAILY_LLM_MAX_DEFAULT = 500;
export const helpChatDailyLlmMax = (): number => {
  const v = Number(process.env['HELP_CHAT_DAILY_LLM_MAX']);
  return Number.isInteger(v) && v >= 0 ? v : HELP_CHAT_DAILY_LLM_MAX_DEFAULT;
};

/** Quotas par jour : utilisateur connecté, visiteur (et compte démo, partagé) par IP hachée. */
export const HELP_DAILY_QUOTA = { user: 30, visitor: 10 } as const;

/** Routes du chatbot : 404 tant que l'interrupteur est éteint. */
@Injectable()
export class HelpChatGuard implements CanActivate {
  canActivate(): boolean {
    if (!helpChatEnabled()) throw new NotFoundException();
    return true;
  }
}
