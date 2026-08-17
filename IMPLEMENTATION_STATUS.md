# Status de implementação

Atualizado em 16/08/2026.

## Concluído

- arquitetura Next.js App Router, TypeScript estrito e PWA;
- Next.js 16.3.1/Turbopack, com auditoria das dependências de produção sem vulnerabilidades;
- identidade visual nova, mobile-first e acessível, sem copiar HTML/CSS legado;
- Firebase Web SDK com cache persistente multiaba e listeners em tempo real;
- login Google/e-mail, acesso viewer via API, rate limit básico e cookie assinado;
- modelo multi-tenant em `baba_accounts/{accountId}`;
- cadastro, presença, pagamentos, sorteio, times, placar, gols, cronômetro, rodízio, tabela, ranking, estrelas, metas e histórico;
- mesa tática touch-first com autosave e JSON;
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
- importador inteligente de relatórios e assistente de consultas;
- fotos de metas e escudos através do Storage;
- animação multietapas/WebM na mesa tática;
- Firebase Custom Token para remover a leitura pública por caminho mantida para compatibilidade do viewer legado;
- suíte E2E Playwright e testes de regras no emulador com credenciais de produção isoladas.

## Configuração externa pendente

- `psyzon-baba.vercel.app` precisa ser adicionado em Firebase Console → Authentication → Settings → Authorized domains. A conta disponível na CLI não possui `firebaseauth.configs.update`; acesso por código e e-mail continuam disponíveis, mas login Google nesse domínio depende dessa autorização única por um proprietário do Firebase.
