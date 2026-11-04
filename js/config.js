// =====================================================================
// CONFIGURAÇÃO DO GEOPORTAL — é o único arquivo que você precisa editar
// para apontar o site para outro projeto Supabase.
// =====================================================================
// SEGURANÇA:
//  * Use SOMENTE a chave pública ("anon" ou "publishable", sb_publishable_...).
//    Ela foi feita para ficar visível no navegador; quem protege os dados
//    é o RLS configurado no banco (supabase/02_preparar_tabelas_e_api.sql).
//  * NUNCA coloque aqui a chave "service_role" / "secret" (sb_secret_...):
//    ela ignora o RLS e daria a qualquer visitante poder de apagar o banco.
//    O app.js se recusa a iniciar se detectar uma chave desse tipo.
// =====================================================================
window.GEOPORTAL_CONFIG = {
  // URL do projeto (com ou sem "/rest/v1/" no final — o código normaliza)
  SUPABASE_URL: 'https://iitjbwuopjgrsmndczxh.supabase.co',

  // Chave pública "anon" do projeto (Settings > API Keys)
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlpdGpid3VvcGpncnNtbmRjenhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM4MDIyMDEsImV4cCI6MjEwOTM3ODIwMX0.P5_PMzXnh9f9MAnoF4CEEKTCIhAlgaALfrbq5c11eLc',

  // Objetos publicados no banco (criados pelo script 02)
  RPC_HEX: 'hex_dados_web',              // função que devolve os indicadores
  VIEW_DISTRITOS: 'vw_limites_distritais',
  TABELA_CATALOGO: 'catalogo_camadas',

  // Resolução H3 esperada da grade (usada na análise de pontos enviados)
  H3_RESOLUCAO: 10,

  // Limite de feições por camada do catálogo (proteção do navegador)
  MAX_FEICOES_CAMADA: 20000
};
