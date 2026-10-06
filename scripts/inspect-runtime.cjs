const endpoint = process.argv[2] || 'http://127.0.0.1:9223/json';

async function main() {
  const targets = await fetch(endpoint).then(response => response.json());
  const target = targets.find(item => item.type === 'page' && item.webSocketDebuggerUrl);
  if (!target) throw new Error('Nenhuma janela do MyBills encontrada para diagnóstico.');

  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });

  const expression = `JSON.stringify({
    title: document.title,
    readyState: document.readyState,
    storageLoading: document.body.classList.contains('storage-loading'),
    theme: document.body.dataset.theme,
    entries: typeof entries === 'undefined' ? null : entries.length,
    selectedMonth: typeof selectedDate === 'undefined' ? null : selectedDate.toISOString(),
    income: document.querySelector('#incomeValue')?.textContent,
    expenses: document.querySelector('#expenseValue')?.textContent,
    saved: document.querySelector('#savedValue')?.textContent,
    transactionRows: document.querySelectorAll('#transactionTable tr').length,
    localPrimary: localStorage.getItem('mybills-finance-v1'),
    localBackup: localStorage.getItem('mybills-finance-backup-v1')
  })`;

  const result = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Tempo esgotado no diagnóstico.')), 5000);
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.id !== 1) return;
      clearTimeout(timeout);
      resolve(message.result?.result?.value);
    });
    socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
  });

  socket.close();
  console.log(JSON.stringify(JSON.parse(result), null, 2));
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
