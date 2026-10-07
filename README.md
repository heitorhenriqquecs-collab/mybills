# mybills

Aplicativo de planejamento financeiro pessoal para Windows e Android. Cada aparelho guarda contas e dados localmente, sem servidor central e sem depender de internet.

## Versão web

A versão web pode ser testada em [heitt.portalsgi.dev.br/mybills](https://heitt.portalsgi.dev.br/mybills/). Os dados permanecem no próprio navegador do usuário.

## Executar em desenvolvimento

```powershell
npm install
npm start
```

Antes de enviar alterações, valide a sintaxe dos arquivos JavaScript e atualize a versão web:

```powershell
npm run check
```

## Aplicativos offline-first

O MyBills possui agora dois alvos nativos:

- Windows portátil com Electron, independente do navegador;
- Android com Capacitor, distribuído como APK e compatível com Android 8 ou superior.

Os instaláveis gerados ficam em `releases/`. A transferência entre Windows e Android é direta pela rede Wi-Fi local: QR Code do celular para o computador e código de seis números do computador para o celular.

## Transferência direta

O computador abre uma conexão local temporária somente quando o usuário inicia uma transferência. A sessão expira em cinco minutos, é encerrada depois do uso e o conteúdo trafega criptografado com AES-256-GCM. Nenhum dado passa pela internet ou por um serviço externo.

## Aplicativo local no Windows

Nesta máquina, o mybills é aberto por um atalho próprio na Área de Trabalho e no menu Iniciar. O atalho aponta para a versão portátil do Electron e não depende do Microsoft Edge.

Os dados locais de cada conta ficam em `%LOCALAPPDATA%\MyBills\Data\Accounts\<conta>\state.json`, com escrita atômica, cópia de segurança e histórico de recuperação. O estado antigo é preservado e migrado para a primeira conta usada no aparelho.

## Android

```powershell
npm run mobile:apk
```

O comando atualiza os arquivos web offline, sincroniza o projeto Capacitor e gera o APK em `android/app/build/outputs/apk/debug/app-debug.apk`.

## Gerar instalador para distribuição

```powershell
npm run make
```

O instalador será criado dentro da pasta `out/make`. Para funcionar em computadores com política corporativa, ele deve ser assinado com um certificado confiável antes da distribuição.

> O instalador do protótipo ainda não possui assinatura digital. Por isso, o Windows pode exibir um aviso de segurança ao abri-lo. A assinatura deve ser adicionada antes de distribuir publicamente.

## Recursos

- receitas, despesas, contas recorrentes e parceladas;
- visão mensal com indicador de saúde financeira;
- projeção automática dos próximos meses;
- simulador de compra parcelada ou renda extra;
- transferência direta por QR Code e código temporário, sem arquivos;
- cadastro e login locais com CPF e senha protegida por PBKDF2;
- desbloqueio por biometria ou credencial do aparelho no Android;
- salvamento automático de lançamentos, rascunhos, filtros, simulações e preferências de tela;
- temas claro e escuro, com a preferência salva automaticamente;
- primeiro acesso totalmente vazio, sem dados demonstrativos.

O aplicativo começa sem lançamentos. Antes de aceitar alterações, ele aguarda o carregamento nativo; estados vazios acidentais são rejeitados e cada lançamento é confirmado no armazenamento local antes de a tela informar sucesso.
