-- Migração: cria a tabela de configuração do site, usada hoje pelo "Cartão de
-- compartilhamento" (as meta tags Open Graph que Discord/WhatsApp/Telegram/Slack
-- leem para montar a prévia do link).
--
-- Rode isto no SQL Editor do Supabase UMA ÚNICA VEZ, ANTES de fazer deploy do
-- código que introduz o cartão. Não mexe em nenhuma tabela existente: só cria
-- uma tabela nova e vazia (o site funciona normalmente com ela vazia, usando os
-- valores de reserva).
--
-- Se você está configurando o projeto do zero (tabelas ainda não existem),
-- NÃO rode este arquivo — rode `db/schema.sql`, que já inclui esta tabela.

create table if not exists site_config (
  key text primary key,
  value text not null default '',
  updated_at timestamptz not null default now()
);
