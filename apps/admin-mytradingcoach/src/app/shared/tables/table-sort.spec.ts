import { describe, expect, it } from 'vitest';
import { TableSort } from './table-sort';

interface Row {
  n: string;
  act: number; // heures depuis dernière activité (plus petit = plus récent)
  reg: number; // timestamp inscription
}

const ROWS: Row[] = [
  { n: 'Charlie', act: 96, reg: 30 },
  { n: 'alice', act: 4, reg: 10 },
  { n: 'Bob', act: 1e9, reg: 20 }, // "Jamais"
];

function makeSort() {
  return new TableSort<Row>(
    { n: (r) => r.n.toLowerCase(), act: (r) => r.act, reg: (r) => r.reg },
    'act',
    ['reg'],
  );
}

describe('TableSort', () => {
  it('trie par la clé par défaut en ascendant (activité = plus récent en haut)', () => {
    const sort = makeSort();
    const out = sort.apply(ROWS);
    expect(out.map((r) => r.n)).toEqual(['alice', 'Charlie', 'Bob']); // 4 < 96 < 1e9
  });

  it('inverse le sens au re-clic sur la colonne active', () => {
    const sort = makeSort();
    sort.toggle('act'); // déjà actif → inverse en descendant
    expect(sort.dir()).toBe(-1);
    expect(sort.apply(ROWS).map((r) => r.n)).toEqual(['Bob', 'Charlie', 'alice']);
  });

  it('active une nouvelle colonne avec le sens par défaut (desc-first pour reg)', () => {
    const sort = makeSort();
    sort.toggle('reg'); // reg ∈ descFirstKeys → -1
    expect(sort.isActive('reg')).toBe(true);
    expect(sort.dir()).toBe(-1);
    expect(sort.apply(ROWS).map((r) => r.n)).toEqual(['Charlie', 'Bob', 'alice']); // 30 > 20 > 10
  });

  it('active une colonne normale en ascendant', () => {
    const sort = makeSort();
    sort.toggle('n'); // pas desc-first → +1
    expect(sort.dir()).toBe(1);
    expect(sort.apply(ROWS).map((r) => r.n)).toEqual(['alice', 'Bob', 'Charlie']);
  });

  it('expose le bon chevron pour la colonne active uniquement', () => {
    const sort = makeSort();
    expect(sort.caret('act')).toBe('▲');
    expect(sort.caret('reg')).toBe('');
    sort.toggle('act');
    expect(sort.caret('act')).toBe('▼');
  });
});