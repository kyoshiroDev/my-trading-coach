import nx from '@nx/eslint-plugin';

export default [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  {
    ignores: ['**/dist', '**/out-tsc', '**/test-output'],
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: ['^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$'],
          // Qui peut importer qui (tags posés dans chaque project.json / package.json) :
          // une app n'importe jamais une autre app, le code partagé ne dépend de rien d'autre,
          // et le front (app, admin) n'importe jamais le back (API), ni l'inverse.
          depConstraints: [
            { sourceTag: 'type:app', onlyDependOnLibsWithTags: ['type:lib'] },
            { sourceTag: 'type:lib', onlyDependOnLibsWithTags: ['type:lib'] },
            { sourceTag: 'type:e2e', onlyDependOnLibsWithTags: ['type:app', 'type:lib'] },
            { sourceTag: 'scope:shared', onlyDependOnLibsWithTags: ['scope:shared'] },
            { sourceTag: 'scope:front', onlyDependOnLibsWithTags: ['scope:front', 'scope:shared'] },
            { sourceTag: 'scope:back', onlyDependOnLibsWithTags: ['scope:back', 'scope:shared'] },
            { sourceTag: 'scope:landing', onlyDependOnLibsWithTags: ['scope:landing', 'scope:shared'] },
            { sourceTag: 'scope:bot', onlyDependOnLibsWithTags: ['scope:bot', 'scope:shared'] },
          ],
        },
      ],
    },
  },
  {
    files: [
      '**/*.ts',
      '**/*.tsx',
      '**/*.cts',
      '**/*.mts',
      '**/*.js',
      '**/*.jsx',
      '**/*.cjs',
      '**/*.mjs',
    ],
    rules: {
      // Le `_`-prefixe marque un binding intentionnellement inutilisé (params requis
      // par une signature/override, erreur de catch ignoree). Convention standard.
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      // Decision deliberee (regle stylistique inadaptee a ce stack TS strict) :
      // l'operateur `!` est utilise volontairement la ou un invariant garantit le
      // non-null mais que TS ne peut pas l'inferer (champs Prisma filtres `not: null`,
      // cles de groupBy, Map.get apres set, refs @ViewChild). Le reecrire en garde
      // ajoute du bruit sans gain de surete. On garde no-explicit-any actif (vrai defaut).
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  {
    // Fichiers de test : `any` (mocks, casts de fixtures) et assertions de fixtures
    // connues sont legitimes. On relache uniquement le typage strict cote tests.
    files: ['**/*.spec.ts', '**/*.spec.tsx', '**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
];
