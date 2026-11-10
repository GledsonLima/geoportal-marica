/* =====================================================================
   desenho.js — ferramentas de desenho sobre o mapa (v3.3.0)

   1. MEDIR    distância (linha) e área (polígono), padrão métrico.
               ol.sphere.getLength/getArea: cálculo GEODÉSICO sobre a esfera
               terrestre. Medir no plano do Web Mercator (EPSG:3857) daria áreas
               ~17% maiores em Maricá (fator 1/cos²(23°)).
   2. RELATÓRIO de um ponto ou de uma área desenhada pelo usuário:
               risco climático (médias ponderadas pela área de interseção com
               cada hexágono), distribuição por classe, indicadores por grupo,
               áreas prioritárias e temas tocados, distritos.

   Regras do relatório
     * Área máxima: LIMITE_HA (10 km²). Acima disso a média de centenas de
       hexágonos dilui contrastes e esconde os focos de risco — o resultado
       deixaria de descrever um "local" (efeito de escala / MAUP).
     * Uma consulta por vez: enquanto calcula, os botões ficam desabilitados;
       um desenho novo apaga o anterior.
     * Ids de células conferidos por expressão regular antes de entrar na URL;
       a consulta ao banco é só leitura (RLS) e por lotes pequenos.

   Só uma ferramenta de desenho fica ativa por vez; enquanto ativa, o clique
   no mapa é vértice (painel.js consulta NS.desenho.ativo()).
   ===================================================================== */
