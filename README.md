# Spawnfluxo — Catálogo de Spawn

Aplicação web para gerenciar catálogos de códigos de spawn do servidor, organizados em
duas abas independentes: **Spawn de Veículos** e **Spawn de Itens**. Cada aba guarda nome,
código de spawn, uma ou mais categorias (próprias daquela aba) e foto (opcional).

- **Página pública** (`/` ou `/index.html`): qualquer pessoa pode alternar entre as abas
  **Spawn de Veículos** e **Spawn de Itens** e, dentro de cada uma, buscar por nome, código
  ou categoria e ver nome + código + categorias + foto. As categorias aparecem como botões
  clicáveis — clique para filtrar por uma ou mais ao mesmo tempo (clique de novo para
  tirar o filtro). Cada aba tem seu próprio conjunto de categorias (ex.: "ARMA" na aba de
  itens não tem nada a ver com categorias de veículos). Não é possível editar nada por aqui.
- **Painel administrativo** (`/admin.html`): protegido por senha. Tem as mesmas duas abas
  da página pública — tudo que você faz (buscar, criar, editar, excluir veículo/item,
  gerenciar categorias) vale só para a aba selecionada no momento. Dentro de cada aba: busca
  e os mesmos botões de categoria da página pública para filtrar a tabela; clicar em
  "Editar" transforma a própria linha da tabela num formulário editável (sem precisar rolar
  a página até o topo); permite adicionar, editar e excluir registros, marcar **múltiplas
  categorias** por registro (via checkboxes), **criar categorias novas** direto na barra do
  topo (mesmo sem ainda ter um registro para usá-la), **renomear categorias** clicando no ✎
  do botão (o nome novo substitui o antigo em todos os registros daquela aba que a usavam) e
  **excluir categorias** clicando no × — os registros que estavam nela só perdem essa
  categoria (podendo ficar sem nenhuma), não são excluídos. Qualquer categoria criada,
  renomeada ou excluída no admin aparece/muda/some dos botões da página pública
  automaticamente, sempre dentro da mesma aba (os botões vêm sempre da lista atual do
  servidor para aquele tipo). A foto é opcional — dá para cadastrar só nome/código/categoria
  e adicionar (ou trocar) a foto depois, editando o registro. A foto é sempre um link
  `https://` (hospede a imagem em algum lugar como imgur, Discord ou Google Drive com link
  público, e cole o link no formulário) — não há upload de arquivo, para o site poder rodar
  100% de graça sem precisar de disco próprio. O botão **"Exportar backup (.txt)"** na barra
  do topo baixa um arquivo de texto com tudo que está na aba atual (nome == código de spawn),
  agrupado por categoria — sem fotos, só como backup/consulta rápida.

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

Na primeira execução, cada aba é populada automaticamente (uma independente da outra) se
estiver vazia:
- **Spawn de Veículos**: os **207 veículos** já cadastrados (a partir de
  `data/seed-cars.json`), organizados em 8 categorias: `PLANOS VIP'S`, `VEÍCULOS VIP'S`,
  `MOTOS VIP'S`, `VEÍCULOS ESPECIAIS`, `AERONAVES`, `CAMINHÕES`, `VEÍCULOS LUXO` e
  `RECOMPENSAS DO PASSE`.
- **Spawn de Itens**: os **155 itens** já cadastrados (a partir de `data/seed-items.json`),
  organizados em 10 categorias: `ARMA`, `ARMAS BRANCAS`, `MUNIÇÕES & ATTACHS`, `MUAMBAS`,
  `DROGAS`, `FARM`, `PESCA - MINERAÇÃO - FAZENDA`, `UTILIDADES`, `CASAMENTO` e `OUTROS`.

Nenhuma foto foi associada ainda em nenhuma das duas abas — adicione pelo painel admin
quando quiser.

**Pontos para você revisar na lista de itens** (mesmo espírito das ressalvas de veículos
abaixo — pequenos ajustes que fiz ao transcrever sua lista):
- Categoria `PESCA - MINEIRAÇÃO - FAZENDA`: corrigi para `PESCA - MINERAÇÃO - FAZENDA`
  (troquei "MINEIRAÇÃO" por "MINERAÇÃO") por parecer um typo — renomeie pelo ✎ do botão de
  categoria no admin se eu tiver entendido errado.
- Dois códigos vieram com um "1" solto no final (`WEAPON_COMBATPDW 1` → sig sauer, e
  `secador 1` → secador); tirei esse "1" por parecer um resíduo de formatação da lista
  original. Se o código de spawn realmente inclui esse "1", é só editar o registro no admin
  e corrigir o código de spawn.

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

### ⚠️ Atualizando um projeto que já estava no ar (antes da aba "Spawn de Itens" existir)

Se o seu projeto Supabase já tinha as tabelas `cars`/`categories` de antes — ou seja, você
já vinha usando o Spawnfluxo só com veículos — **rode a migração antes de atualizar o
código em produção**:

1. No SQL Editor do Supabase, cole o conteúdo de
   [`db/migration-002-add-item-type.sql`](db/migration-002-add-item-type.sql) e clique em
   **Run**. Não é destrutivo: todos os veículos e categorias existentes continuam
   intactos, só ganham uma coluna `type = 'veiculo'` internamente.
