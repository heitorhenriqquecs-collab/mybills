const STORAGE_KEY = 'mybills-finance-v1';
const BACKUP_STORAGE_KEY = 'mybills-finance-backup-v1';
const UI_STORAGE_KEY = 'mybills-ui-state-v1';
const DRAFT_STORAGE_KEY = 'mybills-entry-draft-v1';
const DATABASE_NAME = 'mybills-durable-storage';
const DATABASE_STORE = 'state';
const NATIVE_STATE_KEY = 'mybills-state-v1';
const NATIVE_BACKUP_KEY = 'mybills-state-backup-v1';
const LEGACY_AUTH_STORAGE_KEY = 'mybills-cloud-session-v1';
const LOCAL_ACCOUNTS_KEY = 'mybills-local-accounts-v1';
const LOCAL_SESSION_KEY = 'mybills-local-session-v1';
const ACTIVE_ACCOUNT_KEY = 'mybills-local-active-account-v1';
const SKIP_BIOMETRIC_ONCE_KEY = 'mybills-skip-biometric-once-v1';
const MIGRATION_KEY = 'mybills-account-migrated-v1';
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const categoryIcons = { Moradia: '⌂', Alimentação: '◌', Transporte: '↗', Saúde: '✚', Lazer: '◇', Assinaturas: '∞', Salário: '↗', Freelance: '✦', Outros: '•' };

const now = new Date();
const dateAt = (monthOffset, day) => {
  const d = new Date(now.getFullYear(), now.getMonth() + monthOffset, day);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
};

const starterData = [];

let localSession = null;
let accountNamespace = 'signed-out';
let bootstrapState = null;
let entries = starterData;
let uiState = {};
let selectedDate = uiState.selectedMonth ? parseSavedMonth(uiState.selectedMonth) : new Date(now.getFullYear(), now.getMonth(), 1);
let activeFilter = uiState.activeFilter || 'all';
let hiddenValues = Boolean(uiState.hiddenValues);
let currentRevision = Number(bootstrapState?.revision) || 0;
let emptyStateConfirmed = Boolean(bootstrapState?.emptyStateConfirmed && !entries.length);
let storageReady = false;
let nativeWriteQueue = Promise.resolve();
let lastCommittedFingerprint = bootstrapState ? stateFingerprint(bootstrapState) : '';
let saveTimer;
let detailTrigger = null;

function scopedKey(key) { return `${key}:${accountNamespace}`; }
function saveStatus(mode, label) {
  const element=document.querySelector('#saveStatus'); if(!element)return;
  element.classList.toggle('saving',mode==='saving'); element.classList.toggle('offline',mode==='offline');
  const text=element.querySelector('span'); if(text)text.textContent=label;
}
function loadAccounts(){try{return JSON.parse(localStorage.getItem(LOCAL_ACCOUNTS_KEY))||{};}catch{return {};}}
function storeAccounts(accounts){localStorage.setItem(LOCAL_ACCOUNTS_KEY,JSON.stringify(accounts));}
function loadStoredSession(){try{return JSON.parse(sessionStorage.getItem(LOCAL_SESSION_KEY))||null;}catch{return null;}}
function storeSession(session){localSession=session;if(session)sessionStorage.setItem(LOCAL_SESSION_KEY,JSON.stringify(session));else sessionStorage.removeItem(LOCAL_SESSION_KEY);}
function bytesToBase64(bytes){let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);return btoa(binary);}
function base64ToBytes(value){const binary=atob(value);return Uint8Array.from(binary,char=>char.charCodeAt(0));}
async function sha256(value){const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');}
async function protectPassword(password,saltValue){const salt=saltValue?base64ToBytes(saltValue):crypto.getRandomValues(new Uint8Array(16));const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);const bits=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt,iterations:210000},key,256);return {salt:bytesToBase64(salt),hash:bytesToBase64(new Uint8Array(bits))};}
function normalizeCpf(value){return String(value||'').replace(/\D/g,'');}
function validCpf(value){const cpf=normalizeCpf(value);if(!/^\d{11}$/.test(cpf)||/^(\d)\1{10}$/.test(cpf))return false;const digit=length=>{let sum=0;for(let index=0;index<length;index++)sum+=Number(cpf[index])*(length+1-index);const rest=(sum*10)%11;return rest===10?0:rest;};return digit(9)===Number(cpf[9])&&digit(10)===Number(cpf[10]);}
function maskCpf(value){const cpf=normalizeCpf(value);return cpf.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/,'$1.$2.$3-$4');}
function biometricPlugin(){return window.Capacitor?.Plugins?.BiometricAuthNative||null;}
async function biometricAvailable(){if(!isNativeMobile()||!biometricPlugin())return false;try{return Boolean((await biometricPlugin().checkBiometry()).isAvailable);}catch{return false;}}
async function requestBiometric(reason='Desbloqueie o MyBills'){await biometricPlugin().authenticate({reason,cancelTitle:'Usar senha',allowDeviceCredential:true,androidTitle:'Desbloquear MyBills',androidSubtitle:'Confirme sua identidade para acessar seus dados',androidConfirmationRequired:false,androidBiometryStrength:0});}
function formatCpfInput(value) {
  const digits=String(value||'').replace(/\D/g,'').slice(0,11);
  return digits.replace(/^(\d{3})(\d)/,'$1.$2').replace(/^(\d{3})\.(\d{3})(\d)/,'$1.$2.$3').replace(/\.(\d{3})(\d)/,'.$1-$2');
}
function showAuth(message='') {
  document.querySelector('#appShell').hidden=true;document.querySelector('#authGate').hidden=false;
  const error=document.querySelector('#authError');error.textContent=message;error.hidden=!message;
}
function hideAuth() { document.querySelector('#authGate').hidden=true;document.querySelector('#appShell').hidden=false;document.querySelector('#accountName').textContent=localSession?.user?.name||localSession?.user?.cpf||'Minha conta'; }
async function verifyStoredSession() {
  const accounts=loadAccounts(),stored=loadStoredSession();
  if(stored?.user?.id&&Object.values(accounts).some(account=>account.id===stored.user.id)){localSession=stored;return true;}
  if(localStorage.getItem(SKIP_BIOMETRIC_ONCE_KEY)==='1'){localStorage.removeItem(SKIP_BIOMETRIC_ONCE_KEY);return false;}
  const activeId=localStorage.getItem(ACTIVE_ACCOUNT_KEY),account=Object.values(accounts).find(item=>item.id===activeId);
  if(!account?.biometricEnabled||!await biometricAvailable())return false;
  try{await requestBiometric();storeSession({user:{id:account.id,name:account.name,cpf:account.cpfMasked}});return true;}catch{return false;}
}
function waitForAuthentication() {
  return new Promise(resolve=>{
    const accounts=loadAccounts();let legacy=null;try{legacy=JSON.parse(localStorage.getItem(LEGACY_AUTH_STORAGE_KEY))||null;}catch{}
    const migrationMode=Boolean(!Object.keys(accounts).length&&legacy?.user?.id);let registerMode=migrationMode||!Object.keys(accounts).length;
    const form=document.querySelector('#authForm'),switchButton=document.querySelector('#authSwitch'),submit=document.querySelector('#authSubmit');
    const setMode=value=>{registerMode=migrationMode?true:value;document.querySelector('#authNameField').hidden=!registerMode;document.querySelector('#authConfirmField').hidden=!registerMode;document.querySelector('#authPassword').autocomplete=registerMode?'new-password':'current-password';document.querySelector('#authTitle').textContent=migrationMode?'Proteja seus dados locais':registerMode?'Crie sua conta neste aparelho':'Entre para continuar';document.querySelector('#authCopy').textContent=migrationMode?'Crie uma senha local para manter os dados que já estão neste aparelho.':registerMode?'Esta conta existirá somente neste aparelho e funcionará sem internet.':'Entre na sua conta local. Nenhuma conexão com servidor é necessária.';submit.textContent=migrationMode?'Criar acesso local':registerMode?'Criar conta':'Entrar';switchButton.textContent=registerMode?'Já tenho uma conta':'Ainda não tenho conta';switchButton.hidden=migrationMode;if(migrationMode&&legacy?.user?.name)document.querySelector('#authName').value=legacy.user.name;document.querySelector('#authError').hidden=true;};
    switchButton.onclick=()=>setMode(!registerMode);
    document.querySelector('#authCpf').oninput=event=>{event.target.value=formatCpfInput(event.target.value);};
    form.onsubmit=async event=>{event.preventDefault();const error=document.querySelector('#authError');error.hidden=true;const cpf=document.querySelector('#authCpf').value,password=document.querySelector('#authPassword').value,confirm=document.querySelector('#authConfirm').value;if(!validCpf(cpf)){error.textContent='Informe um CPF válido.';error.hidden=false;return;}if(registerMode&&password!==confirm){error.textContent='As duas senhas precisam ser iguais.';error.hidden=false;return;}submit.disabled=true;submit.textContent=registerMode?'Criando…':'Entrando…';try{const key=await sha256(normalizeCpf(cpf)),current=loadAccounts();let account=current[key];if(registerMode){if(account)throw new Error('Já existe uma conta local com este CPF.');const protectedPassword=await protectPassword(password);account={id:migrationMode?legacy.user.id:crypto.randomUUID(),name:document.querySelector('#authName').value.trim()||'Usuário',cpfMasked:maskCpf(cpf),passwordSalt:protectedPassword.salt,passwordHash:protectedPassword.hash,biometricEnabled:false,createdAt:new Date().toISOString()};current[key]=account;storeAccounts(current);localStorage.removeItem(LEGACY_AUTH_STORAGE_KEY);}else{if(!account)throw new Error('Conta não encontrada neste aparelho.');const protectedPassword=await protectPassword(password,account.passwordSalt);if(protectedPassword.hash!==account.passwordHash)throw new Error('CPF ou senha incorretos.');}const session={user:{id:account.id,name:account.name,cpf:account.cpfMasked}};storeSession(session);localStorage.setItem(ACTIVE_ACCOUNT_KEY,account.id);resolve(true);}catch(failure){error.textContent=failure.message||'Não foi possível abrir a conta.';error.hidden=false;}finally{submit.disabled=false;setMode(registerMode);}};
    setMode(registerMode);showAuth();
  });
}
async function authenticate() { if(await verifyStoredSession())return true;return waitForAuthentication(); }

