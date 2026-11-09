-- =====================================================================
-- PASSO 5 — espacializar os TRÊS MAPAS INTERMEDIÁRIOS
-- Onde rodar: painel do Supabase > SQL Editor > New query > colar > Run
-- Rodar DEPOIS dos scripts 02 e 04. Pode ser executado mais de uma vez.
--
-- POR QUE ESTE SCRIPT EXISTE
-- Os três mapas que originaram o Índice de Risco Climático já estão no
-- banco, na mesma tabela e na mesma grade H3:
--     indicador_mapa1 -> Ameaça Climática
--     indicador_mapa2 -> Exposição Socioambiental
--     indicador_mapa3 -> Vulnerabilidade Climática
-- Não há nada para importar: basta devolvê-los junto com o índice final,
-- numa única requisição. A função hex_mapa_web() do script 04 passa a
-- devolver 5 colunas em vez de 2 (de ~0,3 MB para ~0,6 MB comprimidos),
-- e o site desenha as quatro camadas sem nenhuma consulta adicional.
--
-- PRECISÃO DAS CASAS DECIMAIS
--   indicador_final: 6 casas, para não mudar de classe perto das quebras
--     de Jenks do estudo (a menor distância entre quebras é ~0,31).
--   mapas intermediários: 4 casas. As quebras publicadas têm 2 casas,
--     então 4 dão duas ordens de grandeza de folga.
-- =====================================================================
set search_path = public, extensions;

create or replace function public.hex_mapa_web()
returns json
language sql
stable
security invoker
set search_path = public, extensions
as $$
  select json_build_object(
    'campos', json_build_array(
      'h3_index', 'indicador_final',
      'indicador_mapa1', 'indicador_mapa2', 'indicador_mapa3'
    ),
    'linhas', coalesce(
      json_agg(
        json_build_array(
          h.h3_index,
          round(h.indicador_final::numeric, 6),
          round(h.indicador_mapa1::numeric, 4),
          round(h.indicador_mapa2::numeric, 4),
          round(h.indicador_mapa3::numeric, 4)
        )
        order by h.h3_index          -- ordem fixa: resposta estável e bem comprimida
      ), '[]'::json)
  )
  from public.hex_indicadores_completos h
  where h.h3_index is not null;
$$;

revoke execute on function public.hex_mapa_web() from public;
grant execute on function public.hex_mapa_web() to anon, authenticated;

notify pgrst, 'reload schema';

-- =====================================================================
-- CONFERÊNCIA 1 — deve devolver 23849
-- =====================================================================
select json_array_length((public.hex_mapa_web() ->> 'linhas')::json) as linhas;

-- =====================================================================
-- CONFERÊNCIA 2 — mínimos e máximos de cada mapa.
-- Devem bater com as legendas impressas do estudo:
--   Ameaça Climática ............ 1,31 a 3,21
--   Exposição Socioambiental .... 1,00 a 4,55
--   Vulnerabilidade Climática ... 1,00 a 4,91
-- A última coluna mostra quantas células estão no valor mínimo. Em
-- indicador_mapa3 são ~17.255 (72% da grade), o que explica por que a
-- primeira classe da Vulnerabilidade cobre quase todo o município.
-- =====================================================================
select 'indicador_mapa1 (Ameaça Climática)'        as mapa,
       round(min(indicador_mapa1)::numeric, 3)     as minimo,
       round(max(indicador_mapa1)::numeric, 3)     as maximo,
       count(*) filter (where indicador_mapa1 = (select min(indicador_mapa1) from public.hex_indicadores_completos)) as celulas_no_minimo
  from public.hex_indicadores_completos
union all
select 'indicador_mapa2 (Exposição Socioambiental)',
       round(min(indicador_mapa2)::numeric, 3),
       round(max(indicador_mapa2)::numeric, 3),
       count(*) filter (where indicador_mapa2 = (select min(indicador_mapa2) from public.hex_indicadores_completos))
  from public.hex_indicadores_completos
union all
select 'indicador_mapa3 (Vulnerabilidade Climática)',
       round(min(indicador_mapa3)::numeric, 3),
       round(max(indicador_mapa3)::numeric, 3),
       count(*) filter (where indicador_mapa3 = (select min(indicador_mapa3) from public.hex_indicadores_completos))
  from public.hex_indicadores_completos;
