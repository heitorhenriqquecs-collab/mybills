# MyBills Server Host para Windows

Este é o modo em que o computador do proprietário guarda as contas e os dados. O Android acessa o PC pelo túnel HTTPS `https://mybills.portalsgi.dev.br`.

O fluxo replica o modelo do MangueBeat:

- supervisor oculto verifica o servidor a cada 15 segundos;
- duas falhas locais consecutivas provocam reinício do servidor;
- três falhas públicas consecutivas provocam reinício do túnel;
- verificador independente do Agendador do Windows roda a cada cinco minutos;
- atalho na Inicialização restaura o supervisor após o login;
- ícone na bandeja mostra verde quando servidor e acesso externo estão funcionando;
- cópia criptografada do banco é criada a cada duas horas em `OneDrive\MyBills-Backups`.

O segredo do host também é copiado para essa pasta em formato DPAPI, protegido pela conta do Windows. Não compartilhe esse arquivo.

Nesta máquina, os componentes executáveis são instalados em `D:\MyBills-Server-Host`, seguindo o padrão aceito pelo Agendador do MangueBeat. Se não houver unidade D:, é usado `%LOCALAPPDATA%\MyBills\ServerHost`. Os dados permanecem sempre separados em `%LOCALAPPDATA%\MyBills\Server\Data` e não são removidos em atualizações.

Enquanto o PC estiver desligado, suspenso ou sem internet, o aplicativo do celular continua com a cópia offline, mas não consegue sincronizar até o PC voltar.
