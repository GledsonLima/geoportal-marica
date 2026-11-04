-- =====================================================================
-- PASSO 3 — Preparar as tabelas importadas e publicar a API do geoportal
-- Onde rodar: painel do Supabase > SQL Editor > New query > colar > Run
-- Rodar DEPOIS de importar as duas camadas com ogr2ogr (PASSO 2 do README):
--   public.hex_indicadores_completos  (grade H3 res. 10, EPSG:31983)
--   public.limites_distritais         (4 distritos, EPSG:31983)
-- O script pode ser executado mais de uma vez sem problema (idempotente).
--
-- Arquitetura (dados -> serviço -> cliente):
--   tabelas em EPSG:31983 (SRC de análise do projeto, UTM 23S)
--     -> views em EPSG:4326 (o que a web consome; GeoJSON exige WGS84)
--     -> PostgREST (API REST automática do Supabase) com RLS = somente leitura
--     -> navegador (GitHub Pages) com a chave pública "anon"
-- =====================================================================

set search_path = public, extensions;

-- ---------------------------------------------------------------------
-- 3.1  Normalizar o nome da coluna com acento ("população" -> "populacao")
--      Nomes com ç/ã funcionam no Postgres, mas exigem aspas e atrapalham
--      URLs da API. O frontend usa o nome sem acento.
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'hex_indicadores_completos'
               and column_name = 'grupo_1_mapa_2_população') then
    alter table public.hex_indicadores_completos
      rename column "grupo_1_mapa_2_população" to grupo_1_mapa_2_populacao;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 3.2  Chave primária = h3_index (o ogr2ogr cria "ogc_fid" como PK)
-- ---------------------------------------------------------------------
do $$
declare v_pk text;
begin
  select conname into v_pk from pg_constraint
   where conrelid = 'public.hex_indicadores_completos'::regclass and contype = 'p';
  if v_pk is not null and not exists (
       select 1 from pg_constraint c
       join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
       where c.conname = v_pk and c.conrelid = 'public.hex_indicadores_completos'::regclass
         and a.attname = 'h3_index') then
    execute format('alter table public.hex_indicadores_completos drop constraint %I', v_pk);
  end if;
  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.hex_indicadores_completos'::regclass and contype = 'p') then
    alter table public.hex_indicadores_completos add primary key (h3_index);
  end if;
end $$;

-- Índice espacial (o ogr2ogr já cria com -lco SPATIAL_INDEX=GIST; aqui garante)
create index if not exists hex_indicadores_completos_geom_idx
  on public.hex_indicadores_completos using gist (geom);
create index if not exists limites_distritais_geom_idx
  on public.limites_distritais using gist (geom);

-- Estatísticas atualizadas para o planejador de consultas
analyze public.hex_indicadores_completos;
analyze public.limites_distritais;

-- ---------------------------------------------------------------------
-- 3.3  Segurança: Row Level Security (RLS) = somente leitura pública
--      A chave "anon" fica visível no código do site (isso é normal).
--      Quem protege os dados é o RLS: sem política de INSERT/UPDATE/DELETE,
--      ninguém escreve com a chave pública. Além disso revogamos as escritas.
-- ---------------------------------------------------------------------
alter table public.hex_indicadores_completos enable row level security;
alter table public.limites_distritais        enable row level security;

drop policy if exists "leitura publica" on public.hex_indicadores_completos;
create policy "leitura publica" on public.hex_indicadores_completos
  for select to anon, authenticated using (true);

drop policy if exists "leitura publica" on public.limites_distritais;
create policy "leitura publica" on public.limites_distritais
  for select to anon, authenticated using (true);

revoke insert, update, delete, truncate on public.hex_indicadores_completos from anon, authenticated;
revoke insert, update, delete, truncate on public.limites_distritais        from anon, authenticated;
grant select on public.hex_indicadores_completos to anon, authenticated;
grant select on public.limites_distritais        to anon, authenticated;

