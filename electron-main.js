const { app, BrowserWindow, shell, ipcMain, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const dgram = require('node:dgram');
const crypto = require('node:crypto');
const QRCode = require('qrcode');

if (require('electron-squirrel-startup')) app.quit();
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();
let mainWindow = null;

function statePaths(scope) {
  const baseDirectory=path.join(process.env.LOCALAPPDATA||app.getPath('userData'),'MyBills','Data');
  const safeScope=typeof scope==='string'&&/^[a-zA-Z0-9-]{8,80}$/.test(scope)?scope:null;
  const dataDirectory=safeScope?path.join(baseDirectory,'Accounts',safeScope):baseDirectory;
  return {dataDirectory,historyDirectory:path.join(dataDirectory,'History'),stateFile:path.join(dataDirectory,'state.json'),backupFile:path.join(dataDirectory,'state.bak.json'),temporaryFile:path.join(dataDirectory,'state.tmp.json')};
}

function validEntry(entry){return Boolean(entry&&typeof entry.id==='string'&&entry.id.trim()&&['income','expense'].includes(entry.type)&&typeof entry.description==='string'&&entry.description.trim()&&Number.isFinite(Number(entry.value))&&Number(entry.value)>0&&/^\d{4}-\d{2}-\d{2}$/.test(entry.date||'')&&typeof entry.category==='string'&&entry.category.trim()&&['once','monthly','installments'].includes(entry.recurrence)&&(entry.recurrence!=='installments'||(Number.isInteger(Number(entry.installments))&&Number(entry.installments)>=2&&Number(entry.installments)<=60)));}
function validState(value){return Boolean(value?.version===1&&Array.isArray(value.entries)&&value.entries.every(validEntry)&&new Set(value.entries.map(entry=>entry.id)).size===value.entries.length);}
function readJson(file){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return null;}}
function stateTime(value){const time=Date.parse(value?.updatedAt||'');return Number.isFinite(time)?time:0;}
function chooseState(values){const valid=values.filter(validState),newest=states=>states.sort((a,b)=>(Number(b.revision)||0)-(Number(a.revision)||0)||stateTime(b)-stateTime(a))[0]||null,nonEmpty=newest(valid.filter(value=>value.entries.length)),confirmedEmpty=newest(valid.filter(value=>!value.entries.length&&value.emptyStateConfirmed));if(nonEmpty&&confirmedEmpty&&(Number(confirmedEmpty.revision)||0)>(Number(nonEmpty.revision)||0))return confirmedEmpty;return nonEmpty||confirmedEmpty||newest(valid);}
function loadState(scope){const paths=statePaths(scope);return chooseState([readJson(paths.stateFile),readJson(paths.temporaryFile),readJson(paths.backupFile)]);}
function comparableState(value){return JSON.stringify({entries:value.entries,uiState:value.uiState||{}});}
function saveHistory(paths,value){
  if(!validState(value)||!value.entries.length)return;
  fs.mkdirSync(paths.historyDirectory,{recursive:true});
  const stamp=(value.updatedAt||new Date().toISOString()).replace(/[:.]/g,'-');
  const historyFile=path.join(paths.historyDirectory,`state-${stamp}.json`);
  if(!fs.existsSync(historyFile))fs.writeFileSync(historyFile,JSON.stringify(value,null,2),'utf8');
  const history=fs.readdirSync(paths.historyDirectory).filter(name=>/^state-.*\.json$/.test(name)).sort().reverse();
  for(const oldName of history.slice(10))fs.unlinkSync(path.join(paths.historyDirectory,oldName));
}
function saveState(value,scope){
  if(!validState(value)||(!value.entries.length&&!value.emptyStateConfirmed))throw new Error('Estado financeiro inválido ou vazio não confirmado.');
  const paths=statePaths(scope);
  fs.mkdirSync(paths.dataDirectory,{recursive:true});
  const normalized={version:1,revision:Number(value.revision)||0,updatedAt:value.updatedAt||new Date().toISOString(),emptyStateConfirmed:Boolean(value.emptyStateConfirmed&&!value.entries.length),entries:value.entries.map(entry=>({...entry})),uiState:value.uiState&&typeof value.uiState==='object'?value.uiState:{}};
  const previous=readJson(paths.stateFile);
  fs.writeFileSync(paths.temporaryFile,JSON.stringify(normalized,null,2),'utf8');
  const descriptor=fs.openSync(paths.temporaryFile,'r+');fs.fsyncSync(descriptor);fs.closeSync(descriptor);
  if(validState(previous)&&comparableState(previous)!==comparableState(normalized)){fs.copyFileSync(paths.stateFile,paths.backupFile);saveHistory(paths,previous);}
  try{fs.renameSync(paths.temporaryFile,paths.stateFile);}catch(error){
    if(!['EPERM','EEXIST'].includes(error.code))throw error;
    fs.copyFileSync(paths.temporaryFile,paths.stateFile);
    const stateDescriptor=fs.openSync(paths.stateFile,'r+');fs.fsyncSync(stateDescriptor);fs.closeSync(stateDescriptor);
    fs.unlinkSync(paths.temporaryFile);
  }
  return normalized;
}

