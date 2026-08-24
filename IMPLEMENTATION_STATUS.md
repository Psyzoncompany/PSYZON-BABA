# Status de implementação

Atualizado em 24/08/2026.

## Fases concluídas nesta entrega

### 1. Base, domínio e dados

- Next.js 16.3.1 App Router, React 19, TypeScript estrito e PWA;
- modelo multi-tenant `baba_accounts/{accountId}`;
- funções puras para sorteio, lote de recém-chegados, rodízio, tabela, campeão, rankings, pagamentos e estrelas;
- snapshots de elenco, soft delete e agregação idempotente ao finalizar o baba;
- mensalidades por mês e por jogador, resolvidas por `updatedAtMs` individual.

### 2. Segurança e autorização

- código de quatro dígitos verificado somente no servidor;
- HMAC para busca, AES-256-GCM para consulta pelo organizador, rate limit persistido e atraso progressivo;
- Custom Token Firebase de viewer, sessão HttpOnly/Secure/SameSite=Lax, rotação e revogação por versão;
- Firebase Admin isolado do bundle do navegador;
- regras Firestore com isolamento entre contas, viewer somente leitura e coleções privadas;
- regras Storage com isolamento por conta, escrita apenas do organizador e validação básica de imagem.
- APIs com Firebase Admin também validam expiração e `accessVersion` do visualizador antes de ler dados da conta.

### 3. Fluxos verticais

- acesso de organizador, comissão e jogador;
- cadastro/status/presença de jogadores e pagamentos mensais;
- criação do baba, escolha bloqueável do modo e sorteio/montagem manual;
- modo online com cronômetro, gol, autor, sem artilheiro, desfazer e rodízio completo;
- modo manual com PDF e totais por time/jogador;
- tabela, ranking mensal/geral/dia/goleiro/histórico, critérios de ordenação e estrelas;
- ranking mensal, geral e histórico reconstruído dos babas finalizados, com a mesma fonte usada pelo PDF;
- card acessível de cada jogador no ranking, com dados do baba atual, histórico, estrelas e pagamento quando autorizado;
- painel do organizador por estado, código viewer, finalização e reset lógico;
- criação/troca segura da senha da comissão após autenticação Google recente, vinculada ao mesmo UID;
- PDFs A4 de ranking, pagamentos e ficha manual;
- backup/restauração autenticados e mesa tática local.

## Decisões importantes

- o visual foi refeito, preservando os fluxos reconhecíveis do site antigo sem copiar seu HTML/CSS;
- Server Components continuam sendo o padrão das rotas; os providers e telas interativas são Client Components;
- o servidor nunca aceita `accountId`, papel ou totais financeiros enviados pelo cliente como autoridade;
- o modo fica bloqueado após a criação de times/jogos;
- tabela ao vivo é apenas prévia; pontos são persistidos ao finalizar;
- uma partida finalizada aplica estatísticas uma vez e mantém snapshot para desfazer;
- os agregados de ranking exibidos não são tratados como fonte definitiva: são somadas as contribuições preservadas em cada baba finalizado;
- o backup exclui `security`, `rate_limits` e `audit`, portanto não transporta código ou segredos.

## Migrações

- dados novos usam `schemaVersion: 3`;
- `scripts/migrate-legacy.mjs` fornece dry-run, contagens, checksum e aplicação aditiva com `merge`;
- a restauração JSON da interface também é aditiva, autenticada e auditada;
- nenhuma migração foi aplicada ao projeto Firebase de produção nesta sessão.

## Validação executada

- `npm run lint`: passou sem erros;
- `npm run typecheck`: passou;
- `npm test`: 30 testes unitários passaram;
- `npm run test:rules`: 8 testes de Firestore/Storage no emulador passaram;
- `npm audit --omit=dev`: 0 altas/críticas e 6 moderadas transitivas, vindas do módulo opcional `@google-cloud/storage` de `firebase-admin`; o aplicativo não importa esse módulo, mas o lockfile ainda é sinalizado;
- `npm run build`: passou com 20 páginas/rotas geradas e sem erro de TypeScript.
- smoke test HTTP: 9 rotas principais/manifest responderam `200` no servidor de produção local.

Os testes cobrem sorteio sem duplicação, goleiros, recém-chegados, todos os casos de rodízio, tabela/campeões, rankings, estrelas/elegibilidade/meia estrela, pagamentos e isolamento/autorização no Firestore.

## Pendências reais

Estas partes do prompt amplo ainda não estão completas e não devem ser tratadas como produção pronta:

- metas de compra com upload no Storage;
- editor histórico completo com correção transacional por delta e exclusão lógica;
- importador inteligente de relatório textual, aliases e reversão específica;
- assistente “IA do Baba” baseado nos dados da conta;
- personalização de nomes, cores e escudos dos times no Storage;
- PDFs de todos os formatos solicitados (há ranking, pagamentos e ficha manual);
- edição/exclusão de partida finalizada e reordenação drag-and-drop da fila;
- compartilhamento por Web Share e fila própria de mutações offline além da persistência do Firestore;
- testes E2E completos, QA visual real em Android/iPhone/desktop e auditoria de acessibilidade com leitor de tela;
- integração MCP administrativa e observabilidade externa configurada.
- publicação das regras no Firebase de produção: o CLI local ainda não tem uma conta autenticada; execute `npx firebase login` e `npm run firebase:deploy` antes de validar o site publicado.

O navegador integrado não estava conectado nesta sessão; por isso a validação visual em dispositivos não foi simulada nem declarada como concluída. Antes de publicar, execute os fluxos do checklist do README em homologação com o projeto Firebase real.