-- ---------------------------------------------------------------------
-- 3.4  Views de publicação em EPSG:4326
--      security_invoker = true -> a view respeita o RLS da tabela de origem
--      (sem isso, a view rodaria com os privilégios do dono e "furaria" o RLS).
-- ---------------------------------------------------------------------
drop view if exists public.vw_limites_distritais;
create view public.vw_limites_distritais with (security_invoker = true) as
select
  d.nm_dist,
  st_transform(d.geom, 4326)::geometry(MultiPolygon, 4326) as geom
from public.limites_distritais d;

-- Grade com geometria (uso: catálogo, QGIS, alternativa ao modo h3 do frontend).
-- Atenção: 23.849 polígonos -> resposta pesada; o frontend NÃO usa esta view
-- por padrão (ele reconstrói os hexágonos a partir do h3_index).
drop view if exists public.vw_hex_web;
create view public.vw_hex_web with (security_invoker = true) as
select
  h.h3_index,
  round(h.indicador_final::numeric, 6)                     as indicador_final,
  round(h.indicador_mapa1::numeric, 3)                     as indicador_mapa1,
  round(h.indicador_mapa2::numeric, 3)                     as indicador_mapa2,
  round(h.indicador_mapa3::numeric, 3)                     as indicador_mapa3,
  st_transform(h.geom, 4326)::geometry(MultiPolygon, 4326) as geom
from public.hex_indicadores_completos h;

grant select on public.vw_limites_distritais, public.vw_hex_web to anon, authenticated;

-- ---------------------------------------------------------------------
-- 3.5  Função RPC "hex_dados_web": todos os indicadores em UM pedido, compacto
--      Por quê:
--       * a API do Supabase devolve no máximo 1000 linhas por pedido em tabelas;
--         uma função que retorna um único JSON não tem esse limite;
--       * formato "colunas + linhas" (sem repetir o nome dos campos) e valores
--         arredondados (3 casas; indicador_final com 6) -> ~2 MB em vez de ~10 MB com geometria;
--       * a geometria do hexágono é reconstruída no navegador a partir do
--         h3_index (h3-js), idêntica à da tabela (diferença < 1 mm, conferida).
--      Chamada: GET {SUPABASE_URL}/rest/v1/rpc/hex_dados_web
-- ---------------------------------------------------------------------
create or replace function public.hex_dados_web()
returns json
language sql
stable
security invoker
set search_path = public, extensions
as $$
  select json_build_object(
    'campos', json_build_array(
      'h3_index', 'indicador_final',
      'indicador_mapa1', 'indicador_mapa2', 'indicador_mapa3',
      'grupo_1_mapa_1_inunda_alagamento', 'grupo_2_mapa_1_dinami_costeira',
      'grupo_3_mapa_1_movimento_massa', 'grupo_4_mapa_1_ameaca_termica',
      'grupo_1_mapa_2_populacao', 'grupo_2_mapa_2_infra_servicos',
      'grupo_3_mapa_2_ocupa_territorio',
      'grupo_1_mapa_3_fragi_infra_urbana', 'grupo_2_mapa_3_capa_adap_socioecono'),
    'linhas', coalesce(json_agg(json_build_array(
      h.h3_index,
      round(h.indicador_final::numeric, 6),   -- 6 casas: não mudar de classe Jenks perto das quebras
      round(h.indicador_mapa1::numeric, 3),
      round(h.indicador_mapa2::numeric, 3),
      round(h.indicador_mapa3::numeric, 3),
      round(h.grupo_1_mapa_1_inunda_alagamento::numeric, 3),
      round(h.grupo_2_mapa_1_dinami_costeira::numeric, 3),
      round(h.grupo_3_mapa_1_movimento_massa::numeric, 3),
      round(h.grupo_4_mapa_1_ameaca_termica::numeric, 3),
      round(h.grupo_1_mapa_2_populacao::numeric, 3),
      round(h.grupo_2_mapa_2_infra_servicos::numeric, 3),
      round(h.grupo_3_mapa_2_ocupa_territorio::numeric, 3),
      round(h.grupo_1_mapa_3_fragi_infra_urbana::numeric, 3),
      round(h.grupo_2_mapa_3_capa_adap_socioecono::numeric, 3)
    ) order by h.h3_index), '[]'::json)
  )
  from public.hex_indicadores_completos h;
