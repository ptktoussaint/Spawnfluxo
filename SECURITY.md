# Segurança — Spawnfluxo

Este documento descreve a arquitetura de segurança do Spawnfluxo: o que existe, por que
existe, e o que **não** existe (e por quê) — para que qualquer pessoa (inclusive uma IA
numa auditoria futura) não presuma capacidades que este projeto não tem.

## Arquitetura, em uma frase

Um servidor Express único conecta **diretamente** ao Postgres do Supabase via
connection string (`pg`/node-postgres) — não existe nenhum uso do SDK
`@supabase/supabase-js`, Supabase Auth, Storage, Realtime, Edge Functions ou RPC. O
navegador nunca fala com o Supabase; ele só fala com o nosso próprio servidor Express.

```
Navegador (público ou admin) ──HTTPS──> Express (Render) ──Postgres/TLS──> Supabase (só banco)
```

## O que este projeto usa do Supabase — e o que não usa

| Recurso do Supabase | Usado? | Observação |
|---|---|---|
| Postgres (banco) | **Sim** | Única coisa usada. Conexão direta via `pg`, connection string do "Session pooler". |
| Auth | Não | Login do admin é senha única comparada no nosso servidor, sem contas de usuário. |
| Storage | Não | Fotos são links `https://` externos (ex.: imgur); não há upload de arquivo. |
| Realtime | Não | Nenhum WebSocket/subscription. |
| Edge Functions | Não | Toda lógica roda no Express, no Render. |
| RPC / functions Postgres | Não | Schema (`db/schema.sql`) só tem `CREATE TABLE`, sem functions/triggers/views. |
| API REST automática (PostgREST) | Existe, mas não é usada pelo app | Ver seção RLS abaixo — é a superfície que RLS protege. |

## Modelo de dados e de usuários

Duas tabelas (`cars`, `categories`), sem conceito de "dono" por registro — é um catálogo
público compartilhado, não dados por usuário. Existe só **um** papel administrativo
(senha única em `ADMIN_PASSWORD`), sem contas individuais, sem roles, sem metadata de
usuário que possa ser adulterado para virar admin.

## Autenticação e sessão do admin

- Login: senha única, comparada com `crypto.timingSafeEqual` (tempo constante).
- Sessão: token aleatório de 256 bits (`crypto.randomBytes(32)`), guardado **só em
  memória do processo Node** (nunca em disco/banco), expira em 12h.
- Transporte: header `Authorization: Bearer <token>` — nunca cookie. Isso elimina CSRF
  por construção: um site malicioso não tem como anexar esse header a uma requisição
  forjada (ao contrário de cookies, que o navegador anexa sozinho).
- Armazenamento no navegador: `sessionStorage` (não sobrevive ao fechar a aba, não é
  compartilhado entre abas, mais seguro que `localStorage`).

## Row Level Security (RLS) no Supabase

As tabelas `cars` e `categories` têm **RLS habilitado, sem nenhuma policy**. Esse é o
estado correto para este projeto, e é intencional — não uma pendência:

- Nosso servidor conecta como o role `postgres` (dono das tabelas), que **sempre ignora
  RLS** — é o próprio Postgres que garante isso, não é uma configuração do Supabase.
  RLS nunca vai restringir o que o Express consegue fazer.
- RLS existe aqui só para proteger contra a **API REST automática do Supabase**
  (PostgREST, acessível com a `anon`/`publishable key` do projeto). Como o app nunca usa
  essa API nem expõe essa chave no frontend, "RLS habilitado + zero policies" resulta em
  **negar tudo por padrão** para quem tentar acessar via REST — que é exatamente o
  comportamento desejado, já que ninguém deveria acessar as tabelas por esse caminho.
- Não criamos nenhuma policy `USING (true)` ou equivalente — não existe motivo para
  liberar leitura/escrita via REST, então nenhuma policy foi adicionada.

## Segredos e variáveis de ambiente

