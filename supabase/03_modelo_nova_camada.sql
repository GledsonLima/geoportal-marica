-- =====================================================================
-- MODELO — publicar uma camada nova no painel "Camadas do Supabase"
-- Onde rodar: painel do Supabase > SQL Editor (depois de importar com ogr2ogr)
-- Troque:  minha_camada  -> nome da tabela importada (em EPSG:31983)
--          vw_minha_camada -> nome da view publicada (EPSG:4326)
--          títulos, cor, tipo de geometria e campos
-- =====================================================================
set search_path = public, extensions;

-- 1) Leitura pública protegida por RLS na tabela de origem
alter table public.minha_camada enable row level security;
drop policy if exists "leitura publica" on public.minha_camada;
create policy "leitura publica" on public.minha_camada
  for select to anon, authenticated using (true);
revoke insert, update, delete, truncate on public.minha_camada from anon, authenticated;
grant select on public.minha_camada to anon, authenticated;

-- 2) View de publicação em EPSG:4326 (só as colunas que devem aparecer no site)
--    ST_MakeValid evita que uma geometria inválida quebre o desenho no navegador.
drop view if exists public.vw_minha_camada;
create view public.vw_minha_camada with (security_invoker = true) as
select
  t.ogc_fid,                       -- chave estável (usada na paginação)
  t.nome,                          -- troque pelos campos reais
  st_transform(st_makevalid(t.geom), 4326) as geom
from public.minha_camada t;
grant select on public.vw_minha_camada to anon, authenticated;

-- 3) Registro no catálogo (é isto que faz a camada aparecer no site)
insert into public.catalogo_camadas
  (tabela, titulo, descricao, fonte, tipo_geometria, cor, campo_rotulo, campo_ordem, visivel_inicial, ordem)
values
  ('vw_minha_camada', 'Minha camada', 'Descrição curta do conteúdo.', 'Órgão/autor, ano',
   'poligono',        -- 'poligono' | 'linha' | 'ponto'
   '#e31a1c',         -- cor em hexadecimal
   'nome',            -- campo para rótulo (ou null)
   'ogc_fid',         -- campo de ordenação estável para paginação
   false, 10)
on conflict (tabela) do update set
  titulo = excluded.titulo, descricao = excluded.descricao, fonte = excluded.fonte,
  tipo_geometria = excluded.tipo_geometria, cor = excluded.cor, campo_rotulo = excluded.campo_rotulo,
  campo_ordem = excluded.campo_ordem, visivel_inicial = excluded.visivel_inicial, ordem = excluded.ordem;

notify pgrst, 'reload schema';

-- Dica: camadas acima de ~20 mil feições ficam pesadas no navegador. Para elas,
-- simplifique na view (ST_SimplifyPreserveTopology em metros, antes do ST_Transform)
-- ou avalie vector tiles (ST_AsMVT) numa próxima etapa.
