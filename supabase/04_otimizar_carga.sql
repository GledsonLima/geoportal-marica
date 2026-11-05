-- =====================================================================
-- PASSO OPCIONAL (recomendado) — carga mais rápida do mapa
-- Onde rodar: painel do Supabase > SQL Editor > New query > colar > Run
-- Rodar DEPOIS do script 02. Pode ser executado mais de uma vez.
--
-- O que faz: cria a função hex_mapa_web(), que devolve só h3_index e
-- indicador_final (o suficiente para desenhar o mapa, filtrar e analisar
-- uploads). O site passa a baixar cerca de 0,3 MB em vez de 2,6 MB e busca
-- os outros 12 indicadores de UMA célula só quando ela é clicada.
-- Se esta função não existir, o site continua funcionando com a função
-- completa (hex_dados_web), apenas mais devagar.
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
    'campos', json_build_array('h3_index', 'indicador_final'),
    -- 6 casas: não muda de classe Jenks perto das quebras
    'linhas', coalesce(json_agg(json_build_array(h.h3_index, round(h.indicador_final::numeric, 6))), '[]'::json)
  )
  from public.hex_indicadores_completos h;
$$;

revoke execute on function public.hex_mapa_web() from public;
grant execute on function public.hex_mapa_web() to anon, authenticated;

notify pgrst, 'reload schema';

-- Conferência: deve retornar 23849
select json_array_length((public.hex_mapa_web() ->> 'linhas')::json) as linhas;
