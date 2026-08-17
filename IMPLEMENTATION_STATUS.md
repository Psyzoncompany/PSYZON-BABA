# Status de implementação

Atualizado em 16/08/2026.

## Concluído

- arquitetura Next.js App Router, TypeScript estrito e PWA;
- Next.js 16.3.1/Turbopack, com auditoria das dependências de produção sem vulnerabilidades;
- identidade visual nova, mobile-first e acessível, sem copiar HTML/CSS legado;
- Firebase Web SDK com cache persistente multiaba e listeners em tempo real;
- login Google no domínio autorizado, acesso viewer via API, rate limit básico e cookie assinado;
- modelo multi-tenant em `baba_accounts/{accountId}`;
- cadastro, presença, página de pagamentos, sorteio, times com cores/escudos originais, placar, gols, cronômetro, rodízio, tabela, ranking, estrelas e histórico;
- importação idempotente dos jogadores, babas e jogos do banco legado;
- layout específico mais compacto para iPhone;
- regras Firestore/Storage, índices, migração dry-run/aplicável e documentação;
- testes unitários das regras centrais.

## Decisões

- a configuração pública do Firebase foi preservada do legado; nenhuma credencial privada foi copiada;
- documentos novos usam `schemaVersion: 3`, campos em inglês e aliases essenciais em português quando necessários à compatibilidade;
- entidades históricas usam soft delete e snapshots de elenco por partida;
- valores monetários novos são inteiros em centavos;
- datas de evento usam `YYYY-MM-DD` e a UI formata em `pt-BR`.

## Próximas evoluções não bloqueantes

- geração PDF diagramada no servidor; hoje a UI oferece impressão/PDF nativo do navegador;
- editor histórico completo com aplicação transacional de deltas;
- importador inteligente de relatórios em texto e assistente de consultas;
- personalização de escudos através do Storage;
- Firebase Custom Token para remover a leitura pública por caminho mantida para compatibilidade do viewer legado;
- suíte E2E Playwright e testes de regras no emulador com credenciais de produção isoladas.

## Configuração externa pendente

- a conta disponível na CLI não possui `serviceusage.services.use` nem `firebaserules.releases.get`; por isso `firestore.rules` está preparado no repositório, mas a validação/publicação no Firebase exige que um proprietário conceda essas permissões;
- enquanto isso, o site usa `baba-psyzon.vercel.app`, domínio já autorizado pelo Firebase, e o organizador entra com Google.
