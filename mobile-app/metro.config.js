const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Add rn-sdk as a watch folder so changes are picked up in dev.
config.watchFolders = [path.resolve(__dirname, '..', 'rn-sdk')];

// Map the package name to its built dist output (folder dependency already works, this is a fallback)
config.resolver = config.resolver || {};
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  '@financekit/rn-sdk': path.resolve(__dirname, '..', 'rn-sdk', 'dist')
};

module.exports = config;