2. Só depois disso faça o deploy do código novo (`git push`/Render). Se o código novo subir
   antes da migração, o servidor vai falhar ao iniciar (a coluna `type` ainda não existe).

Se você está configurando o projeto do zero agora, **ignore isso** — o passo 3 acima
(`db/schema.sql`) já cria as tabelas com suporte às duas abas desde o início.

### Migração do cartão de compartilhamento (`site_config`)

Para poder editar o cartão de compartilhamento pelo painel, rode uma vez no SQL Editor do
Supabase o arquivo [`db/migration-003-site-config.sql`](db/migration-003-site-config.sql).
Ele só cria uma tabela nova e vazia, não mexe em nada existente.

Diferente da migração 002, **esta não é obrigatória para o deploy**: se a tabela não
existir, o servidor sobe normalmente (registra um aviso no log) e o cartão usa os valores
de reserva — você só não consegue salvar valores próprios pelo painel até rodá-la.

### Como os dados persistem

O servidor lê as tabelas `cars` e `categories` do Supabase **uma única vez, quando inicia**,
e guarda tudo em memória a partir daí. Toda busca, filtro e listagem no site (público ou
admin) vem dessa memória — não gera nenhuma consulta ao banco. O banco só é tocado de novo
quando: (a) o servidor reinicia (o que acontece de vez em quando no plano grátis do Render,
não a cada visita), recarregando o cache do zero, ou (b) você cria/edita/exclui algo pelo
painel admin, que grava no banco **e** atualiza o cache na hora. Isso significa que o uso
do site não gera custo proporcional a quantas pessoas acessam.

## Cartão de compartilhamento (prévia do link no Discord/WhatsApp/Telegram/Slack)

Quando alguém cola o link do site num app de mensagem, aparece um "cartão de visitas"
com imagem em miniatura, título e subtítulo. Isso é montado a partir das meta tags Open
Graph, que o servidor injeta no HTML da home (`lib/share-card.js`).

**Por que no servidor:** os robôs que geram essas prévias **não executam JavaScript**.
Qualquer coisa que a página monte depois, no navegador, não existe para eles — então as
tags precisam já sair prontas dentro do HTML da resposta.

Para editar: painel admin → seção **Cartão de compartilhamento** (no topo, acima das
abas). São três campos, todos opcionais:

| Campo | Se ficar vazio, usa |
|---|---|
| Título do cartão | o nome do site (`SPAWNS FLUXO "BY PTK"`) |
| Subtítulo do cartão | a descrição do site |
| Imagem do cartão | o logo do site |

Se não houver imagem nenhuma, o cartão sai só com texto (sem moldura de imagem
quebrada) e o formato vira `summary` em vez de `summary_large_image`.

- **Tamanho recomendado da imagem: 1200 × 630 px** (proporção 1,91:1). A prévia do painel
  avisa na hora se o link não carrega como imagem e se a proporção está diferente disso.
- **Use link externo, não arquivo enviado.** O Render no plano gratuito tem disco
  temporário: qualquer arquivo salvo no servidor some a cada atualização/reinício. Por
  isso o campo aceita um link `https://` (imgur, Discord, Google Drive público) — mesma
  abordagem já usada nas fotos dos veículos.
- Defina `SITE_URL` em produção. É o que garante `og:url` correto e transforma um caminho
  interno (`/img/card.png`) na URL absoluta que os robôs exigem.

**Forçar o Discord a atualizar um link que ele já guardou em cache:** o Discord guarda a
prévia por algum tempo. Para ver a versão nova na hora, use um destes:
1. Cole o link com um parâmetro qualquer no final (`https://seusite.com/?v=2`) — para o
   Discord é outra URL, então ele busca de novo. O `og:url` continua apontando para a raiz.
2. Passe o link no [Discord Embed Debugger](https://discord.com/developers/embeds) ou
   valide em [opengraph.xyz](https://www.opengraph.xyz/) para conferir o que está sendo lido.
3. Para os demais: WhatsApp costuma soltar em algumas horas; Telegram tem o bot
   `@WebpageBot` (comando `/update` com o link); Slack revalida sozinho em ~30 min.

## Testes

```bash
npm test
```

Roda o test runner nativo do Node (`node --test`) — sem dependência extra. Cobre o núcleo
do cartão de compartilhamento (`lib/share-card.js`): prioridade do título/subtítulo
próprios sobre os do site, as reservas quando os campos estão vazios, o escape de
caracteres perigosos (um título com `<script>` não pode sair como tag executável) e a
imagem virando endereço absoluto. Os testes não precisam de banco nem de servidor no ar.

## Segurança

Veja [`SECURITY.md`](SECURITY.md) para a arquitetura de segurança completa (o que o
projeto usa do Supabase, RLS, autenticação, segredos, etc.). Resumo rápido abaixo:

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
| `SITE_URL`        | (vazio)     | Endereço público do site, sem barra final (ex. `https://spawnfluxo.onrender.com`). Usado no cartão de compartilhamento; se vazio, usa o domínio da requisição |

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
