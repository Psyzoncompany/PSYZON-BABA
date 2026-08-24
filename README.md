# Baba Psyzon

Aplicativo mobile-first para organizar um baba em tempo real. A nova aplicação usa Next.js 16 com App Router, React 19, TypeScript estrito e Firebase, mantendo os dados isolados em `baba_accounts/{accountId}`.

## Funcionalidades implementadas

- entrada do organizador com Google ou e-mail/senha da comissão;
- entrada de jogador por código de quatro dígitos verificado no servidor, com rate limit, HMAC, código criptografado e sessão Firebase de somente leitura;
- cadastro, status, presença e mensalidades por jogador;
- modo Pelo Site com cronômetro, placar, gols com ou sem artilheiro, desfazer gol/jogo, fila e desempates;
- modo Manual com ficha A4 e lançamento final de vitórias, empates, derrotas e gols por jogador;
- sorteio puro e testável, lote de recém-chegados, goleiros equilibrados e montagem manual;
- tabela ao vivo, campeão/co-campeões, rankings por escopo e critério e motor único de estrelas;
- PDFs A4 de ranking, pagamentos e ficha manual;
- backup JSON completo e restauração autenticada, com limite de 25 MB, prévia e confirmação;
- mesa tática touch-first com quadros, animação, desfazer/refazer e JSON;
- PWA, safe areas, tema/densidade, cache do Firestore e sincronização em tempo real.

## Arquitetura e modelo de dados

As telas ficam em `app/` e `components/`; regras determinísticas em `lib/domain/`; acesso Firebase em `lib/firebase/`; autorização em `lib/auth/`; e PDFs em `lib/pdf/`. Firebase Admin só é importado por módulos `server-only`.

Estrutura principal do Firestore:

```text
baba_accounts/{accountId}
├── players/{playerId}
├── babas/{babaId}
│   ├── teams/{teamId}
│   ├── games/{gameId}
│   ├── manual_results/{teamId}
│   ├── player_stats/{playerId}
│   └── undo_snapshots/{gameId}
├── payments/{YYYY-MM}/players/{playerId}
├── months/{YYYY-MM}/rankings/{playerId}
├── player_stats/{playerId}
├── imports/{importId}
├── audit/{auditId}
└── security/access
```

Valores monetários novos são centavos inteiros. Datas de evento usam `YYYY-MM-DD`; instantes usam milissegundos e são exibidos em `pt-BR`, no fuso `America/Bahia`. Partidas guardam snapshots dos elencos. Exclusões de entidades com histórico são lógicas.

## Rotas

- `/`: escolha de acesso;
- `/app/ao-vivo`, `/app/times`, `/app/tabela`, `/app/ranking`, `/app/historico`;
- `/app/pagamentos`, `/app/ficha-manual`, `/app/mais`;
- `/organizador`, `/aparencia`, `/mesa-tatica`.

## Desenvolvimento

Requer Node.js 20.9 ou superior.

```powershell
npm install
Copy-Item .env.example .env.local
npm run dev
```

Validação local:

```powershell
npm run lint
npm run typecheck
npm test
npm run test:rules
npm run build
```

Para trabalhar manualmente com os emuladores:

```powershell
npm run firebase:emulators
```

## Variáveis de ambiente

Copie `.env.example` e configure:

- `NEXT_PUBLIC_FIREBASE_*`: configuração pública do Firebase Web SDK;
- `BABA_SESSION_SECRET`: assina a sessão HttpOnly do acesso por código;
- `BABA_ACCESS_CODE_SECRET`: HMAC e criptografia do código;
- `BABA_RATE_LIMIT_SECRET`: anonimiza IP/dispositivo no controle de tentativas;
- `FIREBASE_SERVICE_ACCOUNT_JSON`: credencial privada do Firebase Admin no servidor da Vercel;
- `FIREBASE_PROJECT_ID`: projeto usado pelo Admin SDK.

Use segredos independentes com pelo menos 48 bytes. Nunca use prefixo `NEXT_PUBLIC_` em credenciais privadas. No Firebase Authentication, habilite Google e e-mail/senha e inclua o domínio de produção em **Authentication → Settings → Authorized domains**.

## Segurança

O código de jogador não é salvo em texto puro. A API mantém apenas um índice HMAC e uma cópia AES-GCM para o organizador consultar; a rotação aumenta `accessVersion` e invalida sessões anteriores. O visualizador recebe Custom Token com `role=viewer`, `accountId`, validade e versão. As regras do Firestore bloqueiam escrita de viewer, acesso cruzado entre contas, coleções de segurança e coleções públicas antigas.

Antes do deploy, publique regras e índices com uma conta que tenha permissão no projeto:

```powershell
npx firebase login
npm run firebase:deploy
```

O projeto padrão já está fixado em `sitey-caixa-16e06` no `.firebaserc`. Se o navegador mostrar `permission-denied` em um listener, confirme primeiro que essas regras foram publicadas nesse projeto e depois saia e entre novamente no aplicativo; não torne as coleções públicas para contornar o erro.

Como o Storage consulta `meta/security` para revogar viewer imediatamente, a primeira publicação pode pedir a ativação da permissão de regras entre Storage e Firestore.

## Migração do legado

O utilitário em `scripts/migrate-legacy.mjs` usa Firebase Admin, é aditivo e executa dry-run por padrão:

```powershell
$env:BABA_ACCOUNT_UID="uid-do-organizador"
$env:FIREBASE_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}'
node scripts/migrate-legacy.mjs
node scripts/migrate-legacy.mjs --apply
```

Revise contagens e checksum antes de `--apply` e exporte um backup do Firestore. O script usa `merge`, pode ser retomado e não remove as coleções antigas. A transformação detalhada de estruturas legadas divergentes deve ser validada em um projeto de homologação antes da produção.

## Deploy e rollback

1. Importe o repositório na Vercel e configure todas as variáveis de ambiente.
2. Execute lint, tipos, testes, teste de regras e build no CI.
3. Publique `firestore.rules`, `storage.rules` e `firestore.indexes.json`.
4. Autorize o domínio final no Firebase Auth.
5. Em dois navegadores, valide organizador e viewer na mesma conta.

Para rollback da aplicação, promova o último deployment estável na Vercel. Como a migração é aditiva, as coleções legadas permanecem disponíveis para uma versão anterior; restaure dados novos por um backup validado quando necessário.

## Checklist pós-deploy

1. Entrar como organizador e criar/rotacionar o código do jogador.
2. Entrar pelo código em outro aparelho e confirmar que qualquer escrita é negada.
3. Criar um baba, marcar pelo menos oito jogadores de linha, sortear e concluir uma partida.
4. Validar o modo Manual e baixar a ficha PDF.
5. Conferir mensalidades e PDF financeiro.
6. Exportar um backup e testar sua prévia em homologação.
7. Instalar a PWA em Android/iOS e verificar safe areas, teclado e navegação.
8. Monitorar erros de servidor na Vercel e negações/falhas no Firebase.

Consulte `IMPLEMENTATION_STATUS.md` para o estado exato e as limitações ainda abertas.
