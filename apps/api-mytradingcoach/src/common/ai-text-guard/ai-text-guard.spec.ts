import { describe, expect, it, vi } from 'vitest';
import { AI_TEXT_FALLBACK, findForbiddenInValue, findForbiddenTerms, guardAiText, neutralizeValue } from './ai-text-guard';

describe('findForbiddenTerms : termes proscrits', () => {
  it.each([
    ["C'est ton setup le plus rentable.", 'rentable'],
    ['Ta rentabilité progresse.', 'rentable'],
    ['Un setup très profitable.', 'profitable'],
    ["Ton setup Breakout, c'est ton edge.", 'edge'],
    ['Un avantage statistique net.', 'avantage-statistique'],
    ['Résultat garanti sur ce setup.', 'garanti'],
    ['Avec ce plan, le gain est assuré.', 'assure'],
    ['Tu passeras ton éval à coup sûr.', 'sur'],
    ['Cette routine va te faire gagner du temps et de l’argent.', 'faire-gagner'],
    ['Demain tu vas récupérer ta perte.', 'futur'],
    ['Tu seras plus régulier.', 'futur'],
    ['Pour améliorer ton taux de réussite, attends la clôture.', 'taux-de-reussite'],
    ['Optimise tes gains en laissant courir.', 'optimiser-gains'],
    ['Achète MNQ sur le retour au VWAP.', 'achat-vente'],
    ['Vends le haut du range.', 'achat-vente'],
    ['Entre sur ES après la news.', 'entre-sur'],
    ['Prends ce trade à 15h30.', 'entre-sur'],
    ['Tu es un trader gagnant.', 'trader-gagnant'],
    ['Tu as une mentalité de perdant.', 'trader-gagnant'],
  ])('« %s » → %s', (text, id) => {
    expect(findForbiddenTerms(text)).toContain(id);
  });

  it('insensible à la casse et aux accents', () => {
    expect(findForbiddenTerms('RENTABLE')).toContain('rentable');
    expect(findForbiddenTerms('rentabilite')).toContain('rentable');
    expect(findForbiddenTerms('ACHETE le breakout')).toContain('achat-vente');
    expect(findForbiddenTerms('achète le breakout')).toContain('achat-vente');
    expect(findForbiddenTerms('Ton EDGE est clair')).toContain('edge');
    expect(findForbiddenTerms('Résultat GARANTI')).toContain('garanti');
    expect(findForbiddenTerms('Tu Vas Gagner')).toContain('futur');
  });

  it('apostrophe typographique ou droite : même résultat', () => {
    expect(findForbiddenTerms('c’est ton edge')).toEqual(findForbiddenTerms("c'est ton edge"));
  });
});

describe('findForbiddenTerms : faux positifs courants (acceptés)', () => {
  it.each([
    // Un trade, une série ou un jour gagnant/perdant : on décrit un trade, pas le trader.
    'Tes trades gagnants durent en moyenne 12 minutes.',
    'Trois trades perdants de suite, puis tu as arrêté comme prévu.',
    'Série gagnante de 4 trades.',
    'Clôturés · 2 · 2 gagnants',
    // Le rappel du caractère indicatif est voulu : négation.
    "Aucun gain n'est garanti.",
    "Ces analyses ne garantissent aucun résultat futur.",
    "Rien n'est assuré : ce sont des estimations.",
    'Sans garantie de résultat.',
    // « sur », « bien sûr », consigne de discipline.
    'Bien sûr, ton stop était placé.',
    'Tu as tradé sur MNQ et sur ES.',
    'Assure-toi de respecter ton stop.',
    // Description d'un comportement passé ou habituel, pas une consigne.
    'Tu vends tes positions gagnantes trop tôt.',
    "J'achète le bas du range quand le plan le prévoit.",
    "Tu es entré sur MNQ deux minutes après la perte.",
    'Ton taux de réussite était de 54 % sur la semaine.',
    // Mots voisins.
    'Hedge et knowledge ne sont pas visés.',
    'Ta discipline sur les stops a été constante.',
  ])('« %s » : conforme', (text) => {
    expect(findForbiddenTerms(text)).toEqual([]);
  });
});

describe('valeurs structurées (JSON de l’IA)', () => {
  const value = {
    summary: 'Semaine disciplinée, stops respectés.',
    strengths: [{ text: "Breakout, c'est ton edge" }, { text: 'Taille de position constante.' }],
    type: 'strength',
  };

  it('trouve les motifs dans toutes les chaînes', () => {
    expect(findForbiddenInValue(value)).toEqual(['edge']);
  });

  it('neutralise seulement les chaînes non conformes', () => {
    const out = neutralizeValue(value);
    expect(out.summary).toBe(value.summary);
    expect(out.strengths[0].text).toBe(AI_TEXT_FALLBACK);
    expect(out.strengths[1].text).toBe('Taille de position constante.');
    expect(out.type).toBe('strength');
  });

  it('le texte neutre de repli est lui-même conforme', () => {
    expect(findForbiddenTerms(AI_TEXT_FALLBACK)).toEqual([]);
  });
});

describe('guardAiText : une régénération au plus, puis repli', () => {
  const logger = () => ({ warn: vi.fn() });

  it('texte conforme : un seul appel, aucun journal', async () => {
    const produce = vi.fn().mockResolvedValue('Stops respectés toute la semaine.');
    const log = logger();
    expect(await guardAiText('chat', produce, log)).toBe('Stops respectés toute la semaine.');
    expect(produce).toHaveBeenCalledTimes(1);
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('non conforme puis conforme : régénéré une fois', async () => {
    const produce = vi.fn().mockResolvedValueOnce("C'est ton edge.").mockResolvedValueOnce('Setup le plus régulier sur la période.');
    const log = logger();
    expect(await guardAiText('chat', produce, log)).toBe('Setup le plus régulier sur la période.');
    expect(produce).toHaveBeenCalledTimes(2);
    expect(log.warn).toHaveBeenCalledTimes(1);
  });

  it('non conforme deux fois : texte neutre, jamais de troisième appel', async () => {
    const produce = vi.fn().mockResolvedValue('Achète MNQ, résultat garanti.');
    const log = logger();
    expect(await guardAiText('chat', produce, log)).toBe(AI_TEXT_FALLBACK);
    expect(produce).toHaveBeenCalledTimes(2);
    expect(log.warn).toHaveBeenCalledTimes(2);
  });

  it('les journaux comptent les motifs sans écrire le texte', async () => {
    const secret = 'Achète MNQ maintenant, résultat garanti à coup sûr';
    const produce = vi.fn().mockResolvedValue(secret);
    const log = logger();
    await guardAiText('daily_recap', produce, log);
    const lines = log.warn.mock.calls.map((c) => String(c[0])).join('\n');
    expect(lines).toContain('daily_recap');
    expect(lines).toMatch(/\d motif/);
    expect(lines).not.toContain('MNQ');
    expect(lines).not.toContain(secret);
  });
});
