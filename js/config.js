// =====================================================================
// CONFIGURAÇÃO DO SIGWEB — é o único arquivo que você precisa editar
// para apontar o site para outro projeto/banco.
// =====================================================================
// SEGURANÇA — por que a chave fica aqui, à vista:
//  * Um site estático (GitHub Pages) não tem servidor nem etapa de build,
//    e o navegador não lê arquivos .env. Mesmo com build, a chave acabaria
//    dentro do JavaScript publicado e visível no F12.
//  * Por isso use SOMENTE a chave pública ("anon" ou "publishable",
//    sb_publishable_...). Ela IDENTIFICA o projeto, não AUTORIZA nada:
//    quem protege os dados é o RLS do banco (supabase/02_preparar_tabelas_e_api.sql),
//    que libera apenas leitura. É o mesmo modelo de uma chave de Google Maps JS.
//  * NUNCA coloque aqui a chave "service_role" / "secret" (sb_secret_...):
//    ela ignora o RLS e daria a qualquer visitante poder de apagar o banco.
//    O app se recusa a iniciar se detectar uma chave desse tipo.
// =====================================================================
window.GEOPORTAL_CONFIG = {

  // ---- Conexão com a API REST do banco -------------------------------
  // URL do projeto (com ou sem "/rest/v1/" no final — o código normaliza)
  SUPABASE_URL: 'https://iitjbwuopjgrsmndczxh.supabase.co',

  // Chave pública "anon" do projeto
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlpdGpid3VvcGpncnNtbmRjenhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM4MDIyMDEsImV4cCI6MjEwOTM3ODIwMX0.P5_PMzXnh9f9MAnoF4CEEKTCIhAlgaALfrbq5c11eLc',

  // ---- Objetos publicados no banco -----------------------------------
  RPC_HEX_LEVE: 'hex_mapa_web',             // função leve (script 04): só h3_index + indicador_final
  RPC_HEX: 'hex_dados_web',                 // função completa (script 02): todos os indicadores
  TABELA_HEX: 'hex_indicadores_completos',  // tabela consultada no clique (detalhe de uma célula)
  VIEW_DISTRITOS: 'vw_limites_distritais',
  TABELA_CATALOGO: 'catalogo_camadas',      // não usada desde a v3.3.0 ("Outras camadas" saiu do menu)

  // ---- Áreas prioritárias e SbN (script 06) -----------------------------
  VIEW_AREAS: 'vw_areas_prioritarias',      // 60 áreas em EPSG:4326, com o vetor `temas`
  TABELA_TEMAS: 'tema_estrategico',         // 5 temas: nome, nome curto e cor
  RPC_TEMAS_DA_AREA: 'temas_da_area',       // parâmetro tipado p_num_area (smallint)
  RPC_SBN_DO_TEMA: 'sbn_do_tema',           // parâmetro tipado p_tema (smallint)
  RPC_FICHA: 'ficha_sbn',                   // parâmetro p_slug (text)
  RPC_FUNCOES: 'sbn_funcoes',               // as 20 funções da grade da ficha

  // ---- Município ------------------------------------------------------
  // Caixa envolvente usada para limitar a busca de endereços a Maricá.
  // Ordem: [oeste, sul, leste, norte] em graus decimais (EPSG:4326).
  BBOX_MARICA: [-43.05, -23.10, -42.55, -22.80],

  // Enquadramento inicial, usado antes de a grade carregar e ao clicar no logo.
  CENTRO_INICIAL: [-42.82, -22.92],
  ZOOM_INICIAL: 11,

  // ---- Mapas base ------------------------------------------------------
  // Opcional: chave da CARTO. Desde 2024 o endpoint gratuito sem chave
  // devolve tiles com a marca d'água "API KEY REQUIRED"; por isso os mapas
  // "Claro" e "Escuro" usam a Esri por padrão. Preenchendo esta chave
  // (conta gratuita em carto.com/basemaps), as opções CARTO aparecem na lista.
  // Atenção: tal como a chave acima, ela fica visível no navegador.
  CARTO_API_KEY: '',

  // ---- Limites de proteção do navegador --------------------------------
  H3_RESOLUCAO: 10,          // resolução H3 esperada da grade
  MAX_FEICOES_CAMADA: 20000  // teto de feições por camada do catálogo
};
