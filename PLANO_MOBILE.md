# Plano do MyBills Mobile

## Objetivo

Criar uma versão mobile leve, offline-first e instalável do MyBills, mantendo as funções e a identidade visual do aplicativo atual. O projeto enviado em `project.zip` será usado somente como referência de posicionamento e hierarquia; as cores continuarão seguindo a identidade verde, dourada e neutra do MyBills.

## Decisão técnica

- Reaproveitar a aplicação web atual com **Vite + Capacitor**.
- Gerar inicialmente um **APK Android** para testes e, depois, um **AAB** para a Play Store.
- Manter todo o funcionamento financeiro offline e sincronizar a conta quando houver internet.
- Usar **SQLite local** no aplicativo final, com migrações versionadas.
- Preservar compatibilidade de importação com o JSON já exportado pela versão de PC.
- Deixar iOS preparado na arquitetura, mas a compilação de IPA exigirá macOS, Xcode e uma conta Apple Developer.

Essa abordagem evita uma reconstrução completa em React Native ou Flutter, reduz o tamanho do projeto e permite compartilhar a maior parte da interface e das regras financeiras entre PC e celular.

## Estrutura visual mobile

Referência de posicionamento extraída do modelo enviado:

1. Cabeçalho fixo com marca, atalho da futura assistente e notificações.
2. Saudação, título e ação principal no início da tela.
3. Cards financeiros em uma coluna: saldo previsto, receitas, despesas e valor livre.
4. Cards clicáveis com painel de detalhamento dos valores.
5. Lista de próximos compromissos logo após o resumo.
6. Gráfico de fluxo financeiro e análise mensal abaixo da lista.
7. Barra inferior fixa com:
   - Início;
   - Extrato;
   - botão central para adicionar lançamento;
   - Contas;
   - Planejamento, deixando a posição da IA preparada para o futuro.
8. Formulário de lançamento em uma sobreposição adaptada à tela, fechado somente pelo X.
9. Respeito às áreas seguras do aparelho, ao teclado virtual e ao botão Voltar do Android.

## Dados e salvamento

O banco local terá, no mínimo:

- lançamentos;
- recorrências e parcelas;
- categorias;
- estado pago/pendente;
- configurações;
- mês selecionado;
- rascunho do formulário;
- versão do banco para futuras atualizações.

Cada alteração será salva imediatamente em uma transação local. Fechar o aplicativo, reiniciar o celular ou ficar sem internet não poderá apagar os dados.

## Transferência do save entre PC e celular

### Formato principal: backup `.mybills`

O método mais seguro para continuar exatamente do mesmo ponto será um arquivo de backup próprio, por exemplo:

`meu-save-2026-10-03.mybills`

Esse arquivo conterá:

- versão do formato;
- data da exportação;
- todos os lançamentos e IDs;
- recorrências e parcelas;
- categorias;
- configurações importantes;
- informações necessárias para detectar duplicados.

Fluxo de importação:

1. O usuário escolhe o arquivo pelo seletor do celular ou do PC.
2. O aplicativo valida o formato antes de alterar qualquer dado.
3. Uma prévia informa quantos lançamentos e configurações foram encontrados.
4. O usuário escolhe **Substituir dados** ou **Mesclar**.
5. Na mesclagem, IDs existentes impedem lançamentos duplicados.
6. Antes de substituir, o aplicativo cria automaticamente uma cópia de segurança recuperável.

O arquivo poderá ser enviado por WhatsApp, e-mail, Google Drive, cabo USB ou qualquer outro meio suportado pelo aparelho.

### Compatibilidade com Excel

Também haverá importação e exportação em `.xlsx` ou `.csv`, com colunas padronizadas:

- ID;
- Tipo;
- Descrição;
- Valor;
- Vencimento;
- Categoria;
- Recorrência;
- Número de parcelas;
- Pago/Pendente.

O Excel será útil para visualizar e editar lançamentos. O arquivo `.mybills` continuará sendo o formato recomendado para um backup completo, pois uma planilha não preserva com a mesma segurança todas as configurações internas.

## Etapas de implementação

### Etapa 1 — Preparar a base compartilhada

- Organizar regras financeiras e formato dos dados independentemente da interface.
- Criar uma versão oficial do esquema de backup.
- Importar o JSON atual sem perder dados.
- Adicionar testes para recorrências, parcelas, meses e totais.

### Etapa 2 — Construir a interface mobile

- Aplicar a estrutura visual do modelo enviado.
- Manter as cores e os modos claro/escuro do MyBills.
- Adaptar cards, tabelas e gráficos para toque.
- Implementar a barra inferior e o botão central.
- Garantir legibilidade em telas pequenas sem depender de zoom manual.

### Etapa 3 — Persistência mobile

- Integrar SQLite.
- Migrar automaticamente os dados existentes na primeira abertura.
- Salvar lançamentos, rascunhos e preferências imediatamente.
- Testar encerramento forçado e reinicialização do aparelho.

### Etapa 4 — Importação, exportação e backup

- Exportar e importar `.mybills`.
- Adicionar prévia, validação, mesclagem e restauração de segurança.
- Manter compatibilidade com o JSON da versão de PC.
- Adicionar `.xlsx`/`.csv` para intercâmbio com planilhas.
- Usar o compartilhamento nativo do Android.

### Etapa 5 — Gerar o executável

- Configurar nome, ícone, tela inicial e identificador do aplicativo.
- Gerar APK de teste assinado.
- Testar instalação e atualização sem perder o banco.
- Gerar AAB de produção quando o aplicativo estiver aprovado.

### Etapa 6 — Verificação final

- Testar aparelhos pequenos e grandes.
- Testar teclado, rotação, áreas seguras e botão Voltar.
- Confirmar equivalência dos totais entre PC e celular.
- Exportar no PC, importar no celular e realizar o caminho inverso.
- Testar arquivos inválidos, duplicados e versões antigas.
- Confirmar funcionamento completo em modo avião.

## Critérios para considerar a primeira versão pronta

- Instala por APK e abre sem internet.
- Começa sem dados de demonstração.
- Todas as alterações são salvas automaticamente.
- Exibe corretamente receitas, despesas, valor livre e projeções.
- Permite criar, editar e excluir lançamentos, recorrências e parcelas.
- Importa um save do PC e continua com os mesmos dados.
- Exporta um save que pode ser restaurado no PC ou em outro celular.
- Não perde dados ao atualizar o APK.
- Mantém boa leitura e uso confortável em tela pequena.

## Ordem recomendada para a próxima sessão

Começar pela Etapa 1 e pelo formato `.mybills`. A transferência confiável dos dados deve existir antes de gerar o primeiro APK, pois ela também será o mecanismo de segurança durante os testes.