(function (NS) {
  'use strict';

  var CFG = window.GEOPORTAL_CONFIG || {};
  var $ = NS.$, esc = NS.esc, num = NS.num, isNum = NS.isNum, pausa = NS.pausa;
  var M = NS.mapa;

  var LIMITE_HA = 1000;          // 10 km² — área máxima do relatório
  var LOTE = 80;                 // células por requisição de detalhes (URL curta)
  var RE_CELULA = /^[0-9a-f]{15}$/;

  // =================== 1. CAMADAS E ESTILOS ===========================
  var medidaSource = new ol.source.Vector();
  var relSource = new ol.source.Vector();

  var ESTILO_MEDIDA = [
    new ol.style.Style({ stroke: new ol.style.Stroke({ color: 'rgba(255,255,255,0.95)', width: 5 }) }),
    new ol.style.Style({
      stroke: new ol.style.Stroke({ color: '#1e2a38', width: 2.4 }),
      fill: new ol.style.Fill({ color: 'rgba(30,42,56,0.12)' })
    })
  ];
  var ESTILO_REL = [
    new ol.style.Style({ stroke: new ol.style.Stroke({ color: 'rgba(255,255,255,0.95)', width: 5.5 }) }),
    new ol.style.Style({
      stroke: new ol.style.Stroke({ color: '#bc1f28', width: 2.6, lineDash: [10, 6] }),
      fill: new ol.style.Fill({ color: 'rgba(188,31,40,0.10)' }),
      image: new ol.style.Circle({ radius: 7, fill: new ol.style.Fill({ color: '#bc1f28' }),
        stroke: new ol.style.Stroke({ color: '#ffffff', width: 2.5 }) })
    })
  ];
  var medidaLayer = new ol.layer.Vector({ source: medidaSource, style: ESTILO_MEDIDA, zIndex: 60 });
  var relLayer = new ol.layer.Vector({ source: relSource, style: ESTILO_REL, zIndex: 59 });
  M.map.addLayer(relLayer);
  M.map.addLayer(medidaLayer);

  // =================== 2. FORMATAÇÃO MÉTRICA ==========================
  function fmtComprimento(m) {
    if (m < 1000) return num(m, m < 100 ? 1 : 0) + ' m';
    return num(m / 1000, 2) + ' km';
  }
  function fmtArea(m2) {
    if (m2 < 10000) return num(m2, 0) + ' m²';
    if (m2 < 1e6) return num(m2 / 1e4, 2) + ' ha';
    return num(m2 / 1e6, 2) + ' km² (' + num(m2 / 1e4, 0) + ' ha)';
  }
  function medir(geom) {
    if (geom instanceof ol.geom.Polygon) {
      var perim = ol.sphere.getLength(new ol.geom.LineString(geom.getLinearRing(0).getCoordinates()));
      return { texto: fmtArea(ol.sphere.getArea(geom)), extra: 'perímetro ' + fmtComprimento(perim) };
    }
    return { texto: fmtComprimento(ol.sphere.getLength(geom)), extra: '' };
  }

  // =================== 3. CONTROLE DA FERRAMENTA ======================
  var draw = null, modo = null, ocupado = false;
  var rotuloVivo = null;           // overlay que acompanha o desenho em curso
  var overlaysMedida = [];
  var nMedida = 0;

  // Barra de instrução sobre o mapa (essencial no toque: Concluir / Cancelar)
  var barra = document.createElement('div');
  barra.id = 'desenho-barra';
  barra.hidden = true;
  barra.innerHTML = '<span id="desenho-instrucao"></span>' +
    '<button type="button" id="desenho-concluir">Concluir</button>' +
    '<button type="button" id="desenho-cancelar">Cancelar</button>';
  $('map-wrapper').appendChild(barra);

  var INSTRUCAO = {
    'distancia': 'Clique para marcar os pontos da linha; duplo clique termina.',
    'area': 'Clique para marcar os vértices da área; duplo clique termina.',
    'rel-ponto': 'Clique no local do relatório.',
    'rel-area': 'Desenhe a área (até 10 km²); duplo clique termina.'
  };
  // Em tela de toque não existe "duplo clique" confortável: orienta para o botão Concluir
  var TOQUE = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  if (TOQUE) {
    INSTRUCAO['distancia'] = 'Toque para marcar os pontos da linha; depois toque em Concluir.';
    INSTRUCAO['area'] = 'Toque para marcar os vértices da área; depois toque em Concluir.';
    INSTRUCAO['rel-ponto'] = 'Toque no local do relatório.';
    INSTRUCAO['rel-area'] = 'Marque a área (até 10 km²) e toque em Concluir.';
  }
  var TIPO = { 'distancia': 'LineString', 'area': 'Polygon', 'rel-ponto': 'Point', 'rel-area': 'Polygon' };

  function botoes() { return document.querySelectorAll('[data-desenho]'); }
  function marcarBotoes() {
    botoes().forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.desenho === modo)); });
  }
  function travarRelatorio(v) {
    document.querySelectorAll('[data-desenho^="rel-"], #relatorio-limpar').forEach(function (b) { b.disabled = v; });
  }

  function parar() {
    if (draw) { M.map.removeInteraction(draw); draw = null; }
    if (rotuloVivo) { M.map.removeOverlay(rotuloVivo); rotuloVivo = null; }
    modo = null;
    barra.hidden = true;
    marcarBotoes();
  }

  /** Esc: cancela o desenho em curso. Devolve true se havia algo a cancelar. */
  function cancelarDesenho() {
    if (!draw) return false;
    try { draw.abortDrawing(); } catch (e) { /* nada em curso */ }
    parar();
    return true;
  }

  function iniciar(m) {
    if (modo === m) { parar(); return; }      // clicar de novo desliga
    parar();
    var relatorio = m.indexOf('rel-') === 0;
    if (relatorio && ocupado) return;         // uma consulta por vez
    if (relatorio) limparRelatorio();         // um desenho novo apaga o anterior

    modo = m;
    draw = new ol.interaction.Draw({ source: relatorio ? relSource : medidaSource, type: TIPO[m] });
    M.map.addInteraction(draw);
    if (!relatorio) ligarRotuloVivo(draw);
    draw.on('drawend', function (e) {
      if (relatorio) {
        // Relatório: um desenho e pronto. Adiado porque drawend dispara antes de a
        // feição entrar na fonte e de a interação terminar o próprio ciclo.
        setTimeout(function () { parar(); gerarRelatorio(e.feature); }, 0);
      } else {
        fixarMedida(e.feature);
      }
    });

    $('desenho-instrucao').textContent = INSTRUCAO[m];
    $('desenho-concluir').hidden = TIPO[m] === 'Point';
    barra.hidden = false;
    marcarBotoes();
    // No celular o painel lateral cobre o mapa: fecha para dar lugar ao desenho
    if (NS.ehCelular() && NS.painel && NS.painel.fecharPainel) NS.painel.fecharPainel();
  }

  $('desenho-concluir').addEventListener('click', function () {
    if (!draw) return;
    try { draw.finishDrawing(); } catch (e) { /* desenho incompleto: ignora */ }
  });
  $('desenho-cancelar').addEventListener('click', cancelarDesenho);

  botoes().forEach(function (b) {
    b.addEventListener('click', function () { iniciar(b.dataset.desenho); });
  });

  // ---- Medir --------------------------------------------------------
  function novoRotulo(fixo) {
    var el = document.createElement('div');
    el.className = 'medida-rotulo' + (fixo ? ' fixo' : '');
    var ov = new ol.Overlay({ element: el, offset: [0, -10], positioning: 'bottom-center', stopEvent: false });
    M.map.addOverlay(ov);
    return ov;
  }

  function ligarRotuloVivo(d) {
    d.on('drawstart', function (e) {
      rotuloVivo = novoRotulo(false);
      var geom = e.feature.getGeometry();
      geom.on('change', function () {
        if (!rotuloVivo) return;
        var r = medir(geom);
        rotuloVivo.getElement().textContent = r.texto;
        var pos = geom instanceof ol.geom.Polygon ? geom.getInteriorPoint().getCoordinates() : geom.getLastCoordinate();
        rotuloVivo.setPosition(pos);
      });
    });
  }

  function fixarMedida(feature) {
    if (rotuloVivo) { M.map.removeOverlay(rotuloVivo); rotuloVivo = null; }
    var geom = feature.getGeometry(), r = medir(geom);
    var ov = novoRotulo(true);
    ov.getElement().textContent = r.texto;
    ov.setPosition(geom instanceof ol.geom.Polygon ? geom.getInteriorPoint().getCoordinates() : geom.getLastCoordinate());
    overlaysMedida.push(ov);
    nMedida++;
    var item = document.createElement('div');
    item.className = 'medida-item';
    item.innerHTML = '<span>' + (geom instanceof ol.geom.Polygon ? 'Área' : 'Distância') + ' ' + nMedida +
      (r.extra ? ' <small>(' + esc(r.extra) + ')</small>' : '') + '</span><b>' + esc(r.texto) + '</b>';
    $('medidas-lista').appendChild(item);
  }

  $('medir-limpar').addEventListener('click', function () {
    if (modo === 'distancia' || modo === 'area') cancelarDesenho();
    medidaSource.clear();
    overlaysMedida.forEach(function (o) { M.map.removeOverlay(o); });
    overlaysMedida = []; nMedida = 0;
    $('medidas-lista').innerHTML = '';
  });

  // =================== 4. RELATÓRIO: CÁLCULO ==========================
  var fmtGeo = new ol.format.GeoJSON();
  var OPC = { featureProjection: 'EPSG:3857', dataProjection: 'EPSG:4326' };
  var cacheAreas = null, cacheDistritos = null;

  function paraGeoJSON(f) { return fmtGeo.writeFeatureObject(f, OPC); }
  function areas4326() {
    if (!cacheAreas) {
      cacheAreas = M.areasSource.getFeatures().map(function (f) {
        var g = paraGeoJSON(f);
        return { num: f.get('num_area'), temas: f.get('temas') || [], area_ha: f.get('area_ha'), gj: g, bb: turf.bbox(g) };
      });
    }
    return cacheAreas;
  }
  function distritos4326() {
    if (!cacheDistritos) {
      cacheDistritos = M.distritosSource.getFeatures().map(function (f) {
        var g = paraGeoJSON(f);
        return { nome: f.get('nm_dist') || 'Distrito', gj: g, bb: turf.bbox(g) };
      });
    }
    return cacheDistritos;
  }
  function bbCruza(a, b) { return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1]; }

  var CAMPOS = M.CAMADAS.map(function (c) { return c.campo; });

  /** Linhas completas (com os 9 grupos) de várias células, em lotes. */
  async function gruposDasCelulas(ids, status) {
    var campos = ['h3_index'].concat(M.GROUP_FIELDS.map(function (g) { return g.field; })).join(',');
    var mapa = new Map();
    ids = ids.filter(function (id) { return RE_CELULA.test(id); });
    for (var i = 0; i < ids.length; i += LOTE) {
      status('Buscando os indicadores por grupo (' + Math.min(i + LOTE, ids.length) + ' de ' + ids.length + ' hexágonos)…');
      var lote = ids.slice(i, i + LOTE);
      var r = await NS.api.get((CFG.TABELA_HEX || 'hex_indicadores_completos') +
        '?select=' + campos + '&h3_index=in.(' + lote.join(',') + ')');
      (r || []).forEach(function (l) { mapa.set(l.h3_index, l); });
    }
    return mapa;
  }

  async function analisarPonto(gj, status) {
    var c = gj.geometry.coordinates;
    var cel = h3.latLngToCell(c[1], c[0], M.resolucaoH3);
    var f = M.hexPorId.get(cel);
    if (!f) throw new Error('O ponto está fora da área com dados de risco (limite do município).');
    var valores = {};
    CAMPOS.forEach(function (k) { valores[k] = f.get(k); });

    var grupos = null;
    try {
      status('Buscando os indicadores por grupo…');
      var d = await M.detalhesDaCelula(cel);
      grupos = {};
      M.GROUP_FIELDS.forEach(function (g) { grupos[g.field] = d[g.field]; });
      CAMPOS.forEach(function (k) { if (isNum(d[k])) valores[k] = d[k]; });
    } catch (e) { console.warn('[relatório] grupos indisponíveis:', e); }

    var areas = areas4326().filter(function (a) {
      return bbCruza([c[0], c[1], c[0], c[1]], a.bb) && turf.booleanPointInPolygon(gj, a.gj);
    }).map(function (a) { return { num: a.num, temas: a.temas, area_ha: a.area_ha }; });
    var distritos = distritos4326().filter(function (d) { return turf.booleanPointInPolygon(gj, d.gj); })
      .map(function (d) { return { nome: d.nome, pct: 100 }; });

    return { tipo: 'ponto', lon: c[0], lat: c[1], celula: cel, nCelulas: 1, valores: valores,
             grupos: grupos, areas: areas, distritos: distritos };
  }

  async function analisarArea(gj, status) {
    if (turf.kinks(gj).features.length) {
      throw new Error('As linhas da área desenhada se cruzam. Desenhe de novo, sem cruzar o contorno.');
    }
    var areaM2 = turf.area(gj);
    if (areaM2 > LIMITE_HA * 1e4) {
      throw new Error('A área desenhada tem ' + fmtArea(areaM2) + '. O limite do relatório é ' + num(LIMITE_HA / 100, 0) +
        ' km² (' + num(LIMITE_HA, 0) + ' ha), para que as médias continuem descrevendo um local. Desenhe uma área menor.');
    }
    var perim = turf.length(turf.polygonToLine(gj), { units: 'kilometers' }) * 1000;

    // Hexágonos candidatos pelo retângulo envolvente (R-tree do OL) e interseção exata
    var bb = turf.bbox(gj);
    var cand = M.hexSource.getFeaturesInExtent(ol.proj.transformExtent(bb, 'EPSG:4326', 'EPSG:3857'));
    var cels = [];
    for (var i = 0; i < cand.length; i++) {
      try {
        var inter = turf.intersect(gj, turf.polygon([M.contornoH3(cand[i].getId())]));   // turf@6: 2 argumentos
        if (inter) { var a = turf.area(inter); if (a > 0) cels.push({ f: cand[i], a: a }); }
      } catch (e) { console.warn('[relatório] interseção:', e); }
      if (i % 300 === 299) { status('Cruzando com a grade: ' + (i + 1) + ' de ' + cand.length + ' hexágonos…'); await pausa(); }
    }
    if (!cels.length) throw new Error('A área desenhada está fora da área com dados de risco (limite do município).');

    // Médias ponderadas pela área de interseção + distribuição da área por classe
    var valores = {}, distrib = {}, minmax = {};
    M.CAMADAS.forEach(function (cam) {
      var soma = 0, peso = 0, mn = Infinity, mx = -Infinity;
      var porClasse = cam.classes.map(function () { return 0; });
      cels.forEach(function (c) {
        var v = c.f.get(cam.campo);
        if (!isNum(v)) return;
        soma += v * c.a; peso += c.a; mn = Math.min(mn, v); mx = Math.max(mx, v);
        porClasse[M.indiceClasse(v, cam)] += c.a;
      });
      valores[cam.campo] = peso ? soma / peso : null;
      distrib[cam.campo] = porClasse;
      minmax[cam.campo] = peso ? [mn, mx] : null;
    });
    var areaCoberta = cels.reduce(function (s, c) { return s + c.a; }, 0);

    // Grupos: médias ponderadas, com os dados completos buscados em lotes
    var grupos = null;
    try {
      var linhas = await gruposDasCelulas(cels.map(function (c) { return c.f.getId(); }), status);
      grupos = {};
      M.GROUP_FIELDS.forEach(function (g) {
        var s = 0, p = 0;
        cels.forEach(function (c) {
          var l = linhas.get(c.f.getId()), v = l ? l[g.field] : null;
          if (isNum(v)) { s += v * c.a; p += c.a; }
        });
        grupos[g.field] = p ? s / p : null;
      });
    } catch (e) { console.warn('[relatório] grupos indisponíveis:', e); }

    status('Cruzando com as áreas prioritárias…');
    var areas = [];
    areas4326().forEach(function (a) {
      if (!bbCruza(bb, a.bb)) return;
      try {
        var x = turf.intersect(gj, a.gj);
        var ax = x ? turf.area(x) : 0;
        if (ax > 0) areas.push({ num: a.num, temas: a.temas, area_ha: a.area_ha, sobre_ha: ax / 1e4, pct: 100 * ax / areaM2 });
      } catch (e) { console.warn('[relatório] área prioritária:', e); }
    });
    var distritos = [];
    distritos4326().forEach(function (d) {
      if (!bbCruza(bb, d.bb)) return;
      try {
        var x = turf.intersect(gj, d.gj), ax = x ? turf.area(x) : 0;
        if (ax > 0) distritos.push({ nome: d.nome, pct: 100 * ax / areaM2 });
      } catch (e) { console.warn('[relatório] distrito:', e); }
    });
    distritos.sort(function (a, b) { return b.pct - a.pct; });

    return { tipo: 'area', areaM2: areaM2, perimetroM: perim, nCelulas: cels.length, areaCoberta: areaCoberta,
             valores: valores, distrib: distrib, minmax: minmax, grupos: grupos, areas: areas, distritos: distritos };
  }

  // =================== 5. RELATÓRIO: APRESENTAÇÃO =====================
  var chartRel = null;
  var ultimo = null;               // { r, gj } do relatório exibido (para exportar)

  function selo(v, cam) {
    var c = M.classifica(v, cam);
    return '<span class="rel-selo" style="background:' + c.color + ';color:' + c.text + '">' + esc(c.label) + '</span>';
  }
  function barraClasses(porClasse, cam) {
    var tot = porClasse.reduce(function (a, b) { return a + b; }, 0);
    if (!tot) return '';
    return '<div class="rel-barra" role="img" aria-label="' + esc(porClasse.map(function (a, i) {
      return cam.classes[i].label + ' ' + num(100 * a / tot, 0) + '%';
    }).join('; ')) + '">' + porClasse.map(function (a, i) {
      return a > 0 ? '<span style="width:' + (100 * a / tot) + '%;background:' + M.corDaClasse(cam, i) +
        '" title="' + esc(cam.classes[i].label + ': ' + num(100 * a / tot, 1) + '%') + '"></span>' : '';
    }).join('') + '</div>';
  }
  function chipsTemas(ids) {
    return ids.map(function (id) {
      var t = M.temaPorId(id);
      if (!t) return '';
      return '<span class="rel-tema" style="border-color:' + esc(t.cor) + '"><i style="background:' + esc(t.cor) + '"></i>' + esc(t.nome_curto) + '</span>';
    }).join(' ');
  }

  /** Corpo do relatório. `radar` é o HTML do gráfico (canvas no painel, <img> no arquivo exportado). */
  function corpoRelatorio(r, radar) {
    var final = M.CAMADAS[0];
    var resumo = r.tipo === 'ponto'
      ? 'Ponto em ' + num(r.lat, 5) + ', ' + num(r.lon, 5) + ' (graus, WGS 84) · hexágono ' + esc(r.celula)
      : 'Área desenhada de ' + fmtArea(r.areaM2) + ' · perímetro ' + fmtComprimento(r.perimetroM) +
        ' · ' + num(r.nCelulas, 0) + ' hexágonos' +
        (r.areaCoberta < r.areaM2 * 0.98 ? ' · ' + num(100 * r.areaCoberta / r.areaM2, 0) + '% da área tem dados de risco' : '');
    var distr = r.distritos.length
      ? 'Distrito' + (r.distritos.length > 1 ? 's' : '') + ': ' + r.distritos.map(function (d) {
          return esc(d.nome) + (r.tipo === 'area' && r.distritos.length > 1 ? ' (' + num(d.pct, 0) + '%)' : '');
        }).join(', ')
      : '';

    var vF = r.valores[final.campo];
    var blocoRisco =
      '<section class="rel-bloco"><h4>Risco climático</h4>' +
        '<div class="rel-destaque"><div><span class="rel-num">' + num(vF, 2) + '</span>' + selo(vF, final) + '</div>' +
        '<p>' + esc(final.curto) + (r.tipo === 'area'
          ? ' — média ponderada pela área' + (r.minmax[final.campo] ? '; varia de ' + num(r.minmax[final.campo][0], 2) +
            ' a ' + num(r.minmax[final.campo][1], 2) + ' entre os hexágonos' : '')
          : ' do hexágono') + '.</p></div>' +
        (r.tipo === 'area' ? '<div class="rel-sub">Área por classe de risco</div>' + barraClasses(r.distrib[final.campo], final) : '') +
        '<table class="rel-tabela"><tbody>' + M.CAMADAS.slice(1).map(function (cam) {
          var v = r.valores[cam.campo];
          return '<tr><th>' + esc(cam.curto) + '</th><td class="n">' + num(v, 2) + '</td><td>' + (isNum(v) ? selo(v, cam) : '—') + '</td></tr>' +
            (r.tipo === 'area' ? '<tr class="rel-tr-barra"><td colspan="3">' + barraClasses(r.distrib[cam.campo], cam) + '</td></tr>' : '');
        }).join('') + '</tbody></table>' +
      '</section>';

    var blocoGrupos = '<section class="rel-bloco"><h4>Indicadores por grupo</h4>' + (r.grupos
      ? radar + '<table class="rel-tabela"><tbody>' + M.GROUP_FIELDS.map(function (g) {
          var cam = M.CAMADAS.filter(function (c) { return c.mapa === g.mapa; })[0];
          return '<tr><th>' + esc(g.label) + ' <small>(' + esc(cam ? cam.curto : '') + ')</small></th><td class="n">' + num(r.grupos[g.field], 2) + '</td></tr>';
        }).join('') + '</tbody></table>'
      : '<p class="rel-vazio">Não foi possível obter os indicadores por grupo agora. Os demais resultados não dependem deles.</p>') +
      '</section>';

    var somaPct = r.areas.reduce(function (s, a) { return s + (a.pct || 0); }, 0);
    var blocoAreas = '<section class="rel-bloco"><h4>Áreas prioritárias para adaptação</h4>' + (r.areas.length
      ? (r.tipo === 'area' ? '<p>' + num(Math.min(100, somaPct), 0) + '% da área desenhada está dentro de áreas prioritárias.</p>'
                           : '<p>O ponto está dentro de uma área prioritária.</p>') +
        '<table class="rel-tabela"><thead><tr><th>Área</th><th>Temas estratégicos</th>' + (r.tipo === 'area' ? '<th class="n">Sobreposição</th>' : '') +
        '</tr></thead><tbody>' + r.areas.map(function (a) {
          return '<tr><td><strong>' + esc(a.num) + '</strong></td><td>' + chipsTemas(a.temas) + '</td>' +
            (r.tipo === 'area' ? '<td class="n">' + num(a.sobre_ha, 2) + ' ha<br><small>' + num(a.pct, 0) + '% do desenho</small></td>' : '') + '</tr>';
        }).join('') + '</tbody></table>'
      : '<p class="rel-vazio">O local não toca nenhuma das 60 áreas prioritárias para adaptação climática.</p>') +
      '</section>';

    return '<div class="rel-cabeca"><h3>Relatório do local</h3><p>' + resumo + '</p>' + (distr ? '<p>' + distr + '</p>' : '') + '</div>' +
      '<div class="rel-grade">' + blocoRisco + blocoGrupos + blocoAreas + '</div>' +
      '<p class="rel-nota"><strong>Como ler.</strong> Valores do estudo de risco climático de Maricá na grade hexagonal H3 ' +
      '(células de ~0,015 km²). ' + (r.tipo === 'area'
        ? 'Para a área, cada valor é a média dos hexágonos ponderada pela parte de cada um que fica dentro do desenho; '
        : '') +
      'as classes seguem as quebras naturais (Jenks) de cada camada do estudo. Médias de áreas maiores suavizam os extremos: ' +
      'consulte também a distribuição por classe. Resultado indicativo, não substitui avaliação em campo. ' +
      'Gerado em ' + new Date().toLocaleString('pt-BR') + ' no SIGWEB SBN Maricá.</p>';
  }

  function radarConfig(r) {
    return {
      type: 'radar',
      data: { labels: M.GROUP_FIELDS.map(function (g) { return g.label; }),
        datasets: [{ data: M.GROUP_FIELDS.map(function (g) { return isNum(r.grupos[g.field]) ? r.grupos[g.field] : null; }),
          backgroundColor: 'rgba(188,31,40,0.18)', borderColor: '#bc1f28', borderWidth: 2,
          pointBackgroundColor: '#bc1f28', pointRadius: 3, spanGaps: true }] },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        scales: { r: { min: 1, max: 5, ticks: { stepSize: 1, backdropColor: 'transparent', font: { size: 9 } },
          pointLabels: { font: { size: 10 }, color: '#1e2a38', callback: function (t) { return NS.quebraRotulo(t, 16); } },
          grid: { color: '#e5e9ee' }, angleLines: { color: '#e5e9ee' } } },
        plugins: { legend: { display: false },
          tooltip: { callbacks: { label: function (ctx) { return 'Valor: ' + num(ctx.parsed.r, 2); } } } }
      }
    };
  }

  function mostrarRelatorio(r, gj, feature) {
    ultimo = { r: r, gj: gj };
    var acoes = '<div class="rel-acoes" role="group" aria-label="Exportar relatório">' +
      '<button type="button" class="btn btn-primary" data-rel="html">Baixar relatório (HTML)</button>' +
      '<button type="button" class="btn btn-secondary" data-rel="imprimir">Imprimir / PDF</button>' +
      '<button type="button" class="btn btn-secondary" data-rel="csv">Dados (CSV)</button>' +
      '<button type="button" class="btn btn-secondary" data-rel="geojson">Geometria (GeoJSON)</button></div>';
    var radar = '<div class="rel-radar"><canvas id="rel-radar-canvas" role="img" aria-label="Gráfico de radar dos indicadores por grupo"></canvas></div>';
    var ext = feature.getGeometry().getExtent();
    if (r.tipo === 'ponto') {
      var c = feature.getGeometry().getCoordinates(), d = 400;
      ext = [c[0] - d, c[1] - d, c[0] + d, c[1] + d];
    }
    var corpo = NS.fichas.mostrarConteudo({
      titulo: r.tipo === 'ponto' ? 'Relatório do ponto' : 'Relatório da área desenhada',
      html: '<div class="relatorio">' + acoes + corpoRelatorio(r, radar) + '</div>',
      extent: ext
    });
    if (chartRel) { chartRel.destroy(); chartRel = null; }
    var cv = corpo.querySelector('#rel-radar-canvas');
    if (cv && r.grupos && window.Chart) {
      try { chartRel = new Chart(cv, radarConfig(r)); } catch (e) { console.warn('[relatório] radar:', e); }
    }
    corpo.querySelectorAll('[data-rel]').forEach(function (b) {
      b.addEventListener('click', function () { exportar(b.dataset.rel); });
    });
  }

  async function gerarRelatorio(feature) {
    var st = $('relatorio-status');
    var status = function (t) { st.textContent = t; };
    ocupado = true; travarRelatorio(true);
    status('Calculando o relatório…');
    try {
      if (!M.hexSource.getFeatures().length) throw new Error('A grade ainda não foi carregada.');
      var gj = paraGeoJSON(feature);
      var r = gj.geometry.type === 'Point' ? await analisarPonto(gj, status) : await analisarArea(gj, status);
      mostrarRelatorio(r, gj, feature);
      status('Relatório pronto — veja o painel abaixo do mapa.');
    } catch (e) {
      console.error('[relatório]', e);
      status(e.message || 'Não foi possível gerar o relatório.');
      relSource.clear();
    } finally {
      ocupado = false; travarRelatorio(false);
    }
  }

  function limparRelatorio() {
    relSource.clear();
    ultimo = null;
    $('relatorio-status').textContent = '';
    if (chartRel) { chartRel.destroy(); chartRel = null; }
    if (NS.fichas && NS.fichas.aberto() && document.querySelector('#sbn-corpo .relatorio')) NS.fichas.fechar();
  }
  $('relatorio-limpar').addEventListener('click', function () {
    if (modo && modo.indexOf('rel-') === 0) cancelarDesenho();
    limparRelatorio();
  });

  // =================== 6. EXPORTAÇÃO ==================================
  var CSS_ARQUIVO =
    'body{font-family:"Segoe UI",Arial,sans-serif;color:#1e2a38;max-width:900px;margin:24px auto;padding:0 16px;line-height:1.45}' +
    'header{border-bottom:4px solid #bc1f28;margin-bottom:16px;padding-bottom:8px}header b{color:#bc1f28}' +
    'h3{font-size:1.4rem;margin:0 0 4px}h4{font-size:1rem;margin:0 0 8px;color:#bc1f28;text-transform:uppercase;letter-spacing:.04em}' +
    '.rel-cabeca p{margin:2px 0;color:#5b6b7b;font-size:.9rem}.rel-bloco{border:1px solid #dde3e9;border-radius:8px;padding:12px 14px;margin:12px 0;break-inside:avoid}' +
    '.rel-destaque{display:flex;gap:14px;align-items:center;flex-wrap:wrap}.rel-destaque p{margin:0;color:#5b6b7b;font-size:.85rem}' +
    '.rel-num{font-size:2rem;font-weight:800;margin-right:8px}.rel-selo{display:inline-block;padding:2px 10px;border-radius:999px;font-size:.78rem;font-weight:700;-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
    '.rel-sub{font-size:.8rem;color:#5b6b7b;margin:10px 0 4px}.rel-barra{display:flex;height:12px;border-radius:3px;overflow:hidden;background:#eee;-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
    '.rel-barra span{display:block;height:100%}.rel-tabela{width:100%;border-collapse:collapse;margin-top:10px;font-size:.88rem}' +
    '.rel-tabela th,.rel-tabela td{text-align:left;padding:5px 6px;border-bottom:1px solid #eef1f4;vertical-align:top}.rel-tabela .n{text-align:right;white-space:nowrap}' +
    '.rel-tr-barra td{border-bottom:none;padding-top:0}.rel-tema{display:inline-flex;align-items:center;gap:5px;border:1px solid;border-radius:999px;padding:1px 8px;font-size:.78rem;margin:1px}' +
    '.rel-tema i{width:9px;height:9px;border-radius:50%;display:inline-block;-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
    '.rel-radar img{max-width:420px;width:100%;display:block;margin:0 auto}.rel-nota{font-size:.78rem;color:#5b6b7b;margin-top:16px}.rel-vazio{color:#5b6b7b}' +
    'footer{font-size:.75rem;color:#8396a8;margin-top:20px;border-top:1px solid #dde3e9;padding-top:8px}';

  function documentoHTML(imprimir) {
    var r = ultimo.r;
    var img = '';
    try {
      if (chartRel && r.grupos) img = '<div class="rel-radar"><img alt="Gráfico de radar dos indicadores por grupo" src="' +
        chartRel.toBase64Image() + '"></div>';
    } catch (e) { console.warn('[relatório] imagem do radar:', e); }   // a tabela dos grupos continua no arquivo
    return '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width, initial-scale=1"><title>Relatório do local — SIGWEB SBN Maricá</title>' +
      '<style>' + CSS_ARQUIVO + '</style></head><body>' +
      '<header><b>SIGWEB SBN Maricá</b> · Prefeitura de Maricá</header>' + corpoRelatorio(r, img) +
      '<footer>' + (function () {
        var g = JSON.stringify(ultimo.gj.geometry);
        return g.length <= 3000 ? 'Geometria do local (GeoJSON, EPSG:4326): ' + esc(g)
          : 'A geometria do local pode ser baixada em GeoJSON no próprio portal.';
      })() + '</footer>' +
      (imprimir ? '<script>window.onload=function(){window.print();}<\/script>' : '') +
      '</body></html>';
  }

  function linhasCSV() {
    var r = ultimo.r, L = [['secao', 'item', 'valor', 'classe_ou_unidade']];
    if (r.tipo === 'ponto') {
      L.push(['local', 'latitude', r.lat, 'graus'], ['local', 'longitude', r.lon, 'graus'], ['local', 'hexagono_h3', r.celula, '']);
    } else {
      L.push(['local', 'area', (r.areaM2 / 1e4).toFixed(4), 'ha'], ['local', 'perimetro', r.perimetroM.toFixed(1), 'm'],
             ['local', 'hexagonos', r.nCelulas, ''], ['local', 'area_com_dados', (r.areaCoberta / 1e4).toFixed(4), 'ha']);
    }
    r.distritos.forEach(function (d) { L.push(['distrito', d.nome, d.pct.toFixed(1), '% da area']); });
    M.CAMADAS.forEach(function (cam) {
      var v = r.valores[cam.campo];
      L.push(['risco', cam.curto, isNum(v) ? v.toFixed(4) : '', isNum(v) ? M.classifica(v, cam).label : '']);
      if (r.tipo === 'area') {
        var tot = r.distrib[cam.campo].reduce(function (a, b) { return a + b; }, 0) || 1;
        r.distrib[cam.campo].forEach(function (a, i) {
          L.push(['area_por_classe', cam.curto + ' - ' + cam.classes[i].label, (100 * a / tot).toFixed(1), '%']);
        });
      }
    });
    if (r.grupos) M.GROUP_FIELDS.forEach(function (g) {
      L.push(['grupo', g.label, isNum(r.grupos[g.field]) ? r.grupos[g.field].toFixed(4) : '', '']);
    });
    r.areas.forEach(function (a) {
      L.push(['area_prioritaria', 'area ' + a.num, r.tipo === 'area' ? a.sobre_ha.toFixed(4) : '',
              a.temas.map(function (id) { var t = M.temaPorId(id); return t ? t.nome_curto : id; }).join(' | ')]);
    });
    var q = function (v) { v = v == null ? '' : String(v); return /[",;\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    return '﻿' + L.map(function (l) { return l.map(q).join(','); }).join('\n');
  }

  function exportar(tipo) {
    if (!ultimo) return;
    var base = 'relatorio_local_' + new Date().toISOString().slice(0, 10);
    if (tipo === 'html') NS.baixar(documentoHTML(false), base + '.html', 'text/html;charset=utf-8');
    else if (tipo === 'csv') NS.baixar(linhasCSV(), base + '.csv', 'text/csv;charset=utf-8');
    else if (tipo === 'geojson') {
      var r = ultimo.r, props = { fonte: 'SIGWEB SBN Maricá', gerado_em: new Date().toISOString() };
      M.CAMADAS.forEach(function (cam) { props[cam.campo] = r.valores[cam.campo]; });
      props.areas_prioritarias = r.areas.map(function (a) { return a.num; });
      if (r.tipo === 'area') props.area_ha = r.areaM2 / 1e4;
      NS.baixar(JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: props, geometry: ultimo.gj.geometry }] }),
        base + '.geojson', 'application/geo+json');
    } else if (tipo === 'imprimir') {
      var url = URL.createObjectURL(new Blob([documentoHTML(true)], { type: 'text/html;charset=utf-8' }));
      var w = window.open(url, '_blank');
      if (!w) NS.baixar(documentoHTML(false), base + '.html', 'text/html;charset=utf-8');   // pop-up bloqueado
      setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
    }
  }

  // =================== 7. INTERFACE PÚBLICA ===========================
  NS.desenho = {
    ativo: function () { return !!draw; },
    cancelarDesenho: cancelarDesenho,
    parar: parar,
    // expostos para teste
    _gerarRelatorio: gerarRelatorio, _relSource: relSource, _medidaSource: medidaSource,
    _fmtArea: fmtArea, _fmtComprimento: fmtComprimento, LIMITE_HA: LIMITE_HA
  };

})(window.SIGWEB);
