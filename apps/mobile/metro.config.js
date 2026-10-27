// Metro for an npm-workspaces monorepo: Expo's defaults already watch the repo root and resolve hoisted packages,
// so @golaly/client, @golaly/shared and @golaly/tokens are used straight from their sources.
const { getDefaultConfig } = require("expo/metro-config");

module.exports = getDefaultConfig(__dirname);