function isValidEntry(entry) {
  if (!entry || typeof entry !== 'object') return false;
  if (typeof entry.id !== 'string' || !entry.id.trim()) return false;
  if (!['income','expense'].includes(entry.type)) return false;
  if (typeof entry.description !== 'string' || !entry.description.trim()) return false;
  if (!Number.isFinite(Number(entry.value)) || Number(entry.value) <= 0) return false;
  if (typeof entry.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(entry.date) || Number.isNaN(parseDate(entry.date).getTime())) return false;
  if (typeof entry.category !== 'string' || !entry.category.trim()) return false;
  if (!['once','monthly','installments'].includes(entry.recurrence)) return false;
  return entry.recurrence !== 'installments' || (Number.isInteger(Number(entry.installments)) && Number(entry.installments) >= 2 && Number(entry.installments) <= 60);
}
function isValidState(value) {
  if (!value || value.version !== 1 || !Array.isArray(value.entries) || !value.entries.every(isValidEntry)) return false;
  return new Set(value.entries.map(entry=>entry.id)).size === value.entries.length;
}
function readLocalState() {
  try {
    const backup=JSON.parse(localStorage.getItem(scopedKey(BACKUP_STORAGE_KEY)));
    if (isValidState(backup)) return backup;
  } catch {}
  try {
    const saved=JSON.parse(localStorage.getItem(scopedKey(STORAGE_KEY)));
    if (Array.isArray(saved) && saved.every(isValidEntry)) return {version:1,revision:0,updatedAt:null,entries:saved};
  } catch {}
  return null;
}
function readLegacyLocalState() {
  try { const backup=JSON.parse(localStorage.getItem(BACKUP_STORAGE_KEY));if(isValidState(backup))return backup; } catch {}
  try { const saved=JSON.parse(localStorage.getItem(STORAGE_KEY));if(Array.isArray(saved)&&saved.every(isValidEntry))return {version:1,revision:0,updatedAt:null,entries:saved}; } catch {}
  return null;
}
function loadUIState() {
  try { return JSON.parse(localStorage.getItem(scopedKey(UI_STORAGE_KEY))) || {}; }
  catch { return {}; }
}
function parseSavedMonth(value) { const [year,month] = value.split('-').map(Number); return new Date(year,month-1,1); }
function makeState(data=entries,{updatedAt=new Date().toISOString(),revision=currentRevision,confirmedEmpty=emptyStateConfirmed}={}) {
  return {version:1,revision,updatedAt,emptyStateConfirmed:Boolean(confirmedEmpty&&!data.length),entries:data.map(entry=>({...entry})),uiState:{...uiState,draft:collectDraft()}};
}
function storeLocalState(state) {
  localStorage.setItem(scopedKey(STORAGE_KEY),JSON.stringify(state.entries));
  localStorage.setItem(scopedKey(BACKUP_STORAGE_KEY),JSON.stringify(state));
}
function stateFingerprint(state){return JSON.stringify({entries:state?.entries||[],uiState:state?.uiState||{},emptyStateConfirmed:Boolean(state?.emptyStateConfirmed)});}
function queueNativeWrite(state) {
  nativeWriteQueue=nativeWriteQueue.catch(()=>{}).then(()=>writeNativeData(state));
  return nativeWriteQueue;
}
async function saveData({confirmedEmpty=false,waitForPrimary=false}={}) {
  if (!storageReady) return false;
  emptyStateConfirmed=entries.length===0&&(confirmedEmpty||emptyStateConfirmed);
  const nextRevision=currentRevision+1;
  const state=makeState(entries,{revision:nextRevision,confirmedEmpty:emptyStateConfirmed});
  if (!isValidState(state) || (!state.entries.length&&!state.emptyStateConfirmed)) {
    console.warn('Gravação vazia não confirmada foi ignorada.');
    return false;
  }
  const fingerprint=stateFingerprint(state);
  if(fingerprint===lastCommittedFingerprint){if(waitForPrimary)await nativeWriteQueue;return true;}
  currentRevision=nextRevision;
  storeLocalState(state);
  const nativeCommit=queueNativeWrite(state);
  lastCommittedFingerprint=fingerprint;
  nativeCommit.then(committed=>{if(!committed&&lastCommittedFingerprint===fingerprint)lastCommittedFingerprint='';});
  writeDurableData(state);
  writeFileData(state);
  queueAutosave();
  saveStatus('saved','Salvo automaticamente');
  if (waitForPrimary){await nativeCommit;return true;}
  return true;
}
function flushNativeData(){if(storageReady&&window.mybillsDesktop?.saveStateSync){const state=makeState();if(state.entries.length||state.emptyStateConfirmed)window.mybillsDesktop.saveStateSync(accountNamespace,state);}}
function isNativeMobile(){return Boolean(window.Capacitor?.isNativePlatform?.());}
async function writeNativeData(state){
  try{
    if(window.mybillsDesktop?.desktop){await window.mybillsDesktop.saveState(accountNamespace,state);return true;}
    if(isNativeMobile()&&window.Capacitor?.Plugins?.Preferences){
      const preferences=window.Capacitor.Plugins.Preferences;
      const primaryKey=scopedKey(NATIVE_STATE_KEY),backupKey=scopedKey(NATIVE_BACKUP_KEY);
      const previous=await preferences.get({key:primaryKey});
      if(previous?.value){try{const parsed=JSON.parse(previous.value);if(isValidState(parsed)&&stateFingerprint(parsed)!==stateFingerprint(state))await preferences.set({key:backupKey,value:previous.value});}catch{}}
      await preferences.set({key:primaryKey,value:JSON.stringify(state)});
      return true;
    }
  }catch(error){console.warn('Armazenamento nativo indisponível:',error);}
  return false;
}
async function readNativeStates(){
  try{
    if(window.mybillsDesktop?.desktop){const state=await window.mybillsDesktop.loadState(accountNamespace);return isValidState(state)?[state]:[];}
    if(isNativeMobile()&&window.Capacitor?.Plugins?.Preferences){
      const preferences=window.Capacitor.Plugins.Preferences;
      const [primary,backup]=await Promise.all([preferences.get({key:scopedKey(NATIVE_STATE_KEY)}),preferences.get({key:scopedKey(NATIVE_BACKUP_KEY)})]);
      return [primary?.value,backup?.value].map(value=>{try{return value?JSON.parse(value):null;}catch{return null;}}).filter(isValidState);
    }
  }catch(error){console.warn('Leitura nativa indisponível:',error);}
  return [];
}
async function readLegacyNativeStates(){
  try{
    if(window.mybillsDesktop?.desktop){const state=await window.mybillsDesktop.loadState();return isValidState(state)?[state]:[];}
    if(isNativeMobile()&&window.Capacitor?.Plugins?.Preferences){const preferences=window.Capacitor.Plugins.Preferences;const [primary,backup]=await Promise.all([preferences.get({key:NATIVE_STATE_KEY}),preferences.get({key:NATIVE_BACKUP_KEY})]);return [primary?.value,backup?.value].map(value=>{try{return value?JSON.parse(value):null;}catch{return null;}}).filter(isValidState);}
  }catch{}
  return [];
}
function usesLocalServer(){return !isNativeMobile()&&!window.mybillsDesktop?.desktop&&location.protocol==='http:'&&location.port==='4173'&&(location.hostname==='127.0.0.1'||location.hostname==='localhost');}
async function writeFileData(state){
  if(!usesLocalServer())return false;
  try{const response=await fetch('/api/state',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(state),keepalive:true});return response.ok;}
  catch(error){console.warn('Arquivo local indisponível:',error);return false;}
}
async function readFileData(){
  if(!usesLocalServer())return null;
  try{const response=await fetch('/api/state',{cache:'no-store'});if(!response.ok)return null;const saved=await response.json();return saved?.version===1&&Array.isArray(saved.entries)?saved:null;}
  catch{return null;}
}
function openDurableDatabase() {
  return new Promise((resolve,reject)=>{
    if(!window.indexedDB){reject(new Error('IndexedDB indisponível'));return;}
    const request=indexedDB.open(DATABASE_NAME,1);
    request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains(DATABASE_STORE))request.result.createObjectStore(DATABASE_STORE,{keyPath:'key'});};
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
  });
}
async function writeDurableData(state) {
  try {
    const database=await openDurableDatabase();
    await new Promise((resolve,reject)=>{const transaction=database.transaction(DATABASE_STORE,'readwrite');transaction.objectStore(DATABASE_STORE).put({key:`finance:${accountNamespace}`,...state});transaction.oncomplete=resolve;transaction.onerror=()=>reject(transaction.error);});
    database.close();
  } catch (error) { console.warn('Cópia durável indisponível:',error); }
}
async function readDurableData() {
  try {
    const database=await openDurableDatabase();
    const result=await new Promise((resolve,reject)=>{const request=database.transaction(DATABASE_STORE,'readonly').objectStore(DATABASE_STORE).get(`finance:${accountNamespace}`);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    database.close();
    return result;
  } catch { return null; }
}
async function readLegacyDurableData(){
  try{const database=await openDurableDatabase();const result=await new Promise((resolve,reject)=>{const request=database.transaction(DATABASE_STORE,'readonly').objectStore(DATABASE_STORE).get('finance');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});database.close();return result;}catch{return null;}
}
function stateTime(state){const value=Date.parse(state?.updatedAt||'');return Number.isFinite(value)?value:0;}
function withTimeout(promise,milliseconds,fallback){return Promise.race([Promise.resolve(promise),new Promise(resolve=>setTimeout(()=>resolve(fallback),milliseconds))]);}
function chooseBestState(candidates) {
  const valid=candidates.filter(isValidState);
  const nonEmpty=valid.filter(state=>state.entries.length);
  const confirmedEmpty=valid.filter(state=>!state.entries.length&&state.emptyStateConfirmed);
  const newest=states=>states.sort((a,b)=>(Number(b.revision)||0)-(Number(a.revision)||0)||stateTime(b)-stateTime(a))[0]||null;
  const bestNonEmpty=newest(nonEmpty);
  const bestEmpty=newest(confirmedEmpty);
  if(bestNonEmpty&&bestEmpty&&(Number(bestEmpty.revision)||0)>(Number(bestNonEmpty.revision)||0))return bestEmpty;
  return bestNonEmpty||bestEmpty||newest(valid);
}
async function initializeDurableStorage() {
  try { void navigator.storage?.persist?.(); } catch {}
  const candidates=[];
  if(bootstrapState)candidates.push(bootstrapState);
  const nativeStates=await withTimeout(readNativeStates(),2500,[]);candidates.push(...nativeStates);
  const fileState=await withTimeout(readFileData(),2500,null);
  if(isValidState(fileState))candidates.push(fileState);
  const durable=await withTimeout(readDurableData(),1500,null);
  if(isValidState(durable))candidates.push(durable);
  const migrationCompleted=localStorage.getItem(scopedKey(MIGRATION_KEY))==='1';
  if(!migrationCompleted){
    const legacyLocal=readLegacyLocalState();if(isValidState(legacyLocal))candidates.push(legacyLocal);
    const legacyNative=await withTimeout(readLegacyNativeStates(),2500,[]);candidates.push(...legacyNative);
    const legacyDurable=await withTimeout(readLegacyDurableData(),1500,null);if(isValidState(legacyDurable))candidates.push(legacyDurable);
  }
  const selected=chooseBestState(candidates);
  if(selected){
    entries=selected.entries.map(entry=>({...entry}));
    currentRevision=Number(selected.revision)||0;
    emptyStateConfirmed=Boolean(selected.emptyStateConfirmed&&!entries.length);
    if(selected.uiState&&typeof selected.uiState==='object')uiState={...uiState,...selected.uiState};
    storeLocalState({...selected,uiState});
    lastCommittedFingerprint=stateFingerprint({...selected,uiState});
    void writeDurableData({...selected,uiState});
    const nativeBest=chooseBestState(nativeStates);
    if(!nativeBest||JSON.stringify(nativeBest)!==JSON.stringify(selected))await withTimeout(queueNativeWrite({...selected,uiState}),2500,false);
  }else{
    entries=[];currentRevision=0;emptyStateConfirmed=true;
  }
  localStorage.setItem(scopedKey(MIGRATION_KEY),'1');
  storageReady=true;
}
async function logout(){
  persistUIState();await saveData({confirmedEmpty:emptyStateConfirmed,waitForPrimary:true});storeSession(null);localStorage.setItem(SKIP_BIOMETRIC_ONCE_KEY,'1');location.reload();
}
function collectDraft() {
  if (!document.querySelector('#entryModal') || document.querySelector('#entryModal').hidden || document.querySelector('#entryId').value) return uiState.draft || null;
  return { type:document.querySelector('input[name="type"]:checked')?.value || 'expense', description:document.querySelector('#entryDescription').value, value:document.querySelector('#entryValue').value, date:document.querySelector('#entryDate').value, category:document.querySelector('#entryCategory').value, recurrence:document.querySelector('#entryRecurrence').value, installments:document.querySelector('#entryInstallments').value };
}
function loadDraft() { try { return JSON.parse(localStorage.getItem(scopedKey(DRAFT_STORAGE_KEY))) || uiState.draft || null; } catch { return uiState.draft || null; } }
function saveDraftNow() { const form=document.querySelector('#entryForm'); if(!form||document.querySelector('#entryId').value)return; const draft={type:document.querySelector('input[name="type"]:checked')?.value||'expense',description:document.querySelector('#entryDescription').value,value:document.querySelector('#entryValue').value,date:document.querySelector('#entryDate').value,category:document.querySelector('#entryCategory').value,recurrence:document.querySelector('#entryRecurrence').value,installments:document.querySelector('#entryInstallments').value}; uiState.draft=draft; localStorage.setItem(scopedKey(DRAFT_STORAGE_KEY),JSON.stringify(draft)); }
function clearDraft() { localStorage.removeItem(scopedKey(DRAFT_STORAGE_KEY)); uiState.draft=null; const form=document.querySelector('#entryForm'); form.reset(); document.querySelector('#entryId').value=''; document.querySelector('#entryDate').value=dateAt(0,20); document.querySelector('#entryInstallments').value=2; toggleInstallments(); queueAutosave(); document.querySelector('#entryDescription').focus(); toast('Rascunho limpo.'); }
function persistUIState() {
  const simulationType=document.querySelector('#simulationType'), simulationValue=document.querySelector('#simulationValue'), simulationInstallments=document.querySelector('#simulationInstallments'), simulationStart=document.querySelector('#simulationStart');
  uiState={selectedMonth:`${selectedDate.getFullYear()}-${String(selectedDate.getMonth()+1).padStart(2,'0')}`,activeFilter,hiddenValues,theme:document.body.dataset.theme||'dark',view:document.querySelector('.view.active')?.id.replace('View','')||'overview',draft:collectDraft(),simulation:{type:simulationType?.value,value:simulationValue?.value,installments:simulationInstallments?.value,start:simulationStart?.value}};
  localStorage.setItem(scopedKey(UI_STORAGE_KEY),JSON.stringify(uiState));
}
function queueAutosave() {
  clearTimeout(saveTimer); saveTimer=setTimeout(persistUIState,250);
}
function applyTheme(theme) { const selected=theme==='light'?'light':'dark'; document.body.dataset.theme=selected; const title=selected==='dark'?'Ativar modo claro':'Ativar modo escuro'; const button=document.querySelector('#themeToggle'); if(button){button.title=title;button.setAttribute('aria-label',title);} const mobileButton=document.querySelector('#mobileThemeBtn'); if(mobileButton) mobileButton.setAttribute('aria-label',title); }
function money(value) { return new Intl.NumberFormat('pt-BR', { style:'currency', currency:'BRL' }).format(value); }
function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function monthKey(date) { return `${date.getFullYear()}-${date.getMonth()}`; }
function parseDate(dateString) { const [y,m,d] = dateString.split('-').map(Number); return new Date(y,m-1,d); }
function addMonths(date, amount) { return new Date(date.getFullYear(), date.getMonth()+amount, 1); }

function entryOccursIn(entry, monthDate) {
  const start = parseDate(entry.date);
  const startIndex = start.getFullYear()*12 + start.getMonth();
  const targetIndex = monthDate.getFullYear()*12 + monthDate.getMonth();
  const diff = targetIndex - startIndex;
  if (entry.recurrence === 'monthly') return diff >= 0;
  if (entry.recurrence === 'installments') return diff >= 0 && diff < Number(entry.installments || 1);
  return diff === 0;
}
function entriesForMonth(date) { return entries.filter(e => entryOccursIn(e, date)); }
function monthTotals(date) {
  const list = entriesForMonth(date);
  const income = list.filter(e=>e.type==='income').reduce((s,e)=>s+Number(e.value),0);
  const expense = list.filter(e=>e.type==='expense').reduce((s,e)=>s+Number(e.value),0);
  return { income, expense, balance: income-expense, list };
}

function renderOverview() {
  const totals = monthTotals(selectedDate);
  const previous = monthTotals(addMonths(selectedDate,-1));
  document.querySelector('#selectedMonth').textContent = capitalize(selectedDate.toLocaleDateString('pt-BR',{month:'long',year:'numeric'}));
  document.querySelector('#balanceValue').textContent = money(totals.balance);
  const change = previous.balance ? ((totals.balance-previous.balance)/Math.abs(previous.balance))*100 : 0;
  const changeEl = document.querySelector('#balanceChange');
  changeEl.textContent = `${change >= 0 ? '+' : ''}${change.toFixed(0)}%`;
  changeEl.style.color = change >= 0 ? 'var(--lime)' : 'var(--coral)';
  document.querySelector('#incomeValue').textContent = money(totals.income);
  document.querySelector('#expenseValue').textContent = money(totals.expense);
  document.querySelector('#savedValue').textContent = money(totals.balance);
  const incomeCount = totals.list.filter(e=>e.type==='income').length;
  const expenseCount = totals.list.filter(e=>e.type==='expense').length;
  document.querySelector('#incomeCount').textContent = `${incomeCount} ${incomeCount===1?'lançamento':'lançamentos'}`;
  document.querySelector('#expenseCount').textContent = `${expenseCount} ${expenseCount===1?'conta':'contas'}`;
  const rate = totals.income ? (totals.balance/totals.income)*100 : 0;
  document.querySelector('#savedRate').textContent = `${Math.round(rate)}% da receita`;
  const score = Math.max(0,Math.min(100,Math.round(45 + rate*1.7)));
  document.querySelector('#scoreValue').textContent = score;
  document.querySelector('#scoreRing').style.setProperty('--score',`${score*3.6}deg`);
  document.querySelector('#scoreLabel').textContent = score >= 75 ? 'Excelente' : score >= 55 ? 'Saudável' : score >= 35 ? 'Atenção' : 'Em risco';
  renderCashflow(); renderUpcoming(); renderInsight(totals,rate);
}

function renderCashflow() {
  const months = Array.from({length:6},(_,i)=>addMonths(selectedDate,i));
  const values = months.map(monthTotals); const max = Math.max(...values.flatMap(v=>[v.income,v.expense]),1);
  document.querySelector('#cashflowChart').innerHTML = values.map((v,i)=>`<div class="chart-group"><div class="bar income" style="height:${Math.max(2,v.income/max*100)}%" title="Receitas: ${money(v.income)}"></div><div class="bar expense" style="height:${Math.max(2,v.expense/max*100)}%" title="Despesas: ${money(v.expense)}"></div><label>${MONTHS[months[i].getMonth()]}</label></div>`).join('');
}
function renderUpcoming() {
  const list = entriesForMonth(selectedDate).filter(e=>e.type==='expense').sort((a,b)=>parseDate(a.date).getDate()-parseDate(b.date).getDate()).slice(0,4);
  document.querySelector('#upcomingBills').innerHTML = list.length ? list.map(e=>{ const day=parseDate(e.date).getDate(); const overdue=monthKey(selectedDate)===monthKey(now)&&day<now.getDate(); return `<div class="bill-row"><span class="bill-icon">${categoryIcons[e.category]||'•'}</span><div><strong>${escapeHtml(e.description)}</strong><small>${overdue?'Venceu':'Vence'} dia ${String(day).padStart(2,'0')} · ${e.category}</small></div><span class="bill-value ${overdue?'overdue':''}">${money(e.value)}</span></div>`; }).join('') : '<div class="empty-state"><p>Nenhuma conta prevista.</p></div>';
}
function renderInsight(totals,rate) {
  let text;
  if (!totals.income) text = 'Cadastre uma receita para calcular sua margem mensal e receber uma leitura mais útil.';
  else if (totals.balance < 0) text = `As despesas superam a renda em ${money(Math.abs(totals.balance))}. Revise os maiores gastos antes do fim do mês.`;
  else if (rate >= 30) text = `Você mantém ${Math.round(rate)}% da renda livre. É uma margem forte para formar reserva ou antecipar objetivos.`;
  else text = `Sua margem livre é de ${Math.round(rate)}%. Uma redução de 10% nas despesas ampliaria sua folga em ${money(totals.expense*.1)}.`;
  document.querySelector('#insightText').textContent = text;
}

function renderTransactions() {
  let filtered = activeFilter==='all' ? entries : entries.filter(e=>e.type===activeFilter);
  filtered = [...filtered].sort((a,b)=>parseDate(b.date)-parseDate(a.date));
  const body = document.querySelector('#transactionTable');
  document.querySelector('#transactionEmpty').hidden = filtered.length>0;
  body.innerHTML = filtered.map(e=>`<tr><td>${escapeHtml(e.description)}</td><td><span class="category-tag">${e.category}</span></td><td>${parseDate(e.date).toLocaleDateString('pt-BR',{day:'2-digit',month:'short',year:'numeric'})}</td><td><span class="recurrence-tag">${e.recurrence==='monthly'?'Mensal':e.recurrence==='installments'?`${e.installments} parcelas`:'Único'}</span></td><td class="right ${e.type==='income'?'amount-income':'amount-expense'}">${e.type==='income'?'+':'−'} ${money(e.value)}</td><td class="row-actions"><button data-edit="${e.id}" title="Editar">✎</button><button data-delete="${e.id}" title="Excluir">×</button></td></tr>`).join('');
}

function monthlySeries(count=12) { return Array.from({length:count},(_,i)=>{ const date=addMonths(selectedDate,i); return {date,...monthTotals(date)}; }); }
function cumulative(series) { let sum=0; return series.map(item=>(sum+=item.balance)); }
function renderProjection() {
  const baseSeries=monthlySeries(); const baseCum=cumulative(baseSeries);
  const type=document.querySelector('#simulationType').value; const total=Number(document.querySelector('#simulationValue').value)||0;
  const installments=Number(document.querySelector('#simulationInstallments').value)||1; const monthly=total/installments;
  const startRaw=document.querySelector('#simulationStart').value; const [sy,sm]=(startRaw||`${selectedDate.getFullYear()}-${String(selectedDate.getMonth()+1).padStart(2,'0')}`).split('-').map(Number); const startIndex=sy*12+(sm-1);
  let simSum=0; const simCum=baseSeries.map((item,i)=>{ const idx=item.date.getFullYear()*12+item.date.getMonth(); const applies=idx>=startIndex&&idx<startIndex+installments; simSum += item.balance + (applies?(type==='income'?monthly:-monthly):0); return simSum; });
  document.querySelector('#installmentsOutput').textContent=`${installments}x`;
  document.querySelector('#monthlyImpact').textContent=money(monthly);
  document.querySelector('#projectionFinal').textContent=money(simCum.at(-1)); const delta=simCum.at(-1)-baseCum.at(-1);
  document.querySelector('#projectionDelta').textContent=`${delta>=0?'+':''}${money(delta)} vs. cenário atual`;
  renderLineChart(baseCum,simCum);
  document.querySelector('#projectionMonths').innerHTML=baseSeries.slice(0,6).map((item,i)=>`<div class="projection-month"><span>${MONTHS[item.date.getMonth()]} ${String(item.date.getFullYear()).slice(-2)}</span><strong>${money(simCum[i])}</strong><small>${money(item.income)} entra · ${money(item.expense)} sai</small></div>`).join('');
}
function renderLineChart(base,sim) {
  const all=[...base,...sim,0], min=Math.min(...all), max=Math.max(...all), range=max-min||1, w=700,h=170,pad=8;
  const points=arr=>arr.map((v,i)=>`${pad+i*(w-pad*2)/(arr.length-1)},${h-pad-(v-min)/range*(h-pad*2)}`).join(' ');
  const scenario=points(sim), basePts=points(base); const area=`${scenario} ${w-pad},${h-pad} ${pad},${h-pad}`;
  document.querySelector('#projectionChart').innerHTML=`<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><defs><linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffb20f" stop-opacity=".22"/><stop offset="1" stop-color="#ffb20f" stop-opacity="0"/></linearGradient></defs>${[.25,.5,.75].map(r=>`<line class="chart-grid-line" x1="0" x2="${w}" y1="${h*r}" y2="${h*r}"/>`).join('')}<polygon class="area-path" points="${area}"/><polyline class="base-path" points="${basePts}"/><polyline class="scenario-path" points="${scenario}"/></svg>`;
}

function recurrenceDetail(entry) {
  if (entry.recurrence === 'monthly') return 'Repete todo mês';
  if (entry.recurrence === 'installments') {
    const start = parseDate(entry.date);
    const position = selectedDate.getFullYear()*12 + selectedDate.getMonth() - (start.getFullYear()*12 + start.getMonth()) + 1;
    return `Parcela ${position} de ${Number(entry.installments || 1)}`;
  }
  return 'Lançamento único';
}

function detailRows(list) {
  return [...list].sort((a,b)=>parseDate(a.date).getDate()-parseDate(b.date).getDate()).map(entry=>{
    const day=String(parseDate(entry.date).getDate()).padStart(2,'0');
    const sign=entry.type==='income'?'+':'−';
    return `<div class="detail-row ${entry.type}"><span class="detail-row-icon">${categoryIcons[entry.category]||'•'}</span><div class="detail-row-main"><strong>${escapeHtml(entry.description)}</strong><small>${escapeHtml(entry.category)} · dia ${day} · ${recurrenceDetail(entry)}</small></div><span class="detail-row-value">${sign} ${money(Number(entry.value))}</span></div>`;
  }).join('');
}

function detailSection(title,list) {
  if (!list.length) return '';
  return `<div class="detail-section-title"><span>${title}</span><b>${list.length} ${list.length===1?'item':'itens'}</b></div>${detailRows(list)}`;
}

function openMetricDetail(type, trigger) {
  const totals=monthTotals(selectedDate);
  const incomes=totals.list.filter(entry=>entry.type==='income');
  const expenses=totals.list.filter(entry=>entry.type==='expense');
  const config={
    income:{title:'Detalhes das receitas',label:'Total recebido',total:totals.income,list:incomes,section:'Valores que entram'},
    expense:{title:'Detalhes das despesas',label:'Total a pagar',total:totals.expense,list:expenses,section:'Valores que saem'},
    saved:{title:'Como o valor livre é calculado',label:'Valor livre no mês',total:totals.balance,list:totals.list,section:''}
  }[type];
  if (!config) return;
  detailTrigger=trigger||document.activeElement;
  document.querySelector('#detailTitle').textContent=config.title;
  document.querySelector('#detailTotalLabel').textContent=config.label;
  document.querySelector('#detailTotal').textContent=money(config.total);
  document.querySelector('#detailPeriod').textContent=selectedDate.toLocaleDateString('pt-BR',{month:'long',year:'numeric'});
  const formula=document.querySelector('#detailFormula');
  formula.hidden=type!=='saved';
  formula.innerHTML=type==='saved'?`<div class="formula-part income"><span>Receitas</span><strong>${money(totals.income)}</strong></div><span class="formula-symbol">−</span><div class="formula-part expense"><span>Despesas</span><strong>${money(totals.expense)}</strong></div><span class="formula-symbol">=</span><div class="formula-part saved"><span>Valor livre</span><strong>${money(totals.balance)}</strong></div>`:'';
  const content=document.querySelector('#detailContent');
  if (type==='saved' && totals.list.length) content.innerHTML=detailSection('Receitas consideradas',incomes)+detailSection('Despesas consideradas',expenses);
  else if (config.list.length) content.innerHTML=detailSection(config.section,config.list);
  else content.innerHTML=`<div class="detail-empty"><div><span>◇</span><strong>Nenhum valor neste mês</strong><p>Os lançamentos adicionados para este período aparecerão aqui.</p></div></div>`;
  document.querySelector('#metricDetail').hidden=false;
  setModalOpen(true);
  setTimeout(()=>document.querySelector('#closeDetail').focus(),0);
}

function closeMetricDetail() {
  document.querySelector('#metricDetail').hidden=true;
  setModalOpen(false);
  detailTrigger?.focus();
}
function setModalOpen(open){document.body.classList.toggle('modal-open',open);document.documentElement.classList.toggle('modal-open',open);}
function openMobileData(){document.querySelector('#mobileDataModal').hidden=false;setModalOpen(true);setTimeout(()=>document.querySelector('#closeMobileData').focus(),0);}
function closeMobileData(){document.querySelector('#mobileDataModal').hidden=true;setModalOpen(false);document.querySelector('#mobileDataBtn').focus();}

function switchView(name) {
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active')); document.querySelector(`#${name}View`).classList.add('active');
  document.querySelectorAll('.nav-item[data-view]').forEach(n=>n.classList.toggle('active',n.dataset.view===name));
  const titles={overview:'Sua vida financeira, em perspectiva.',transactions:'Tudo que entra e sai.',projection:'Escolhas mais conscientes.'};
  document.querySelector('#pageTitle').innerHTML=titles[name]; if(name==='transactions')renderTransactions(); if(name==='projection')renderProjection(); queueAutosave();
}
function openModal(entry=null) {
  document.querySelector('#entryForm').reset(); document.querySelector('#entryId').value=entry?.id||''; document.querySelector('#modalTitle').textContent=entry?'Editar lançamento':'Novo lançamento';
  if(entry){ document.querySelector(`input[name="type"][value="${entry.type}"]`).checked=true; document.querySelector('#entryDescription').value=entry.description; document.querySelector('#entryValue').value=entry.value; document.querySelector('#entryDate').value=entry.date; document.querySelector('#entryCategory').value=entry.category; document.querySelector('#entryRecurrence').value=entry.recurrence; document.querySelector('#entryInstallments').value=entry.installments||2; }
  else if(loadDraft()){ const draft=loadDraft(); document.querySelector(`input[name="type"][value="${draft.type||'expense'}"]`).checked=true; document.querySelector('#entryDescription').value=draft.description||''; document.querySelector('#entryValue').value=draft.value||''; document.querySelector('#entryDate').value=draft.date||dateAt(0,20); document.querySelector('#entryCategory').value=draft.category||'Moradia'; document.querySelector('#entryRecurrence').value=draft.recurrence||'once'; document.querySelector('#entryInstallments').value=draft.installments||2; }
  else document.querySelector('#entryDate').value=dateAt(0,20);
  document.querySelector('#clearDraftBtn').hidden=Boolean(entry); toggleInstallments(); document.querySelector('#entryModal').hidden=false; setModalOpen(true); setTimeout(()=>document.querySelector('#entryDescription').focus(),50);
}
function closeModal(){const modal=document.querySelector('#entryModal');if(!modal.hidden&&!document.querySelector('#entryId').value)saveDraftNow();modal.hidden=true;setModalOpen(false);queueAutosave();}
function toggleInstallments(){document.querySelector('#installmentsField').hidden=document.querySelector('#entryRecurrence').value!=='installments';}
function toast(message){const el=document.querySelector('#toast');el.textContent=message;el.classList.add('show');setTimeout(()=>el.classList.remove('show'),2200);}
function escapeHtml(value){const div=document.createElement('div');div.textContent=value;return div.innerHTML;}
function createBackup(){const state=makeState();return {format:'mybills',formatVersion:2,appVersion:'0.6.0',exportedAt:new Date().toISOString(),...state,state};}
function stateFromImport(value){
  let state=null;
  if(Array.isArray(value))state={version:1,revision:0,entries:value};
  else if(value?.format==='mybills'){
    if(value.formatVersion===2)state=value.state||value;
    else if(value.formatVersion===undefined||value.formatVersion===1)state=value;
    else throw new Error('Versão de backup ainda não suportada.');
  } else if(value?.version===1)state=value;
  if(!isValidState(state))throw new Error('A transferência não contém lançamentos válidos.');
  return {version:1,revision:Number(state.revision)||0,updatedAt:state.updatedAt,entries:state.entries.map(entry=>({...entry})),uiState:state.uiState&&typeof state.uiState==='object'?state.uiState:null,emptyStateConfirmed:Boolean(state.emptyStateConfirmed&&!state.entries.length)};
}
async function applyImportedBackup(value){
  const imported=stateFromImport(typeof value==='string'?JSON.parse(value):value);
  const question=`Foram recebidos ${imported.entries.length} ${imported.entries.length===1?'lançamento':'lançamentos'}. Substituir os dados atuais? Uma cópia do estado anterior será mantida.`;
  if(!confirm(question))return false;
  entries=imported.entries;
  currentRevision=Math.max(currentRevision,imported.revision);
  emptyStateConfirmed=!entries.length;
  if(imported.uiState){uiState={...uiState,...imported.uiState};localStorage.setItem(scopedKey(UI_STORAGE_KEY),JSON.stringify(uiState));}
  const committed=await saveData({confirmedEmpty:!entries.length,waitForPrimary:true});
  if(!committed)throw new Error('O armazenamento não confirmou a importação.');
  document.querySelector('#mobileDataModal').hidden=true;
  document.querySelector('#transferModal').hidden=true;
  setModalOpen(false);
  renderOverview();renderTransactions();renderProjection();
  toast('Dados recebidos com segurança.');
  return true;
}
function encodeTransferBytes(bytes){let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
function decodeTransferBytes(value){const normalized=value.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(value.length/4)*4,'=');const binary=atob(normalized);return Uint8Array.from(binary,char=>char.charCodeAt(0));}
async function transferCryptoKey(token){return crypto.subtle.importKey('raw',await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token)),{name:'AES-GCM'},false,['encrypt','decrypt']);}
async function encryptTransferPayload(value,token){const iv=crypto.getRandomValues(new Uint8Array(12)),encrypted=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},await transferCryptoKey(token),new TextEncoder().encode(JSON.stringify(value))));return {v:1,iv:encodeTransferBytes(iv),data:encodeTransferBytes(encrypted.slice(0,-16)),tag:encodeTransferBytes(encrypted.slice(-16))};}
async function decryptTransferPayload(value,token){const ciphertext=decodeTransferBytes(value.data),tag=decodeTransferBytes(value.tag),combined=new Uint8Array(ciphertext.length+tag.length);combined.set(ciphertext);combined.set(tag,ciphertext.length);const decrypted=await crypto.subtle.decrypt({name:'AES-GCM',iv:decodeTransferBytes(value.iv)},await transferCryptoKey(token),combined);return JSON.parse(new TextDecoder().decode(decrypted));}
function showTransferModal(result,direction){const modal=document.querySelector('#transferModal'),qrWrap=document.querySelector('#transferQrWrap'),codeWrap=document.querySelector('#transferCodeWrap');qrWrap.hidden=direction!=='receive';codeWrap.hidden=direction!=='send';if(result.qrDataUrl)document.querySelector('#transferQr').src=result.qrDataUrl;if(result.code)document.querySelector('#transferCode').textContent=`${result.code.slice(0,3)} ${result.code.slice(3)}`;document.querySelector('#transferTitle').textContent=direction==='receive'?'Receber do celular':'Enviar ao celular';document.querySelector('#transferMessage').textContent=direction==='receive'?'No celular, abra Dados, toque em “Enviar ao computador” e leia este QR Code.':'No celular, abra Dados, digite este código e toque em “Receber do computador”.';modal.hidden=false;setModalOpen(true);}
async function closeTransferModal(){document.querySelector('#transferModal').hidden=true;setModalOpen(false);await window.mybillsDesktop?.cancelLocalTransfer?.();}
async function startDesktopTransfer(direction){if(!window.mybillsDesktop?.desktop){toast('Esta ação deve ser iniciada no computador.');return;}try{const result=await window.mybillsDesktop.startLocalTransfer(direction,direction==='send'?createBackup():null);showTransferModal(result,direction);}catch(error){console.warn('Transferência local indisponível:',error);toast(error.message||'Não foi possível iniciar a transferência.');}}
async function mobileSendToComputer(){
  const scanner=window.Capacitor?.Plugins?.CapacitorBarcodeScanner;if(!isNativeMobile()||!scanner){toast('Leitura de QR Code indisponível neste aparelho.');return;}
  try{const result=await scanner.scanBarcode({hint:0,scanInstructions:'Aponte para o QR Code exibido no MyBills do computador',scanButton:false,cameraDirection:1,scanOrientation:3,android:{scanningLibrary:'zxing'}});const connection=JSON.parse(result.ScanResult||'{}');if(connection.kind!=='mybills-local-transfer'||connection.direction!=='receive'||Date.now()>Number(connection.expiresAt))throw new Error('Este QR Code não é válido ou expirou.');const encrypted=await encryptTransferPayload(createBackup(),connection.token),hosts=Array.isArray(connection.hosts)&&connection.hosts.length?connection.hosts:[connection.host];let sent=false;for(const host of hosts){try{const response=await fetch(`http://${host}:${connection.port}/mybills/push?token=${encodeURIComponent(connection.token)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(encrypted)});if(response.ok){sent=true;break;}}catch{}}if(!sent)throw new Error('O computador não foi encontrado na rede Wi-Fi.');closeMobileData();toast('Dados enviados ao computador.');}catch(error){if(/cancel/i.test(String(error?.message||error)))return;console.warn('Falha ao enviar por QR Code:',error);toast(error.message||'Não foi possível enviar os dados.');}
}
async function mobileReceiveFromComputer(){
  const input=document.querySelector('#mobileTransferCode'),code=input.value.replace(/\D/g,'');if(!/^\d{6}$/.test(code)){toast('Digite o código de seis números.');input.focus();return;}
  const discovery=window.Capacitor?.Plugins?.LocalTransfer;if(!isNativeMobile()||!discovery){toast('Conexão local indisponível neste aparelho.');return;}
  try{toast('Procurando o computador…');const connection=await discovery.discover({code});const response=await fetch(`http://${connection.host}:${connection.port}/mybills/pull?token=${encodeURIComponent(connection.token)}`,{cache:'no-store'});if(!response.ok)throw new Error('O código expirou ou já foi usado.');const encrypted=await response.json(),backup=await decryptTransferPayload(encrypted,connection.token);await applyImportedBackup(backup);input.value='';}catch(error){console.warn('Falha ao receber pelo código:',error);toast(error.message||'Não foi possível encontrar o computador.');}
}
function currentAccountRecord(){const accounts=loadAccounts();for(const [key,account] of Object.entries(accounts))if(account.id===localSession?.user?.id)return {accounts,key,account};return null;}
async function refreshBiometricButton(){const button=document.querySelector('#mobileBiometricBtn');if(!button)return;const available=await biometricAvailable();button.hidden=!available;if(!available)return;const enabled=Boolean(currentAccountRecord()?.account.biometricEnabled);button.querySelector('strong').textContent=enabled?'Desativar biometria':'Ativar biometria';button.querySelector('small').textContent=enabled?'Exigir CPF e senha na próxima abertura':'Desbloquear com digital ou reconhecimento facial';}
async function toggleBiometric(){const record=currentAccountRecord();if(!record)return;try{await requestBiometric(record.account.biometricEnabled?'Confirme para desativar a biometria':'Confirme para ativar a biometria');record.account.biometricEnabled=!record.account.biometricEnabled;record.accounts[record.key]=record.account;storeAccounts(record.accounts);localStorage.setItem(ACTIVE_ACCOUNT_KEY,record.account.id);await refreshBiometricButton();toast(record.account.biometricEnabled?'Biometria ativada neste celular.':'Biometria desativada.');}catch(error){if(!/cancel/i.test(String(error?.message||error)))toast('Não foi possível confirmar sua biometria.');}}

function setupEvents(){
  document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>switchView(b.dataset.view)));
  document.querySelectorAll('[data-go]').forEach(b=>b.addEventListener('click',()=>switchView(b.dataset.go)));
  document.querySelectorAll('[data-metric]').forEach(card=>{
    card.addEventListener('click',()=>openMetricDetail(card.dataset.metric,card));
    card.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();openMetricDetail(card.dataset.metric,card);}});
  });
  document.querySelector('#closeDetail').addEventListener('click',closeMetricDetail);
  document.querySelector('#prevMonth').addEventListener('click',()=>{selectedDate=addMonths(selectedDate,-1);renderOverview();});
  document.querySelector('#nextMonth').addEventListener('click',()=>{selectedDate=addMonths(selectedDate,1);renderOverview();});
  document.querySelector('#newEntryBtn').addEventListener('click',()=>openModal());
  document.querySelector('#mobileNewEntryBtn').addEventListener('click',()=>openModal());
  document.querySelector('#mobileHeroAddBtn').addEventListener('click',()=>openModal());
  document.querySelector('#mobileDataBtn').addEventListener('click',openMobileData);
  document.querySelector('#closeMobileData').addEventListener('click',closeMobileData);
  document.querySelector('#mobileExportBtn').addEventListener('click',mobileSendToComputer);
  document.querySelector('#mobileImportBtn').addEventListener('click',mobileReceiveFromComputer);
  document.querySelector('#mobileTransferCode').addEventListener('input',event=>{event.target.value=event.target.value.replace(/\D/g,'').slice(0,6);});
  document.querySelector('#mobileBiometricBtn').addEventListener('click',toggleBiometric);
  document.querySelector('#mobileThemeBtn').addEventListener('click',()=>{applyTheme(document.body.dataset.theme==='dark'?'light':'dark');queueAutosave();});
  document.querySelector('#logoutBtn').addEventListener('click',logout);
  document.querySelector('#mobileLogoutBtn').addEventListener('click',logout);
  document.querySelector('#themeToggle').addEventListener('click',()=>{applyTheme(document.body.dataset.theme==='dark'?'light':'dark');queueAutosave();});
  document.querySelector('#closeModal').addEventListener('click',closeModal);
  document.querySelector('#entryRecurrence').addEventListener('change',toggleInstallments);
  document.querySelector('#entryForm').addEventListener('input',saveDraftNow); document.querySelector('#entryForm').addEventListener('change',saveDraftNow); document.querySelector('#clearDraftBtn').addEventListener('click',clearDraft);
  document.querySelector('#entryForm').addEventListener('submit',async e=>{e.preventDefault();const id=document.querySelector('#entryId').value;const entry={id:id||crypto.randomUUID(),type:new FormData(e.target).get('type'),description:document.querySelector('#entryDescription').value.trim(),value:Number(document.querySelector('#entryValue').value),date:document.querySelector('#entryDate').value,category:document.querySelector('#entryCategory').value,recurrence:document.querySelector('#entryRecurrence').value,installments:Number(document.querySelector('#entryInstallments').value)}; if(!isValidEntry(entry)){toast('Confira os dados do lançamento.');return;} if(id)entries=entries.map(item=>item.id===id?entry:item);else entries.push(entry);emptyStateConfirmed=false;uiState.draft=null;localStorage.removeItem(scopedKey(DRAFT_STORAGE_KEY));const committed=await saveData({waitForPrimary:true});document.querySelector('#entryModal').hidden=true;setModalOpen(false);renderOverview();renderTransactions();renderProjection();toast(committed?(id?'Lançamento atualizado.':'Lançamento adicionado.'):'Lançamento mantido; faça um backup por segurança.');});
  document.querySelector('#transactionFilters').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;activeFilter=b.dataset.filter;document.querySelectorAll('#transactionFilters button').forEach(x=>x.classList.toggle('active',x===b));renderTransactions();});
  document.querySelector('#transactionTable').addEventListener('click',async e=>{const edit=e.target.closest('[data-edit]'),del=e.target.closest('[data-delete]');if(edit)openModal(entries.find(x=>x.id===edit.dataset.edit));if(del){entries=entries.filter(x=>x.id!==del.dataset.delete);await saveData({confirmedEmpty:entries.length===0,waitForPrimary:true});renderTransactions();renderOverview();toast('Lançamento excluído.');}});
  ['simulationType','simulationValue','simulationInstallments','simulationStart'].forEach(id=>document.querySelector(`#${id}`).addEventListener('input',renderProjection));
  document.querySelector('#toggleBalance').addEventListener('click',()=>{hiddenValues=!hiddenValues;document.body.classList.toggle('hidden-values',hiddenValues);document.querySelector('#toggleBalance').textContent=hiddenValues?'○':'◉';});
  document.querySelector('#exportBtn').addEventListener('click',()=>startDesktopTransfer('send'));
  document.querySelector('#importBtn').addEventListener('click',()=>startDesktopTransfer('receive'));
  document.querySelector('#closeTransferModal').addEventListener('click',closeTransferModal);
  if(window.mybillsDesktop?.onTransferReceived)window.mybillsDesktop.onTransferReceived(async value=>{try{await applyImportedBackup(value);}catch(error){console.warn('Falha ao receber dados do celular:',error);toast('Os dados recebidos não são válidos.');}});
  document.querySelector('#resetBtn').addEventListener('click',async()=>{if(confirm('Apagar todos os lançamentos? Uma cópia anterior será mantida para recuperação.')){entries=[];emptyStateConfirmed=true;uiState.draft=null;localStorage.removeItem(scopedKey(DRAFT_STORAGE_KEY));await saveData({confirmedEmpty:true,waitForPrimary:true});renderOverview();renderTransactions();renderProjection();toast('Todos os dados foram apagados.');}});
  document.addEventListener('input',queueAutosave); document.addEventListener('change',queueAutosave); document.addEventListener('click',queueAutosave);
  document.addEventListener('visibilitychange',async()=>{if(document.visibilityState==='hidden'){persistUIState();await saveData({confirmedEmpty:emptyStateConfirmed,waitForPrimary:true});}});
  window.addEventListener('beforeunload',()=>{persistUIState();flushNativeData();if(!window.mybillsDesktop?.desktop)void saveData({confirmedEmpty:emptyStateConfirmed});});
}

