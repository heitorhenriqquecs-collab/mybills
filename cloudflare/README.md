# MyBills Cloudflare (opção gratuita para testes)

Esta versão publica a mesma API de login e sincronização em um endereço HTTPS do Cloudflare Workers e guarda as contas no banco D1. O computador do dono não precisa ficar ligado.

## Instância deste projeto

O servidor já está publicado em:

```text
https://mybills-cloud.mybills-heitor.workers.dev
```

Esse endereço já está gravado nas versões Windows e Android. As etapas abaixo servem para manutenção ou para publicar uma nova instância.

## O que fica protegido

- O CPF completo não é gravado: somente uma chave HMAC e uma máscara.
- A senha não é gravada: somente um hash PBKDF2 com salt individual.
- O conteúdo financeiro é criptografado com AES-GCM antes de entrar no D1.
- Cada conta acessa somente o estado associado ao token dela.

Guarde o segredo. Se ele for perdido ou trocado, os dados já criptografados não poderão ser recuperados.

## Publicar

É necessário ter Node.js e criar uma conta gratuita no Cloudflare.

1. Abra o terminal nesta pasta (`cloudflare`).
2. Autorize sua conta:

   ```powershell
   npx wrangler login
   ```

3. Crie o banco:

   ```powershell
   npx wrangler d1 create mybills-cloud
   ```

4. Copie o `database_id` exibido e substitua o valor atual de `database_id` em `wrangler.jsonc`.
5. Crie as tabelas:

   ```powershell
   npx wrangler d1 execute mybills-cloud --remote --file=schema.sql
   ```

6. Cadastre um segredo longo e aleatório. O terminal solicitará o valor sem exibi-lo:

   ```powershell
   npx wrangler secret put MYBILLS_SECRET
   ```

7. Publique:

   ```powershell
   npx wrangler deploy
   ```

O final do comando mostrará um endereço parecido com `https://mybills-cloud.seu-usuario.workers.dev`.

## Conectar os aplicativos

O endereço do serviço é definido pela equipe no arquivo `cloud-config.js` antes de gerar os aplicativos. O usuário final não escolhe nem configura servidor: Android e Windows usam automaticamente a mesma instância oficial. Depois, basta criar uma conta e fazer login.

Teste opcional no navegador:

```text
https://SEU-ENDERECO.workers.dev/api/health
```

O resultado deve conter `"ok":true`.

## Limites e privacidade

O plano gratuito é apropriado para um protótipo com poucos amigos, mas tem limites diários de operações. Antes de abrir o aplicativo ao público, inclua termos de uso, política de privacidade, recuperação de senha, exclusão de conta e uma rotina de backup do banco D1.
