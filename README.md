# Spawnfluxo — Catálogo de Spawn de Veículos

Aplicação web para gerenciar o catálogo de códigos de spawn de veículos do servidor:
nome do veículo, código de spawn, uma ou mais categorias e foto (opcional).

- **Página pública** (`/` ou `/index.html`): qualquer pessoa pode buscar por nome ou
  categoria e ver nome + código + categorias + foto. Não é possível editar nada por aqui.
- **Painel administrativo** (`/admin.html`): protegido por senha. Tem busca e filtro por
  categoria, igual à página pública. Clicar em "Editar" transforma a própria linha da
  tabela num formulário editável (sem precisar rolar a página até o topo). Permite
  adicionar, editar e excluir veículos, marcar **múltiplas categorias** por veículo (via
  checkboxes) e **criar categorias novas** direto na barra do topo, mesmo sem ainda ter um
  veículo para usá-la. A foto é opcional — dá para cadastrar só nome/código/categoria e
  adicionar (ou trocar) a foto depois, editando o registro. A foto é sempre um link
  `https://` (hospede a imagem em algum lugar como imgur, Discord ou Google Drive com link
  público, e cole o link no formulário) — não há upload de arquivo, para o site poder rodar
  100% de graça sem precisar de disco próprio.

Os dados ficam num banco **Postgres gratuito no Supabase**, não em arquivo local — assim o
site pode ser hospedado inteiramente na camada gratuita do Render (que não oferece disco
persistente). O servidor lê o banco só uma vez, ao iniciar, e mantém tudo em memória depois
disso (veja **Como os dados persistem** abaixo) — assim o uso do site não depende de cota
por leitura nem gera custo proporcional a acessos.

## Como rodar localmente

1. Configure um projeto Supabase (veja a seção **Configurar o Supabase** abaixo) — é o
   mesmo projeto que você vai usar em produção, então esse passo só precisa ser feito uma vez.
2. Instale as dependências e configure o `.env`:

   ```bash
   npm install
   cp .env.example .env
   ```

   Edite o `.env` e preencha `ADMIN_PASSWORD` (uma senha forte) e `DATABASE_URL` com a
   connection string do seu projeto Supabase.
3. Rode:

   ```bash
   npm start
   ```

Acesse `http://localhost:3000` (catálogo público) e `http://localhost:3000/admin.html` (admin).

Na primeira execução, se a tabela `cars` estiver vazia, o servidor a popula automaticamente
com os **207 veículos** já cadastrados (a partir de `data/seed-cars.json`), organizados em
8 categorias: `PLANOS VIP'S`, `VEÍCULOS VIP'S`, `MOTOS VIP'S`, `VEÍCULOS ESPECIAIS`,
`AERONAVES`, `CAMINHÕES`, `VEÍCULOS LUXO` e `RECOMPENSAS DO PASSE`. Nenhuma foto foi
associada ainda — adicione pelo painel admin quando quiser.

**Pontos para você revisar** (peculiaridades que já existiam nas listas originais, mantidas
fielmente na importação):
- Categoria `RECOMPENSAS DO PASSE`: o nome dessa categoria foi um palpite meu, pois o
  cabeçalho não apareceu na captura de tela enviada. Renomeie se tiver o nome correto.
- Alguns itens compartilham o mesmo código de spawn com nomes diferentes (ex.: `VIP
  CARNAVAL` e `VIP ASTRO ( Gallivanter Exige )` os dois usam `gexige`) — isso já vinha
  assim das suas listas (skins/veículos reaproveitados entre benefícios), não é erro de
  importação.
- Há duas linhas "PURO SANGUE" com grafias e códigos diferentes (`PUROSANGUE` →
  `gcmferrariporusangue` e `PURO SANGUE` → `PRIMOGENITO`) — vale conferir se o código
  `PRIMOGENITO` dessa segunda linha está correto, pois já existe outra linha `PRIMOGENITO`
  com código `primogenito`.