async function init(){
  document.body.classList.add('storage-loading');
  await authenticate();
  accountNamespace=localSession.user.id;
  bootstrapState=readLocalState();entries=bootstrapState?.entries?.map(entry=>({...entry}))||[];uiState=loadUIState();currentRevision=Number(bootstrapState?.revision)||0;emptyStateConfirmed=Boolean(bootstrapState?.emptyStateConfirmed&&!entries.length);lastCommittedFingerprint=bootstrapState?stateFingerprint(bootstrapState):'';
  await initializeDurableStorage();
  selectedDate=uiState.selectedMonth ? parseSavedMonth(uiState.selectedMonth) : new Date(now.getFullYear(), now.getMonth(), 1);
  activeFilter=uiState.activeFilter||'all';
  hiddenValues=Boolean(uiState.hiddenValues);
  applyTheme(uiState.theme||'dark');
  document.querySelector('#todayLabel').textContent=capitalize(now.toLocaleDateString('pt-BR',{weekday:'long',day:'2-digit',month:'long'}));
  document.querySelector('#pageTitle').innerHTML='Seu dinheiro, <span>com clareza.</span>';
  const simulation=uiState.simulation||{}; document.querySelector('#simulationType').value=simulation.type||'expense'; document.querySelector('#simulationValue').value=simulation.value||2400; document.querySelector('#simulationInstallments').value=simulation.installments||6; document.querySelector('#simulationStart').value=simulation.start||`${selectedDate.getFullYear()}-${String(selectedDate.getMonth()+1).padStart(2,'0')}`;
  document.body.classList.toggle('hidden-values',hiddenValues); document.querySelector('#toggleBalance').textContent=hiddenValues?'○':'◉'; document.querySelectorAll('#transactionFilters button').forEach(button=>button.classList.toggle('active',button.dataset.filter===activeFilter));
  setupEvents();renderOverview();renderTransactions();renderProjection();switchView(uiState.view||'overview');persistUIState();hideAuth();document.body.classList.remove('storage-loading');saveStatus('saved','Salvo automaticamente');void refreshBiometricButton();
  if(usesLocalServer())setInterval(()=>fetch('/api/ping',{cache:'no-store'}).catch(()=>{}),30000);
  if(isNativeMobile()&&window.Capacitor?.Plugins?.App)window.Capacitor.Plugins.App.addListener('appStateChange',async state=>{if(!state.isActive){persistUIState();await saveData({confirmedEmpty:emptyStateConfirmed,waitForPrimary:true});}});
}
init().catch(error=>{console.error('Falha ao iniciar o MyBills:',error);document.body.classList.remove('storage-loading');showAuth('Não foi possível abrir seus dados locais. Feche e abra o aplicativo novamente.');});
