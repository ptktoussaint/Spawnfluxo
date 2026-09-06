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

Os veículos ficam em `data/cars.json` (formato simples, sem banco de dados externo).
As fotos enviadas pelo formulário ficam em `public/uploads/`.

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

| Variável         | Padrão      | Descrição                                   |
|------------------|-------------|----------------------------------------------|
| `PORT`           | `3000`      | Porta do servidor                             |
| `ADMIN_PASSWORD` | `admin123`  | Senha do painel admin — **troque em produção** |
| `TRUST_PROXY`    | (vazio)     | `true` se estiver atrás de proxy/load balancer |

## Deploy

Como os dados ficam em `data/cars.json` e as fotos em `public/uploads/`, escolha um
provedor com **disco persistente** (ex.: uma VM, Railway/Render com volume persistente).
Em plataformas totalmente efêmeras (sem disco persistente), os dados cadastrados podem
ser perdidos a cada novo deploy.
