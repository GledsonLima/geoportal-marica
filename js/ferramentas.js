/* =====================================================================
   ferramentas.js — filtro por indicador, upload e análise de sobreposição
                    e exportação. (Medir e relatório: js/desenho.js.)

   Tudo roda no navegador, contra a grade já carregada:
     * Ponto    -> h3.latLngToCell(lat, lon, 10) dá a célula exata (sem teste geométrico)
     * Linha    -> média simples dos hexágonos atravessados
     * Polígono -> média ponderada pela área de interseção E média simples,
                   mais a distribuição da área por classe de risco
   Áreas calculadas com turf.area (geodésica, em m²): não sofrem a distorção
   de área do Web Mercator, que em Maricá já chega a ~17%.
   ===================================================================== */
window.SIGWEB = window.SIGWEB || {};
(function (NS) {
  'use strict';

  var CFG = window.GEOPORTAL_CONFIG || {};
  var $ = NS.$, esc = NS.esc, num = NS.num, isNum = NS.isNum, pausa = NS.pausa;
  var M = NS.mapa;

  // =================== 1. FILTRO ======================================
  function atualizarStatusFiltro() {
    var total = M.hexSource.getFeatures().length;
    if (!total) return;
    var visiveis = M.hexSource.getFeatures().filter(function (f) {
      return M.passaFiltro(M.valorAtivo(f));
    }).length;
    $('filter-status').textContent = visiveis === total ? '' :
      'Exibindo ' + visiveis.toLocaleString('pt-BR') + ' de ' + total.toLocaleString('pt-BR') + ' hexágonos.';
  }
  NS.atualizarStatusFiltro = atualizarStatusFiltro;

  /** O filtro vale para a camada que está colorindo o mapa; o rótulo diz qual é. */
  function atualizarRotuloFiltro() {
    var el = $('filter-camada');
    if (el) el.textContent = M.camadaAtiva().curto;
  }
  NS.atualizarRotuloFiltro = atualizarRotuloFiltro;

  function ligarFiltro() {
    $('apply-filter').addEventListener('click', function () {
      var mn = $('filter-min').value, mx = $('filter-max').value;
      if (mn === '' && mx === '') { $('filter-status').textContent = 'Informe o mínimo, o máximo ou os dois.'; return; }
      var a = mn === '' ? null : Number(mn), b = mx === '' ? null : Number(mx);
      if ((a !== null && isNaN(a)) || (b !== null && isNaN(b))) { $('filter-status').textContent = 'Valores inválidos.'; return; }
      if (a !== null && b !== null && a > b) { $('filter-status').textContent = 'O mínimo é maior que o máximo.'; return; }
      M.filtro.min = a; M.filtro.max = b;
      M.hexLayer.changed(); atualizarStatusFiltro();
    });
    $('clear-filter').addEventListener('click', function () {
      $('filter-min').value = ''; $('filter-max').value = '';
      M.filtro.min = null; M.filtro.max = null;
      M.hexLayer.changed(); atualizarStatusFiltro();
    });
  }

  // (v3.3.0) O catálogo de "Outras camadas" e a conexão manual de tabelas foram
  // retirados da interface a pedido do projeto. A tabela catalogo_camadas pode
  // continuar no banco; o site apenas não a lê mais.

  // =================== 3. UPLOAD E ANÁLISE ============================
  function limparUpload() {
    M.uploadedSource.clear();
    $('upload-results').innerHTML = '';
    $('upload-status').textContent = '';
  }
  NS.limparUpload = limparUpload;

  /** Hexágonos cujo retângulo envolvente cruza o da feição (filtro rápido via R-tree do OL). */
  function hexCandidatos(feat4326) {
    var bb = turf.bbox(feat4326);
    var ext = ol.proj.transformExtent(bb, 'EPSG:4326', 'EPSG:3857');
    return M.hexSource.getFeaturesInExtent(ext);
  }
  function poligonoHex(f) { return turf.polygon([M.contornoH3(f.getId())]); }

  /**
   * Analisa uma feição contra a grade. `cam` é a camada do índice que está
   * colorindo o mapa — fixada no início da análise para que uma troca de
   * camada no meio do processamento não misture indicadores no resultado.
   */
  async function analisarFeicao(feature, idx, cam) {
    var campo = cam.campo;
    var tipo = feature.geometry ? feature.geometry.type : null;
    var props = feature.properties || {};
    var name = props.name || props.Name || props.NAME || props.nome || props.Nome || ('Feição ' + (idx + 1));

    if (tipo === 'Point' || tipo === 'MultiPoint') {
      var pts = tipo === 'Point' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
      var vals = [];
      pts.forEach(function (c) {
        var cel = h3.latLngToCell(c[1], c[0], M.resolucaoH3);
        var f = M.hexPorId.get(cel);
        if (f && isNum(f.get(campo))) vals.push(f.get(campo));
      });
      if (!vals.length) return { name: name, type: 'Ponto', found: false };
      var v = vals.reduce(function (a, b) { return a + b; }, 0) / vals.length;
      return { name: name, type: pts.length > 1 ? 'Multiponto' : 'Ponto', found: true, value: v, count: vals.length };
    }

    if (tipo === 'LineString' || tipo === 'MultiLineString') {
      var valsL = [], cand = hexCandidatos(feature);
      for (var i = 0; i < cand.length; i++) {
        try {
          if (turf.booleanIntersects(feature, poligonoHex(cand[i])) && isNum(cand[i].get(campo))) {
            valsL.push(cand[i].get(campo));
          }
        } catch (e) { console.warn('[upload] linha x hexágono:', e); }
        if (i % 1000 === 999) await pausa();
      }
      if (!valsL.length) return { name: name, type: 'Linha', found: false };
      return { name: name, type: 'Linha', found: true,
        value: valsL.reduce(function (a, b) { return a + b; }, 0) / valsL.length, count: valsL.length };
    }

    if (tipo === 'Polygon' || tipo === 'MultiPolygon') {
      var candP = hexCandidatos(feature);
      var soma = 0, somaPond = 0, areaTot = 0, n = 0;
      var areaClasse = cam.classes.map(function () { return 0; });
      for (var k = 0; k < candP.length; k++) {
        var vv = candP[k].get(campo);
        if (!isNum(vv)) continue;
        try {
          var inter = turf.intersect(feature, poligonoHex(candP[k]));   // turf@6: 2 argumentos
          if (inter) {
            var a = turf.area(inter);
            if (a > 0) { soma += vv; somaPond += vv * a; areaTot += a; n++; areaClasse[M.indiceClasse(vv, cam)] += a; }
          }
        } catch (e) { console.warn('[upload] interseção de polígono:', e); }
        if (k % 500 === 499) {
          $('upload-status').textContent = 'Analisando "' + name + '": ' + (k + 1) + ' de ' + candP.length + ' hexágonos…';
          await pausa();
        }
      }
      if (!n) return { name: name, type: 'Polígono', found: false };
      return { name: name, type: 'Polígono', found: true, value: somaPond / areaTot,
        simples: soma / n, count: n, area: areaTot, areaClasse: areaClasse };
    }
    return { name: name, type: tipo || 'desconhecido', found: false, unsupported: true };
  }

  function mostrarResultados(rows, cam) {
    $('upload-results').innerHTML =
      '<div class="result-camada">Valores de <strong>' + esc(cam.curto) + '</strong></div>' +
      rows.map(function (r) {
      if (r.unsupported) {
        return '<div class="result-card"><div class="result-name">' + esc(r.name) +
          '</div><div class="result-meta">Tipo de geometria (' + esc(r.type) + ') não suportado.</div></div>';
      }
      if (!r.found) {
        return '<div class="result-card"><div class="result-name">' + esc(r.name) +
          '</div><div class="result-meta">' + esc(r.type) + ' — fora da área com dados de risco.</div></div>';
      }
      var cat = M.classifica(r.value, cam), extra;
      if (r.type === 'Polígono') {
        var barra = r.areaClasse.map(function (a, i) {
          return a > 0 ? '<span title="' + esc(cam.classes[i].label) + ': ' + num(100 * a / r.area, 1) +
            '%" style="display:inline-block;height:8px;width:' + (100 * a / r.area) +
            '%;background:' + M.corDaClasse(cam, i) + ';"></span>' : '';
        }).join('');
        extra = '<div class="result-meta">Média ponderada pela área: <strong>' + num(r.value, 2) +
          '</strong> · média simples: ' + num(r.simples, 2) + '</div>' +
          '<div class="result-meta">' + r.count + ' hexágono(s) · área analisada: ' + num(r.area / 10000, 2) + ' ha</div>' +
          '<div class="result-barra">' + barra + '</div>' +
          '<div class="result-meta">Distribuição da área por classe de risco</div>';
      } else {
        extra = '<div class="result-meta">Valor do indicador: <strong>' + num(r.value, 2) + '</strong>' +
          (r.count > 1 ? ' (média de ' + r.count + ' hexágonos)' : '') + '</div>';
      }
      return '<div class="result-card"><div class="result-name"><span class="result-dot" style="background:' +
        cat.color + ';"></span>' + esc(r.name) + '</div><div class="result-meta">' + esc(r.type) +
        ' — ' + esc(cat.label) + '</div>' + extra + '</div>';
    }).join('');
  }

  function ligarUpload() {
    var uploadInput = $('upload-input');
    $('clear-upload-btn').addEventListener('click', function () {
      limparUpload(); uploadInput.value = '';
      if (NS.fecharInfo) NS.fecharInfo();
    });

    uploadInput.addEventListener('change', async function (e) {
      var file = e.target.files[0];
      if (!file) return;
      limparUpload();
      if (!M.hexSource.getFeatures().length) { $('upload-status').textContent = 'A grade ainda não foi carregada.'; return; }
      $('upload-status').textContent = 'Processando arquivo…';
      try {
        var nome = file.name.toLowerCase(), geojson;
        if (nome.endsWith('.kml')) {
          var feats = new ol.format.KML({ extractStyles: false })
            .readFeatures(await file.text(), { featureProjection: 'EPSG:4326' });
          geojson = new ol.format.GeoJSON().writeFeaturesObject(feats);
        } else if (nome.endsWith('.zip')) {
          var res = await shp(await file.arrayBuffer());   // shpjs reprojeta para WGS84 pelo .prj
          geojson = Array.isArray(res)
            ? { type: 'FeatureCollection', features: res.reduce(function (acc, fc) { return acc.concat(fc.features); }, []) }
            : res;
        } else {
          $('upload-status').textContent = 'Formato não suportado. Envie .kml ou .zip com o shapefile completo (.shp, .shx, .dbf, .prj).';
          return;
        }

        // Separa GeometryCollection (comum em KML) em feições simples
        var simples = [];
        (geojson.features || []).forEach(function (f) {
          if (f.geometry && f.geometry.type === 'GeometryCollection') {
            f.geometry.geometries.forEach(function (g) {
              simples.push({ type: 'Feature', properties: f.properties, geometry: g });
            });
          } else if (f.geometry) simples.push(f);
        });
        if (!simples.length) { $('upload-status').textContent = 'Nenhuma feição com geometria encontrada no arquivo.'; return; }
        if (!NS.api.pareceWGS84(simples)) {
          $('upload-status').textContent = 'As coordenadas não parecem estar em graus (WGS 84). No shapefile, confira o .prj.';
          return;
        }

        M.uploadedSource.addFeatures(new ol.format.GeoJSON().readFeatures(
          { type: 'FeatureCollection', features: simples },
          { dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857' }));
        var ext = M.uploadedSource.getExtent();
        if (ext && isFinite(ext[0])) M.map.getView().fit(ext, { padding: [40, 40, 40, 40], maxZoom: 17, duration: 500 });

        // Camada fixada agora: a análise pode levar segundos e não deve
        // misturar indicadores se o usuário trocar de camada no meio.
        var cam = M.camadaAtiva();
        var rows = [];
        for (var i = 0; i < simples.length; i++) {
          $('upload-status').textContent = 'Analisando feição ' + (i + 1) + ' de ' + simples.length + '…';
          rows.push(await analisarFeicao(simples[i], i, cam));
        }
        mostrarResultados(rows, cam);
        $('upload-status').textContent = 'Análise concluída — ' + rows.length + ' feição(ões) processada(s).';
      } catch (err) {
        console.error('[upload] erro ao processar:', err);
        $('upload-status').textContent = 'Erro ao processar o arquivo. Abra o Console (F12) para ver os detalhes técnicos.';
      }
    });
  }

  // =================== 4. EXPORTAÇÃO ==================================
  function hexVisiveis() {
    return M.hexSource.getFeatures().filter(function (f) { return M.passaFiltro(M.valorAtivo(f)); });
  }
  function propsLimpos(f) {
    var p = f.getProperties();
    delete p.geometry;
    Object.keys(p).forEach(function (k) { if (k.charAt(0) === '_') delete p[k]; });
    return p;
  }

  /**
   * No modo leve a grade só tem 2 campos; os demais são baixados (uma vez)
   * da função completa, somente na hora de exportar.
   */
  async function prepararExportacao(alvo, feats) {
    if (alvo === 'hex' && M.modoLeve()) {
      var dc = await M.obterDadosCompletos();
      return {
        campos: dc.campos,
        propsDe: function (f) {
          var l = dc.porId.get(f.getId()), o = {};
          if (l) dc.campos.forEach(function (c, i) { o[c] = l[i]; });
          return o;
        }
      };
    }
    var campos = (M.campos().length && alvo === 'hex') ? M.campos() : Object.keys(propsLimpos(feats[0]));
    return { campos: campos, propsDe: propsLimpos };
  }

  function ligarExportacao() {
    document.querySelectorAll('[data-export]').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        var alvo = btn.dataset.export, fmt = btn.dataset.format;
        var feats = alvo === 'hex' ? hexVisiveis() : M.distritosSource.getFeatures();
        if (!feats.length) { alert('Não há feições para exportar (dados ainda carregando ou filtro vazio).'); return; }
        var base = alvo === 'hex' ? 'marica_hex_indicadores' : 'marica_limites_distritais';
        var rotulo = btn.textContent;
        btn.disabled = true; btn.textContent = '…';
        try {
          var p = await prepararExportacao(alvo, feats);
          var campos = p.campos, propsDe = p.propsDe;
          if (fmt === 'csv') {
            var q = function (v) {
              if (v === null || v === undefined) return '';
              return /[",;\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v);
            };
            var linhas = [campos.join(',')].concat(feats.map(function (f) {
              var pr = propsDe(f);
              return campos.map(function (c) { return q(pr[c]); }).join(',');
            }));
            NS.baixar('﻿' + linhas.join('\n'), base + '.csv', 'text/csv;charset=utf-8');
          } else if (fmt === 'geojson') {
            var fc;
            if (alvo === 'hex') {
              // Geometria exata direto do H3, em graus: sem ida e volta pelo Web Mercator.
              fc = { type: 'FeatureCollection', features: feats.map(function (f) {
                return { type: 'Feature', properties: propsDe(f),
                  geometry: { type: 'Polygon', coordinates: [M.contornoH3(f.getId())] } };
              }) };
            } else {
              fc = new ol.format.GeoJSON().writeFeaturesObject(feats.map(function (f) {
                var c = f.clone(); c.unset('_ptRotulo', true); return c;
              }), { featureProjection: 'EPSG:3857', dataProjection: 'EPSG:4326', decimals: 7 });
            }
            NS.baixar(JSON.stringify(fc), base + '.geojson', 'application/geo+json');
          } else if (fmt === 'kml') {
            var limpos = feats.map(function (f) {
              var c = new ol.Feature(f.getGeometry().clone());
              c.setProperties(propsDe(f));
              if (f.getId()) c.set('name', f.getId());
              else if (f.get('nm_dist')) c.set('name', f.get('nm_dist'));
              return c;
            });
            var kml = new ol.format.KML({ writeStyles: false })
              .writeFeatures(limpos, { featureProjection: 'EPSG:3857', decimals: 7 });
            NS.baixar(kml, base + '.kml', 'application/vnd.google-earth.kml+xml');
          }
        } catch (e) {
          console.error('[exportação] erro:', e);
          alert('Não foi possível exportar: ' + e.message);
        } finally { btn.disabled = false; btn.textContent = rotulo; }
      });
    });
  }

  // =================== 5. LIGAÇÃO =====================================
  NS.ferramentas = {
    ligar: function () { ligarFiltro(); ligarUpload(); ligarExportacao(); },
    atualizarStatusFiltro: atualizarStatusFiltro
  };

})(window.SIGWEB);
