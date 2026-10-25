const { withAndroidManifest } = require('@expo/config-plugins');

// Liquid Glass's RenderNode / RenderEffect path requires a hardware window.
// Everything else (dependencies and Compose compiler) belongs to the local
// module, so Expo prebuild can regenerate android/ without manual patches.
module.exports = function withLiquidGlass(config) {
  return withAndroidManifest(config, (config) => {
    const application = config.modResults.manifest.application?.[0];
    if (application) {
      application.$['android:hardwareAccelerated'] = 'true';
      if (config.android?.package === 'com.zskruc.resonus.glasspreview') {
        // Measure release frame timing locally without enabling debug mode.
        application.profileable = [{ $: { 'android:shell': 'true' } }];
      } else {
        // Prebuild may reuse android/ generated for the preview identity.
        delete application.profileable;
      }
    }
    return config;
  });
};
