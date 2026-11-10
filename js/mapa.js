/* =====================================================================
   mapa.js — mapa, mapas base, grade hexagonal, limites distritais,
             classificação, estilos, filtro e legenda.

   Decisões geoespaciais registradas aqui:
    * A grade NÃO traz geometria do banco: cada hexágono é reconstruído no
      navegador a partir do h3_index com h3-js (diferença < 1 mm em relação
      ao polígono armazenado). Isso derruba o volume transferido.
    * As QUATRO camadas do índice (final + 3 mapas intermediários) são
      ATRIBUTOS DA MESMA FEIÇÃO e vêm na mesma resposta (script 05), então
      trocar de camada não gera nenhuma consulta nova.
    * Cada camada carrega a classificação (Jenks, 5 classes) E as cores do
      estudo. Como as quebras foram calculadas mapa a mapa, as cores NÃO são
      comparáveis entre camadas — o site avisa isso na interface.
    * Camada da grade usa VectorImage: 24 mil polígonos redesenhados como
      imagem ao arrastar, em vez de 24 mil geometrias.
   ===================================================================== */
window.SIGWEB = window.SIGWEB || {};
(function (NS) {
  'use strict';

  var CFG = window.GEOPORTAL_CONFIG || {};
  var $ = NS.$, isNum = NS.isNum, esc = NS.esc;
  var H3_RES = CFG.H3_RESOLUCAO || 10;

  // =================== 1. CLASSIFICAÇÃO ===============================
  /**
   * Preto ou branco sobre uma cor de fundo, pela luminância relativa da WCAG.
   * Evita escrever à mão o par cor/texto de cada uma das 20 classes.
   */
  function corDoTexto(hex) {
    function canal(v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
    var L = 0.2126 * canal(parseInt(hex.substr(1, 2), 16)) +
            0.7152 * canal(parseInt(hex.substr(3, 2), 16)) +
            0.0722 * canal(parseInt(hex.substr(5, 2), 16));
    return (L + 0.05) / 0.05 > 4.5 ? '#1f2933' : '#ffffff';
  }

  // ColorBrewer YlOrRd (5 classes): sequencial e segura para daltonismo.
  // Opção do usuário; as cores oficiais do estudo continuam sendo o padrão.
  var PALETA_ACESSIVEL = ['#ffffb2', '#fecc5c', '#fd8d3c', '#f03b20', '#bd0026'];

  /*  AS QUATRO CAMADAS DO ÍNDICE
      MEXA SÓ NAS CORES. As faixas (`max`) são as quebras naturais (Jenks) do
      estudo; alterá-las muda o significado do mapa, não a aparência.
        final      -> conferido com o SLD indicador_final_jenks5
        os outros  -> lidos das legendas publicadas do estudo (2 casas).
      O script supabase/05 traz uma consulta que mede quantas células caem em
      cima das quebras, para saber se esse arredondamento importa.            */
  var CAMADAS = [
    {
      id: 'final', campo: 'indicador_final', mapa: null,
      nome: 'Índice de Risco Climático Final',
      curto: 'Índice de Risco Climático',
      classes: [
        { max: 1.7336663784572,  label: 'Baixíssimo Risco', faixa: '1,26 – 1,73', cor: '#2c7bb6' },
        { max: 2.0479783984149,  label: 'Baixo Risco',      faixa: '1,73 – 2,05', cor: '#abd9e9' },
        { max: 2.46574265290324, label: 'Médio Risco',      faixa: '2,05 – 2,47', cor: '#ffffbf' },
        { max: 2.87339898143592, label: 'Alto Risco',       faixa: '2,47 – 2,87', cor: '#fdae61' },
        { max: Infinity,         label: 'Altíssimo Risco',  faixa: '2,87 – 3,59', cor: '#d7191c' }
      ]
    },
    {
      id: 'ameaca', campo: 'indicador_mapa1', mapa: 1,
      nome: 'Ameaças Climáticas', curto: 'Ameaças Climáticas',
      classes: [
        { max: 1.78,     label: 'Muito baixa', faixa: '1,31 – 1,78', cor: '#85bdc1' },
        { max: 2.00,     label: 'Baixa',       faixa: '1,78 – 2,00', cor: '#b6d4aa' },
        { max: 2.25,     label: 'Média',       faixa: '2,00 – 2,25', cor: '#f4e9b0' },
        { max: 2.62,     label: 'Alta',        faixa: '2,25 – 2,62', cor: '#f9a46d' },
        { max: Infinity, label: 'Muito alta',  faixa: '2,62 – 3,21', cor: '#dd3d3d' }
      ]
    },
    {
      id: 'exposicao', campo: 'indicador_mapa2', mapa: 2,
      nome: 'Exposição Socioambiental', curto: 'Exposição',
      classes: [
        { max: 2.08,     label: 'Muito baixa', faixa: '1,00 – 2,08', cor: '#71bdbd' },
        { max: 2.86,     label: 'Baixa',       faixa: '2,08 – 2,86', cor: '#baede6' },
        { max: 3.41,     label: 'Média',       faixa: '2,86 – 3,41', cor: '#f4ecbe' },
        { max: 3.74,     label: 'Alta',        faixa: '3,41 – 3,74', cor: '#efaaaf' },
        { max: Infinity, label: 'Muito alta',  faixa: '3,74 – 4,55', cor: '#d56c92' }
      ]
    },
    {
      id: 'vulnerabilidade', campo: 'indicador_mapa3', mapa: 3,
      nome: 'Vulnerabilidade Climática', curto: 'Vulnerabilidade',
      classes: [
        { max: 1.58,     label: 'Muito baixa', faixa: '1,00 – 1,58', cor: '#3e70a0' },
        { max: 2.61,     label: 'Baixa',       faixa: '1,58 – 2,61', cor: '#7ab0c4' },
        { max: 3.17,     label: 'Média',       faixa: '2,61 – 3,17', cor: '#f5e8b0' },
        { max: 3.80,     label: 'Alta',        faixa: '3,17 – 3,80', cor: '#ed944f' },
        { max: Infinity, label: 'Muito alta',  faixa: '3,80 – 4,91', cor: '#e35744' }
      ]
    }
  ];

  var SEM_DADO = { label: 'Sem dado', faixa: '', cor: '#cccccc' };

  var camadaId = 'final';
  var paletaAcessivel = false;

  function camadaPorId(id) {
    for (var i = 0; i < CAMADAS.length; i++) if (CAMADAS[i].id === id) return CAMADAS[i];
    return CAMADAS[0];
  }
  function camadaAtiva() { return camadaPorId(camadaId); }

  /** Cor da classe i, já considerando a opção de paleta acessível. */
  function corDaClasse(cam, i) {
    if (i < 0 || i >= (cam || camadaAtiva()).classes.length) return SEM_DADO.cor;
    return paletaAcessivel ? PALETA_ACESSIVEL[i] : (cam || camadaAtiva()).classes[i].cor;
  }

  function indiceClasse(v, cam) {
    cam = cam || camadaAtiva();
    if (!isNum(v)) return -1;
    for (var i = 0; i < cam.classes.length; i++) if (v <= cam.classes[i].max) return i;
    return cam.classes.length - 1;
  }

  /** Classe de um valor, com cor de fundo e cor de texto já resolvidas. */
  function classifica(v, cam) {
    cam = cam || camadaAtiva();
    var i = indiceClasse(v, cam);
    if (i < 0) return { label: SEM_DADO.label, faixa: '', color: SEM_DADO.cor, text: corDoTexto(SEM_DADO.cor) };
    var cor = corDaClasse(cam, i);
    return { label: cam.classes[i].label, faixa: cam.classes[i].faixa, color: cor, text: corDoTexto(cor) };
  }

  /* Grupos que compõem cada mapa. `mapa` liga o grupo ao indicador
     intermediário: 1 = Ameaça (4), 2 = Exposição (3), 3 = Vulnerabilidade (2). */
  var GROUP_FIELDS = [
    { mapa: 1, field: 'grupo_1_mapa_1_inunda_alagamento',    label: 'Inundações e Alagamentos' },
    { mapa: 1, field: 'grupo_2_mapa_1_dinami_costeira',      label: 'Dinâmica Costeira' },
    { mapa: 1, field: 'grupo_3_mapa_1_movimento_massa',      label: 'Movimentos de Massa' },
    { mapa: 1, field: 'grupo_4_mapa_1_ameaca_termica',       label: 'Ameaças Térmicas' },
    { mapa: 2, field: 'grupo_1_mapa_2_populacao',            label: 'População' },
    { mapa: 2, field: 'grupo_2_mapa_2_infra_servicos',       label: 'Infraestrutura e Serviços' },
    { mapa: 2, field: 'grupo_3_mapa_2_ocupa_territorio',     label: 'Ocupação do Território' },
    { mapa: 3, field: 'grupo_1_mapa_3_fragi_infra_urbana',   label: 'Fragilidade da Infraestrutura Urbana' },
    { mapa: 3, field: 'grupo_2_mapa_3_capa_adap_socioecono', label: 'Capacidade Adaptativa Socioeconômica' }
  ];
  var INTERMEDIATE_MAPS = [
    { field: 'indicador_mapa1', label: 'Ameaças Climáticas' },
    { field: 'indicador_mapa2', label: 'Exposição' },
    { field: 'indicador_mapa3', label: 'Vulnerabilidade' }
  ];

  /** Grupos de uma camada: no índice final, os nove; nos intermediários, os seus. */
  function gruposDaCamada(cam) {
    cam = cam || camadaAtiva();
    if (!cam.mapa) return GROUP_FIELDS;
    return GROUP_FIELDS.filter(function (g) { return g.mapa === cam.mapa; });
  }

  // =================== 2. MAPAS BASE ==================================
  // A CARTO fechou o endpoint gratuito sem chave: as URLs antigas continuam
  // respondendo HTTP 200, mas com um tile de marca d'água "API KEY REQUIRED".
  // Por isso "Claro" e "Escuro" usam os Canvas da Esri, que não pedem chave.
  var ESRI = 'https://services.arcgisonline.com/ArcGIS/rest/services/';
  var CRED_ESRI = 'Tiles © Esri — Esri, HERE, Garmin, © OpenStreetMap contributors';
  var TILE_EXEMPLO = { z: 11, x: 781, y: 1159 };   // um tile sobre Maricá, para as miniaturas

  function urlExemplo(modelo) {
    return modelo
      .replace('{z}', TILE_EXEMPLO.z).replace('{x}', TILE_EXEMPLO.x).replace('{y}', TILE_EXEMPLO.y)
      .replace(/\{[a-z]-[a-z]\}/, 'a');
  }

  var BASEMAPS = [
    { id: 'claro', nome: 'Claro', padrao: true,
      url: ESRI + 'Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
      rotulos: ESRI + 'Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}',
      attributions: CRED_ESRI },
    { id: 'escuro', nome: 'Escuro',
      url: ESRI + 'Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
      rotulos: ESRI + 'Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}',
      attributions: CRED_ESRI },
    { id: 'osm', nome: 'OpenStreetMap',
      url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      attributions: '© OpenStreetMap contributors' },
    { id: 'satelite', nome: 'Satélite',
      url: ESRI + 'World_Imagery/MapServer/tile/{z}/{y}/{x}',
      attributions: 'Tiles © Esri — Maxar, Earthstar Geographics e a comunidade de usuários SIG',
      maxZoom: 19 }
  ];

  if (CFG.CARTO_API_KEY) {
    var k = encodeURIComponent(CFG.CARTO_API_KEY);
    BASEMAPS.splice(2, 0,
      { id: 'carto-claro', nome: 'CARTO Claro',
        url: 'https://{a-d}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png?api_key=' + k,
        attributions: '© OpenStreetMap contributors © CARTO' },
      { id: 'carto-escuro', nome: 'CARTO Escuro',
        url: 'https://{a-d}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png?api_key=' + k,
        attributions: '© OpenStreetMap contributors © CARTO' });
  }

  function criarBase(def) {
    function fonte(url) {
      return new ol.source.XYZ({
        url: url, attributions: def.attributions,
        maxZoom: def.maxZoom || 19, crossOrigin: 'anonymous'
      });
    }
    def.fonte = fonte(def.url);
    // Dentro de um grupo as camadas internas ficam sempre visíveis: quem liga
    // e desliga o mapa base é o grupo.
    var base = new ol.layer.Tile({ source: def.fonte });
    if (!def.rotulos) { base.setVisible(false); def.layer = base; return base; }
    def.layer = new ol.layer.Group({
      visible: false,
      layers: [base, new ol.layer.Tile({ source: fonte(def.rotulos) })]
    });
    return def.layer;
  }
  BASEMAPS.forEach(criarBase);

  var baseAtual = (BASEMAPS.filter(function (d) { return d.padrao; })[0] || BASEMAPS[0]).id;

  function trocarBase(id) {
    var achou = false;
    BASEMAPS.forEach(function (d) {
      var v = d.id === id;
      d.layer.setVisible(v); d.erros = 0;
      if (v) achou = true;
    });
    if (!achou) return trocarBase(BASEMAPS[0].id);
    baseAtual = id;
    document.querySelectorAll('#basemap-list .basemap-item').forEach(function (el) {
      var sel = el.dataset.base === id;
      el.classList.toggle('ativo', sel);
      el.setAttribute('aria-checked', String(sel));
      el.tabIndex = sel ? 0 : -1;
    });
  }

  /**
   * Troca automática para o OpenStreetMap quando um provedor para de responder.
   * ATENÇÃO: isto cobre falhas de rede. NÃO cobre o caso da CARTO sem chave, em
   * que o servidor devolve 200 com uma imagem válida de marca d'água — para o
   * navegador, aquilo é um tile que carregou.
   */
  function vigiarFalhas(def) {
    if (def.id === 'osm') return;
    def.erros = 0;
    def.fonte.on('tileloaderror', function () {
      if (!def.layer.getVisible()) return;
      if (++def.erros < 4) return;
      console.warn('[mapa] tiles falhando em', def.nome, '— voltando para o OpenStreetMap');
      trocarBase('osm');
      if (NS.avisarMapa) NS.avisarMapa('O mapa base "' + def.nome + '" não está respondendo. Voltamos para o OpenStreetMap.');
    });
  }
  BASEMAPS.forEach(vigiarFalhas);

  // =================== 3. CAMADAS DE DADOS ============================
  var hexSource = new ol.source.Vector({ wrapX: false });
  var hexLayer = new ol.layer.VectorImage({ source: hexSource, style: estiloHex, zIndex: 10 });

  var distritosSource = new ol.source.Vector({ wrapX: false });
  var distritosLayer = new ol.layer.Vector({
    source: distritosSource, opacity: 0.7, style: estiloDistrito, zIndex: 20, declutter: true
  });

  // Áreas prioritárias (60 polígonos): ficam entre a grade e os limites distritais.
  var areasSource = new ol.source.Vector({ wrapX: false });
  var areasLayer = new ol.layer.Vector({
    source: areasSource, style: estiloArea, zIndex: 25, declutter: true
  });
  // "Priorização territorial": as MESMAS 60 feições, só contorno, sem tema.
  // Mesma fonte (sem segunda requisição); começa desligada.
  var areasBaseLayer = new ol.layer.Vector({
    source: areasSource, style: estiloAreaBase, zIndex: 24, declutter: true, visible: false
  });

  var uploadedSource = new ol.source.Vector();
  var uploadedLayer = new ol.layer.Vector({
    source: uploadedSource, zIndex: 40,
    style: new ol.style.Style({
      stroke: new ol.style.Stroke({ color: '#ff00d0', width: 3 }),
      fill: new ol.style.Fill({ color: 'rgba(255, 0, 208, 0.15)' }),
      image: new ol.style.Circle({ radius: 7, fill: new ol.style.Fill({ color: '#ff00d0' }),
        stroke: new ol.style.Stroke({ color: '#ffffff', width: 2 }) })
    })
  });

  var map = new ol.Map({
    target: 'map',
    layers: BASEMAPS.map(function (d) { return d.layer; }).concat([hexLayer, areasBaseLayer, areasLayer, distritosLayer, uploadedLayer]),
    view: new ol.View({
      center: ol.proj.fromLonLat(CFG.CENTRO_INICIAL || [-42.82, -22.92]),
      zoom: CFG.ZOOM_INICIAL || 11, maxZoom: 19
    }),
    controls: (ol.control.defaults && ol.control.defaults.defaults)
      ? ol.control.defaults.defaults({ attributionOptions: { collapsible: true } })
      : undefined
  });
  map.addControl(new ol.control.ScaleLine({ units: 'metric' }));
  trocarBase(baseAtual);

  var searchMarkerEl = $('search-marker');
  searchMarkerEl.style.display = 'block';
  var searchMarkerOverlay = new ol.Overlay({ element: searchMarkerEl, positioning: 'bottom-center' });
  map.addOverlay(searchMarkerOverlay);

  var extensaoInicial = null;
  function irParaVisaoInicial() {
    if (extensaoInicial && isFinite(extensaoInicial[0])) {
      map.getView().fit(extensaoInicial, { padding: [30, 30, 30, 30], duration: 600 });
    } else {
      map.getView().animate({
        center: ol.proj.fromLonLat(CFG.CENTRO_INICIAL || [-42.82, -22.92]),
        zoom: CFG.ZOOM_INICIAL || 11, duration: 600
      });
    }
  }

  // =================== 4. GRADE HEXAGONAL =============================
  var hexCampos = [];
  var modoLeve = false;
  var dadosCompletos = null;
  var hexPorId = new Map();
  var detalhesCache = new Map();

  function contornoH3(id) {
    var anel = h3.cellToBoundary(id, true);   // true = ordem GeoJSON [lng, lat]
    var a = anel[0], b = anel[anel.length - 1];
    if (a[0] !== b[0] || a[1] !== b[1]) anel.push([a[0], a[1]]);
    return anel;
  }

  async function baixarGrade(setLoading) {
    try {
      var d = await NS.api.get('rpc/' + (CFG.RPC_HEX_LEVE || 'hex_mapa_web'));
      if (d && Array.isArray(d.campos) && Array.isArray(d.linhas)) return { dados: d, leve: true };
    } catch (e) {
      if (!(e.code === 'PGRST202' || e.status === 404)) throw e;
    }
    setLoading('Baixando indicadores da grade (≈2,6 MB)…');
    return { dados: await NS.api.get('rpc/' + (CFG.RPC_HEX || 'hex_dados_web')), leve: false };
  }

  async function detalhesDaCelula(id) {
    if (detalhesCache.has(id)) return detalhesCache.get(id);
    if (!/^[0-9a-f]{15}$/.test(id)) throw new Error('Identificador de célula inválido.');
    var campos = ['h3_index', 'indicador_final']
      .concat(INTERMEDIATE_MAPS.map(function (m) { return m.field; }),
              GROUP_FIELDS.map(function (g) { return g.field; })).join(',');
    var r = await NS.api.get((CFG.TABELA_HEX || 'hex_indicadores_completos') +
      '?select=' + campos + '&h3_index=eq.' + encodeURIComponent(id));
    if (!r.length) throw new Error('Célula não encontrada na base de dados.');
    detalhesCache.set(id, r[0]);
    return r[0];
  }

  async function obterDadosCompletos() {
    if (!dadosCompletos) {
      var d = await NS.api.get('rpc/' + (CFG.RPC_HEX || 'hex_dados_web'));
      var iId = d.campos.indexOf('h3_index'), porId = new Map();
      d.linhas.forEach(function (l) { porId.set(l[iId], l); });
      dadosCompletos = { campos: d.campos, porId: porId };
    }
    return dadosCompletos;
  }

  /** A grade trouxe os três mapas intermediários? (script 05 aplicado) */
  function temIntermediarios() { return hexCampos.indexOf('indicador_mapa1') >= 0; }

  async function carregarGrade(setLoading) {
    setLoading('Baixando indicadores da grade…');
    var r = await baixarGrade(setLoading);
    var dados = r.dados;
    modoLeve = r.leve;
    if (!dados || !Array.isArray(dados.campos) || !Array.isArray(dados.linhas)) {
      throw new Error('Resposta inesperada da função da grade.');
    }
    hexCampos = dados.campos;
    var iId = hexCampos.indexOf('h3_index');
    if (iId < 0) throw new Error('A função da grade não devolveu o campo h3_index.');

    setLoading('Montando ' + dados.linhas.length.toLocaleString('pt-BR') + ' hexágonos…');
    var feicoes = [], invalidos = 0;
    for (var n = 0; n < dados.linhas.length; n++) {
      var linha = dados.linhas[n];
      var id = linha[iId];
      if (!id || !h3.isValidCell(id)) { invalidos++; continue; }
      var props = {};
      for (var j = 0; j < hexCampos.length; j++) props[hexCampos[j]] = linha[j];
      var coords = contornoH3(id).map(function (c) { return ol.proj.fromLonLat(c); });
      var f = new ol.Feature(new ol.geom.Polygon([coords]));
      f.setProperties(props, true);
      f.setId(id);
      feicoes.push(f);
      hexPorId.set(id, f);
    }
    if (invalidos) console.warn('[mapa] hexágonos ignorados por h3_index inválido:', invalidos);
    hexSource.addFeatures(feicoes);
    var ext = hexSource.getExtent();
    if (isFinite(ext[0])) {
      extensaoInicial = ext;
      map.getView().fit(ext, { padding: [30, 30, 30, 30], duration: 0 });
    }
    return feicoes.length;
  }

  // =================== 5. ESTILO, FILTRO E LEGENDA ====================
  var filtro = { min: null, max: null };
  var classesOcultas = new Set();
  var ESTILOS_HEX = null;      // cache [semContorno[], comContorno[]] da camada ativa
  var opacidadePreenchimento = 1;

  /** '#rrggbb' + alfa -> 'rgba(r,g,b,a)' */
  function comAlfa(hex, a) {
    return 'rgba(' + parseInt(hex.substr(1, 2), 16) + ',' + parseInt(hex.substr(3, 2), 16) + ',' +
           parseInt(hex.substr(5, 2), 16) + ',' + a + ')';
  }

  /*  Opacidade do PREENCHIMENTO (v3.3.0) é diferente da opacidade da CAMADA:
      com o preenchimento transparente, o contorno de cada hexágono passa a ser
      desenhado NA COR DA CLASSE, opaco, em qualquer zoom. Assim o fundo aparece
      por dentro das células e a classe continua legível pela borda.            */
  function construirEstilos() {
    var cam = camadaAtiva();
    var vazado = opacidadePreenchimento < 1;
    function conjunto(comContorno) {
      function estilo(cor) {
        var borda;
        if (vazado) borda = new ol.style.Stroke({ color: cor, width: comContorno ? 1.4 : 0.9 });
        else if (comContorno) borda = new ol.style.Stroke({ color: 'rgba(35,35,35,0.55)', width: 0.6 });
        return new ol.style.Style({ fill: new ol.style.Fill({ color: comAlfa(cor, opacidadePreenchimento) }), stroke: borda });
      }
      var arr = cam.classes.map(function (c, i) { return estilo(corDaClasse(cam, i)); });
      arr.push(estilo(SEM_DADO.cor));   // último índice: sem dado
      return arr;
    }
    ESTILOS_HEX = [conjunto(false), conjunto(true)];
  }

  function setOpacidadePreenchimento(v) {
    opacidadePreenchimento = Math.max(0, Math.min(1, Number(v)));
    construirEstilos();
    hexLayer.changed();
  }
  construirEstilos();

  /** Valor da célula no atributo da camada que está sendo exibida. */
  function valorAtivo(feature) { return feature.get(camadaAtiva().campo); }

  function passaFiltro(v) {
    if (filtro.min !== null && !(isNum(v) && v >= filtro.min)) return false;
    if (filtro.max !== null && !(isNum(v) && v <= filtro.max)) return false;
    return !classesOcultas.has(indiceClasse(v));
  }

  function estiloHex(feature, resolucao) {
    var v = valorAtivo(feature);
    if (!passaFiltro(v)) return null;
    var i = indiceClasse(v);
    if (i < 0) i = camadaAtiva().classes.length;   // índice "sem dado"
    // Contorno só a partir de ~zoom 14: em escalas menores as bordas de
    // 24 mil hexágonos viram mancha escura e alteram a cor percebida.
    return ESTILOS_HEX[resolucao < 10 ? 1 : 0][i];
  }

  /**
   * Troca a camada exibida. Não vai à rede: os quatro indicadores já estão
   * em memória. Limpa classes ocultas e filtro, porque as faixas de uma
   * camada não querem dizer nada na outra.
   */
  function trocarIndice(id) {
    if (!CAMADAS.some(function (c) { return c.id === id; })) return;
    if (id !== 'final' && !temIntermediarios()) return;   // script 05 ainda não rodou
    camadaId = id;
    classesOcultas.clear();
    filtro.min = null; filtro.max = null;
    var fmin = $('filter-min'), fmax = $('filter-max');
    if (fmin) fmin.value = ''; if (fmax) fmax.value = '';
    construirEstilos();
    hexLayer.changed();
    redesenharLegendas();
    if (NS.aoTrocarIndice) NS.aoTrocarIndice();
  }

  function setPaletaAcessivel(v) {
    paletaAcessivel = !!v;
    construirEstilos();
    hexLayer.changed();
    redesenharLegendas();
  }

  /**
   * Monta a legenda da camada ativa dentro de um container.
   * Chamada duas vezes (caixa no mapa e painel "Legenda"): o estado de classes
   * ocultas é compartilhado, então as duas ficam sincronizadas.
   */
  function montarLegenda(container) {
    if (!container) return;
    var cam = camadaAtiva();
    container.innerHTML = cam.classes.map(function (c, i) {
      return '<div class="legend-row clicavel' + (classesOcultas.has(i) ? ' desligada' : '') + '"' +
        ' data-classe="' + i + '" role="button" tabindex="0" aria-pressed="' + String(!classesOcultas.has(i)) + '"' +
        ' title="Clique para ocultar/exibir esta classe">' +
        '<span class="swatch" style="background:' + corDaClasse(cam, i) + ';"></span>' +
        '<span class="legend-label">' + esc(c.label) + '</span>' +
        '<span class="legend-range">' + esc(c.faixa) + '</span></div>';
    }).join('');
    container.querySelectorAll('.legend-row').forEach(function (el) {
      function alterna() {
        var i = Number(el.dataset.classe);
        if (classesOcultas.has(i)) classesOcultas.delete(i); else classesOcultas.add(i);
        hexLayer.changed();
        redesenharLegendas();
        if (NS.atualizarStatusFiltro) NS.atualizarStatusFiltro();
      }
      el.addEventListener('click', alterna);
      el.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); alterna(); }
      });
    });
  }

  function redesenharLegendas() {
    var titulo = $('risk-legend-titulo');
    if (titulo) titulo.textContent = camadaAtiva().curto;
    montarLegenda($('risk-legend-rows'));
    montarLegenda($('legenda-painel'));
  }

  // =================== 6. LIMITES DISTRITAIS ==========================
  var mostrarRotulos = false;
  var ESTILO_DISTRITO_LINHA = [
    new ol.style.Style({ stroke: new ol.style.Stroke({ color: 'rgba(255,255,255,0.9)', width: 5 }) }),
    new ol.style.Style({ stroke: new ol.style.Stroke({ color: '#1e2a38', width: 2.2 }) })
  ];

  /*  Rótulo centralizado (v3.3.0): o ponto interior do OpenLayers fica no meio
      da linha horizontal que passa pelo centro do retângulo envolvente — em
      polígonos alongados ou inclinados (os distritos de Maricá) ele encosta na
      borda. Usamos o "polo de inacessibilidade" (algoritmo polylabel, Mapbox):
      o ponto interno mais distante de todas as bordas, que é o centro visual.  */
  function distAoSegmento2(px, py, a, b) {
    var x = a[0], y = a[1], dx = b[0] - x, dy = b[1] - y;
    if (dx !== 0 || dy !== 0) {
      var t = ((px - x) * dx + (py - y) * dy) / (dx * dx + dy * dy);
      if (t > 1) { x = b[0]; y = b[1]; } else if (t > 0) { x += dx * t; y += dy * t; }
    }
    dx = px - x; dy = py - y;
    return dx * dx + dy * dy;
  }
  /** Distância com sinal ao contorno: positiva dentro do polígono. */
  function distAoPoligono(x, y, aneis) {
    var dentro = false, min = Infinity;
    aneis.forEach(function (anel) {
      for (var i = 0, n = anel.length, j = n - 1; i < n; j = i++) {
        var a = anel[i], b = anel[j];
        if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) dentro = !dentro;
        min = Math.min(min, distAoSegmento2(x, y, a, b));
      }
    });
    return (dentro ? 1 : -1) * Math.sqrt(min);
  }
  function celula(x, y, h, aneis) {
    var d = distAoPoligono(x, y, aneis);
    return { x: x, y: y, h: h, d: d, max: d + h * Math.SQRT2 };
  }
  function polylabel(aneis) {
    var ext = aneis[0], minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    ext.forEach(function (c) { minX = Math.min(minX, c[0]); minY = Math.min(minY, c[1]); maxX = Math.max(maxX, c[0]); maxY = Math.max(maxY, c[1]); });
    var w = maxX - minX, hgt = maxY - minY, tam = Math.min(w, hgt), precisao = Math.max(w, hgt) / 150;
    if (!tam) return [minX, minY];
    var fila = [], h = tam / 2;
    for (var x = minX; x < maxX; x += tam) for (var y = minY; y < maxY; y += tam) fila.push(celula(x + h, y + h, h, aneis));
    var melhor = celula(minX + w / 2, minY + hgt / 2, 0, aneis);
    var guarda = 0;
    while (fila.length && guarda++ < 20000) {
      var k = 0;                                   // retira a célula mais promissora
      for (var i = 1; i < fila.length; i++) if (fila[i].max > fila[k].max) k = i;
      var c = fila.splice(k, 1)[0];
      if (c.d > melhor.d) melhor = c;
      if (c.max - melhor.d <= precisao) continue;  // não pode melhorar o suficiente
      h = c.h / 2;
      fila.push(celula(c.x - h, c.y - h, h, aneis), celula(c.x + h, c.y - h, h, aneis),
                celula(c.x - h, c.y + h, h, aneis), celula(c.x + h, c.y + h, h, aneis));
    }
    return [melhor.x, melhor.y];
  }

  /** Ponto do rótulo: centro visual da MAIOR parte (evita rótulo repetido em ilhas). Calculado uma vez. */
  function pontoRotulo(feature) {
    var p = feature.get('_ptRotulo');
    if (p) return p;
    var g = feature.getGeometry(), pg = null;
    if (g instanceof ol.geom.MultiPolygon) {
      var area = -1;
      g.getPolygons().forEach(function (q) { var a = q.getArea(); if (a > area) { area = a; pg = q; } });
    } else if (g instanceof ol.geom.Polygon) {
      pg = g;
    }
    if (pg && pg.getCoordinates) {
      try { p = new ol.geom.Point(polylabel(pg.getCoordinates())); } catch (e) { p = null; }
    }
    if (!p && g && g.getInteriorPoint) p = g.getInteriorPoint();
    feature.set('_ptRotulo', p, true);
    return p;
  }

  function estiloDistrito(feature) {
    if (!mostrarRotulos) return ESTILO_DISTRITO_LINHA;
    return ESTILO_DISTRITO_LINHA.concat([new ol.style.Style({
      geometry: pontoRotulo,
      text: new ol.style.Text({
        text: String(feature.get('nm_dist') || ''),
        font: 'bold 14px "Segoe UI", Arial, sans-serif',
        fill: new ol.style.Fill({ color: '#1e2a38' }),
        stroke: new ol.style.Stroke({ color: '#ffffff', width: 4 }),
        overflow: true
      })
    })]);
  }

  async function carregarDistritos() {
    var fc = await NS.api.get((CFG.VIEW_DISTRITOS || 'vw_limites_distritais') + '?select=*', { geojson: true });
    var feats = new ol.format.GeoJSON().readFeatures(fc, {
      dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857'
    });
    distritosSource.addFeatures(feats);
    $('distritos-legend').style.display = $('toggle-distritos').checked ? 'block' : 'none';
    return feats.length;
  }

  // =================== 7. ÁREAS PRIORITÁRIAS ==========================
  /*  Cada área tem um vetor `temas` (N:N com os 5 temas estratégicos). A camada
      é UMA só no OpenLayers, mas se comporta como uma subcamada por tema: cada
      tema tem a sua chave e a sua cor, e a área aparece enquanto ao menos um
      dos seus temas estiver ligado. Se tiver mais de um tema ligado, o contorno
      sai em FAIXAS concêntricas, uma cor por tema — assim nenhuma cor esconde a
      outra e o mapa continua legível sem sobrepor camadas.                      */
  var TEMAS_PADRAO = [   // usado só se a tabela tema_estrategico não puder ser lida
    { id: 1, nome: 'Águas Urbanas',        nome_curto: 'Águas Urbanas',        cor: '#1f78b4' },
    { id: 2, nome: 'Terreno e Erosão',     nome_curto: 'Terreno e Erosão',     cor: '#d95f02' },
    { id: 3, nome: 'Costeira e Lagunar',   nome_curto: 'Costeira e Lagunar',   cor: '#00a0b0' },
    { id: 4, nome: 'Infraestrutura Verde', nome_curto: 'Infraestrutura Verde', cor: '#66a61e' },
    { id: 5, nome: 'Saneamento Ecológico', nome_curto: 'Saneamento Ecológico', cor: '#7570b3' }
  ];
  var temas = [];
  var temasVisiveis = new Set();
  var rotulosAreas = true;
  var areaSelecionada = null;
  var ESTILOS_AREA = new Map();    // cache por combinação de temas ligados

  function temaPorId(id) {
    for (var i = 0; i < temas.length; i++) if (temas[i].id === id) return temas[i];
    return null;
  }
  function corDoTema(id) { var t = temaPorId(id); return t ? t.cor : '#555555'; }

  function rgba(hex, a) {
    return 'rgba(' + parseInt(hex.substr(1, 2), 16) + ',' + parseInt(hex.substr(3, 2), 16) + ',' +
           parseInt(hex.substr(5, 2), 16) + ',' + a + ')';
  }

  /** Estilos do polígono (sem rótulo) para uma lista de temas ligados. */
  function estilosDoPoligono(ids) {
    var chave = ids.join(',');
    if (ESTILOS_AREA.has(chave)) return ESTILOS_AREA.get(chave);
    var n = ids.length, st = [];
    // Preenchimento leve (a grade de risco continua visível por baixo)
    st.push(new ol.style.Style({ fill: new ol.style.Fill({ color: rgba(corDoTema(ids[0]), 0.16) }) }));
    // Halo branco: separa o contorno colorido do mapa de fundo e da grade
    st.push(new ol.style.Style({ stroke: new ol.style.Stroke({ color: 'rgba(255,255,255,0.95)', width: n * 2.4 + 3.4 }) }));
    // Faixas: a primeira é a mais larga (fica por baixo), a última a mais fina
    ids.forEach(function (id, k) {
      st.push(new ol.style.Style({ stroke: new ol.style.Stroke({ color: corDoTema(id), width: (n - k) * 2.4 + 0.8 }) }));
    });
    ESTILOS_AREA.set(chave, st);
    return st;
  }

  var ESTILO_SELECAO = new ol.style.Style({
    stroke: new ol.style.Stroke({ color: '#111827', width: 3.2, lineDash: [9, 6] }),
    fill: new ol.style.Fill({ color: 'rgba(17,24,39,0.10)' })
  });

  function estiloArea(feature) {
    var ids = (feature.get('temas') || []).filter(function (t) { return temasVisiveis.has(t); });
    if (!ids.length) return null;
    var st = estilosDoPoligono(ids);
    var num = feature.get('num_area');
    var extra = [];
    if (areaSelecionada !== null && num === areaSelecionada) extra.push(ESTILO_SELECAO);
    if (rotulosAreas) {
      extra.push(new ol.style.Style({
        geometry: pontoRotulo,
        text: new ol.style.Text({
          text: String(num),
          font: 'bold 13px "Segoe UI", Arial, sans-serif',
          fill: new ol.style.Fill({ color: '#1f2933' }),
          stroke: new ol.style.Stroke({ color: '#ffffff', width: 4 }),
          overflow: true
        })
      }));
    }
    return extra.length ? st.concat(extra) : st;
  }

  var ESTILO_AREA_BASE = [
    new ol.style.Style({ fill: new ol.style.Fill({ color: 'rgba(45,58,70,0.07)' }),
                         stroke: new ol.style.Stroke({ color: 'rgba(255,255,255,0.95)', width: 5 }) }),
    new ol.style.Style({ stroke: new ol.style.Stroke({ color: '#2d3a46', width: 2.2 }) })
  ];
  function estiloAreaBase(feature) {
    var extra = [];
    var num = feature.get('num_area');
    if (areaSelecionada !== null && num === areaSelecionada) extra.push(ESTILO_SELECAO);
    // Número só se a camada por temática estiver desligada (evita rótulo duplicado)
    if (rotulosAreas && !areasLayer.getVisible()) {
      extra.push(new ol.style.Style({
        geometry: pontoRotulo,
        text: new ol.style.Text({
          text: String(num), font: 'bold 13px "Segoe UI", Arial, sans-serif',
          fill: new ol.style.Fill({ color: '#1f2933' }),
          stroke: new ol.style.Stroke({ color: '#ffffff', width: 4 }), overflow: true
        })
      }));
    }
    return extra.length ? ESTILO_AREA_BASE.concat(extra) : ESTILO_AREA_BASE;
  }

  async function carregarTemas() {
    try {
      var r = await NS.api.get((CFG.TABELA_TEMAS || 'tema_estrategico') +
        '?select=id,nome,nome_curto,cor,ordem&order=ordem.asc');
      if (Array.isArray(r) && r.length) return r;
    } catch (e) { console.warn('[mapa] temas: usando a lista padrão —', e.message); }
    return TEMAS_PADRAO;
  }

  /** Lê as 60 áreas (GeoJSON em 4326) e os temas. Devolve o número de áreas. */
  async function carregarAreas() {
    var res = await Promise.all([
      NS.api.get((CFG.VIEW_AREAS || 'vw_areas_prioritarias') + '?select=*&order=num_area.asc', { geojson: true }),
      carregarTemas()
    ]);
    temas = res[1].map(function (t) {
      return { id: Number(t.id), nome: t.nome, nome_curto: t.nome_curto || t.nome, cor: t.cor || '#555555' };
    });
    // Mesmo objeto Set (não reatribuir): NS.mapa.temasVisiveis aponta para ele.
    temasVisiveis.clear();
    temas.forEach(function (t) { temasVisiveis.add(t.id); });
    var feats = new ol.format.GeoJSON().readFeatures(res[0], {
      dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857'
    });
    feats.forEach(function (f) {
      var n = Number(f.get('num_area'));
      f.set('num_area', n, true);
      f.set('temas', (f.get('temas') || []).map(Number), true);
      f.setId(n);
    });
    areasSource.addFeatures(feats);
    return feats.length;
  }

  function areaPorNum(n) { return areasSource.getFeatureById(Number(n)); }

  /** Quantas áreas têm cada tema (para o painel de camadas). */
  function contagemPorTema() {
    var c = {};
    areasSource.getFeatures().forEach(function (f) {
      (f.get('temas') || []).forEach(function (t) { c[t] = (c[t] || 0) + 1; });
    });
    return c;
  }

  function montarLegendaAreas() {
    var el = $('areas-legend-rows');
    if (!el) return;
    var linhas = [];
    if (areasBaseLayer.getVisible()) {
      linhas.push('<div class="legend-row"><span class="swatch-linha" style="background:#2d3a46;"></span>' +
                  '<span class="legend-label">Para adaptação climática (60)</span></div>');
    }
    if (areasLayer.getVisible()) {
      temas.filter(function (t) { return temasVisiveis.has(t.id); }).forEach(function (t) {
        linhas.push('<div class="legend-row"><span class="swatch-linha" style="background:' + esc(t.cor) + ';"></span>' +
                    '<span class="legend-label">' + esc(t.nome_curto) + '</span></div>');
      });
    }
    el.innerHTML = linhas.join('');
    var caixa = $('areas-legend');
    if (caixa) caixa.hidden = !linhas.length;
  }

  function setTemaVisivel(id, v) {
    if (v) temasVisiveis.add(id); else temasVisiveis.delete(id);
    areasLayer.changed();
    montarLegendaAreas();
  }
  function setAreasVisiveis(v) { areasLayer.setVisible(!!v); areasBaseLayer.changed(); montarLegendaAreas(); }
  function setAreasBaseVisiveis(v) { areasBaseLayer.setVisible(!!v); montarLegendaAreas(); }
  function setRotulosAreas(v) { rotulosAreas = !!v; areasLayer.changed(); areasBaseLayer.changed(); }
  function selecionarArea(n) {
    areaSelecionada = (n === null || n === undefined) ? null : Number(n);
    areasLayer.changed();
    areasBaseLayer.changed();
  }

  // =================== 8. EXPOSIÇÃO DO MÓDULO =========================
  NS.mapa = {
    map: map,
    BASEMAPS: BASEMAPS,
    urlExemplo: urlExemplo,
    trocarBase: trocarBase,
    baseAtual: function () { return baseAtual; },
    irParaVisaoInicial: irParaVisaoInicial,

    CAMADAS: CAMADAS,
    camadaPorId: camadaPorId,
    camadaAtiva: camadaAtiva,
    trocarIndice: trocarIndice,
    gruposDaCamada: gruposDaCamada,
    valorAtivo: valorAtivo,
    classifica: classifica,
    corDaClasse: corDaClasse,
    indiceClasse: indiceClasse,
    temIntermediarios: temIntermediarios,
    setPaletaAcessivel: setPaletaAcessivel,
    paletaAcessivel: function () { return paletaAcessivel; },
    corDoTexto: corDoTexto,

    INTERMEDIATE_MAPS: INTERMEDIATE_MAPS,
    GROUP_FIELDS: GROUP_FIELDS,
    // Compatibilidade com a v2: o índice final continua acessível por estes nomes.
    RISK_BREAKS: camadaPorId('final').classes,
    classifyRisk: function (v) { return classifica(v, camadaPorId('final')); },

    hexSource: hexSource, hexLayer: hexLayer, hexPorId: hexPorId,
    distritosSource: distritosSource, distritosLayer: distritosLayer,
    uploadedSource: uploadedSource, uploadedLayer: uploadedLayer,
    searchMarkerOverlay: searchMarkerOverlay,

    contornoH3: contornoH3,
    carregarGrade: carregarGrade,
    carregarDistritos: carregarDistritos,
    detalhesDaCelula: detalhesDaCelula,
    obterDadosCompletos: obterDadosCompletos,
    modoLeve: function () { return modoLeve; },
    campos: function () { return hexCampos; },

    filtro: filtro,
    classesOcultas: classesOcultas,
    passaFiltro: passaFiltro,
    redesenharLegendas: redesenharLegendas,
    setRotulosDistritos: function (v) { mostrarRotulos = v; distritosLayer.changed(); },

    areasSource: areasSource, areasLayer: areasLayer, areasBaseLayer: areasBaseLayer,
    setAreasBaseVisiveis: setAreasBaseVisiveis,
    setOpacidadePreenchimento: setOpacidadePreenchimento,
    polylabel: polylabel,
    carregarAreas: carregarAreas,
    temas: function () { return temas; },
    temaPorId: temaPorId,
    temasVisiveis: temasVisiveis,
    areaPorNum: areaPorNum,
    contagemPorTema: contagemPorTema,
    setTemaVisivel: setTemaVisivel,
    setAreasVisiveis: setAreasVisiveis,
    setRotulosAreas: setRotulosAreas,
    selecionarArea: selecionarArea,
    montarLegendaAreas: montarLegendaAreas,
    resolucaoH3: H3_RES
  };

})(window.SIGWEB);
