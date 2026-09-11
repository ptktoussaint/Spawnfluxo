-- Rode isto no SQL Editor do Supabase (Project > SQL Editor > New query) uma
-- única vez, antes de rodar o Spawnfluxo pela primeira vez contra esse projeto.
--
-- Se o seu projeto já tinha essas tabelas de antes da aba "Spawn de Itens"
-- existir (ou seja, `cars`/`categories` sem a coluna `type`), NÃO rode este
-- arquivo de novo — rode `db/migration-002-add-item-type.sql` em vez disso.

create table if not exists cars (
  id uuid primary key,
  type text not null default 'veiculo' check (type in ('veiculo', 'item')),
  name text not null,
  spawn_code text not null,
  categories text[] not null default '{}',
  photo_url text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists categories (
  type text not null default 'veiculo' check (type in ('veiculo', 'item')),
  slug text not null,
  name text not null,
  updated_at timestamptz not null default now(),
  primary key (type, slug)
);

-- Configuração do site (chave/valor). Hoje guarda os campos do "Cartão de
-- compartilhamento": share_title, share_description e share_image. Pode ficar
-- vazia — nesse caso o site usa os valores de reserva (nome/descrição/logo).
create table if not exists site_config (
  key text primary key,
  value text not null default '',
  updated_at timestamptz not null default now()
);
