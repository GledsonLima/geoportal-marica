/* =====================================================================
   Geoportal "Mapeamento de Risco Climático de Maricá-RJ" — v2.1.0
   Lógica do frontend estático (GitHub Pages) + Supabase (PostgREST)

   Fluxo de ponta a ponta:
     navegador --GET /rest/v1/rpc/hex_dados_web--> Supabase (PostgREST)
               <-- JSON compacto (h3_index + 13 indicadores, ~2 MB) --
     h3-js reconstrói cada hexágono a partir do h3_index (sem baixar geometria)
     OpenLayers desenha e classifica (Jenks 5 classes) no próprio navegador
     distritos e camadas do catálogo: GET /rest/v1/<view> com
       Accept: application/geo+json (GeoJSON em EPSG:4326)

   Módulos: 0 config/guardas | 1 cliente Supabase | 2 classificação |
            3 mapa e camadas | 4 dados da grade | 5 legenda e filtro |
            6 distritos | 7 controles | 8 dashboard | 9 clique |
            10 catálogo | 11 upload e análise | 12 exportação | 13 início
   ===================================================================== */
(function () {
  'use strict';

  // ================= 0. CONFIGURAÇÃO E GUARDAS =================
  const CFG = window.GEOPORTAL_CONFIG || {};
  const SUPABASE_URL = String(CFG.SUPABASE_URL || '')
    .trim().replace(/\/+$/, '').replace(/\/rest\/v1$/, '');
  const SUPABASE_KEY = String(CFG.SUPABASE_ANON_KEY || '').trim();
  const H3_RES = CFG.H3_RESOLUCAO || 10;
  const MAX_FEICOES = CFG.MAX_FEICOES_CAMADA || 20000;
  const PAGINA = 1000; // limite padrão de linhas por pedido no Supabase (max-rows)

  /** Descobre o papel da chave: anon | authenticated | service_role | publishable | secret */
  function papelDaChave(chave) {
    if (chave.startsWith('sb_secret_')) return 'secret';
    if (chave.startsWith('sb_publishable_')) return 'publishable';
    try {
      const b64 = chave.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(atob(b64)).role || 'desconhecido';
    } catch (e) { return 'desconhecido'; }
  }

  /** Escapa texto para inserir em HTML (evita XSS com nomes vindos de arquivos/banco). */
  function esc(v) {
    return String(v === null || v === undefined ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  const num = (v, casas) => (v === null || v === undefined || isNaN(v)) ? '-' :
    Number(v).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
  const isNum = (v) => typeof v === 'number' && isFinite(v);

  // ================= 1. CLIENTE SUPABASE (REST / PostgREST) =================
  function cabecalhos(extra) {
    const h = Object.assign({ apikey: SUPABASE_KEY }, extra || {});
    // Chaves JWT (anon) vão também no Authorization; as novas "sb_publishable_" não.
    if (SUPABASE_KEY.split('.').length === 3) h.Authorization = 'Bearer ' + SUPABASE_KEY;
    return h;
  }

  /** Erro com mensagem amigável a partir da resposta do PostgREST. */
  async function erroDaResposta(resp, recurso) {
    let corpo = {};
    try { corpo = await resp.json(); } catch (e) { /* corpo não-JSON */ }
    const cod = corpo.code || '';
    let msg;
    if (resp.status === 401 || resp.status === 403) {
      msg = 'Acesso negado pelo Supabase (chave inválida ou sem permissão de leitura em "' + recurso +
            '"). Confira a chave em js/config.js e as políticas RLS (script 02).';
    } else if (cod === 'PGRST202') {
      msg = 'A função "' + recurso + '" não existe no banco. Rode o script supabase/02_preparar_tabelas_e_api.sql (Passo 3 do README).';
    } else if (cod === 'PGRST205' || resp.status === 404) {
      msg = 'A tabela/view "' + recurso + '" não foi encontrada na API. Confira o nome, se ela está no schema public e rode o script 02.';
    } else if (cod === '57014') {
      msg = 'Consulta cancelada por tempo esgotado no banco (statement timeout) em "' + recurso + '".';
    } else {
      msg = 'Erro ' + resp.status + ' ao ler "' + recurso + '": ' + (corpo.message || resp.statusText);
    }
    const err = new Error(msg); err.status = resp.status; err.code = cod; err.detalhe = corpo;
    return err;
  }

  /**
   * GET na API REST do Supabase.
   * @param {string} caminho  ex.: "rpc/hex_dados_web" ou "vw_x?select=*&limit=10"
   * @param {object} opt      { geojson: true } para pedir application/geo+json
   */
  async function sbGet(caminho, opt) {
    opt = opt || {};
    const url = SUPABASE_URL + '/rest/v1/' + caminho;
    const recurso = caminho.split('?')[0].replace(/^rpc\//, '');
    let resp;
    try {
      resp = await fetch(url, {
        headers: cabecalhos({ Accept: opt.geojson ? 'application/geo+json' : 'application/json' })
      });
    } catch (e) {
      throw new Error('Não foi possível contatar o Supabase. Verifique a internet ou se o projeto está pausado ' +
                      '(projetos gratuitos pausam após um período sem uso: reative em supabase.com/dashboard).');
    }
    if (!resp.ok) throw await erroDaResposta(resp, recurso);
    return resp.json();
  }

  /** Busca uma tabela/view inteira como GeoJSON, paginando de 1000 em 1000. */
  async function sbGetGeoJSONPaginado(tabela, campoOrdem, aoProgredir) {
    const feicoes = [];
    for (let offset = 0; offset < MAX_FEICOES; offset += PAGINA) {
      let q = tabela + '?select=*&limit=' + PAGINA + '&offset=' + offset;
      if (campoOrdem) q += '&order=' + encodeURIComponent(campoOrdem) + '.asc';
      const fc = await sbGet(q, { geojson: true });
      const lote = (fc && fc.features) || [];
      feicoes.push.apply(feicoes, lote);
      if (aoProgredir) aoProgredir(feicoes.length);
      if (lote.length < PAGINA) return { features: feicoes, truncado: false };
    }
    return { features: feicoes.slice(0, MAX_FEICOES), truncado: true };
  }

  /** Confere se as coordenadas parecem graus (EPSG:4326) e não metros (ex.: UTM 31983). */
  function pareceWGS84(features) {
    for (const f of features) {
      if (!f.geometry) continue;
      let c = f.geometry.coordinates;
      while (Array.isArray(c) && Array.isArray(c[0])) c = c[0];
      if (Array.isArray(c) && c.length >= 2) return Math.abs(c[0]) <= 180 && Math.abs(c[1]) <= 90;
    }
    return true;
  }

  // ================= 2. CLASSIFICAÇÃO (Jenks, 5 classes) =================
  // Quebras e cores conferidas com o SLD "indicador_final_jenks5" (QGIS):
  // classe 1: valor <= 1,7337 | 2: <= 2,0480 | 3: <= 2,4657 | 4: <= 2,8734 | 5: acima.
  // Esta é agora a ÚNICA fonte da simbologia: mapa, legenda e dashboard leem daqui.
  const RISK_BREAKS = [
    { max: 1.7336663784572,  label: 'Baixíssimo Risco', faixa: '1,26 – 1,73', color: '#2c7bb6', text: '#ffffff' },
    { max: 2.0479783984149,  label: 'Baixo Risco',      faixa: '1,73 – 2,05', color: '#abd9e9', text: '#1e2a38' },
    { max: 2.46574265290324, label: 'Médio Risco',      faixa: '2,05 – 2,47', color: '#ffffbf', text: '#1e2a38' },
    { max: 2.87339898143592, label: 'Alto Risco',       faixa: '2,47 – 2,87', color: '#fdae61', text: '#1e2a38' },
    { max: Infinity,         label: 'Altíssimo Risco',  faixa: '2,87 – 3,59', color: '#d7191c', text: '#ffffff' }
  ];
  const SEM_DADO = { max: 0, label: 'Sem dado', faixa: '', color: '#cccccc', text: '#333333' };

  function indiceClasse(v) {
    if (!isNum(v)) return -1;
    for (let i = 0; i < RISK_BREAKS.length; i++) if (v <= RISK_BREAKS[i].max) return i;
    return RISK_BREAKS.length - 1;
  }
  const classifyRisk = (v) => { const i = indiceClasse(v); return i < 0 ? SEM_DADO : RISK_BREAKS[i]; };

  const INTERMEDIATE_MAPS = [
    { field: 'indicador_mapa1', label: 'Ameaça Climática' },
    { field: 'indicador_mapa2', label: 'Exposição' },
    { field: 'indicador_mapa3', label: 'Vulnerabilidade' }
  ];
  const GROUP_FIELDS = [
    { field: 'grupo_1_mapa_1_inunda_alagamento', label: 'Inundações e Alagamentos' },
    { field: 'grupo_2_mapa_1_dinami_costeira', label: 'Dinâmica Costeira' },
    { field: 'grupo_3_mapa_1_movimento_massa', label: 'Movimentos de Massa' },
    { field: 'grupo_4_mapa_1_ameaca_termica', label: 'Ameaças Térmicas' },
    { field: 'grupo_1_mapa_2_populacao', label: 'População' },
    { field: 'grupo_2_mapa_2_infra_servicos', label: 'Infraestrutura e Serviços' },
    { field: 'grupo_3_mapa_2_ocupa_territorio', label: 'Ocupação do Território' },
    { field: 'grupo_1_mapa_3_fragi_infra_urbana', label: 'Fragilidade da Infraestrutura Urbana' },
    { field: 'grupo_2_mapa_3_capa_adap_socioecono', label: 'Capacidade Adaptativa Socioeconômica' }
  ];

  // ================= 3. MAPA E CAMADAS =================
  const $ = (id) => document.getElementById(id);

  const baseLayers = {
    osm: new ol.layer.Tile({ source: new ol.source.OSM(), visible: true }),
    positron: new ol.layer.Tile({
      source: new ol.source.XYZ({ url: 'https://{a-d}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
        attributions: '© OpenStreetMap contributors © CARTO' }), visible: false }),
    dark: new ol.layer.Tile({
      source: new ol.source.XYZ({ url: 'https://{a-d}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
        attributions: '© OpenStreetMap contributors © CARTO' }), visible: false }),
    satellite: new ol.layer.Tile({
      source: new ol.source.XYZ({ url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        attributions: 'Tiles © Esri', maxZoom: 19 }), visible: false }),
    topo: new ol.layer.Tile({
      source: new ol.source.XYZ({ url: 'https://{a-c}.tile.opentopomap.org/{z}/{x}/{y}.png',
        attributions: 'Map data: © OpenStreetMap contributors, SRTM | Style: © OpenTopoMap', maxZoom: 17 }), visible: false })
  };

  // Grade hexagonal: VectorImage = desenha os ~24 mil polígonos numa imagem
  // (mais leve que Vector comum ao arrastar o mapa).
  const hexSource = new ol.source.Vector({ wrapX: false });
  const hexLayer = new ol.layer.VectorImage({ source: hexSource, style: estiloHex, zIndex: 10 });

  const distritosSource = new ol.source.Vector({ wrapX: false });
  const distritosLayer = new ol.layer.Vector({
    source: distritosSource, opacity: 0.7, style: estiloDistrito, zIndex: 20, declutter: true
  });

  const uploadedSource = new ol.source.Vector();
  const uploadedLayer = new ol.layer.Vector({
    source: uploadedSource, zIndex: 40,
    style: new ol.style.Style({
      stroke: new ol.style.Stroke({ color: '#ff00d0', width: 3 }),
      fill: new ol.style.Fill({ color: 'rgba(255, 0, 208, 0.15)' }),
      image: new ol.style.Circle({ radius: 7, fill: new ol.style.Fill({ color: '#ff00d0' }),
        stroke: new ol.style.Stroke({ color: '#ffffff', width: 2 }) })
    })
  });

  const map = new ol.Map({
    target: 'map',
    layers: Object.values(baseLayers).concat([hexLayer, distritosLayer, uploadedLayer]),
    view: new ol.View({ center: ol.proj.fromLonLat([-42.82, -22.92]), zoom: 11, maxZoom: 19 })
  });
  map.addControl(new ol.control.ScaleLine({ units: 'metric' }));

  const searchMarkerEl = $('search-marker');
  searchMarkerEl.style.display = 'block';
  const searchMarkerOverlay = new ol.Overlay({ element: searchMarkerEl, positioning: 'bottom-center' });
  map.addOverlay(searchMarkerOverlay);

  // ================= 4. DADOS DA GRADE (RPC + h3-js) =================
  let hexCampos = [];               // nomes das colunas devolvidas pela RPC
  let modoLeve = false;             // true: a grade veio só com h3_index + indicador_final
  let dadosCompletos = null;        // todos os campos, baixados só se precisar (exportação)
  const hexPorId = new Map();       // h3_index -> ol.Feature (busca O(1) para pontos)
  const detalhesCache = new Map();  // h3_index -> indicadores completos da célula (modo leve)

  /** Contorno do hexágono em [lon, lat] (anel fechado), a partir do índice H3. */
  function contornoH3(id) {
    const anel = h3.cellToBoundary(id, true); // true = ordem GeoJSON [lng, lat]
    const a = anel[0], b = anel[anel.length - 1];
    if (a[0] !== b[0] || a[1] !== b[1]) anel.push([a[0], a[1]]);
    return anel;
  }

  /**
   * Carga em duas fases. Fase 1 (esta): só h3_index + indicador_final (~0,3 MB comprimido)
   * já bastam para desenhar o mapa, o filtro e o upload. Fase 2: os demais 12 indicadores
   * de UMA célula são buscados só quando ela é clicada (ver detalhesDaCelula).
   * Se a função leve ainda não existe no banco (script 04), usa a função completa.
   */
  async function baixarGrade() {
    try {
      const d = await sbGet('rpc/' + (CFG.RPC_HEX_LEVE || 'hex_mapa_web'));
      if (d && Array.isArray(d.campos) && Array.isArray(d.linhas)) return { dados: d, leve: true };
    } catch (e) {
      if (!(e.code === 'PGRST202' || e.status === 404)) throw e;   // outro erro: não mascarar
    }
    setLoading('Baixando indicadores da grade (≈2,6 MB)…');
    return { dados: await sbGet('rpc/' + (CFG.RPC_HEX || 'hex_dados_web')), leve: false };
  }

  /** Indicadores completos de uma célula (modo leve): 1 pedido pequeno, com cache. */
  async function detalhesDaCelula(id) {
    if (detalhesCache.has(id)) return detalhesCache.get(id);
    if (!/^[0-9a-f]{15}$/.test(id)) throw new Error('h3_index inválido.');
    const campos = ['h3_index', 'indicador_final']
      .concat(INTERMEDIATE_MAPS.map((m) => m.field), GROUP_FIELDS.map((g) => g.field)).join(',');
    const r = await sbGet((CFG.TABELA_HEX || 'hex_indicadores_completos') + '?select=' + campos + '&h3_index=eq.' + id);
    if (!r.length) throw new Error('Célula não encontrada no banco.');
    detalhesCache.set(id, r[0]);
    return r[0];
  }

  /** Todos os campos de todas as células (só para exportar no modo leve). */
  async function obterDadosCompletos() {
    if (!dadosCompletos) {
      const d = await sbGet('rpc/' + (CFG.RPC_HEX || 'hex_dados_web'));
      const iId = d.campos.indexOf('h3_index'), porId = new Map();
      d.linhas.forEach((l) => porId.set(l[iId], l));
      dadosCompletos = { campos: d.campos, porId };
    }
    return dadosCompletos;
  }

  async function carregarGrade() {
    setLoading('Baixando indicadores da grade…');
    const { dados, leve } = await baixarGrade();
    modoLeve = leve;
    if (!dados || !Array.isArray(dados.campos) || !Array.isArray(dados.linhas)) {
      throw new Error('Resposta inesperada da função da grade (sem "campos"/"linhas").');
    }
    hexCampos = dados.campos;
    const iId = hexCampos.indexOf('h3_index');
    if (iId < 0) throw new Error('A função hex_dados_web não devolveu o campo h3_index.');

    setLoading('Montando ' + dados.linhas.length.toLocaleString('pt-BR') + ' hexágonos…');
    const feicoes = [];
    let invalidos = 0;
    for (const linha of dados.linhas) {
      const id = linha[iId];
      if (!id || !h3.isValidCell(id)) { invalidos++; continue; }
      const props = {};
      for (let j = 0; j < hexCampos.length; j++) props[hexCampos[j]] = linha[j];
      const coords = contornoH3(id).map((c) => ol.proj.fromLonLat(c));
      const f = new ol.Feature(new ol.geom.Polygon([coords]));
      f.setProperties(props, true);
      f.setId(id);
      feicoes.push(f);
      hexPorId.set(id, f);
    }
    if (invalidos) console.warn('Hexágonos ignorados por h3_index inválido:', invalidos);
    hexSource.addFeatures(feicoes);
    const ext = hexSource.getExtent();
    if (isFinite(ext[0])) map.getView().fit(ext, { padding: [30, 30, 30, 30], duration: 0 });
    return feicoes.length;
  }

  // ================= 5. ESTILO, LEGENDA E FILTRO =================
  const filtro = { min: null, max: null };
  const classesOcultas = new Set();

  // Cache de estilos (um objeto por classe; com e sem contorno conforme o zoom)
  function criaEstilos(comContorno) {
    return RISK_BREAKS.concat([SEM_DADO]).map((c) => new ol.style.Style({
      fill: new ol.style.Fill({ color: c.color }),
      stroke: comContorno ? new ol.style.Stroke({ color: 'rgba(35,35,35,0.55)', width: 0.6 }) : undefined
    }));
  }
  const ESTILOS_HEX = [criaEstilos(false), criaEstilos(true)];

  function passaFiltro(v) {
    if (filtro.min !== null && !(isNum(v) && v >= filtro.min)) return false;
    if (filtro.max !== null && !(isNum(v) && v <= filtro.max)) return false;
    return !classesOcultas.has(indiceClasse(v));
  }

  function estiloHex(feature, resolucao) {
    const v = feature.get('indicador_final');
    if (!passaFiltro(v)) return null;
    let i = indiceClasse(v); if (i < 0) i = RISK_BREAKS.length;   // índice "sem dado"
    // Contorno só a partir de ~zoom 14 (resolução < 10 m/pixel): em escalas menores
    // as bordas de 24 mil hexágonos viram uma mancha escura e alteram a cor percebida.
    return ESTILOS_HEX[resolucao < 10 ? 1 : 0][i];
  }

  function montarLegenda() {
    $('risk-legend-rows').innerHTML = RISK_BREAKS.map((c, i) =>
      '<div class="legend-row clicavel" data-classe="' + i + '" role="button" tabindex="0" ' +
      'aria-pressed="true" title="Clique para ocultar/exibir esta classe">' +
      '<span class="swatch" style="background:' + c.color + ';"></span>' +
      '<span class="legend-label">' + esc(c.label) + '</span>' +
      '<span class="legend-range">' + esc(c.faixa) + '</span></div>').join('');
    $('risk-legend-rows').querySelectorAll('.legend-row').forEach((el) => {
      const alterna = () => {
        const i = Number(el.dataset.classe);
        if (classesOcultas.has(i)) classesOcultas.delete(i); else classesOcultas.add(i);
        el.classList.toggle('desligada', classesOcultas.has(i));
        el.setAttribute('aria-pressed', String(!classesOcultas.has(i)));
        hexLayer.changed();
        atualizarStatusFiltro();
      };
      el.addEventListener('click', alterna);
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); alterna(); } });
    });
  }

  function atualizarStatusFiltro() {
    const total = hexSource.getFeatures().length;
    if (!total) return;
    const visiveis = hexSource.getFeatures().filter((f) => passaFiltro(f.get('indicador_final'))).length;
    $('filter-status').textContent = visiveis === total ? '' :
      'Exibindo ' + visiveis.toLocaleString('pt-BR') + ' de ' + total.toLocaleString('pt-BR') + ' hexágonos.';
  }

  // ================= 6. LIMITES DISTRITAIS =================
  let mostrarRotulos = false;
  const ESTILO_DISTRITO_LINHA = [
    new ol.style.Style({ stroke: new ol.style.Stroke({ color: 'rgba(255,255,255,0.9)', width: 5 }) }),
    new ol.style.Style({ stroke: new ol.style.Stroke({ color: '#1e2a38', width: 2.2 }) })
  ];

  /** Ponto do rótulo: ponto interior da MAIOR parte (evita rótulo repetido em ilhas). */
  function pontoRotulo(feature) {
    let p = feature.get('_ptRotulo');
    if (p) return p;
    const g = feature.getGeometry();
    if (g instanceof ol.geom.MultiPolygon) {
      let maior = null, area = -1;
      g.getPolygons().forEach((pg) => { const a = pg.getArea(); if (a > area) { area = a; maior = pg; } });
      p = maior ? maior.getInteriorPoint() : null;
    } else if (g && g.getInteriorPoint) {
      p = g.getInteriorPoint();
    }
    feature.set('_ptRotulo', p, true);
    return p;
  }

  function estiloDistrito(feature) {
    if (!mostrarRotulos) return ESTILO_DISTRITO_LINHA;
    return ESTILO_DISTRITO_LINHA.concat([new ol.style.Style({
      geometry: pontoRotulo,
      text: new ol.style.Text({
        text: String(feature.get('nm_dist') || ''), font: 'bold 14px "Segoe UI", Arial, sans-serif',
        fill: new ol.style.Fill({ color: '#1e2a38' }),
        stroke: new ol.style.Stroke({ color: '#ffffff', width: 4 }), overflow: true
      })
    })]);
  }

  async function carregarDistritos() {
    const fc = await sbGet((CFG.VIEW_DISTRITOS || 'vw_limites_distritais') + '?select=*', { geojson: true });
    const feats = new ol.format.GeoJSON().readFeatures(fc, { dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857' });
    distritosSource.addFeatures(feats);
    $('distritos-legend').style.display = $('toggle-distritos').checked ? 'block' : 'none';
    return feats.length;
  }

  // ================= 7. CONTROLES DA BARRA LATERAL =================
  $('basemap-select').addEventListener('change', (e) => {
    Object.keys(baseLayers).forEach((k) => baseLayers[k].setVisible(k === e.target.value));
  });

  // Busca de endereço (Nominatim/OSM, restrita à bbox de Maricá; política de uso: ≤ 1 req/s)
  $('search-btn').addEventListener('click', buscarEndereco);
  $('search-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') buscarEndereco(); });
  async function buscarEndereco() {
    const query = $('search-input').value.trim();
    const st = $('search-status');
    if (!query) { st.textContent = 'Digite um endereço.'; return; }
    const btn = $('search-btn'); btn.disabled = true; st.textContent = 'Buscando…';
    const bbox = '-42.95,-22.83,-42.60,-23.05'; // left,top,right,bottom
    const url = 'https://nominatim.openstreetmap.org/search?format=json&q=' + encodeURIComponent(query) +
                '&viewbox=' + bbox + '&bounded=1&countrycodes=br&limit=1&accept-language=pt-BR';
    try {
      const r = await fetch(url);
      const res = await r.json();
      if (!res || !res.length) { st.textContent = 'Endereço não encontrado dentro de Maricá.'; searchMarkerOverlay.setPosition(undefined); return; }
      const coord = ol.proj.fromLonLat([parseFloat(res[0].lon), parseFloat(res[0].lat)]);
      map.getView().animate({ center: coord, zoom: 16, duration: 800 });
      searchMarkerOverlay.setPosition(coord);
      st.textContent = res[0].display_name;
    } catch (e) {
      st.textContent = 'Erro ao buscar. Tente novamente.';
    } finally {
      setTimeout(() => { btn.disabled = false; }, 1100);
    }
  }
  $('clear-marker-btn').addEventListener('click', () => {
    searchMarkerOverlay.setPosition(undefined); $('search-status').textContent = ''; $('search-input').value = '';
  });

  $('toggle-hex').addEventListener('change', (e) => {
    hexLayer.setVisible(e.target.checked);
    $('risk-legend').style.display = e.target.checked ? 'block' : 'none';
  });
  $('toggle-distritos').addEventListener('change', (e) => {
    distritosLayer.setVisible(e.target.checked);
    $('distritos-legend').style.display = e.target.checked ? 'block' : 'none';
  });
  $('toggle-distritos-labels').addEventListener('change', (e) => { mostrarRotulos = e.target.checked; distritosLayer.changed(); });
  $('opacity-slider').addEventListener('input', (e) => {
    hexLayer.setOpacity(e.target.value / 100); $('opacity-value').textContent = e.target.value;
  });

  $('apply-filter').addEventListener('click', () => {
    const mn = $('filter-min').value, mx = $('filter-max').value;
    if (mn === '' && mx === '') { $('filter-status').textContent = 'Informe o mínimo, o máximo ou os dois.'; return; }
    const a = mn === '' ? null : Number(mn), b = mx === '' ? null : Number(mx);
    if ((a !== null && isNaN(a)) || (b !== null && isNaN(b))) { $('filter-status').textContent = 'Valores inválidos.'; return; }
    if (a !== null && b !== null && a > b) { $('filter-status').textContent = 'O mínimo é maior que o máximo.'; return; }
    filtro.min = a; filtro.max = b; hexLayer.changed(); atualizarStatusFiltro();
  });
  $('clear-filter').addEventListener('click', () => {
    $('filter-min').value = ''; $('filter-max').value = '';
    filtro.min = null; filtro.max = null; hexLayer.changed(); atualizarStatusFiltro();
  });

  // Painel recolhível no celular
  const appEl = $('app');
  const menuAberto = () => !appEl.classList.contains('sidebar-fechada');
  function alternarMenu(abrir) {
    appEl.classList.add('animar-menu');   // a animação só vale depois do primeiro uso (sem "pulo" ao carregar)
    appEl.classList.toggle('sidebar-fechada', !abrir);
    $('sidebar-toggle').setAttribute('aria-expanded', String(abrir));
    setTimeout(() => map.updateSize(), 250);
  }
  if (window.matchMedia('(max-width: 760px)').matches) { appEl.classList.add('sidebar-fechada'); $('sidebar-toggle').setAttribute('aria-expanded', 'false'); }
  $('sidebar-toggle').addEventListener('click', () => alternarMenu(!menuAberto()));

  // ================= 8. DASHBOARD (modal) =================
  const dashboardOverlay = $('dashboard-overlay');
  let radarChart = null;
  let cliqueToken = 0;   // descarta respostas atrasadas se o usuário clicar em outra célula
  function closeDashboard() { cliqueToken++; dashboardOverlay.style.display = 'none'; }

  /** Quebra o nome do eixo do radar em linhas curtas (evita corte em telas estreitas). */
  function quebraRotulo(txt, max) {
    const linhas = []; let atual = '';
    String(txt).split(' ').forEach((p) => {
      if (atual && (atual + ' ' + p).length > max) { linhas.push(atual); atual = p; }
      else atual = atual ? atual + ' ' + p : p;
    });
    if (atual) linhas.push(atual);
    return linhas;
  }
  const telaEstreita = () => window.innerWidth < 520;

  function mostrarCarregandoDashboard(msg, erro) {
    $('dash-bars').innerHTML = '<div class="dash-loading' + (erro ? ' erro' : '') + '">' + esc(msg) + '</div>';
    if (radarChart) { radarChart.destroy(); radarChart = null; }
  }
  $('dashboard-close').addEventListener('click', closeDashboard);
  dashboardOverlay.addEventListener('click', (e) => { if (e.target === dashboardOverlay) closeDashboard(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeDashboard(); fecharInfo(); } });

  function openDashboard(props) {
    $('dash-h3id').textContent = props.h3_index || '-';
    const vf = props.indicador_final, cat = classifyRisk(vf);
    $('dash-final-value').textContent = num(vf, 2);
    const badge = $('dash-final-badge');
    badge.textContent = cat.label; badge.style.background = cat.color; badge.style.color = cat.text;

    // Modo leve: só o índice final chegou; os detalhes são buscados e este método é chamado de novo.
    if (props.indicador_mapa1 === undefined) {
      mostrarCarregandoDashboard('Carregando detalhes da célula…');
      dashboardOverlay.style.display = 'flex';
      $('dashboard-close').focus();
      return;
    }

    // Barras em escala 1–5: 1 = barra vazia, 5 = barra cheia.
    // A cor usa as quebras do indicador FINAL só como referência visual
    // (os mapas intermediários não têm classificação própria).
    $('dash-bars').innerHTML = INTERMEDIATE_MAPS.map((m) => {
      const v = props[m.field];
      const pct = isNum(v) ? Math.max(0, Math.min(100, ((v - 1) / 4) * 100)) : 0;
      return '<div class="dash-bar-row"><div class="dash-bar-top"><span>' + esc(m.label) +
        '</span><span class="dash-bar-value">' + num(v, 2) + '</span></div>' +
        '<div class="dash-bar-track" role="meter" aria-valuemin="1" aria-valuemax="5" aria-valuenow="' + (isNum(v) ? v : '') +
        '" aria-label="' + esc(m.label) + '"><div class="dash-bar-fill" style="width:' + pct + '%; background:' +
        classifyRisk(v).color + ';"></div></div></div>';
    }).join('');

    if (radarChart) radarChart.destroy();
    radarChart = new Chart($('dash-radar-canvas').getContext('2d'), {
      type: 'radar',
      data: {
        labels: GROUP_FIELDS.map((g) => g.label),
        datasets: [{
          label: 'Indicador de grupo',
          data: GROUP_FIELDS.map((g) => (isNum(props[g.field]) ? props[g.field] : null)),
          backgroundColor: 'rgba(47, 127, 209, 0.25)', borderColor: '#2f7fd1', borderWidth: 2,
          pointBackgroundColor: '#2f7fd1', pointRadius: 3, spanGaps: true
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        layout: { padding: telaEstreita() ? { left: 4, right: 4 } : 0 },
        scales: { r: { min: 1, max: 5, ticks: { stepSize: 1, backdropColor: 'transparent', font: { size: 9 } },
          pointLabels: { font: { size: telaEstreita() ? 9 : 10 }, color: '#1e2a38',
            callback: (rotulo) => quebraRotulo(rotulo, telaEstreita() ? 14 : 18) },
          grid: { color: '#e5e9ee' }, angleLines: { color: '#e5e9ee' } } },
        plugins: { legend: { display: false },
          tooltip: { callbacks: { label: (ctx) => 'Valor: ' + num(ctx.parsed.r, 2) } } }
      }
    });
    dashboardOverlay.style.display = 'flex';
    $('dashboard-close').focus();
  }

  // ================= 9. CLIQUE NO MAPA =================
  const camadasCatalogo = new Map(); // tabela -> { def, layer, carregada }

  function fecharInfo() { $('info-panel').hidden = true; }
  $('info-close').addEventListener('click', fecharInfo);

  function mostrarAtributos(titulo, props) {
    const linhas = Object.keys(props).filter((k) => k !== 'geometry' && !k.startsWith('_'))
      .map((k) => '<tr><th>' + esc(k) + '</th><td>' + esc(typeof props[k] === 'object' ? JSON.stringify(props[k]) : props[k]) + '</td></tr>')
      .join('');
    $('info-content').innerHTML = '<div class="info-title">' + esc(titulo) + '</div>' +
      (linhas ? '<table>' + linhas + '</table>' : '<div class="hint-text">Sem atributos.</div>');
    $('info-panel').hidden = false;
  }

  map.on('singleclick', (evt) => {
    // No celular, tocar no mapa com o menu aberto apenas fecha o menu.
    if (menuAberto() && matchMedia('(max-width: 760px)').matches) { alternarMenu(false); return; }
    // 1º: camadas do catálogo e upload (estão por cima da grade)
    let achou = null;
    map.forEachFeatureAtPixel(evt.pixel, (f, layer) => { achou = { f, layer }; return true; }, {
      hitTolerance: 4,
      layerFilter: (l) => l === uploadedLayer || l.get('catalogo') === true
    });
    if (achou) {
      const titulo = achou.layer === uploadedLayer ? 'Feição enviada' : achou.layer.get('titulo');
      mostrarAtributos(titulo, achou.f.getProperties());
      return;
    }
    // 2º: grade hexagonal (somente se visível e se a célula passa no filtro)
    if (!hexLayer.getVisible()) return;
    const cand = hexSource.getFeaturesAtCoordinate(evt.coordinate)
      .filter((f) => passaFiltro(f.get('indicador_final')));
    if (!cand.length) return;
    fecharInfo();
    const f = cand[0], props = f.getProperties();
    openDashboard(props);                       // mostra já o índice final
    if (!modoLeve) return;                      // modo completo: nada mais a buscar
    const meuToken = ++cliqueToken;
    detalhesDaCelula(f.getId())
      .then((p) => { if (meuToken === cliqueToken) openDashboard(p); })
      .catch((e) => { if (meuToken === cliqueToken) mostrarCarregandoDashboard('Não foi possível carregar os detalhes: ' + e.message, true); });
  });
  map.on('pointermove', (evt) => {
    if (evt.dragging) return;
    const hit = map.hasFeatureAtPixel(evt.pixel, { layerFilter: (l) => l === hexLayer || l === uploadedLayer || l.get('catalogo') === true });
    map.getTargetElement().style.cursor = hit ? 'pointer' : '';
  });

  // ================= 10. CATÁLOGO DE CAMADAS DO SUPABASE =================
  const NOME_VALIDO = /^[a-z_][a-z0-9_]*$/;

  function estiloCatalogo(def) {
    const cor = /^#[0-9a-fA-F]{6}$/.test(def.cor || '') ? def.cor : '#ff7f00';
    const base = new ol.style.Style({
      stroke: new ol.style.Stroke({ color: cor, width: def.tipo_geometria === 'linha' ? 3 : 2 }),
      fill: new ol.style.Fill({ color: cor + '33' }),
      image: new ol.style.Circle({ radius: 5, fill: new ol.style.Fill({ color: cor }),
        stroke: new ol.style.Stroke({ color: '#ffffff', width: 1.5 }) })
    });
    if (!def.campo_rotulo) return base;
    return function (f, res) {
      if (res > 20) return base; // rótulos só a partir de ~zoom 13
      return [base, new ol.style.Style({ text: new ol.style.Text({
        text: String(f.get(def.campo_rotulo) ?? ''), font: '12px "Segoe UI", Arial, sans-serif',
        fill: new ol.style.Fill({ color: '#1e2a38' }), stroke: new ol.style.Stroke({ color: '#fff', width: 3 }),
        overflow: false }) })];
    };
  }

  function adicionarItemCatalogo(def) {
    if (camadasCatalogo.has(def.tabela)) return false;
    const lista = $('catalog-list');
    const vazio = lista.querySelector('.catalog-vazio'); if (vazio) vazio.remove();
    const idChk = 'cat-' + def.tabela;
    const item = document.createElement('div');
    item.className = 'catalog-item';
    item.innerHTML =
      '<div class="checkbox-row"><input type="checkbox" id="' + esc(idChk) + '">' +
      '<span class="catalog-swatch" style="background:' + esc(def.cor || '#ff7f00') + ';"></span>' +
      '<label for="' + esc(idChk) + '">' + esc(def.titulo || def.tabela) + '</label></div>' +
      '<div class="catalog-meta">' + (def.descricao ? esc(def.descricao) + '<br>' : '') +
      (def.fonte ? 'Fonte: ' + esc(def.fonte) + '<br>' : '') +
      '<code>' + esc(def.tabela) + '</code> <span class="cat-status"></span></div>';
    lista.appendChild(item);

    const entrada = { def, layer: null, carregada: false };
    camadasCatalogo.set(def.tabela, entrada);
    const chk = item.querySelector('input'), st = item.querySelector('.cat-status');
    chk.addEventListener('change', async () => {
      if (!chk.checked) { if (entrada.layer) entrada.layer.setVisible(false); return; }
      if (entrada.carregada) { entrada.layer.setVisible(true); return; }
      chk.disabled = true; st.textContent = '— carregando…';
      try {
        const r = await sbGetGeoJSONPaginado(def.tabela, def.campo_ordem,
          (n) => { st.textContent = '— ' + n.toLocaleString('pt-BR') + ' feições…'; });
        if (!pareceWGS84(r.features)) {
          throw new Error('A geometria não está em EPSG:4326 (graus). Publique uma view com ST_Transform(geom, 4326) — ver README.');
        }
        const src = new ol.source.Vector({
          features: new ol.format.GeoJSON().readFeatures({ type: 'FeatureCollection', features: r.features },
            { dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857' })
        });
        entrada.layer = new ol.layer.Vector({ source: src, style: estiloCatalogo(def), zIndex: 30 + (def.ordem || 0) / 1000 });
        entrada.layer.set('catalogo', true); entrada.layer.set('titulo', def.titulo || def.tabela);
        map.addLayer(entrada.layer);
        entrada.carregada = true;
        st.textContent = '— ' + r.features.length.toLocaleString('pt-BR') + ' feições' +
          (r.truncado ? ' (limitado a ' + MAX_FEICOES.toLocaleString('pt-BR') + ')' : '');
      } catch (e) {
        console.error('Erro ao carregar camada', def.tabela, e);
        st.textContent = '— erro: ' + e.message; chk.checked = false;
      } finally { chk.disabled = false; }
    });
    if (def.visivel_inicial) { chk.checked = true; chk.dispatchEvent(new Event('change')); }
    return true;
  }

  async function carregarCatalogo() {
    const lista = $('catalog-list');
    try {
      const defs = await sbGet((CFG.TABELA_CATALOGO || 'catalogo_camadas') + '?select=*&order=ordem.asc,titulo.asc');
      lista.innerHTML = '';
      const validas = defs.filter((d) => NOME_VALIDO.test(d.tabela || ''));
      if (!validas.length) lista.innerHTML = '<div class="hint-text catalog-vazio">Nenhuma camada cadastrada em catalogo_camadas.</div>';
      validas.forEach(adicionarItemCatalogo);
    } catch (e) {
      lista.innerHTML = '<div class="hint-text catalog-vazio">Catálogo indisponível: ' + esc(e.message) + '</div>';
    }
  }

  $('manual-connect-btn').addEventListener('click', () => {
    const tabela = $('manual-table').value.trim().toLowerCase();
    const st = $('manual-status');
    if (!NOME_VALIDO.test(tabela)) { st.textContent = 'Nome inválido: use letras minúsculas, números e "_".'; return; }
    const ok = adicionarItemCatalogo({ tabela, titulo: $('manual-title').value.trim() || tabela,
      cor: $('manual-color').value, descricao: 'Conectada manualmente (não fica salva).', visivel_inicial: true });
    st.textContent = ok ? 'Camada adicionada à lista acima.' : 'Essa camada já está na lista.';
  });

  // ================= 11. UPLOAD E ANÁLISE DE SOBREPOSIÇÃO =================
  // Tudo roda no navegador, contra a grade já carregada (sem consultas ao banco).
  //  * Ponto  -> h3.latLngToCell(lat, lon, 10) = célula exata (sem teste geométrico)
  //  * Linha  -> média simples dos hexágonos atravessados
  //  * Polígono -> média simples E média ponderada pela área de interseção,
  //               + distribuição da área por classe de risco
  // Áreas calculadas por turf.area (geodésica, em m²) — independe da distorção do Web Mercator.
  const uploadInput = $('upload-input'), uploadStatusEl = $('upload-status'), uploadResultsEl = $('upload-results');

  function clearUploadedLayer() { uploadedSource.clear(); uploadResultsEl.innerHTML = ''; uploadStatusEl.textContent = ''; }
  $('clear-upload-btn').addEventListener('click', () => { clearUploadedLayer(); uploadInput.value = ''; fecharInfo(); });

  const pausa = () => new Promise((r) => setTimeout(r, 0));

  /** Hexágonos cujo retângulo envolvente cruza o da feição (filtro rápido via índice R-tree do OL). */
  function hexCandidatos(feat4326) {
    const bb = turf.bbox(feat4326);
    const ext = ol.proj.transformExtent(bb, 'EPSG:4326', 'EPSG:3857');
    return hexSource.getFeaturesInExtent(ext);
  }
  const poligonoHex = (f) => turf.polygon([contornoH3(f.getId())]);

  async function analyzeFeature(feature, idx) {
    const tipo = feature.geometry ? feature.geometry.type : null;
    const props = feature.properties || {};
    const name = props.name || props.Name || props.NAME || props.nome || props.Nome || ('Feição ' + (idx + 1));

    if (tipo === 'Point' || tipo === 'MultiPoint') {
      const pts = tipo === 'Point' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
      const vals = [];
      pts.forEach((c) => {
        const cel = h3.latLngToCell(c[1], c[0], H3_RES);
        const f = hexPorId.get(cel);
        if (f && isNum(f.get('indicador_final'))) vals.push(f.get('indicador_final'));
      });
      if (!vals.length) return { name, type: 'Ponto', found: false };
      const v = vals.reduce((a, b) => a + b, 0) / vals.length;
      return { name, type: pts.length > 1 ? 'Multiponto' : 'Ponto', found: true, value: v, count: vals.length };
    }

    if (tipo === 'LineString' || tipo === 'MultiLineString') {
      const vals = [];
      const cand = hexCandidatos(feature);
      for (let i = 0; i < cand.length; i++) {
        try { if (turf.booleanIntersects(feature, poligonoHex(cand[i])) && isNum(cand[i].get('indicador_final'))) vals.push(cand[i].get('indicador_final')); }
        catch (e) { console.warn('Erro ao testar linha x hexágono:', e); }
        if (i % 1000 === 999) await pausa();
      }
      if (!vals.length) return { name, type: 'Linha', found: false };
      return { name, type: 'Linha', found: true, value: vals.reduce((a, b) => a + b, 0) / vals.length, count: vals.length };
    }

    if (tipo === 'Polygon' || tipo === 'MultiPolygon') {
      const cand = hexCandidatos(feature);
      let soma = 0, somaPond = 0, areaTot = 0, n = 0;
      const areaClasse = RISK_BREAKS.map(() => 0);
      for (let i = 0; i < cand.length; i++) {
        const v = cand[i].get('indicador_final');
        if (!isNum(v)) continue;
        try {
          const inter = turf.intersect(feature, poligonoHex(cand[i])); // assinatura do turf@6 (2 argumentos)
          if (inter) {
            const a = turf.area(inter);
            if (a > 0) { soma += v; somaPond += v * a; areaTot += a; n++; areaClasse[indiceClasse(v)] += a; }
          }
        } catch (e) { console.warn('Erro ao testar interseção de polígono:', e); }
        if (i % 500 === 499) { uploadStatusEl.textContent = 'Analisando "' + name + '": ' + (i + 1) + ' de ' + cand.length + ' hexágonos…'; await pausa(); }
      }
      if (!n) return { name, type: 'Polígono', found: false };
      return { name, type: 'Polígono', found: true, value: somaPond / areaTot, simples: soma / n,
               count: n, area: areaTot, areaClasse };
    }
    return { name, type: tipo || 'desconhecido', found: false, unsupported: true };
  }

  function renderResults(rows) {
    uploadResultsEl.innerHTML = rows.map((r) => {
      if (r.unsupported) return '<div class="result-card"><div class="result-name">' + esc(r.name) +
        '</div><div class="result-meta">Tipo de geometria (' + esc(r.type) + ') não suportado.</div></div>';
      if (!r.found) return '<div class="result-card"><div class="result-name">' + esc(r.name) +
        '</div><div class="result-meta">' + esc(r.type) + ' — fora da área com dados de risco.</div></div>';
      const cat = classifyRisk(r.value);
      let extra = '';
      if (r.type === 'Polígono') {
        const barra = r.areaClasse.map((a, i) => a > 0 ? '<span title="' + esc(RISK_BREAKS[i].label) + ': ' +
          num(100 * a / r.area, 1) + '%" style="display:inline-block;height:8px;width:' + (100 * a / r.area) +
          '%;background:' + RISK_BREAKS[i].color + ';"></span>' : '').join('');
        extra = '<div class="result-meta">Média ponderada pela área: <strong>' + num(r.value, 2) + '</strong> · média simples: ' +
          num(r.simples, 2) + '</div><div class="result-meta">' + r.count + ' hexágono(s) · área analisada: ' +
          num(r.area / 10000, 2) + ' ha</div><div style="display:flex;margin-top:5px;border-radius:3px;overflow:hidden;">' + barra + '</div>' +
          '<div class="result-meta">Distribuição da área por classe de risco</div>';
      } else {
        extra = '<div class="result-meta">Valor do indicador: <strong>' + num(r.value, 2) + '</strong>' +
          (r.count > 1 ? ' (média de ' + r.count + ' hexágonos)' : '') + '</div>';
      }
      return '<div class="result-card"><div class="result-name"><span class="result-dot" style="background:' + cat.color +
        ';"></span>' + esc(r.name) + '</div><div class="result-meta">' + esc(r.type) + ' — ' + esc(cat.label) + '</div>' + extra + '</div>';
    }).join('');
  }

  uploadInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    clearUploadedLayer();
    if (!hexSource.getFeatures().length) { uploadStatusEl.textContent = 'A grade ainda não foi carregada.'; return; }
    uploadStatusEl.textContent = 'Processando arquivo…';
    try {
      const nome = file.name.toLowerCase();
      let geojson;
      if (nome.endsWith('.kml')) {
        const feats = new ol.format.KML({ extractStyles: false }).readFeatures(await file.text(), { featureProjection: 'EPSG:4326' });
        geojson = new ol.format.GeoJSON().writeFeaturesObject(feats);
      } else if (nome.endsWith('.zip')) {
        const res = await shp(await file.arrayBuffer()); // shpjs reprojeta para WGS84 usando o .prj
        geojson = Array.isArray(res) ? { type: 'FeatureCollection', features: res.flatMap((fc) => fc.features) } : res;
      } else {
        uploadStatusEl.textContent = 'Formato não suportado. Envie .kml ou .zip com o shapefile completo (.shp, .shx, .dbf, .prj).';
        return;
      }
      // Separa GeometryCollection (comum em KML) em feições simples
      const simples = [];
      (geojson.features || []).forEach((f) => {
        if (f.geometry && f.geometry.type === 'GeometryCollection') {
          f.geometry.geometries.forEach((g) => simples.push({ type: 'Feature', properties: f.properties, geometry: g }));
        } else if (f.geometry) simples.push(f);
      });
      if (!simples.length) { uploadStatusEl.textContent = 'Nenhuma feição com geometria encontrada no arquivo.'; return; }
      if (!pareceWGS84(simples)) { uploadStatusEl.textContent = 'As coordenadas não parecem estar em graus (WGS 84). No shapefile, confira o .prj.'; return; }

      uploadedSource.addFeatures(new ol.format.GeoJSON().readFeatures({ type: 'FeatureCollection', features: simples },
        { dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857' }));
      const ext = uploadedSource.getExtent();
      if (ext && isFinite(ext[0])) map.getView().fit(ext, { padding: [40, 40, 40, 40], maxZoom: 17, duration: 500 });

      const rows = [];
      for (let i = 0; i < simples.length; i++) {
        uploadStatusEl.textContent = 'Analisando feição ' + (i + 1) + ' de ' + simples.length + '…';
        rows.push(await analyzeFeature(simples[i], i));
      }
      renderResults(rows);
      uploadStatusEl.textContent = 'Análise concluída — ' + rows.length + ' feição(ões) processada(s).';
    } catch (err) {
      console.error('Erro ao processar upload:', err);
      uploadStatusEl.textContent = 'Erro ao processar o arquivo. Abra o Console (F12) para ver os detalhes técnicos.';
    }
  });

  // ================= 12. EXPORTAÇÃO (gerada no navegador) =================
  function baixar(conteudo, nomeArquivo, mime) {
    const url = URL.createObjectURL(new Blob([conteudo], { type: mime }));
    const a = document.createElement('a'); a.href = url; a.download = nomeArquivo;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  const hexVisiveis = () => hexSource.getFeatures().filter((f) => passaFiltro(f.get('indicador_final')));
  function propsLimpos(f) { const p = f.getProperties(); delete p.geometry; Object.keys(p).forEach((k) => { if (k.startsWith('_')) delete p[k]; }); return p; }

  // Propriedades de cada hexágono para exportar. No modo leve a grade só tem 2 campos;
  // então os demais são baixados (uma vez) da função completa, só na hora de exportar.
  async function prepararExportacao(alvo, feats) {
    if (alvo === 'hex' && modoLeve) {
      const dc = await obterDadosCompletos();
      return {
        campos: dc.campos,
        propsDe: (f) => { const l = dc.porId.get(f.getId()), o = {}; if (l) dc.campos.forEach((c, i) => { o[c] = l[i]; }); return o; }
      };
    }
    return { campos: hexCampos.length && alvo === 'hex' ? hexCampos : Object.keys(propsLimpos(feats[0])), propsDe: propsLimpos };
  }

  document.querySelectorAll('[data-export]').forEach((btn) => btn.addEventListener('click', async () => {
    const alvo = btn.dataset.export, fmt = btn.dataset.format;
    const feats = alvo === 'hex' ? hexVisiveis() : distritosSource.getFeatures();
    if (!feats.length) { alert('Não há feições para exportar (dados ainda carregando ou filtro vazio).'); return; }
    const base = alvo === 'hex' ? 'marica_hex_indicadores' : 'marica_limites_distritais';
    const rotulo = btn.textContent; btn.disabled = true; btn.textContent = '…';
    try {
      const { campos, propsDe } = await prepararExportacao(alvo, feats);
      if (fmt === 'csv') {
        const q = (v) => (v === null || v === undefined) ? '' : (/[",;\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v));
        const linhas = [campos.join(',')].concat(feats.map((f) => { const p = propsDe(f); return campos.map((c) => q(p[c])).join(','); }));
        baixar('﻿' + linhas.join('\n'), base + '.csv', 'text/csv;charset=utf-8');
      } else if (fmt === 'geojson') {
        let fc;
        if (alvo === 'hex') { // geometria exata direto do H3, em graus (sem ida e volta pelo Web Mercator)
          fc = { type: 'FeatureCollection', features: feats.map((f) => ({ type: 'Feature', properties: propsDe(f),
            geometry: { type: 'Polygon', coordinates: [contornoH3(f.getId())] } })) };
        } else {
          fc = new ol.format.GeoJSON().writeFeaturesObject(feats.map((f) => { const c = f.clone(); c.unset('_ptRotulo', true); return c; }),
            { featureProjection: 'EPSG:3857', dataProjection: 'EPSG:4326', decimals: 7 });
        }
        baixar(JSON.stringify(fc), base + '.geojson', 'application/geo+json');
      } else if (fmt === 'kml') {
        const limpos = feats.map((f) => { const c = new ol.Feature(f.getGeometry().clone()); c.setProperties(propsDe(f)); if (f.getId()) c.set('name', f.getId()); else if (f.get('nm_dist')) c.set('name', f.get('nm_dist')); return c; });
        const kml = new ol.format.KML({ writeStyles: false }).writeFeatures(limpos, { featureProjection: 'EPSG:3857', decimals: 7 });
        baixar(kml, base + '.kml', 'application/vnd.google-earth.kml+xml');
      }
    } catch (e) {
      console.error('Erro na exportação:', e);
      alert('Não foi possível exportar: ' + e.message);
    } finally { btn.disabled = false; btn.textContent = rotulo; }
  }));

  // ================= 13. INICIALIZAÇÃO =================
  function setLoading(texto, erro) {
    const ov = $('loading-overlay');
    ov.classList.remove('hidden'); ov.classList.toggle('erro', !!erro);
    $('loading-text').textContent = texto;
  }
  const esconderLoading = () => $('loading-overlay').classList.add('hidden');
  function setConn(texto, classe) { const el = $('conn-status'); el.textContent = texto; el.className = 'conn-status ' + (classe || ''); }

  async function iniciar() {
    montarLegenda();
    const papel = papelDaChave(SUPABASE_KEY);
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      setLoading('Configure SUPABASE_URL e SUPABASE_ANON_KEY em js/config.js.', true); setConn('Sem configuração', 'erro'); return;
    }
    if (papel === 'service_role' || papel === 'secret') {
      setLoading('PERIGO: a chave em js/config.js é uma chave secreta (service_role). Ela dá acesso total ao banco e não pode ficar no site. ' +
                 'Troque pela chave pública "anon" e gere uma nova chave secreta no painel do Supabase.', true);
      setConn('Chave secreta detectada — site bloqueado', 'erro'); return;
    }
    carregarCatalogo();   // em paralelo: não depende da grade
    const tarefas = await Promise.allSettled([carregarGrade(), carregarDistritos()]);
    const [grade, distr] = tarefas;
    if (grade.status === 'rejected') {
      console.error(grade.reason);
      setLoading('Não foi possível carregar a grade: ' + grade.reason.message, true);
      setConn('Erro de conexão', 'erro');
    } else {
      esconderLoading();
      setConn('Conectado ao Supabase · ' + grade.value.toLocaleString('pt-BR') + ' hexágonos' +
              (distr.status === 'fulfilled' ? ' · ' + distr.value + ' distritos' : ''), 'ok');
    }
    if (distr.status === 'rejected') {
      console.error(distr.reason);
      $('toggle-distritos').checked = false; $('toggle-distritos').disabled = true;
      $('distritos-legend').style.display = 'none';
      if (grade.status === 'fulfilled') setConn($('conn-status').textContent + ' · distritos indisponíveis', 'ok');
    }
  }
  iniciar();

  // Exposto só para depuração no Console (F12): window.__geoportal
  window.__geoportal = { map, hexSource, distritosSource, hexPorId, classifyRisk, RISK_BREAKS, modoLeve: () => modoLeve };
})();
