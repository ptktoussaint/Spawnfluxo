# Spawnfluxo — Catálogo de Spawn de Veículos

Aplicação web para gerenciar o catálogo de códigos de spawn de veículos do servidor:
nome do veículo, código de spawn, categoria e foto (opcional).

- **Página pública** (`/` ou `/index.html`): qualquer pessoa pode buscar por nome ou
  categoria e ver nome + código + categoria + foto. Não é possível editar nada por aqui.
- **Painel administrativo** (`/admin.html`): protegido por senha. Permite adicionar,
  editar e excluir veículos. A foto é opcional — dá para cadastrar só nome/código/categoria
  e adicionar (ou trocar) a foto depois, editando o registro.

## Como rodar localmente

```bash
npm install
cp .env.example .env
# edite o .env e defina uma senha forte em ADMIN_PASSWORD
npm start
```

Acesse `http://localhost:3000` (catálogo público) e `http://localhost:3000/admin.html` (admin).

## Estrutura dos dados

Os veículos ficam em `<DATA_DIR>/cars.json` (formato simples, sem banco de dados externo).
As fotos enviadas pelo formulário ficam em `<DATA_DIR>/uploads/`. Em desenvolvimento local,
`DATA_DIR` é a pasta `data/` do projeto; em produção, aponte para um disco persistente
(veja a seção **Deploy no Render** abaixo). `data/seed-cars.json` é a lista inicial de
veículos — na primeira execução, se `cars.json` ainda não existir, ele é criado a partir
dessa semente.

Foram importados **207 veículos** a partir das listas que você enviou, organizados em 8
categorias: `PLANOS VIP'S`, `VEÍCULOS VIP'S`, `MOTOS VIP'S`, `VEÍCULOS ESPECIAIS`,
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

## Segurança

- O login do admin usa comparação de senha em tempo constante e limite de tentativas
  (10 tentativas a cada 15 min por IP) para dificultar força bruta.
- Sessões de admin são tokens aleatórios de 32 bytes, guardados só em memória (nunca em
  disco), com expiração de 12h.
- Uploads de foto aceitam apenas imagens (png/jpg/webp/gif) até 5MB, com nome de arquivo
  aleatório — não é possível sobrescrever outros arquivos do servidor.
- URLs de foto só são aceitas se forem `https://` ou apontarem para `/uploads/...`.
- Cabeçalhos de segurança (CSP, X-Frame-Options, etc.) via `helmet`.
- **Antes de publicar na internet**: defina uma senha forte em `ADMIN_PASSWORD` (nunca
  use a senha padrão) e sirva o site atrás de HTTPS (a maioria dos provedores de deploy —
  Render, Railway, Fly.io, etc. — já fornece isso automaticamente).
- Se for rodar atrás de um proxy/load balancer, defina `TRUST_PROXY=true` no `.env` para
  o limite de tentativas identificar corretamente o IP de cada visitante.

## Variáveis de ambiente

| Variável         | Padrão               | Descrição                                              |
|------------------|----------------------|---------------------------------------------------------|
| `PORT`           | `3000`               | Porta do servidor                                        |
| `ADMIN_PASSWORD` | `admin123`           | Senha do painel admin — **troque em produção**            |
| `DATA_DIR`       | pasta `data/` do projeto | Onde ficam `cars.json` e `uploads/`. Em produção, aponte para um disco persistente |
| `TRUST_PROXY`    | (vazio)              | `true` se estiver atrás de proxy/load balancer            |

## Deploy no Render (deixar o site público)

O app precisa de **disco persistente** (os dados e fotos não podem viver só na pasta do
código, que é recriada a cada deploy). O plano gratuito de Web Service do Render **não**
suporta disco persistente — é necessário um plano pago que suporte disco (na época em que
este guia foi escrito, o plano "Starter" custava algo em torno de US$7/mês + uma taxa
pequena por GB de disco, algo como US$0,25/GB/mês — **confira o valor atual em
render.com/pricing antes de assinar**, pois preços mudam).

O repositório já inclui um `render.yaml` pronto (Blueprint), então o deploy é quase
automático:

1. Crie uma conta em [render.com](https://render.com) (dá para entrar com sua conta do
   GitHub).
2. No painel do Render, clique em **New +** → **Blueprint**.
3. Conecte sua conta do GitHub e selecione o repositório `ptktoussaint/Spawnfluxo`.
4. Escolha o branch `claude/game-car-spawn-manager-kjb84n` (ou o branch para onde você
   mesclar essas mudanças, ex. `main`).
5. O Render vai ler o `render.yaml` automaticamente e mostrar o serviço `spawnfluxo` com
   um disco de 1GB já configurado. Confirme.
6. Antes de criar, o Render vai pedir o valor da variável `ADMIN_PASSWORD` (ela não tem
   valor padrão de propósito) — digite uma senha forte ali.
7. Clique em **Apply**/**Create**. O primeiro deploy demora alguns minutos.
8. Quando terminar, o Render te dá uma URL pública tipo
   `https://spawnfluxo.onrender.com` — é esse o link que você compartilha com as outras
   pessoas.
9. Acesse `https://spawnfluxo.onrender.com/admin.html` e faça login com a senha que você
   definiu no passo 6.

Depois disso, qualquer novo `git push` no branch conectado atualiza o site automaticamente
(o disco persistente mantém os veículos e fotos cadastrados entre os deploys).

### Alternativa: configurar manualmente (sem usar o Blueprint)

Se preferir não usar o `render.yaml`, dá para criar o Web Service manualmente no Render:
- **Build Command**: `npm install`
- **Start Command**: `npm start`
- Adicione um **Disk**: mount path `/var/data`, tamanho 1GB
- Variáveis de ambiente: `ADMIN_PASSWORD` (sua senha), `DATA_DIR=/var/data`,
  `TRUST_PROXY=true`
