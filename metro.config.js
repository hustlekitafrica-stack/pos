const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);

// Add 'web' platform so Metro resolves *.web.ts / *.web.tsx files first on web builds
// and stub optional Node-only packages that can't be bundled for the browser.
config.resolver = {
  ...config.resolver,
  platforms: [...(config.resolver?.platforms ?? ['ios', 'android']), 'web'],
  extraNodeModules: {
    ...config.resolver?.extraNodeModules,
    // @opentelemetry/api is an optional peer of @supabase/supabase-js; not needed on web
    '@opentelemetry/api': path.resolve(__dirname, 'stubs/opentelemetry-api.js'),
    // better-sqlite3 is a Node.js native module; never needed on web (LokiJS used instead)
    'better-sqlite3': path.resolve(__dirname, 'stubs/opentelemetry-api.js'),
  },
};

module.exports = withNativeWind(config, { input: './global.css' });
