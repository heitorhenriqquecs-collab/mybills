# Servidor MyBills Cloud

Servidor HTTP sem dependências externas para autenticação e sincronização do protótipo.

## Host principal deste projeto

Neste computador, o servidor é mantido pelo pacote `windows-host`, com supervisor, túnel HTTPS, ícone de bandeja, recuperação automática, verificador agendado e backups. O endereço usado pelos aplicativos é `https://mybills.portalsgi.dev.br`.

## Variáveis obrigatórias em produção

- `MYBILLS_JWT_SECRET`: segredo longo e aleatório; também protege a criptografia dos dados.
- `MYBILLS_DATA_DIR`: diretório persistente montado pela hospedagem, por exemplo `/data`.
- `MYBILLS_ALLOWED_ORIGINS`: opcional; lista separada por vírgulas das origens web autorizadas.
- `PORT`: porta fornecida pela hospedagem; o padrão é `8787`.

O segredo não pode ser trocado depois que existirem contas, pois ele protege os identificadores e os dados criptografados. Faça backup do diretório persistente e do segredo.

## Publicação

O `Dockerfile` da raiz está pronto para uma hospedagem compatível com contêiner. Configure HTTPS no provedor, monte um disco persistente em `/data` e defina as variáveis acima. Não publique usando somente HTTP.

Teste de disponibilidade:

```text
GET https://seu-servidor/api/health
```
