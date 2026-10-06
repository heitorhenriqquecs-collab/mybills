const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const dgram = require('node:dgram');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const executable = path.join(root, 'out-v051', 'mybills-win32-x64', 'mybills.exe');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mybills-transfer-test-'));
const debuggingPort = 9437;
const application = childProcess.spawn(executable, [`--remote-debugging-port=${debuggingPort}`, `--user-data-dir=${profile}`], { stdio: 'ignore' });

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function browserTarget() {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const targets = await fetch(`http://127.0.0.1:${debuggingPort}/json`).then(response => response.json());
      const target = targets.find(item => item.type === 'page');
      if (target) return target;
    } catch {}
    await delay(200);
  }
  throw new Error('A interface do Windows não abriu para o teste.');
}
async function cdp(target) {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true });socket.addEventListener('error', reject, { once: true }); });
  let sequence = 0;
  const pending = new Map();
  socket.addEventListener('message', event => { const message=JSON.parse(event.data);if(message.id&&pending.has(message.id)){const {resolve,reject}=pending.get(message.id);pending.delete(message.id);message.error?reject(new Error(message.error.message)):resolve(message.result);} });
  return {
    evaluate(expression){const id=++sequence;socket.send(JSON.stringify({id,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true}}));return new Promise((resolve,reject)=>pending.set(id,{resolve,reject}));},
    close(){socket.close();}
  };
}
function discover(code) {
  return new Promise((resolve,reject)=>{
    const socket=dgram.createSocket('udp4'),timer=setTimeout(()=>{socket.close();reject(new Error('Descoberta local não respondeu.'));},4000);
    socket.on('message',message=>{clearTimeout(timer);socket.close();resolve(JSON.parse(message.toString('utf8')));});
    socket.bind(()=>socket.send(Buffer.from(`MYBILLS_DISCOVER:${code}`),43128,'127.0.0.1'));
  });
}
function decrypt(payload,token){const key=crypto.createHash('sha256').update(token).digest(),decipher=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(payload.iv,'base64url'));decipher.setAuthTag(Buffer.from(payload.tag,'base64url'));return JSON.parse(Buffer.concat([decipher.update(Buffer.from(payload.data,'base64url')),decipher.final()]).toString('utf8'));}

(async()=>{
  let connection;
  try {
    const target=await browserTarget(),client=await cdp(target);
    for(let attempt=0;attempt<30;attempt++){const ready=await client.evaluate(`Boolean(document.querySelector('#authName'))`);if(ready.result.value)break;await delay(150);}
    const auth=await client.evaluate(`({title:document.querySelector('#authTitle')?.textContent,serverControl:Boolean(document.querySelector('.server-settings'))})`);
    if(auth.result.value.serverControl)throw new Error('A configuração de servidor ainda aparece.');
    const login=await client.evaluate(`(async()=>{document.querySelector('#authName').value='Teste local';document.querySelector('#authCpf').value='529.982.247-25';document.querySelector('#authPassword').value='teste-local-123';document.querySelector('#authConfirm').value='teste-local-123';document.querySelector('#authForm').requestSubmit();await new Promise(resolve=>setTimeout(resolve,1800));return {appVisible:!document.querySelector('#appShell').hidden,account:document.querySelector('#accountName').textContent,error:document.querySelector('#authError').textContent};})()`);
    if(login.exceptionDetails)throw new Error(login.exceptionDetails.exception?.description||login.exceptionDetails.text);
    if(!login.result.value?.appVisible)throw new Error(`A conta local não abriu: ${login.result.value?.error||'erro desconhecido'}`);
    const started=await client.evaluate(`window.mybillsDesktop.startLocalTransfer('send',createBackup())`);connection=started.result.value;
    if(!connection)throw new Error(started.exceptionDetails?.exception?.description||'A transferência não foi iniciada.');
    if(!/^\d{6}$/.test(connection.code))throw new Error('Código temporário inválido.');
    const discovered=await discover(connection.code),response=await fetch(`http://127.0.0.1:${discovered.port}/mybills/pull?token=${encodeURIComponent(discovered.token)}`);
    if(!response.ok)throw new Error('Download local recusado.');
    const encrypted=await response.json(),browserDecrypted=await client.evaluate(`decryptTransferPayload(${JSON.stringify(encrypted)},${JSON.stringify(discovered.token)})`),backup=browserDecrypted.result.value;
    if(backup.format!=='mybills'||backup.appVersion!=='0.6.0')throw new Error('Conteúdo transferido inválido.');
    const browserEncrypted=await client.evaluate(`encryptTransferPayload({source:'celular'},${JSON.stringify(discovered.token)})`);
    if(decrypt(browserEncrypted.result.value,discovered.token).source!=='celular')throw new Error('Criptografia do celular incompatível com o computador.');
    client.close();
    console.log('Conta local, código temporário, descoberta Wi-Fi e transferência criptografada validados.');
  } finally {
    try{application.kill();}catch{}
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
