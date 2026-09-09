-- Migração: adiciona suporte à aba "Spawn de Itens" num projeto que já tinha
-- as tabelas `cars`/`categories` da aba "Spawn de Veículos" (schema anterior,
-- sem a coluna `type`).
--
-- Rode isto no SQL Editor do Supabase UMA ÚNICA VEZ, ANTES de fazer deploy do
-- código que introduz as abas. Não é destrutivo: todos os veículos e
-- categorias existentes continuam intactos, só ganham type = 'veiculo'.
--
-- Se você está configurando o projeto do zero (tabelas ainda não existem),
-- NÃO rode este arquivo — rode `db/schema.sql` em vez disso.

alter table cars add column if not exists type text not null default 'veiculo';
alter table cars add constraint cars_type_check check (type in ('veiculo', 'item'));

alter table categories add column if not exists type text not null default 'veiculo';
alter table categories drop constraint if exists categories_pkey;
alter table categories add primary key (type, slug);
alter table categories add constraint categories_type_check check (type in ('veiculo', 'item'));
