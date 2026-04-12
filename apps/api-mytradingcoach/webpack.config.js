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
        if (/^[^./]/.test(request)) {
          return callback(null, 'commonjs ' + request);
        }
        callback();
      });
      compiler.options.externals = arr;
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
