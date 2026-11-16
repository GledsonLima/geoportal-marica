-- ============================================================================
-- 07d6_zoneamento — SIGWEB SBN Maricá · Zoneamento (LC nº 400/2025) · PARTE 6 de 6
--
-- Final: geometria para a web, índices, permissões (RLS) e a função de leitura do
-- site. Rode só depois de todas as partes anteriores.
--
-- O SQL Editor do Supabase recusa scripts grandes; por isso o zoneamento vem em
-- 6 partes. RODE NA ORDEM: 07d1, 07d2, ... 07d6. Pode repetir qualquer
-- parte (os registros têm id fixo e são atualizados, não duplicados).
-- ============================================================================

set search_path = public, extensions;

-- Geometria para a web: tolerância de 2 m (invisível na escala do município).
update public.aux_zoneamento set geom_web = ST_Transform(ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_SimplifyPreserveTopology(geom, 2)), 3)), 4326);
create index if not exists aux_zoneamento_geom_gix on public.aux_zoneamento using gist (geom);
analyze public.aux_zoneamento;

-- Geometria para a web: tolerância de 0 m (invisível na escala do município).
update public.aux_zoneamento_pontos set geom_web = ST_Transform(geom, 4326);
create index if not exists aux_zoneamento_pontos_geom_gix on public.aux_zoneamento_pontos using gist (geom);
analyze public.aux_zoneamento_pontos;

-- Geometria para a web: tolerância de 2 m (invisível na escala do município).
update public.aux_zoneamento_viario set geom_web = ST_Transform(ST_Multi(ST_SimplifyPreserveTopology(geom, 2)), 4326);
create index if not exists aux_zoneamento_viario_geom_gix on public.aux_zoneamento_viario using gist (geom);
analyze public.aux_zoneamento_viario;

alter table public.aux_zoneamento enable row level security;
drop policy if exists "leitura publica aux_zoneamento" on public.aux_zoneamento;
create policy "leitura publica aux_zoneamento" on public.aux_zoneamento for select to anon, authenticated using (true);
revoke insert, update, delete, truncate on public.aux_zoneamento from anon, authenticated;
grant select on public.aux_zoneamento to anon, authenticated;

alter table public.aux_zoneamento_pontos enable row level security;
drop policy if exists "leitura publica aux_zoneamento_pontos" on public.aux_zoneamento_pontos;
create policy "leitura publica aux_zoneamento_pontos" on public.aux_zoneamento_pontos for select to anon, authenticated using (true);
revoke insert, update, delete, truncate on public.aux_zoneamento_pontos from anon, authenticated;
grant select on public.aux_zoneamento_pontos to anon, authenticated;

alter table public.aux_zoneamento_viario enable row level security;
drop policy if exists "leitura publica aux_zoneamento_viario" on public.aux_zoneamento_viario;
create policy "leitura publica aux_zoneamento_viario" on public.aux_zoneamento_viario for select to anon, authenticated using (true);
revoke insert, update, delete, truncate on public.aux_zoneamento_viario from anon, authenticated;
grant select on public.aux_zoneamento_viario to anon, authenticated;

-- ------------------------------------------------ função única de leitura (site)
-- Recebe o nome de uma camada e devolve um FeatureCollection. O nome é comparado
-- com uma lista fixa (CASE): nenhum texto do usuário vira SQL. Se uma das tabelas
-- ainda não existir (outro script 07 não rodou), só aquela camada falha.
create or replace function public.camada_auxiliar(p_camada text)
returns json
language plpgsql stable security invoker
set search_path = public, extensions
as $$
declare r json;
begin
  case p_camada
  when 'bairros' then
    select json_build_object('type','FeatureCollection','features', coalesce(json_agg(json_build_object(
      'type','Feature','id',b.id,
      'properties', json_build_object('nome', b.nome, 'distrito', b.distrito, 'cod_bairro', b.cod_bairro),
      'geometry', ST_AsGeoJSON(b.geom_web, 6)::json) order by b.id), '[]'::json))
      into r from public.aux_bairros b;
  when 'unidades_conservacao' then
    select json_build_object('type','FeatureCollection','features', coalesce(json_agg(json_build_object(
      'type','Feature','id',u.id,
      'properties', json_build_object('nome', u.nome, 'categoria', u.categoria, 'grupo', u.grupo,
                                      'esfera', u.esfera, 'area_ha', u.area_ha),
      'geometry', ST_AsGeoJSON(u.geom_web, 6)::json) order by u.area_ha desc), '[]'::json))
      into r from public.aux_unidades_conservacao u;
  when 'corpos_hidricos' then
    select json_build_object('type','FeatureCollection','features', coalesce(json_agg(json_build_object(
      'type','Feature','id',h.id,
      'properties', json_build_object('nome', h.nome, 'tipo', h.tipo),
      'geometry', ST_AsGeoJSON(h.geom_web, 6)::json) order by h.id), '[]'::json))
      into r from public.aux_corpos_hidricos h;
  when 'zoneamento' then
    select json_build_object('type','FeatureCollection','features', coalesce(json_agg(json_build_object(
      'type','Feature','id',z.id,
      'properties', json_build_object('zona', z.zona, 'nome', z.nome, 'sigla', z.sigla, 'tipo', z.tipo, 'ordem', z.ordem),
      'geometry', ST_AsGeoJSON(z.geom_web, 6)::json) order by z.ordem, z.id), '[]'::json))
      into r from public.aux_zoneamento z;
  when 'zoneamento_pontos' then
    select json_build_object('type','FeatureCollection','features', coalesce(json_agg(json_build_object(
      'type','Feature','id',p.id,
      'properties', json_build_object('nome', p.nome, 'categoria', p.categoria),
      'geometry', ST_AsGeoJSON(p.geom_web, 6)::json) order by p.id), '[]'::json))
      into r from public.aux_zoneamento_pontos p;
  when 'zoneamento_viario' then
    select json_build_object('type','FeatureCollection','features', coalesce(json_agg(json_build_object(
      'type','Feature','id',v.id,
      'properties', json_build_object('classe', v.classe, 'acao', v.acao),
      'geometry', ST_AsGeoJSON(v.geom_web, 6)::json) order by v.id), '[]'::json))
      into r from public.aux_zoneamento_viario v;
  else
    raise exception 'Camada auxiliar desconhecida: %', p_camada using errcode = '22023';
  end case;
  return r;
end $$;

revoke all on function public.camada_auxiliar(text) from public;
grant execute on function public.camada_auxiliar(text) to anon, authenticated;

-- Avisa a API (PostgREST) de que há tabela/função nova.
notify pgrst, 'reload schema';

-- ------------------------------------------------------------- conferência
-- Esperado: poligonos 94 · pontos 13 · trechos_viarios 127 · geom_invalidas 0 · sem_geom_web 0
select (select count(*) from public.aux_zoneamento)          as poligonos,
       (select count(*) from public.aux_zoneamento_pontos)   as pontos,
       (select count(*) from public.aux_zoneamento_viario)   as trechos_viarios,
       (select count(*) from public.aux_zoneamento where not ST_IsValid(geom)) as geom_invalidas,
       (select count(*) from public.aux_zoneamento where geom_web is null or ST_IsEmpty(geom_web)) as sem_geom_web;

-- Polígonos por zona (esperado: AEIS 58, Orla 9 ...)
select ordem, sigla, zona, count(*) as poligonos, round((sum(ST_Area(geom)) / 1e4)::numeric, 1) as area_ha
  from public.aux_zoneamento group by ordem, sigla, zona order by ordem;
