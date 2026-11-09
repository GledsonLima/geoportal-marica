/* =====================================================================
   api.js — conversa com a API REST do banco (PostgREST).

   Fluxo de uma requisição:
     navegador --GET /rest/v1/<recurso>--> PostgREST --> PostgreSQL/PostGIS
                                                 (RLS: só leitura)
               <-- JSON, ou GeoJSON quando Accept: application/geo+json --

   SEGURANÇA
     * Nenhuma consulta é montada por concatenação de texto vindo do usuário:
       identificadores passam por NOME_VALIDO e valores por encodeURIComponent.
       Consultas com parâmetro usam RPC com argumentos tipados no banco, que é
       o equivalente, no PostgREST, a uma query parametrizada.
     * A chave é pública por desenho (ver js/config.js); quem protege os
       dados é o RLS. app.js recusa iniciar se detectar chave secreta.
   ===================================================================== */
window.SIGWEB = window.SIGWEB || {};
(function (NS) {
  'use strict';

  var CFG = window.GEOPORTAL_CONFIG || {};

  var URL_BASE = String(CFG.SUPABASE_URL || '').trim()
    .replace(/\/+$/, '').replace(/\/rest\/v1$/, '');
  var CHAVE = String(CFG.SUPABASE_ANON_KEY || '').trim();

  var PAGINA = 1000;                                   // teto padrão de linhas por pedido
  var MAX_FEICOES = CFG.MAX_FEICOES_CAMADA || 20000;

  /** Nome de tabela/view aceitável: evita montar URL com texto arbitrário. */
  var NOME_VALIDO = /^[a-z_][a-z0-9_]*$/;

  NS.api = {
    URL_BASE: URL_BASE,
    CHAVE: CHAVE,
    PAGINA: PAGINA,
    MAX_FEICOES: MAX_FEICOES,
    NOME_VALIDO: NOME_VALIDO
  };

  /** Papel da chave: anon | authenticated | service_role | publishable | secret. */
  NS.api.papelDaChave = function (chave) {
    chave = chave || CHAVE;
    if (chave.indexOf('sb_secret_') === 0) return 'secret';
    if (chave.indexOf('sb_publishable_') === 0) return 'publishable';
    try {
      var b64 = chave.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(atob(b64)).role || 'desconhecido';
    } catch (e) { return 'desconhecido'; }
  };

  function cabecalhos(extra) {
    var h = Object.assign({ apikey: CHAVE }, extra || {});
    // Chaves JWT (anon) vão também no Authorization; as novas "sb_publishable_" não.
    if (CHAVE.split('.').length === 3) h.Authorization = 'Bearer ' + CHAVE;
    return h;
  }

  /**
   * Transforma a resposta de erro numa mensagem que o visitante entende.
   * O detalhe técnico vai para o console, não para a tela.
   */
  async function erroDaResposta(resp, recurso) {
    var corpo = {};
    try { corpo = await resp.json(); } catch (e) { /* corpo não-JSON */ }
    var cod = corpo.code || '';
    var msg;
    if (resp.status === 401 || resp.status === 403) {
      msg = 'Acesso negado pela base de dados ao ler "' + recurso + '".';
    } else if (cod === 'PGRST202') {
      msg = 'A função "' + recurso + '" não existe na base de dados.';
    } else if (cod === 'PGRST205' || resp.status === 404) {
      msg = 'A camada "' + recurso + '" não foi encontrada na base de dados.';
    } else if (cod === '57014') {
      msg = 'A consulta a "' + recurso + '" demorou demais e foi cancelada.';
    } else {
      msg = 'Erro ' + resp.status + ' ao ler "' + recurso + '".';
    }
    console.error('[api] falha em', recurso, resp.status, corpo);
    var err = new Error(msg);
    err.status = resp.status; err.code = cod; err.detalhe = corpo;
    return err;
  }

  /**
   * GET na API REST.
   * @param {string} caminho  ex.: "rpc/hex_mapa_web" ou "vw_x?select=*&limit=10"
   * @param {object} [opt]    { geojson: true } pede application/geo+json
   */
  NS.api.get = async function (caminho, opt) {
    opt = opt || {};
    var url = URL_BASE + '/rest/v1/' + caminho;
    var recurso = caminho.split('?')[0].replace(/^rpc\//, '');
    var resp;
    try {
      resp = await fetch(url, {
        headers: cabecalhos({ Accept: opt.geojson ? 'application/geo+json' : 'application/json' })
      });
    } catch (e) {
      console.error('[api] sem resposta da base de dados:', e);
      throw new Error('Não foi possível contatar a base de dados. Verifique sua conexão e tente novamente.');
    }
    if (!resp.ok) throw await erroDaResposta(resp, recurso);
    return resp.json();
  };

  /**
   * Lê uma tabela/view inteira como GeoJSON, paginando de PAGINA em PAGINA.
   * O PostgREST limita o número de linhas por resposta, por isso o laço.
   */
  NS.api.getGeoJSONPaginado = async function (tabela, campoOrdem, aoProgredir) {
    if (!NOME_VALIDO.test(tabela)) throw new Error('Nome de camada inválido.');
    var feicoes = [];
    for (var offset = 0; offset < MAX_FEICOES; offset += PAGINA) {
      var q = tabela + '?select=*&limit=' + PAGINA + '&offset=' + offset;
      if (campoOrdem && NOME_VALIDO.test(campoOrdem)) q += '&order=' + encodeURIComponent(campoOrdem) + '.asc';
      var fc = await NS.api.get(q, { geojson: true });
      var lote = (fc && fc.features) || [];
      feicoes.push.apply(feicoes, lote);
      if (aoProgredir) aoProgredir(feicoes.length);
      if (lote.length < PAGINA) return { features: feicoes, truncado: false };
    }
    return { features: feicoes.slice(0, MAX_FEICOES), truncado: true };
  };

  /**
   * Confere se as coordenadas parecem graus (EPSG:4326) e não metros (ex.: UTM 31983).
   * Armadilha clássica: publicar uma view sem ST_Transform e o mapa ficar vazio.
   */
  NS.api.pareceWGS84 = function (features) {
    for (var i = 0; i < features.length; i++) {
      var f = features[i];
      if (!f.geometry) continue;
      var c = f.geometry.coordinates;
      while (Array.isArray(c) && Array.isArray(c[0])) c = c[0];
      if (Array.isArray(c) && c.length >= 2) return Math.abs(c[0]) <= 180 && Math.abs(c[1]) <= 90;
    }
    return true;
  };

})(window.SIGWEB);
