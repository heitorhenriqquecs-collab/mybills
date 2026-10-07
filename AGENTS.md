# Padrões de desenvolvimento do MyBills

- Escreva JavaScript limpo e direto, com nomes claros e funções focadas.
- Prefira soluções simples e compatíveis com Web, Electron e Capacitor.
- Preserve o funcionamento offline-first, a privacidade dos dados locais e a compatibilidade com dados já salvos.
- Comente apenas decisões, restrições de plataforma ou regras de segurança que não sejam evidentes pelo código.
- Altere os arquivos-fonte da raiz e execute `npm run build:web` para atualizar `dist`; não edite os arquivos gerados isoladamente.
- Evite novas dependências quando a plataforma ou o código existente já resolverem o problema com clareza.
- Antes de concluir, execute `npm run check` e a validação específica da plataforma afetada.