ipcMain.handle('mybills:load-state',(_event,scope)=>loadState(scope));
ipcMain.handle('mybills:save-state',(_event,scope,value)=>saveState(value,scope));
ipcMain.on('mybills:save-state-sync',(event,scope,value)=>{try{event.returnValue={ok:true,state:saveState(value,scope)};}catch(error){event.returnValue={ok:false,error:error.message};}});
ipcMain.handle('mybills:export-backup',async(_event,value)=>{
  if(!validState(value))throw new Error('Backup inválido.');
  const result=await dialog.showSaveDialog({title:'Salvar backup do MyBills',defaultPath:`mybills-${new Date().toISOString().slice(0,10)}.mybills`,filters:[{name:'Backup MyBills',extensions:['mybills']},{name:'JSON',extensions:['json']}]});
  if(result.canceled||!result.filePath)return {canceled:true};
  const temporaryPath=`${result.filePath}.tmp`;
  fs.writeFileSync(temporaryPath,JSON.stringify(value,null,2),'utf8');
  if(fs.existsSync(result.filePath))fs.unlinkSync(result.filePath);
  fs.renameSync(temporaryPath,result.filePath);
  return {canceled:false,filePath:result.filePath};
});

const TRANSFER_PORT = 43127;
const DISCOVERY_PORT = 43128;
let transferServer = null;
let discoverySocket = null;
let transferSession = null;
let transferExpiryTimer = null;

function transferState(value) {
  const state=value?.format==='mybills'?(value.state||value):value;
  return validState(state)?state:null;
}
function transferCipherKey(token){return crypto.createHash('sha256').update(token).digest();}
function encryptTransfer(value,token){
  const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',transferCipherKey(token),iv);
  const encrypted=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
  return {v:1,iv:iv.toString('base64url'),data:encrypted.toString('base64url'),tag:cipher.getAuthTag().toString('base64url')};
}
function decryptTransfer(value,token){
  const decipher=crypto.createDecipheriv('aes-256-gcm',transferCipherKey(token),Buffer.from(value.iv,'base64url'));
  decipher.setAuthTag(Buffer.from(value.tag,'base64url'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(value.data,'base64url')),decipher.final()]).toString('utf8'));
}
function closeLocalTransfer(){
  clearTimeout(transferExpiryTimer);transferExpiryTimer=null;transferSession=null;
  if(discoverySocket){try{discoverySocket.close();}catch{}discoverySocket=null;}
  if(transferServer){try{transferServer.close();}catch{}transferServer=null;}
}
function transferCors(response){response.setHeader('Access-Control-Allow-Origin','*');response.setHeader('Access-Control-Allow-Headers','Content-Type');response.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');}
function readTransferBody(request){return new Promise((resolve,reject)=>{let body='';request.on('data',chunk=>{body+=chunk;if(body.length>6_000_000){reject(new Error('payload_too_large'));request.destroy();}});request.on('end',()=>resolve(body));request.on('error',reject);});}
function respondJson(response,status,value){transferCors(response);response.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});response.end(JSON.stringify(value));}
function localAddresses(){
  const adapters=[];
  for(const [name,values] of Object.entries(require('node:os').networkInterfaces()))for(const value of values||[]){if(value.family==='IPv4'&&!value.internal&&!/virtual|vethernet|vmware|tailscale|loopback/i.test(name))adapters.push({name,address:value.address});}
  const score=name=>/wi-?fi|wlan/i.test(name)?3:/ethernet/i.test(name)?2:1;
  return adapters.sort((a,b)=>score(b.name)-score(a.name)).map(item=>item.address);
}
async function startDiscovery(session){
  await new Promise((resolve,reject)=>{
    const socket=dgram.createSocket({type:'udp4',reuseAddr:true});discoverySocket=socket;
    socket.on('message',(message,remote)=>{
      if(!transferSession||message.toString('utf8')!==`MYBILLS_DISCOVER:${transferSession.code}`)return;
      const answer=Buffer.from(JSON.stringify({kind:'mybills-local-transfer',v:1,direction:'send',port:transferSession.port,token:transferSession.token,expiresAt:transferSession.expiresAt}));
      socket.send(answer,remote.port,remote.address);
    });
    socket.once('error',reject);socket.bind(DISCOVERY_PORT,'0.0.0.0',()=>{socket.removeListener('error',reject);resolve();});
  });
}
async function listenTransferServer(server){
  for(let port=TRANSFER_PORT;port<TRANSFER_PORT+10;port++){
    try{await new Promise((resolve,reject)=>{const onError=error=>{server.removeListener('listening',onListening);reject(error);};const onListening=()=>{server.removeListener('error',onError);resolve();};server.once('error',onError);server.once('listening',onListening);server.listen(port,'0.0.0.0');});return port;}
    catch(error){if(error.code!=='EADDRINUSE')throw error;}
  }
  throw new Error('Nenhuma porta local disponível para a transferência.');
}
async function startLocalTransfer(direction,value){
  closeLocalTransfer();
  if(!['send','receive'].includes(direction))throw new Error('Direção de transferência inválida.');
  const state=direction==='send'?transferState(value):null;if(direction==='send'&&!state)throw new Error('Os dados locais não são válidos para transferência.');
  const token=crypto.randomBytes(32).toString('base64url'),code=String(crypto.randomInt(0,1_000_000)).padStart(6,'0'),expiresAt=Date.now()+5*60*1000;
  const server=http.createServer(async(request,response)=>{
    try{
      if(request.method==='OPTIONS'){transferCors(response);response.writeHead(204);response.end();return;}
      const requestUrl=new URL(request.url,'http://127.0.0.1');
      if(!transferSession||Date.now()>transferSession.expiresAt)return respondJson(response,410,{error:'expired'});
      if(requestUrl.searchParams.get('token')!==transferSession.token)return respondJson(response,401,{error:'invalid_token'});
      if(requestUrl.pathname==='/mybills/pull'&&request.method==='GET'&&transferSession.direction==='send'){
        const payload=encryptTransfer({format:'mybills',formatVersion:2,appVersion:'0.6.0',exportedAt:new Date().toISOString(),state:transferSession.state},transferSession.token);
        respondJson(response,200,payload);setTimeout(closeLocalTransfer,400);return;
      }
      if(requestUrl.pathname==='/mybills/push'&&request.method==='POST'&&transferSession.direction==='receive'){
        const encrypted=JSON.parse(await readTransferBody(request));const backup=decryptTransfer(encrypted,transferSession.token);const state=transferState(backup);
        if(!state)return respondJson(response,400,{error:'invalid_state'});
        respondJson(response,200,{ok:true});mainWindow?.webContents.send('mybills:transfer-received',backup);setTimeout(closeLocalTransfer,400);return;
      }
      return respondJson(response,404,{error:'not_found'});
    }catch{return respondJson(response,400,{error:'invalid_payload'});}
  });
  transferServer=server;const port=await listenTransferServer(server);
  transferSession={direction,state,token,code,port,expiresAt};
  if(direction==='send')await startDiscovery(transferSession);
  transferExpiryTimer=setTimeout(closeLocalTransfer,5*60*1000);
  const addresses=localAddresses(),address=addresses[0]||'127.0.0.1';
  const qrPayload=JSON.stringify({kind:'mybills-local-transfer',v:1,direction:'receive',host:address,hosts:addresses.length?addresses:[address],port,token,expiresAt});
  return {direction,code,expiresAt,qrDataUrl:direction==='receive'?await QRCode.toDataURL(qrPayload,{width:330,margin:2,color:{dark:'#163c31',light:'#fff8f2'}}):null};
}

