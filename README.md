# Baba Psyzon

Aplicativo Next.js mobile-first para organizar o baba em tempo real. Usa o projeto Firebase legado `sitey-caixa-16e06`, preserva o namespace multi-tenant `baba_accounts/{accountId}` e mantém leitura de compatibilidade durante a migração.

## O que funciona

- login do organizador com Google ou e-mail/senha;
- acesso de jogador por código de quatro dígitos, validado no servidor e guardado em cookie `HttpOnly`;
- jogadores, presença, tipo, pagamentos e código de visualização;
- sorteio sem duplicidade, separação de visitantes e equilíbrio circular de goleiros;
- partida em tempo real, cronômetro, gols com/sem artilheiro, desfazer gol e rodízio;
- tabela, campeão/co-campeões, ranking, eficiência e estrelas;
- metas de compra, histórico, backup JSON e impressão/PDF pelo navegador;
- mesa tática touch-first com arrastar, desfazer/refazer, autosave e importação/exportação JSON;
- PWA instalável, cache local do Firestore, estados online/offline/salvando e interface responsiva.

## Desenvolvimento

Requer Node.js 20 ou superior.

```bash
npm install
copy .env.example .env.local
npm run dev
```

Validação completa:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Emuladores do Firebase:

```bash
npm run firebase:emulators
```

## Variáveis de ambiente

Os valores `NEXT_PUBLIC_FIREBASE_*` são a configuração pública do Firebase Web SDK e não são senhas. A proteção dos dados depende de Authentication e das regras. Nunca exponha `FIREBASE_SERVICE_ACCOUNT_JSON` nem `BABA_SESSION_SECRET` ao navegador.

Em produção, configure obrigatoriamente `BABA_SESSION_SECRET` com pelo menos 48 bytes aleatórios. Para rotas administrativas futuras, configure `FIREBASE_SERVICE_ACCOUNT_JSON` apenas no ambiente do servidor.

No Firebase Authentication, habilite Google e e-mail/senha e adicione o domínio final da Vercel em **Authentication → Settings → Authorized domains**.

## Migração do legado

O script é aditivo, retomável e usa `set(..., { merge: true })`. Por padrão ele apenas mostra as contagens e checksum:

```bash
set BABA_ACCOUNT_UID=uid-do-organizador
set FIREBASE_SERVICE_ACCOUNT_JSON={...}
node scripts/migrate-legacy.mjs
node scripts/migrate-legacy.mjs --apply
```

Antes de `--apply`, exporte um backup do Firestore. Depois, compare as contagens e o checksum do dry-run. O rollback consiste em manter a aplicação anterior apontando para as coleções raiz; esta migração não remove documentos legados.

## Deploy e rollback

Na Vercel, importe `Psyzoncompany/PSYZON-BABA`, defina as variáveis de ambiente e use a raiz do repositório. Cada push em `main` gera produção quando a integração Git está ativa. Para deploy direto:

```bash
npx vercel@latest --prod
```

Rollback: abra **Vercel → Deployments**, escolha a implantação estável anterior e use **Promote to Production**. As migrações são aditivas, então a versão anterior continua capaz de ler os dados legados.

## Checklist pós-deploy

1. Abrir a URL em janela anônima e confirmar que a tela de acesso carrega.
2. Entrar como organizador, criar um baba e cadastrar um jogador.
3. Gerar o código e entrar por ele em outro aparelho/janela; confirmar somente leitura.
4. Marcar 8 jogadores de linha, sortear e validar a atualização entre os dois aparelhos.
5. Iniciar/finalizar um jogo e confirmar tabela e ranking.
6. Instalar a PWA em Android/iOS e conferir safe areas.
7. Conferir erros de Functions e falhas de Firestore no console da Vercel/Firebase.

## Segurança e consistência

Mutações são autorizadas pelas regras somente para `request.auth.uid == accountId`. O código de quatro dígitos nunca é salvo em texto puro; o índice usa SHA-256 e a sessão é assinada no servidor. As regras atuais preservam leitura pública por caminho para compatibilidade do viewer em tempo real. Para eliminar essa compatibilidade no futuro, emita Firebase Custom Tokens de viewer com claims `accountId/role` através de Firebase Admin e restrinja as regras por claim.