## Configurar o Supabase (banco de dados gratuito)

1. Acesse [supabase.com](https://supabase.com) e crie uma conta gratuita (não pede cartão
   de crédito).
2. **New project** → escolha um nome e uma **senha do banco** (guarde essa senha, você vai
   precisar dela na connection string) → escolha a região mais próxima de você → **Create
   new project**. Leva um ou dois minutos para provisionar.
3. No menu lateral, vá em **SQL Editor** → **New query**, cole o conteúdo do arquivo
   [`db/schema.sql`](db/schema.sql) deste repositório e clique em **Run**. Isso cria as
   tabelas `cars` e `categories`.
4. Vá em **Project Settings** (ícone de engrenagem) → **Database** → **Connection string**
   → aba **URI**. Copie essa string — ela é parecida com:
   `postgresql://postgres.xxxxx:[YOUR-PASSWORD]@aws-0-xxxxx.pooler.supabase.com:6543/postgres`
5. Substitua `[YOUR-PASSWORD]` pela senha do banco que você definiu no passo 2, e use essa
   string completa como `DATABASE_URL` no `.env` (local) ou nas variáveis de ambiente do
   Render (produção).

### Como os dados persistem

O servidor lê as tabelas `cars` e `categories` do Supabase **uma única vez, quando inicia**,
e guarda tudo em memória a partir daí. Toda busca, filtro e listagem no site (público ou
admin) vem dessa memória — não gera nenhuma consulta ao banco. O banco só é tocado de novo
quando: (a) o servidor reinicia (o que acontece de vez em quando no plano grátis do Render,
não a cada visita), recarregando o cache do zero, ou (b) você cria/edita/exclui algo pelo
painel admin, que grava no banco **e** atualiza o cache na hora. Isso significa que o uso
do site não gera custo proporcional a quantas pessoas acessam.

## Segurança

- **Login do admin**: comparação de senha em tempo constante (evita ataques de timing) e
  limite de 10 tentativas a cada 15 min por IP (dificulta força bruta).
- **Sessões**: tokens aleatórios de 32 bytes (256 bits), guardados só em memória do
  servidor (nunca em disco/banco), com expiração de 12h. Trafegam via header
  `Authorization: Bearer`, não em cookie — isso já elimina CSRF por natureza, já que um
  site malicioso não consegue anexar esse header a uma requisição forjada.
- **Sem SQL injection**: todas as consultas ao banco usam parâmetros preparados
  (`$1, $2, ...`), nunca concatenação de string com dado do usuário.
- **Sem XSS**: todo texto vindo do banco (nome, código, categorias, foto) passa por uma
  função de escape antes de virar HTML, tanto em contexto de texto quanto dentro de
  atributos (`src="..."`, `value="..."`) — incluindo aspas, que por si só já bastam para
  escapar de um atributo e injetar código.
- **Limites de tamanho**: nome (200), código (100), categoria (60) e URL de foto (2000
  caracteres), além de no máximo 20 categorias por veículo — evita que um valor absurdo
  fique preso no cache em memória e seja reenviado pra todo mundo que visitar o site.
- **URLs de foto**: validadas com o parser de URL nativo, aceitando só `https://` —
  não dá para injetar `javascript:`, caminhos locais ou protocolos exóticos.
- **Cabeçalhos de segurança** via `helmet`: CSP restritiva (só carrega script/estilo do
  próprio domínio), X-Frame-Options (impede o site ser carregado dentro de um `<iframe>`
  em outro domínio), X-Content-Type-Options, entre outros.
- **Mitigação de uma vulnerabilidade conhecida do Express**: o parser de query string
  padrão (`qs`) tem uma falha de negação de serviço sem correção disponível ainda; como o
  site só usa parâmetros simples de busca, trocamos para o parser nativo do Node, que não
  tem esse código vulnerável.
