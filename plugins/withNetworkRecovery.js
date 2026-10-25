const { withMainApplication } = require('@expo/config-plugins');

const INSTALL = 'expo.modules.networkrecovery.NetworkRecovery.install(this)';

function applyInstall(source) {
  if (source.includes(INSTALL)) return source;
  const anchor = /(override\s+fun\s+onCreate\s*\(\s*\)\s*\{\s*\n\s*super\.onCreate\s*\(\s*\))/;
  if (!anchor.test(source)) {
    throw new Error('withNetworkRecovery: Kotlin MainApplication.onCreate anchor was not found');
  }
  return source.replace(anchor, `$1\n    ${INSTALL}`);
}

module.exports = function withNetworkRecovery(config) {
  return withMainApplication(config, (cfg) => {
    if (cfg.modResults.language !== 'kt') {
      throw new Error('withNetworkRecovery requires Kotlin MainApplication');
    }
    cfg.modResults.contents = applyInstall(cfg.modResults.contents);
    return cfg;
  });
};

module.exports.applyInstall = applyInstall;