| Variável | Onde vive | Nunca aparece em |
|---|---|---|
| `DATABASE_URL` | Env var do servidor (Render) / `.env` local | Frontend, logs, respostas de erro, git |
| `ADMIN_PASSWORD` | Env var do servidor (Render) / `.env` local | Frontend, logs, respostas de erro, git |

Não existe `service_role key`, `anon key` nem nenhuma credencial do Supabase no código —
porque o app nunca usa o SDK do Supabase, só a connection string do Postgres.

## Superfície de API (Express)

| Rota | Método | Autenticação | Rate limit |
|---|---|---|---|
| `/api/cars` | GET | Nenhuma (pública) | Geral (600/5min por IP) |
| `/api/categories` | GET | Nenhuma (pública) | Geral (600/5min por IP) |
| `/api/login` | POST | — | 10 tentativas falhas/15min por IP |
| `/api/logout` | POST | Bearer token | Geral |
| `/api/cars` | POST | Bearer token | Escrita (60/5min por IP) |
| `/api/cars/:id` | PUT | Bearer token | Escrita (60/5min por IP) |
| `/api/cars/:id` | DELETE | Bearer token | Escrita (60/5min por IP) |
| `/api/categories` | POST | Bearer token | Escrita (60/5min por IP) |
| `/api/categories/:name` | PUT | Bearer token | Escrita (60/5min por IP) |
| `/api/categories/:name` | DELETE | Bearer token | Escrita (60/5min por IP) |
| `/api/export` | GET | Bearer token | Geral (600/5min por IP) |

Não existe IDOR no sentido clássico: como não há "dono" por registro, qualquer sessão de
admin autenticada pode editar qualquer carro — esse é o comportamento pretendido (um
único painel administrativo compartilhado), não uma falha de autorização por usuário.

## Cache em memória

O servidor lê o Postgres **uma vez, ao iniciar**, e mantém tudo em memória depois disso.
Toda leitura pública vem da memória; o banco só é escrito (nunca relido em massa) a cada
ação do admin. Isso existe para não gerar custo/risco proporcional a quantidade de
acessos, não é uma medida de segurança em si — mas tem um efeito colateral de segurança:
reduz drasticamente a superfície de "um GET público custoso repetido vira DoS no banco".

## Validação de entrada

Toda entrada do painel admin é validada no servidor (nunca só no frontend): tamanho
máximo de nome/código/categoria/URL de foto, URL de foto restrita a `https://` via parser
de URL nativo, categorias limitadas a 20 por carro. Toda consulta ao Postgres usa
parâmetros preparados (`$1, $2, ...`) — nunca concatenação de string.

## Cabeçalhos de segurança

Via `helmet`: CSP restritiva (só `'self'` para script/estilo, sem `unsafe-inline`),
X-Frame-Options, X-Content-Type-Options, Referrer-Policy, HSTS. `Permissions-Policy`
adicionado manualmente (desabilita geolocalização, câmera, microfone, pagamento, USB).

## Limitações conhecidas (aceitas conscientemente)

- `ssl: { rejectUnauthorized: false }` na conexão com o Postgres: não verifica a cadeia
  de certificado do Supabase. Prática comum para bancos gerenciados, mas em teoria
  vulnerável a um MITM bem posicionado na rede entre Render e Supabase.
- Rate limiting é em memória do processo: correto e suficiente porque o Render free tier
  roda **uma única instância** (sem múltiplas réplicas). Se um dia o app escalar para
  múltiplas instâncias, isso precisará virar um rate limiter compartilhado (ex.: Redis).
- Sem paginação em `/api/cars`: aceitável no tamanho atual do catálogo (centenas de
  linhas); se crescer para dezenas de milhares, valeria revisar.

## Se algo neste documento parecer desatualizado

Este arquivo descreve o estado do projeto na auditoria de segurança mais recente. Se o
projeto ganhar autenticação de usuário real, upload de arquivos, Supabase Storage/Auth,
ou qualquer dado por usuário, **este documento precisa ser revisado antes** de assumir que
as garantias acima (principalmente as de RLS e de "não há dados por usuário") continuam
válidas.
