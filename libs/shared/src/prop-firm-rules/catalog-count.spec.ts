import { describe, it, expect } from 'vitest';
import { PROP_FIRM_CATALOG_FILES } from './catalog';
import { PROP_FIRM_COUNT } from './catalog-count';

describe('PROP_FIRM_COUNT', () => {
  it('égal au nombre de fichiers du catalogue (même source que la landing)', () => {
    expect(PROP_FIRM_COUNT).toBe(PROP_FIRM_CATALOG_FILES.length);
  });
});