$$;

revoke execute on function public.hex_dados_web() from public;
grant execute on function public.hex_dados_web() to anon, authenticated;

-- ---------------------------------------------------------------------
-- 3.6  Catálogo de camadas (metadados mínimos)
--      A chave pública não consegue listar as tabelas do banco (o Supabase
--      bloqueia isso por segurança). Por isso o geoportal lê ESTA tabela
--      para saber quais camadas extras oferecer no painel "Camadas do Supabase".
--      Para publicar uma camada nova: importar (ogr2ogr), criar uma view em
--      EPSG:4326 com RLS de leitura e inserir uma linha aqui (ver README).
-- ---------------------------------------------------------------------
create table if not exists public.catalogo_camadas (
  id              bigint generated always as identity primary key,
  tabela          text not null unique
                  check (tabela ~ '^[a-z_][a-z0-9_]*$'),   -- só nomes simples
  titulo          text not null,
  descricao       text,
  fonte           text,                                   -- origem/autoria do dado
  tipo_geometria  text not null default 'poligono'
                  check (tipo_geometria in ('poligono', 'linha', 'ponto')),
  cor             text not null default '#ff7f00'
                  check (cor ~ '^#[0-9a-fA-F]{6}$'),
  campo_rotulo    text,                                   -- campo para rótulo (opcional)
  campo_ordem     text,                                   -- chave estável p/ paginação (recomendado)
  visivel_inicial boolean not null default false,
  ordem           integer not null default 100,
  ativo           boolean not null default true,
  criado_em       timestamptz not null default now()
);

alter table public.catalogo_camadas enable row level security;
drop policy if exists "leitura publica" on public.catalogo_camadas;
create policy "leitura publica" on public.catalogo_camadas
  for select to anon, authenticated using (ativo);
revoke insert, update, delete, truncate on public.catalogo_camadas from anon, authenticated;
grant select on public.catalogo_camadas to anon, authenticated;

-- Exemplo já cadastrado: a própria grade com geometria, desligada por padrão
-- (serve para testar o catálogo; é pesada, ~23 mil polígonos).
insert into public.catalogo_camadas
  (tabela, titulo, descricao, fonte, tipo_geometria, cor, campo_ordem, visivel_inicial, ordem)
values
  ('vw_hex_web', 'Grade H3 (geometria do banco)',
   'Mesma grade da camada principal, mas com a geometria vinda do PostGIS. Use para conferência.',
   'Estudo Estratégico de adaptação climática com SbN — Maricá-RJ',
   'poligono', '#6a3d9a', 'h3_index', false, 900)
on conflict (tabela) do nothing;

-- ---------------------------------------------------------------------
-- 3.7  Recarregar o cache de schema da API (faz as views/funções aparecerem)
-- ---------------------------------------------------------------------
notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- Conferência (os números devem bater com o QGIS)
-- ---------------------------------------------------------------------
select 'hex_indicadores_completos' as camada, count(*) as feicoes,
       min(indicador_final) as minimo, max(indicador_final) as maximo,
       count(*) filter (where grupo_1_mapa_2_populacao is null) as populacao_nula
from public.hex_indicadores_completos
union all
select 'limites_distritais', count(*), null, null, null from public.limites_distritais;
-- Esperado: 23849 hexágonos, mínimo ~1,263, máximo ~3,588, populacao_nula 0; 4 distritos.
