const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const stateFile = path.join(process.env.LOCALAPPDATA || '', 'MyBills', 'Data', 'state.json');
const outputFile = path.join(projectRoot, 'releases', 'Meu-save-atual.mybills');
const packageInfo = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));

if (state?.version !== 1 || !Array.isArray(state.entries) || !state.entries.length) {
  throw new Error('O estado atual não contém lançamentos para exportar.');
}

const normalizedState = {
  version: 1,
  revision: Number(state.revision) || 0,
  updatedAt: state.updatedAt || new Date().toISOString(),
  emptyStateConfirmed: false,
  entries: state.entries,
  uiState: state.uiState && typeof state.uiState === 'object' ? state.uiState : {}
};
const backup = {
  format: 'mybills',
  formatVersion: 2,
  appVersion: packageInfo.version,
  exportedAt: new Date().toISOString(),
  ...normalizedState,
  state: normalizedState
};

fs.mkdirSync(path.dirname(outputFile), { recursive: true });
fs.writeFileSync(outputFile, JSON.stringify(backup, null, 2), 'utf8');
console.log(`Backup atual gerado em ${outputFile}`);
