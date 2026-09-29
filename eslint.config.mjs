import nx from '@nx/eslint-plugin';
import astro from 'eslint-plugin-astro';

export default [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  {
    ignores: ['**/dist', '**/out-tsc', '**/test-output'],
  },
  // Les 35 fichiers `.astro` de la landing n'étaient PAS lintés : sans ce parseur, eslint ne sait
  // pas les lire et les ignore en silence — un lint vert ne disait donc rien d'eux.
  ...astro.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          // Alias internes d'une app (@app/*, @admin/*, @api/*, tsconfig.base.json) : évitent les
          // imports ../../../ ; une app qui s'importe via son propre alias est donc autorisée.
          allowCircularSelfDependency: true,
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
    // Au-delà de 400 lignes, un fichier se lit mal : c'est le signal pour en sortir la logique
    // pure (helpers, types) ou un sous-composant. Avertissement seulement, pour ne pas bloquer
    // les fichiers encore au-dessus (liste dans CONTRIBUTING.md).
    files: ['**/*.ts'],
    ignores: ['**/*.spec.ts', '**/*.int-spec.ts', '**/*.e2e-spec.ts', 'tools/**', 'e2e/**'],
    rules: {
      'max-lines': ['warn', { max: 400, skipBlankLines: true, skipComments: true }],
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
  {
    // Scripts ponctuels (seed, backfill, ops) : ils agissent SUR l'API et en importent les
    // services (@api/…) par nature. L'exception est limitée à ce dossier : le front ne peut
    // toujours pas importer le back.
    files: ['tools/scripts/**/*.ts'],
    rules: {
      '@nx/enforce-module-boundaries': 'off',
    },
  },
];
