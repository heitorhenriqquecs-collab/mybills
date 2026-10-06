const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const outputDirectory = process.env.MYBILLS_FORGE_OUT_DIR || 'out';
const packageDirectory = path.join(projectRoot, outputDirectory, 'mybills-win32-x64');
const packagedExecutable = path.join(packageDirectory, 'mybills.exe');

if (!fs.existsSync(packageDirectory)) throw new Error(`Pacote não encontrado: ${packageDirectory}`);
if (!fs.existsSync(packagedExecutable)) throw new Error(`Executável empacotado não encontrado: ${packagedExecutable}`);

console.log(`MyBills portátil com identidade e ícone próprios preparado em ${packageDirectory}`);
