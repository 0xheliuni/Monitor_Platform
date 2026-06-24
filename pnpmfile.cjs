module.exports = {
  hooks: {
    readPackageJson: async (pkg) => {
      return pkg;
    },
  },
  allowedNonManifestFiles: [],
  allowBuild: () => true,
};
