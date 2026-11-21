import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EcoValuePipe, formatEcoValue } from './eco-value.pipe';

describe('formatEcoValue (#1179)', () => {
  it('« % » précédé d’une espace insécable, décimale au point (#1180), milliers en espace', () => {
    expect(formatEcoValue(4.1, '%')).toBe('4.1\u00a0%');
    expect(formatEcoValue(-0.3, '%')).toBe('-0.3\u00a0%');
  });

  it('suffixes K, M, B collés, sans unité : la valeur seule', () => {
    expect(formatEcoValue(250, 'K')).toBe('250K');
    expect(formatEcoValue(1.2, 'M')).toBe('1.2M');
    expect(formatEcoValue(3, 'B')).toBe('3B');
    expect(formatEcoValue(52.4, null)).toBe('52.4');
    expect(formatEcoValue(52.4)).toBe('52.4');
  });

  it('milliers en espace fine insécable (U+202F, fr-FR), une seule virgule remplacée, arrondi à 3 décimales', () => {
    expect(formatEcoValue(1234.5, 'K')).toBe('1\u202f234.5K');
    expect(formatEcoValue(-1234.567, '%')).toBe('-1\u202f234.567\u00a0%');
    expect(formatEcoValue(5.3326, '%')).toBe('5.333\u00a0%');
  });

  it('valeur absente → « - »', () => {
    expect(formatEcoValue(null, '%')).toBe('-');
    expect(formatEcoValue(undefined, 'K')).toBe('-');
  });

  it('le pipe délègue au même formateur', () => {
    expect(new EcoValuePipe().transform(4.1, '%')).toBe('4.1\u00a0%');
  });
});

describe('gabarits de l’app : aucun « % » collé à une interpolation (#1179, règle design 5)', () => {
  const appDir = join(import.meta.dirname, '..', '..');
  const templates = (readdirSync(appDir, { recursive: true }) as string[]).filter((f) => f.endsWith('.html'));

  it('trouve les gabarits', () => {
    expect(templates.length).toBeGreaterThan(50);
  });

  it('« }}% » ou « }} % » remplacés par « }}&nbsp;% » ou un pipe (même sur deux lignes)', () => {
    const fautes = templates.filter((f) => /\}\}\s*%/.test(readFileSync(join(appDir, f), 'utf8')));
    expect(fautes).toEqual([]);
  });

  it('les valeurs éco passent par le pipe ecoValue', () => {
    const fautes = templates.filter((f) => /\}\}\s*\{\{\s*[\w.?!]*\bunit\s*\}\}/.test(readFileSync(join(appDir, f), 'utf8')));
    expect(fautes).toEqual([]);
  });
});
