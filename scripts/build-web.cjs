const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const outputDirectory = path.join(projectRoot, 'dist');
if (path.dirname(outputDirectory) !== projectRoot || path.basename(outputDirectory) !== 'dist') throw new Error('Diretório de saída inválido.');

fs.rmSync(outputDirectory, { recursive: true, force: true });
fs.mkdirSync(outputDirectory, { recursive: true });

for (const file of ['index.html', 'styles.css', 'app.js']) fs.copyFileSync(path.join(projectRoot, file), path.join(outputDirectory, file));
fs.cpSync(path.join(projectRoot, 'assets'), path.join(outputDirectory, 'assets'), { recursive: true });
console.log(`Aplicação web offline gerada em ${outputDirectory}`);
