# Spawnfluxo — Catálogo de Spawn de Veículos

Aplicação web para gerenciar o catálogo de códigos de spawn de veículos do servidor:
nome do veículo, código de spawn, uma ou mais categorias e foto (opcional).

- **Página pública** (`/` ou `/index.html`): qualquer pessoa pode buscar por nome ou
  categoria e ver nome + código + categorias + foto. Não é possível editar nada por aqui.
- **Painel administrativo** (`/admin.html`): protegido por senha. Tem busca e filtro por
  categoria, igual à página pública. Clicar em "Editar" transforma a própria linha da
  tabela num formulário editável (sem precisar rolar a página até o topo). Permite
  adicionar, editar e excluir veículos, marcar **múltiplas categorias** por veículo (via
  checkboxes) e **criar categorias novas** direto no formulário, mesmo sem ainda ter um
  veículo para usá-la. A foto é opcional — dá para cadastrar só nome/código/categoria e
  adicionar (ou trocar) a foto depois, editando o registro. A foto é sempre um link
  `https://` (hospede a imagem em algum lugar como imgur, Discord ou Google Drive com link
  público, e cole o link no formulário) — não há upload de arquivo, para o site poder rodar
  100% de graça sem precisar de disco próprio.

Os dados dos veículos ficam no **Firestore** (banco de dados gratuito do Firebase/Google),
não em arquivo local — assim o site pode ser hospedado inteiramente na camada gratuita do
Render (que não oferece disco persistente).

## Como rodar localmente

1. Configure um projeto Firebase (veja a seção **Configurar o Firebase** abaixo) — é o
   mesmo projeto que você vai usar em produção, então esse passo só precisa ser feito uma vez.
2. Instale as dependências e configure o `.env`:

   ```bash
   npm install
   cp .env.example .env
   ```

   Edite o `.env` e preencha `ADMIN_PASSWORD` (uma senha forte) e as três variáveis
   `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` com os dados da
   conta de serviço do seu projeto Firebase.
3. Rode:

   ```bash
   npm start
   ```

Acesse `http://localhost:3000` (catálogo público) e `http://localhost:3000/admin.html` (admin).

Na primeira execução, se a coleção `cars` do Firestore estiver vazia, o servidor a popula
automaticamente com os **207 veículos** já cadastrados (a partir de `data/seed-cars.json`),
organizados em 8 categorias: `PLANOS VIP'S`, `VEÍCULOS VIP'S`, `MOTOS VIP'S`,
`VEÍCULOS ESPECIAIS`, `AERONAVES`, `CAMINHÕES`, `VEÍCULOS LUXO` e `RECOMPENSAS DO PASSE`.
Nenhuma foto foi associada ainda — adicione pelo painel admin quando quiser.

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

## Configurar o Firebase (banco de dados gratuito)

1. Acesse [console.firebase.google.com](https://console.firebase.google.com) e crie um
   projeto novo (pode ser gratuito, plano "Spark").
2. No menu lateral, vá em **Build → Firestore Database** → **Create database** → escolha
   modo de produção (production mode) e a região mais próxima de você → **Enable**.
3. Vá em **Configurações do projeto** (ícone de engrenagem) → aba **Service accounts** →
   **Generate new private key**. Isso baixa um arquivo `.json`.
4. Abra esse arquivo `.json` baixado. Dele você precisa de três valores para o `.env` (ou
   para as variáveis de ambiente do Render):
   - `project_id` → `FIREBASE_PROJECT_ID`
   - `client_email` → `FIREBASE_CLIENT_EMAIL`
   - `private_key` → `FIREBASE_PRIVATE_KEY` (copie o valor inteiro, incluindo
     `-----BEGIN PRIVATE KEY-----` e `-----END PRIVATE KEY-----`)
5. **Guarde esse arquivo `.json` em local seguro e nunca o coloque no Git** — quem tiver
   essas credenciais tem acesso total de leitura/escrita ao banco.

## Segurança

- O login do admin usa comparação de senha em tempo constante e limite de tentativas
  (10 tentativas a cada 15 min por IP) para dificultar força bruta.
- Sessões de admin são tokens aleatórios de 32 bytes, guardados só em memória (nunca em
  disco), com expiração de 12h.
- URLs de foto só são aceitas se forem `https://` (não dá para injetar `javascript:` ou
  caminhos locais).
- Cabeçalhos de segurança (CSP, X-Frame-Options, etc.) via `helmet`.
- As credenciais do Firebase ficam só no servidor (variáveis de ambiente) — nunca são
  expostas ao navegador do visitante.
- **Antes de publicar na internet**: defina uma senha forte em `ADMIN_PASSWORD` (nunca
  use a senha padrão) e sirva o site atrás de HTTPS (o Render já fornece isso
  automaticamente).
- Se for rodar atrás de um proxy/load balancer, defina `TRUST_PROXY=true` para o limite
  de tentativas identificar corretamente o IP de cada visitante.

## Variáveis de ambiente

| Variável                | Padrão      | Descrição                                              |
|--------------------------|-------------|---------------------------------------------------------|
| `PORT`                   | `3000`      | Porta do servidor                                        |
| `ADMIN_PASSWORD`         | `admin123`  | Senha do painel admin — **troque em produção**            |
| `FIREBASE_PROJECT_ID`    | —           | Do arquivo de credenciais do Firebase (`project_id`)      |
| `FIREBASE_CLIENT_EMAIL`  | —           | Do arquivo de credenciais do Firebase (`client_email`)    |
| `FIREBASE_PRIVATE_KEY`   | —           | Do arquivo de credenciais do Firebase (`private_key`)      |
| `TRUST_PROXY`            | (vazio)     | `true` se estiver atrás de proxy/load balancer (ex. Render) |

## Deploy no Render (deixar o site público, de graça)

Como os dados agora ficam no Firestore, o app **não precisa de disco persistente** — dá
para usar o plano gratuito de Web Service do Render.

⚠️ O plano gratuito do Render "dorme" o serviço depois de um tempo sem acesso, e demora
uns 30-50 segundos para "acordar" no próximo acesso — mas isso não afeta os dados (eles
ficam no Firestore, não no Render), só a velocidade da primeira visita depois de um tempo
parado.

O repositório já inclui um `render.yaml` pronto (Blueprint), então o deploy é quase
automático:

1. Configure o Firebase primeiro (seção acima) e tenha em mãos `FIREBASE_PROJECT_ID`,
   `FIREBASE_CLIENT_EMAIL` e `FIREBASE_PRIVATE_KEY`.
2. Crie uma conta em [render.com](https://render.com) (dá para entrar com sua conta do
   GitHub).
3. No painel do Render, clique em **New +** → **Blueprint**.
4. Conecte sua conta do GitHub e selecione o repositório `ptktoussaint/Spawnfluxo`.
5. Escolha o branch `claude/game-car-spawn-manager-kjb84n` (ou o branch para onde você
   mesclar essas mudanças, ex. `main`).
6. O Render vai ler o `render.yaml` automaticamente e mostrar o serviço `spawnfluxo` no
   plano gratuito. Confirme.
7. Antes de criar, o Render vai pedir o valor de `ADMIN_PASSWORD`,
   `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL` e `FIREBASE_PRIVATE_KEY` (não têm
   valor padrão de propósito) — cole os valores correspondentes. Para
   `FIREBASE_PRIVATE_KEY`, cole o valor inteiro do jeito que está no `.json` (com as
   quebras de linha como `\n`).
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
- Variáveis de ambiente: `ADMIN_PASSWORD`, `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`,
  `FIREBASE_PRIVATE_KEY`, `TRUST_PROXY=true`
