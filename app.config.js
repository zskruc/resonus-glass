// A separate application identity keeps preview installs alongside the release.
// Normal builds retain upstream's identifiers and versioning.
module.exports = ({ config }) => {
  if (process.env.RESONUS_GLASS_PREVIEW !== '1') return config;
  return {
    ...config,
    name: 'Resonus Glass',
    slug: 'resonus-glass-preview',
    scheme: 'resonus-glass',
    android: { ...config.android, package: 'com.zskruc.resonus.glasspreview' },
    ios: { ...config.ios, bundleIdentifier: 'com.zskruc.resonus.glasspreview' },
  };
};
