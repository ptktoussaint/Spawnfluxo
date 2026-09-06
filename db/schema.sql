-- Rode isto no SQL Editor do Supabase (Project > SQL Editor > New query) uma
-- única vez, antes de rodar o Spawnfluxo pela primeira vez contra esse projeto.

create table if not exists cars (
  id uuid primary key,
  name text not null,
  spawn_code text not null,
  categories text[] not null default '{}',
  photo_url text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists categories (
  slug text primary key,
  name text not null,
  updated_at timestamptz not null default now()
);
