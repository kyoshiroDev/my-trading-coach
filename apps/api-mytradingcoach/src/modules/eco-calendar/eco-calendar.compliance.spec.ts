import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AiService } from '../ai/ai.service';
import { COMPLIANCE_RULE } from '../ai/prompts/compliance.prompt';
import { findForbiddenTerms } from '../../common/ai-text-guard/ai-text-guard';
import { GAP_LABEL, morningFocus, releaseGap } from './eco-calendar.gap';
import type { PrismaService } from '../../prisma/prisma.service';
import type { RedisService } from '../infra/redis.service';
import type { AnthropicClientService } from '../infra/anthropic-client.service';

/**
 * Conformité du calendrier éco (#920, étape 5) : l'IA ne produit plus de sentiment haussier/baissier
 * par actif, ni de flèche par devise, ni de « conseil » ou de recommandation. L'écart prévision /
 * résultat est calculé en code ; le modèle rédige une interprétation neutre. Ce test échoue si un
 * terme proscrit revient dans les prompts, les sorties ou l'affichage.
 */

/** Termes de direction ou de conseil, propres au calendrier éco (en plus du garde-fou #881). */
const ECO_PROSCRIBED = /\bbull\b|\bbear\b|haussi|baissi|sentiment|recommand|conseil actionnable|actionnable|▲|▼/i;

describe('Calendrier éco · conformité des textes', () => {
  let create: ReturnType<typeof vi.fn>;
  let ai: AiService;

  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'production');
    create = vi.fn();
    ai = new AiService(
      {} as PrismaService,
      {} as never,
      {} as never,
      { create } as unknown as AnthropicClientService,
      {} as RedisService,
    );
  });
  afterEach(() => vi.unstubAllEnvs());

  /** Prompt envoyé, sans la consigne commune #881 (qui cite les mots proscrits pour le modèle). */
  const sentPrompt = () =>
    String((create.mock.calls[0][0] as { messages: { content: string }[] }).messages[0].content).replace(COMPLIANCE_RULE, '');

  it('prompt du résultat : aucune demande de sentiment, de direction ni de conseil ; sortie = écart + interprétation', async () => {
    create.mockResolvedValue({ content: [{ type: 'text', text: '{"interpretation":"L\'inflation mesure la hausse des prix."}' }] });
    const r = await ai.analyzeEcoResult({
      userId: null,
      event: { name: 'CPI YoY', actual: 3.1, estimate: 2.9, previous: 3 },
      userAssets: ['NQ'],
    });
    expect(sentPrompt()).not.toMatch(ECO_PROSCRIBED);
    expect(Object.keys(r).sort()).toEqual(['gap', 'interpretation']);
  });

  it('prompt du matin : aucun sentiment par actif ; recommandation et impacts jamais rédigés par le modèle', async () => {
    create.mockResolvedValue({ content: [{ type: 'text', text: '{"summary":"Deux annonces fortes à 14:30."}' }] });
    const r = await ai.analyzeEcoEvents({
      userId: null,
      events: [{ time: '14:30', name: 'Non Farm Payrolls', impact: 'high', currency: 'USD' }],
      userAssets: ['NQ'],
    });
    expect(sentPrompt()).not.toMatch(ECO_PROSCRIBED);
    expect(r).toEqual({ summary: 'Deux annonces fortes à 14:30.', recommendation: '', assetImpacts: [] });
  });

  it('écart calculé en code : au-dessus, en ligne (à la précision de la prévision), en dessous, sans consensus', () => {
    expect(releaseGap(3.1, 2.9)).toBe('above');
    expect(releaseGap(2.94, 2.9)).toBe('inline');
    expect(releaseGap(150, 180)).toBe('below');
    expect(releaseGap(0.4, null)).toBe('no_consensus');
    expect(releaseGap(null, 2.9)).toBeNull();
  });

  it('textes calculés en code (écart, point d’attention du matin) : ni direction, ni conseil, ni terme #881', () => {
    const focus = morningFocus([
      { time: '14:30', name: 'Non Farm Payrolls', currency: 'USD', impact: 'high', status: 'upcoming', isReleased: false },
      { time: '14:30', name: 'Unemployment Rate', currency: 'USD', impact: 'high', status: 'upcoming', isReleased: false },
    ]);
    expect(focus).toBe(
      'Prochaine annonce à fort impact : 14:30, Non Farm Payrolls (USD), Unemployment Rate (USD). Volatilité possible autour de cet horaire.',
    );
    for (const t of [focus, ...Object.values(GAP_LABEL)]) {
      expect(t).not.toMatch(ECO_PROSCRIBED);
      expect(findForbiddenTerms(t)).toEqual([]);
    }
  });

  it("affichage : plus de sentiment haussier/baissier ni de flèche de direction dans l'app", () => {
    const root = resolve(__dirname, '../../../../..');
    const files = [
      'apps/app-mytradingcoach/src/app/features/eco-calendar/eco-calendar.component.ts',
      'apps/app-mytradingcoach/src/app/features/eco-calendar/eco-calendar.component.html',
      'apps/app-mytradingcoach/src/app/features/dashboard/components/session-live/components/live-next-event/live-next-event.component.html',
      'apps/app-mytradingcoach/src/app/features/dashboard/components/session-live/components/live-next-event/live-next-event.component.ts',
      'apps/app-mytradingcoach/src/app/core/api/eco-calendar.api.ts',
    ];
    for (const f of files) {
      const src = readFileSync(resolve(root, f), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      expect(src, f).not.toMatch(/haussier|baissier|'bull'|'bear'|assetSentiments|sentArrow/);
    }
  });
});
