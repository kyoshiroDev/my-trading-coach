const { NxAppWebpackPlugin } = require('@nx/webpack/app-plugin');
const { join } = require('path');

module.exports = {
  output: {
    path: join(__dirname, 'dist'),
    clean: true,
  },
  // Externalise TOUS les modules node_modules (tout ce qui ne commence pas par . ou /)
  // Garantit le bon fonctionnement en Docker sans dépendre du contexte Nx workspace
  externals: [
    function ({ request }, callback) {
      if (/^[^./]/.test(request)) {
        return callback(null, 'commonjs ' + request);
      }
      callback();
    },
  ],
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
      externalDependencies: 'all', // 🔥 ULTRA IMPORTANT
    }),
  ],
};
