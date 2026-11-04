-- =====================================================================
-- PASSO 1 — Ativar o PostGIS no Supabase
-- Onde rodar: painel do Supabase > SQL Editor > New query > colar > Run
-- Rodar ANTES de importar os dados com ogr2ogr.
-- =====================================================================
-- O Supabase recomenda instalar extensões no schema "extensions"
-- (e não em "public"), para que tabelas internas do PostGIS, como
-- spatial_ref_sys, não fiquem expostas pela API REST.
create extension if not exists postgis with schema extensions;

-- Conferência: deve retornar a versão do PostGIS (ex.: 3.3 ...)
select extensions.postgis_full_version();
