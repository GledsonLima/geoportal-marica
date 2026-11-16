/* =====================================================================
   auxiliares.js — Camadas Auxiliares (v3.4.0)

   Divisão administrativa ... Limites distritais (mapa.js) e Limites dos bairros
   Referências territoriais .. Unidades de Conservação (INEA, 2026),
                               Zoneamento (LC nº 400/2025: polígonos, pontos e
                               hierarquia viária) e Corpos hídricos

   Princípios
   * CARGA SOB DEMANDA: nada é baixado na abertura do site. Cada camada é lida
     (rpc/camada_auxiliar?p_camada=...) só na primeira vez que é ligada — ou
     quando o relatório do local precisa dela. Depois fica em memória.
   * Hierarquia visual: são camadas de REFERÊNCIA, por cima da grade de risco.
     Bairros e UCs só em contorno; corpos hídricos em azul translúcido;
     zoneamento com preenchimento a 50% (ajustável) — é o único que "pinta".
   * "Mostrar rótulos" é um controle único para todas as auxiliares.
   ===================================================================== */
(function (NS) {
  'use strict';

  var CFG = window.GEOPORTAL_CONFIG || {};
  var $ = NS.$, esc = NS.esc, M = NS.mapa;
  var RPC = CFG.RPC_CAMADA_AUXILIAR || 'camada_auxiliar';
  var FONTE = '"Segoe UI", Arial, sans-serif';

  var rotulos = true;
  var opacidadeZon = 0.5;

  // ---------------------------------------------------- utilidades de estilo
  function rgba(hex, a) {
    return 'rgba(' + parseInt(hex.substr(1, 2), 16) + ',' + parseInt(hex.substr(3, 2), 16) + ',' +
           parseInt(hex.substr(5, 2), 16) + ',' + a + ')';
  }
  /** Quebra nomes longos em linhas (o OpenLayers aceita "\n" no texto). */
  function quebrar(txt, max) { return NS.quebraRotulo(String(txt || ''), max || 22).join('\n'); }

  function texto(t, o) {
    o = o || {};
    return new ol.style.Text({
      text: t, font: (o.italico ? 'italic ' : '') + (o.peso || '600') + ' ' + (o.tam || 11) + 'px ' + FONTE,
      fill: new ol.style.Fill({ color: o.cor || '#1e2a38' }),
      stroke: new ol.style.Stroke({ color: 'rgba(255,255,255,0.95)', width: o.halo || 3.5 }),
      placement: o.linha ? 'line' : 'point', overflow: !!o.overflow,
      offsetY: o.dy || 0, textBaseline: o.dy ? 'top' : 'middle'
    });
  }

  /** Hachura diagonal (áreas especiais do zoneamento). Cache por cor/alfa. */
  var cacheHachura = new Map();
  function hachura(cor, alfa) {
    var k = cor + '|' + alfa;
    if (cacheHachura.has(k)) return cacheHachura.get(k);
    var p = rgba(cor, alfa * 0.6);
    try {
      var cv = document.createElement('canvas'); cv.width = cv.height = 10;
      var cx = cv.getContext('2d');
      cx.strokeStyle = rgba(cor, Math.min(1, alfa * 1.4)); cx.lineWidth = 1.6;
      cx.beginPath(); cx.moveTo(0, 10); cx.lineTo(10, 0); cx.moveTo(-2, 2); cx.lineTo(2, -2); cx.moveTo(8, 12); cx.lineTo(12, 8); cx.stroke();
      p = cx.createPattern(cv, 'repeat') || p;
    } catch (e) { /* sem canvas: fica o preenchimento liso */ }
    cacheHachura.set(k, p);
    return p;
  }

  // ======================================================= DEFINIÇÕES
  // Paleta do zoneamento: convenção de planejamento urbano (urbano consolidado
  // em vermelhos, expansão em laranjas, rural em verde-claro, orla em azul,
  // desenvolvimento econômico em roxo). As áreas especiais vão hachuradas,
  // por cima das macrozonas que elas sobrepõem.
  var ZONAS = {
    'MCQU 1': { cor: '#b2182b' }, 'MCQU 2': { cor: '#d6604d' }, 'MCQU 3': { cor: '#f4a582' },
    'MUP 1': { cor: '#e08214' }, 'MUP 2': { cor: '#fdb863' }, 'MUP 3': { cor: '#fee0b6' },
    'MAU': { cor: '#c2a5cf' }, 'MDE': { cor: '#8073ac' }, 'MO': { cor: '#4393c3' }, 'MR': { cor: '#a6d96a' },
    'APA': { cor: '#1b7837', esp: true }, 'AEIA': { cor: '#1b7837', esp: true },
    'AEID': { cor: '#542788', esp: true }, 'AEIS': { cor: '#c51b7d', esp: true }
  };
  var VIARIO = {
    'Estruturantes': { cor: '#262626', w: 4.6 }, 'Primárias': { cor: '#474747', w: 3.4 },
    'Secundárias': { cor: '#6b6b6b', w: 2.4 }, 'Coletoras': { cor: '#8d8d8d', w: 1.6 },
    'Via parque': { cor: '#2e7d32', w: 3 }
  };
  var TRACO_ACAO = { 'Adequação': undefined, 'Abertura': [8, 6], 'Pavimentação': [2, 4] };
  var PONTOS = {
    'Áreas especiais de interesse pesqueiro': { cor: '#0868ac', forma: 'circulo', curto: 'Interesse pesqueiro' },
    'Áreas especiais de interesse indígena': { cor: '#8c510a', forma: 'quadrado', curto: 'Interesse indígena' }
  };

  // ---------------------------------------------------- estilos por camada
  var BAIRRO_LINHA = [
    new ol.style.Style({ stroke: new ol.style.Stroke({ color: 'rgba(255,255,255,0.75)', width: 3.2 }) }),
    new ol.style.Style({ stroke: new ol.style.Stroke({ color: '#6d5d8a', width: 1.2, lineDash: [6, 4] }) })
  ];
  function estiloBairro(f, res) {
    if (!rotulos || res > 60) return BAIRRO_LINHA;
    return BAIRRO_LINHA.concat([new ol.style.Style({ geometry: M.pontoRotulo,
      text: texto(quebrar(f.get('nome'), 16), { italico: true, tam: 11, cor: '#4b3f63' }) })]);
  }

  var UC_INTEGRAL = [
    new ol.style.Style({ stroke: new ol.style.Stroke({ color: 'rgba(255,255,255,0.85)', width: 4.6 }) }),
    new ol.style.Style({ stroke: new ol.style.Stroke({ color: '#14632f', width: 2.2 }) })
  ];
  var UC_SUSTENTAVEL = [
    new ol.style.Style({ stroke: new ol.style.Stroke({ color: 'rgba(255,255,255,0.85)', width: 4.2 }) }),
    new ol.style.Style({ stroke: new ol.style.Stroke({ color: '#4d9a2a', width: 2, lineDash: [10, 5] }) })
  ];
  function estiloUC(f, res) {
    var base = /integral/i.test(f.get('grupo') || '') ? UC_INTEGRAL : UC_SUSTENTAVEL;
    if (!rotulos || res > 80) return base;
    return base.concat([new ol.style.Style({ geometry: M.pontoRotulo,
      text: texto(quebrar(f.get('nome'), 24), { tam: 11, cor: '#14532d', peso: '700' }) })]);
  }

  var HID = {
    'Água': [new ol.style.Style({ fill: new ol.style.Fill({ color: 'rgba(116,169,207,0.6)' }),
                                  stroke: new ol.style.Stroke({ color: '#3a7fb5', width: 0.8 }) })],
    'Área úmida': [new ol.style.Style({ fill: new ol.style.Fill({ color: 'rgba(110,175,165,0.32)' }),
                                        stroke: new ol.style.Stroke({ color: '#4f948a', width: 0.7, lineDash: [3, 3] }) })]
  };
  HID['Margem de rio'] = HID['Água'];
  function estiloHidrico(f, res) {
    var base = HID[f.get('tipo')] || HID['Água'];
    var nome = f.get('nome');
    if (!rotulos || !nome || res > 80) return base;
    return base.concat([new ol.style.Style({ geometry: M.pontoRotulo,
      text: texto(quebrar(nome, 18), { italico: true, tam: 11.5, cor: '#174f7d', peso: '600' }) })]);
  }

  var cacheZon = new Map();
  function estiloZona(f, res) {
    var sig = f.get('sigla'), d = ZONAS[sig] || { cor: '#888888' };
    var k = sig + '|' + opacidadeZon;
    var base = cacheZon.get(k);
    if (!base) {
      base = d.esp
        ? [new ol.style.Style({ fill: new ol.style.Fill({ color: hachura(d.cor, opacidadeZon) }),
                                stroke: new ol.style.Stroke({ color: d.cor, width: 1.6, lineDash: sig === 'AEIS' ? undefined : [7, 4] }) })]
        : [new ol.style.Style({ fill: new ol.style.Fill({ color: rgba(d.cor, opacidadeZon) }),
                                stroke: new ol.style.Stroke({ color: rgba(d.cor, Math.min(1, opacidadeZon + 0.35)), width: 1 }) })];
      cacheZon.set(k, base);
    }
    if (!rotulos) return base;
    // Macrozonas: sigla (a legenda explica). Áreas especiais: nome, só de perto.
    if (!d.esp && res < 90) {
      return base.concat([new ol.style.Style({ geometry: M.pontoRotulo, text: texto(sig, { tam: 12, peso: '800', cor: '#2a2a2a' }) })]);
    }
    if (d.esp && res < 12 && f.get('nome')) {
      return base.concat([new ol.style.Style({ geometry: M.pontoRotulo,
        text: texto(quebrar(f.get('nome'), 18), { tam: 10.5, cor: d.cor, peso: '700' }) })]);
    }
    return base;
  }

  var cachePto = new Map();
  function estiloPonto(f, res) {
    var d = PONTOS[f.get('categoria')] || { cor: '#555555', forma: 'circulo' };
    var base = cachePto.get(d.cor);
    if (!base) {
      var fill = new ol.style.Fill({ color: d.cor }), stroke = new ol.style.Stroke({ color: '#ffffff', width: 2 });
      var img = d.forma === 'quadrado'
        ? new ol.style.RegularShape({ points: 4, radius: 7.5, angle: Math.PI / 4, fill: fill, stroke: stroke })
        : new ol.style.Circle({ radius: 6, fill: fill, stroke: stroke });
      base = [new ol.style.Style({ image: img })];
      cachePto.set(d.cor, base);
    }
    if (!rotulos || res > 30) return base;
    return base.concat([new ol.style.Style({ text: texto(quebrar(f.get('nome'), 20), { tam: 10.5, cor: d.cor, peso: '700', dy: 10 }) })]);
  }

  var cacheVia = new Map();
  function estiloViario(f, res) {
    var c = f.get('classe'), a = f.get('acao'), d = VIARIO[c] || { cor: '#666666', w: 2 };
    var k = c + '|' + a;
    var base = cacheVia.get(k);
    if (!base) {
      base = [
        new ol.style.Style({ stroke: new ol.style.Stroke({ color: 'rgba(255,255,255,0.9)', width: d.w + 2.4 }) }),
        new ol.style.Style({ stroke: new ol.style.Stroke({ color: d.cor, width: d.w, lineDash: TRACO_ACAO[a] }) })
      ];
      cacheVia.set(k, base);
    }
    if (!rotulos || res > 8) return base;
    return base.concat([new ol.style.Style({ text: texto(c, { tam: 10, linha: true, cor: d.cor }) })]);
  }

  // ======================================================= CAMADAS
  /*  Ordem de desenho (zIndex): grade 10 < zoneamento 12 < hídricos 14 < UC 16
      < bairros 18 < distritos 20 < áreas prioritárias 24–25 < viário 27 < pontos 28.  */
  var DEF = {
    bairros:              { rpc: 'bairros', z: 18, estilo: estiloBairro, chave: 'toggle-bairros' },
    unidades_conservacao: { rpc: 'unidades_conservacao', z: 16, estilo: estiloUC, chave: 'toggle-ucs' },
    corpos_hidricos:      { rpc: 'corpos_hidricos', z: 14, estilo: estiloHidrico, chave: 'toggle-hidricos' },
    zoneamento:           { rpc: 'zoneamento', z: 12, estilo: estiloZona, chave: 'toggle-zon-poligonos' },
    zoneamento_pontos:    { rpc: 'zoneamento_pontos', z: 28, estilo: estiloPonto, chave: 'toggle-zon-pontos' },
    zoneamento_viario:    { rpc: 'zoneamento_viario', z: 27, estilo: estiloViario, chave: 'toggle-zon-viario' }
  };
  Object.keys(DEF).forEach(function (id) {
    var d = DEF[id];
    d.source = new ol.source.Vector({ wrapX: false });
    d.layer = new ol.layer.Vector({ source: d.source, style: d.estilo, zIndex: d.z, visible: false,
                                    declutter: true, properties: { auxiliar: id } });
    d.fc = null;            // GeoJSON original (4326), usado no relatório
    d.promessa = null;      // carga em andamento ou concluída
    M.map.addLayer(d.layer);
  });

  /** Lê a camada uma vez só (as chamadas seguintes reaproveitam a mesma promessa). */
  function carregar(id) {
    var d = DEF[id];
    if (!d.promessa) {
      d.promessa = NS.api.get('rpc/' + RPC + '?p_camada=' + encodeURIComponent(d.rpc)).then(function (fc) {
        if (!fc || !Array.isArray(fc.features)) throw new Error('Resposta inesperada da base de dados.');
        d.fc = fc;
        d.source.addFeatures(new ol.format.GeoJSON().readFeatures(fc, {
          dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857'
        }));
        return fc.features.length;
      }).catch(function (e) { d.promessa = null; throw e; });   // permite tentar de novo
    }
    return d.promessa;
  }

  /** O "pai" Zoneamento liga/desliga as três subcamadas conforme as suas chaves. */
  function zonLigado() { var p = $('toggle-zoneamento'); return !!(p && p.checked); }

  async function aplicar(id) {
    var d = DEF[id], chave = $(d.chave);
    var ligar = !!(chave && chave.checked) && (id.indexOf('zoneamento') !== 0 || zonLigado());
    var status = $('status-' + (id.indexOf('zoneamento') === 0 ? 'zoneamento' : id));
    if (!ligar) { d.layer.setVisible(false); montarLegendas(); return; }
    try {
      if (!d.fc && status) { status.textContent = 'carregando…'; status.className = 'aux-status'; }
      var n = await carregar(id);
      if (status) { status.textContent = ''; }
      d.layer.setVisible(!!(chave.checked) && (id.indexOf('zoneamento') !== 0 || zonLigado()));
      montarLegendas();
      return n;
    } catch (e) {
      console.error('[auxiliares] ' + id + ':', e);
      d.layer.setVisible(false);
      if (chave) chave.checked = false;
      if (status) {
        status.textContent = /PGRST202|not find|Could not|camada_auxiliar/i.test((e.code || '') + e.message)
          ? 'indisponível — rode o script 07 no banco' : 'falha ao carregar — tente de novo';
        status.className = 'aux-status erro';
      }
      montarLegendas();
    }
  }

  // ======================================================= LEGENDAS
  function linhaLeg(simbolo, txt) {
    return '<div class="legend-row">' + simbolo + '<span class="legend-label">' + esc(txt) + '</span></div>';
  }
  function simLinha(cor, traco, w) {
    return '<span class="sim-linha" style="border-top:' + (w || 2) + 'px ' + (traco || 'solid') + ' ' + esc(cor) + '"></span>';
  }
  function simArea(fundo, borda, hach) {
    return '<span class="sim-area' + (hach ? ' hach' : '') + '" style="background-color:' + esc(fundo) +
      ';border-color:' + esc(borda) + (hach ? ';color:' + esc(borda) : '') + '"></span>';
  }
  function simPonto(cor, quadrado) {
    return '<span class="sim-ponto' + (quadrado ? ' q' : '') + '" style="background:' + esc(cor) + '"></span>';
  }

  /** Classes de zoneamento presentes nos dados, na ordem da lei (campo ordem). */
  function zonasPresentes() {
    var vistos = new Map();
    (DEF.zoneamento.fc ? DEF.zoneamento.fc.features : []).forEach(function (f) {
      var p = f.properties; if (!vistos.has(p.sigla)) vistos.set(p.sigla, p);
    });
    return Array.from(vistos.values()).sort(function (a, b) { return a.ordem - b.ordem; });
  }

  function htmlLegendaZoneamento(completa) {
    var h = '';
    var zs = zonasPresentes();
    if (DEF.zoneamento.layer.getVisible() || completa) {
      zs.forEach(function (p) {
        var d = ZONAS[p.sigla] || { cor: '#888888' };
        h += linhaLeg(d.esp ? simArea(rgba(d.cor, 0.12), d.cor, true) : simArea(rgba(d.cor, Math.max(0.35, opacidadeZon)), d.cor),
                      p.sigla + ' — ' + (p.tipo === 'macrozona' ? p.zona.replace(/^Macrozona (de |da |do )?/i, '') : p.zona));
      });
    }
    if (DEF.zoneamento_pontos.layer.getVisible() || completa) {
      Object.keys(PONTOS).forEach(function (k) { h += linhaLeg(simPonto(PONTOS[k].cor, PONTOS[k].forma === 'quadrado'), PONTOS[k].curto); });
    }
    if (DEF.zoneamento_viario.layer.getVisible() || completa) {
      Object.keys(VIARIO).forEach(function (k) {
        h += linhaLeg(simLinha(VIARIO[k].cor, 'solid', Math.max(2, Math.round(VIARIO[k].w * 0.7))), k === 'Via parque' ? k : 'Vias ' + k.toLowerCase());
      });
      h += linhaLeg(simLinha('#555', 'dashed', 2), 'Abertura prevista') + linhaLeg(simLinha('#555', 'dotted', 2), 'Pavimentação prevista');
    }
    return h;
  }

  function montarLegendas() {
    // 1) Caixa compacta sobre o mapa
    var h = '';
    if (DEF.bairros.layer.getVisible()) h += linhaLeg(simLinha('#6d5d8a', 'dashed', 2), 'Limite de bairro');
    if (DEF.unidades_conservacao.layer.getVisible()) {
      h += linhaLeg(simLinha('#14632f', 'solid', 3), 'UC de proteção integral') +
           linhaLeg(simLinha('#4d9a2a', 'dashed', 3), 'UC de uso sustentável');
    }
    if (DEF.corpos_hidricos.layer.getVisible()) {
      h += linhaLeg(simArea('rgba(116,169,207,0.6)', '#3a7fb5'), 'Corpo hídrico') +
           linhaLeg(simArea('rgba(110,175,165,0.32)', '#4f948a'), 'Área úmida');
    }
    var zon = DEF.zoneamento.layer.getVisible() || DEF.zoneamento_pontos.layer.getVisible() || DEF.zoneamento_viario.layer.getVisible();
    if (zon) {
      h += '<div class="legend-sub">Zoneamento (LC 400/2025)</div>' +
           '<button type="button" class="legend-link" data-abrir-painel="legenda">Ver a legenda completa</button>';
    }
    // Com alguma auxiliar ligada, o limite distrital entra na mesma caixa
    // (uma caixa a menos empilhada sobre o mapa).
    var caixa = $('aux-legend'), dist = $('distritos-legend'), distOn = $('toggle-distritos') && $('toggle-distritos').checked;
    if (h && distOn) h = linhaLeg(simLinha('#1e2a38', 'solid', 3), 'Limite distrital') + h;
    if (caixa) { $('aux-legend-rows').innerHTML = h; caixa.hidden = !h; }
    if (dist) dist.style.display = (distOn && !h) ? 'block' : 'none';

    // 2) Legenda completa do zoneamento no menu Legenda
    var el = $('legenda-zoneamento');
    if (el) {
      var z = zonLigado() ? htmlLegendaZoneamento(false) : '';
      el.innerHTML = z || '<p class="hint-text">Ligue o Zoneamento em Camadas → Camadas Auxiliares para ver a legenda.</p>';
    }
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-abrir-painel]');
    if (b && NS.painel && NS.painel.abrirPainel) NS.painel.abrirPainel(b.dataset.abrirPainel);
  });

  // ======================================================= CONTROLES
  function ligar() {
    ['bairros', 'unidades_conservacao', 'corpos_hidricos'].forEach(function (id) {
      var ch = $(DEF[id].chave);
      if (ch) ch.addEventListener('change', function () { aplicar(id); });
    });
    ['zoneamento', 'zoneamento_pontos', 'zoneamento_viario'].forEach(function (id) {
      var ch = $(DEF[id].chave);
      if (ch) ch.addEventListener('change', function () { aplicar(id); });
    });
    var td = $('toggle-distritos');
    if (td) td.addEventListener('change', function () { setTimeout(montarLegendas, 0); });
    var pai = $('toggle-zoneamento');
    if (pai) pai.addEventListener('change', function () {
      var sub = $('zoneamento-sub');
      if (sub) sub.hidden = !pai.checked;
      ['zoneamento', 'zoneamento_pontos', 'zoneamento_viario'].forEach(aplicar);
    });
    var op = $('zon-opacity-slider');
    if (op) op.addEventListener('input', function () {
      opacidadeZon = op.value / 100;
      $('zon-opacity-value').textContent = op.value;
      cacheZon.clear(); cacheHachura.clear();
      DEF.zoneamento.layer.changed();
      montarLegendas();
    });
    var rot = $('toggle-rotulos-aux');
    if (rot) {
      rotulos = rot.checked;
      M.setRotulosDistritos(rotulos);
      rot.addEventListener('change', function () { setRotulos(rot.checked); });
    }
    montarLegendas();
  }

  function setRotulos(v) {
    rotulos = !!v;
    M.setRotulosDistritos(rotulos);
    Object.keys(DEF).forEach(function (id) { DEF[id].layer.changed(); });
  }

  // ======================================================= CONSULTA (relatório)
  function bbox(g) { try { return turf.bbox(g); } catch (e) { return null; } }
  function cruza(a, b) { return a && b && a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1]; }

  /**
   * Bairros, UCs e zonas que um ponto ou polígono (GeoJSON 4326) toca.
   * Carrega as camadas que faltarem; se o script 07 não rodou, devolve null
   * naquela parte e o relatório segue sem ela.
   */
  async function consultar(gj) {
    var ponto = gj.geometry.type === 'Point';
    var areaTot = ponto ? 0 : turf.area(gj);
    var bb = ponto ? [gj.geometry.coordinates[0], gj.geometry.coordinates[1], gj.geometry.coordinates[0], gj.geometry.coordinates[1]] : bbox(gj);

    async function camada(id, fn) {
      try { await carregar(id); } catch (e) { console.warn('[auxiliares] relatório sem ' + id + ':', e.message); return null; }
      var out = [];
      DEF[id].fc.features.forEach(function (f) {
        if (!f.geometry || !cruza(bb, f.bbox || (f.bbox = bbox(f)))) return;
        try {
          if (ponto) { if (turf.booleanPointInPolygon(gj, f)) out.push(fn(f, 100)); }
          else {
            var x = turf.intersect(gj, f), a = x ? turf.area(x) : 0;
            if (a > 0) out.push(fn(f, 100 * a / areaTot));
          }
        } catch (e) { console.warn('[auxiliares] interseção:', e); }
      });
      out.sort(function (a, b) { return b.pct - a.pct; });
      return out;
    }

    var r = await Promise.all([
      camada('bairros', function (f, pct) { return { nome: f.properties.nome, pct: pct }; }),
      camada('unidades_conservacao', function (f, pct) { return { nome: f.properties.nome, grupo: f.properties.grupo, esfera: f.properties.esfera, pct: pct }; }),
      camada('zoneamento', function (f, pct) { return { sigla: f.properties.sigla, zona: f.properties.zona, nome: f.properties.nome, tipo: f.properties.tipo, pct: pct }; })
    ]);
    // Zonas: soma por sigla (uma macrozona pode ter vários polígonos)
    var zonas = null;
    if (r[2]) {
      var por = new Map();
      r[2].forEach(function (z) {
        var k = z.tipo === 'macrozona' ? z.sigla : z.sigla + '|' + z.nome;
        var o = por.get(k) || { sigla: z.sigla, zona: z.zona, nome: z.tipo === 'macrozona' ? null : z.nome, tipo: z.tipo, pct: 0 };
        o.pct += z.pct; por.set(k, o);
      });
      zonas = Array.from(por.values()).sort(function (a, b) {
        return (a.tipo === b.tipo ? 0 : a.tipo === 'macrozona' ? -1 : 1) || b.pct - a.pct;
      });
    }
    return { bairros: r[0], ucs: r[1], zonas: zonas };
  }

  NS.aux = {
    ligar: ligar,
    consultar: consultar,
    setRotulos: setRotulos,
    camadas: DEF,
    carregar: carregar,
    cor: function (sigla) { return (ZONAS[sigla] || { cor: '#888888' }).cor; }
  };

})(window.SIGWEB);
