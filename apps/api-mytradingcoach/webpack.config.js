const { NxAppWebpackPlugin } = require('@nx/webpack/app-plugin');
const { join } = require('path');

// Plugin qui ajoute nos externals APRÈS que NxAppWebpackPlugin ait fini
// Nécessaire car NxAppWebpackPlugin écrase la config externals du module.exports
class NodeModulesExternalsPlugin {
  apply(compiler) {
    compiler.hooks.afterEnvironment.tap('NodeModulesExternalsPlugin', () => {
      const existing = compiler.options.externals ?? [];
      const arr = Array.isArray(existing) ? existing : [existing];
      arr.push(({ request }, callback) => {
        // Externalise tout ce qui est un package node_modules
        // Librairies du monorepo (@mtc/*) : code source TS, résolu par les paths du tsconfig et
        // BUNDLÉ — externalisées, elles seraient cherchées dans node_modules au démarrage.
        if (/^[^./]/.test(request) && !request.startsWith('@mtc/')) {
          return callback(null, 'commonjs ' + request);
        }
        callback();
      });
      compiler.options.externals = arr;
      // Alias des librairies du monorepo : le plugin paths de Nx ne lit pas les `paths` du
      // tsconfig dans cette config TS (références de projets). Posé ici, APRÈS Nx, pour ne pas
      // être écrasé — même raison que les externals ci-dessus.
      compiler.options.resolve = compiler.options.resolve ?? {};
      compiler.options.resolve.alias = {
        ...(compiler.options.resolve.alias ?? {}),
        '@mtc/shared': join(__dirname, '../../libs/shared/src/index.ts'),
      };
    });
  }
}

module.exports = {
  cache: false,
  output: {
    path: join(__dirname, 'dist'),
    clean: true,
  },
  plugins: [
    new NxAppWebpackPlugin({
      target: 'node',
      compiler: 'tsc',
      main: './src/main.ts',
      tsConfig: './tsconfig.app.json',
      assets: ['./src/assets'],
      optimization: false,
      outputHashing: 'none',
      generatePackageJson: true,
      sourceMap: false,
      externalDependencies: 'all', // Nx externalise ce qu'il peut
    }),
    // Doit être après NxAppWebpackPlugin pour ne pas être écrasé
    new NodeModulesExternalsPlugin(),
  ],
};