- **Erros genéricos**: falhas internas nunca vazam detalhes (stack trace, erro do banco)
  para quem está navegando — só aparecem no log do servidor.
- A connection string do banco fica só no servidor (variável de ambiente) — nunca é
  exposta ao navegador do visitante.
- **Antes de publicar na internet**: defina uma senha forte em `ADMIN_PASSWORD` (nunca
  use a senha padrão) e sirva o site atrás de HTTPS (o Render já fornece isso
  automaticamente).
- Se for rodar atrás de um proxy/load balancer, defina `TRUST_PROXY=true` para o limite
  de tentativas identificar corretamente o IP de cada visitante.
- **Limitação conhecida**: a conexão com o Postgres usa `rejectUnauthorized: false` (não
  verifica a cadeia de certificado do Supabase), uma prática comum para bancos gerenciados
  mas que, em teoria, deixaria a conexão vulnerável a um ataque man-in-the-middle bem
  posicionado na rede entre Render e Supabase — um cenário de risco baixo, mas real.

## Variáveis de ambiente

| Variável         | Padrão      | Descrição                                                    |
|-------------------|-------------|----------------------------------------------------------------|
| `PORT`            | `3000`      | Porta do servidor                                               |
| `ADMIN_PASSWORD`  | `admin123`  | Senha do painel admin — **troque em produção**                   |
| `DATABASE_URL`    | —           | Connection string do Postgres/Supabase (Project Settings > Database > Connection string > URI) |
| `TRUST_PROXY`     | (vazio)     | `true` se estiver atrás de proxy/load balancer (ex. Render)      |

## Deploy no Render (deixar o site público, de graça)

Como os dados agora ficam no Supabase, o app **não precisa de disco persistente** — dá
para usar o plano gratuito de Web Service do Render.

⚠️ O plano gratuito do Render "dorme" o serviço depois de um tempo sem acesso, e demora
uns 30-50 segundos para "acordar" no próximo acesso — mas isso não afeta os dados (eles
ficam no Supabase, não no Render), só a velocidade da primeira visita depois de um tempo
parado.

O repositório já inclui um `render.yaml` pronto (Blueprint), então o deploy é quase
automático:

1. Configure o Supabase primeiro (seção acima) e tenha em mãos o `DATABASE_URL`.
2. Crie uma conta em [render.com](https://render.com) (dá para entrar com sua conta do
   GitHub).
3. No painel do Render, clique em **New +** → **Blueprint**.
4. Conecte sua conta do GitHub e selecione o repositório `ptktoussaint/Spawnfluxo`.
5. Escolha o branch `claude/game-car-spawn-manager-kjb84n` (ou o branch para onde você
   mesclar essas mudanças, ex. `main`).
6. O Render vai ler o `render.yaml` automaticamente e mostrar o serviço `spawnfluxo` no
   plano gratuito. Confirme.
7. Antes de criar, o Render vai pedir o valor de `ADMIN_PASSWORD` e `DATABASE_URL` (não
   têm valor padrão de propósito) — cole os valores correspondentes.
8. Clique em **Apply**/**Create**. O primeiro deploy demora alguns minutos.
9. Quando terminar, o Render te dá uma URL pública tipo
   `https://spawnfluxo.onrender.com` — é esse o link que você compartilha com as outras
   pessoas.
10. Acesse `https://spawnfluxo.onrender.com/admin.html` e faça login com a senha que você
    definiu no passo 7.

Depois disso, qualquer novo `git push` no branch conectado atualiza o site automaticamente.

### Alternativa: configurar manualmente (sem usar o Blueprint)

Se preferir não usar o `render.yaml`, dá para criar o Web Service manualmente no Render:
- **Build Command**: `npm install`
- **Start Command**: `npm start`
- **Plan**: Free
- Variáveis de ambiente: `ADMIN_PASSWORD`, `DATABASE_URL`, `TRUST_PROXY=true`