ipcMain.handle('mybills:start-local-transfer',(_event,direction,value)=>startLocalTransfer(direction,value));
ipcMain.handle('mybills:cancel-local-transfer',()=>{closeLocalTransfer();return true;});

function createWindow() {
  const smokeTest=process.argv.includes('--smoke-test');
  const diagnosticMode=process.argv.includes('--diagnose');
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 840,
    minHeight: 620,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#18201d',
    icon: path.join(__dirname, 'assets', 'mybills.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow = window;
  window.on('closed',()=>{mainWindow=null;});

  window.loadFile('index.html');
  window.once('ready-to-show', () => {if(!smokeTest&&!diagnosticMode)window.show();});
  if(smokeTest)window.webContents.once('did-finish-load',()=>setTimeout(()=>app.quit(),3500));
  if(diagnosticMode)window.webContents.once('did-finish-load',()=>setTimeout(async()=>{
    const result=await window.webContents.executeJavaScript(`({
      readyState:document.readyState,
      storageLoading:document.body.classList.contains('storage-loading'),
      entries:typeof entries==='undefined'?null:entries.length,
      selectedMonth:typeof selectedDate==='undefined'?null:selectedDate.toISOString(),
      income:document.querySelector('#incomeValue')?.textContent,
      expenses:document.querySelector('#expenseValue')?.textContent,
      saved:document.querySelector('#savedValue')?.textContent,
      transactionRows:document.querySelectorAll('#transactionTable tr').length,
      localPrimary:localStorage.getItem('mybills-finance-v1'),
      localBackup:localStorage.getItem('mybills-finance-backup-v1')
    })`,true);
    const diagnosticDirectory=path.join(process.env.LOCALAPPDATA||app.getPath('userData'),'MyBills','Diagnostics');
    fs.mkdirSync(diagnosticDirectory,{recursive:true});
    fs.writeFileSync(path.join(diagnosticDirectory,'runtime.json'),JSON.stringify(result,null,2),'utf8');
    window.destroy();
    app.quit();
  },4500));

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('second-instance',()=>{if(mainWindow){if(mainWindow.isMinimized())mainWindow.restore();mainWindow.show();mainWindow.focus();}});
app.on('before-quit',closeLocalTransfer);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
