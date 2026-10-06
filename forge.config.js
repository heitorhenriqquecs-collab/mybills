module.exports = {
  outDir: process.env.MYBILLS_FORGE_OUT_DIR || 'out',
  packagerConfig: {
    asar: true,
    icon: './assets/mybills',
    ignore: [/^\/android($|\/)/, /^\/dist($|\/)/, /^\/out($|\/)/, /^\/releases($|\/)/, /^\/\.toolchains($|\/)/]
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        name: 'mybills',
        authors: 'Heitor',
        description: 'Aplicativo offline de planejamento financeiro pessoal.',
        setupIcon: './assets/mybills.ico'
      }
    }
  ]
};
