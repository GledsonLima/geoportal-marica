/* =====================================================================
   painel.js — barra superior, busca de endereços, faixa de ícones,
               painéis, avisos, janela de detalhes e clique no mapa.

   Acessibilidade: cada botão da faixa tem aria-expanded/aria-controls,
   o combobox da busca segue o padrão WAI-ARIA (listbox + setas + Enter),
   Esc fecha painel, sugestões e janela de detalhes, e toda a animação
   é desligada quando o sistema pede menos movimento.
   ===================================================================== */
window.SIGWEB = window.SIGWEB || {};
(function (NS) {
  'use strict';

  var CFG = window.GEOPORTAL_CONFIG || {};
  var $ = NS.$, esc = NS.esc, num = NS.num, isNum = NS.isNum;
  var M = NS.mapa;

  // =================== 1. AVISOS SOBRE O MAPA =========================
  var avisoTimer = null;
  NS.avisarMapa = function (texto) {
    var cx = $('aviso-mapa');
    $('aviso-mapa-texto').textContent = texto;
    cx.hidden = false;
    clearTimeout(avisoTimer);
    avisoTimer = setTimeout(function () { cx.hidden = true; }, 9000);
  };
  $('aviso-mapa-fechar').addEventListener('click', function () {
    clearTimeout(avisoTimer); $('aviso-mapa').hidden = true;
  });

  // =================== 2. FAIXA DE ÍCONES E PAINÉIS ===================
  var appEl = $('app');
  var painelEl = $('painel');
  var TITULOS = {
    'camadas': 'Camadas', 'mapa-base': 'Mapa base', 'legenda': 'Legenda',
    'ferramentas': 'Ferramentas', 'exportar': 'Exportar dados', 'sobre': 'Sobre'
  };
  var painelAtual = null;

  function mostrarSecao(id) {
    painelEl.querySelectorAll('.painel-secao').forEach(function (s) {
      s.hidden = s.dataset.secao !== id;
    });
    $('painel-titulo').textContent = TITULOS[id] || '';
  }

  function abrirPainel(id) {
    painelAtual = id;
    mostrarSecao(id);
    painelEl.hidden = false;
    requestAnimationFrame(function () { appEl.classList.add('painel-aberto'); });
    document.querySelectorAll('.rail-btn').forEach(function (b) {
      b.setAttribute('aria-expanded', String(b.dataset.painel === id));
      b.classList.toggle('ativo', b.dataset.painel === id);
    });
  }

  function fecharPainel() {
    painelAtual = null;
    appEl.classList.remove('painel-aberto');
    document.querySelectorAll('.rail-btn').forEach(function (b) {
      b.setAttribute('aria-expanded', 'false'); b.classList.remove('ativo');
    });
    var ms = NS.menosMovimento() ? 0 : 230;
    setTimeout(function () { if (!painelAtual) painelEl.hidden = true; }, ms);
  }

  function alternarPainel(id) {
    if (painelAtual === id) { fecharPainel(); return; }
    abrirPainel(id);
  }
  NS.fecharPainel = fecharPainel;
  NS.painelAberto = function () { return painelAtual; };

  document.querySelectorAll('.rail-btn').forEach(function (btn) {
    btn.addEventListener('click', function () { alternarPainel(btn.dataset.painel); });
  });
  $('painel-fechar').addEventListener('click', function () {
    fecharPainel();
    var b = document.querySelector('.rail-btn.ativo') || document.querySelector('.rail-btn');
    if (b) b.focus();
  });

  // =================== 3. BARRA SUPERIOR: LOGO ========================
  $('brand').addEventListener('click', function () { M.irParaVisaoInicial(); });

  // =================== 4. BUSCA DE ENDEREÇOS ==========================
  // Nominatim (OpenStreetMap). Política de uso: no máximo 1 requisição por
  // segundo, por isso o debounce somado ao intervalo mínimo abaixo. A busca
  // é limitada à caixa envolvente de Maricá (bounded=1).
  var buscaWrap = $('busca');
  var inputBusca = $('busca-input');
  var listaSug = $('busca-sugestoes');
  var statusBusca = $('busca-status');
  var INTERVALO_MIN = 1100;
  var ultimoPedido = 0;
  var abortar = null;
  var sugestoes = [];
  var destacado = -1;

  function bboxViewbox() {
    var b = CFG.BBOX_MARICA || [-43.05, -23.10, -42.55, -22.80];   // [oeste, sul, leste, norte]
    return b[0] + ',' + b[3] + ',' + b[2] + ',' + b[1];            // Nominatim: esq,cima,dir,baixo
  }

  function fecharSugestoes() {
    listaSug.hidden = true; listaSug.innerHTML = '';
    inputBusca.setAttribute('aria-expanded', 'false');
    inputBusca.removeAttribute('aria-activedescendant');
    sugestoes = []; destacado = -1;
  }

  function desenharSugestoes() {
    if (!sugestoes.length) { fecharSugestoes(); return; }
    listaSug.innerHTML = sugestoes.map(function (s, i) {
      return '<li id="sug-' + i + '" role="option" aria-selected="' + (i === destacado) + '"' +
        (i === destacado ? ' class="destacado"' : '') + ' data-i="' + i + '">' +
        '<span class="sug-titulo">' + esc(s.titulo) + '</span>' +
        '<span class="sug-detalhe">' + esc(s.detalhe) + '</span></li>';
    }).join('');
    listaSug.hidden = false;
    inputBusca.setAttribute('aria-expanded', 'true');
    if (destacado >= 0) inputBusca.setAttribute('aria-activedescendant', 'sug-' + destacado);
    listaSug.querySelectorAll('li').forEach(function (li) {
      li.addEventListener('mousedown', function (e) {   // mousedown: antes do blur do input
        e.preventDefault(); escolher(Number(li.dataset.i));
      });
    });
  }

  function escolher(i) {
    var s = sugestoes[i];
    if (!s) return;
    inputBusca.value = s.titulo;
    fecharSugestoes();
    var coord = ol.proj.fromLonLat([s.lon, s.lat]);
    M.map.getView().animate({ center: coord, zoom: 17, duration: 800 });
    M.searchMarkerOverlay.setPosition(coord);
    statusBusca.textContent = 'Local encontrado: ' + s.titulo;
    $('busca-limpar').hidden = false;
    if (NS.ehCelular()) fecharCampoBusca();
  }

  async function procurar(texto) {
    var espera = INTERVALO_MIN - (Date.now() - ultimoPedido);
    if (espera > 0) await new Promise(function (r) { setTimeout(r, espera); });
    if (inputBusca.value.trim() !== texto) return;      // o usuário já digitou outra coisa

    if (abortar) abortar.abort();
    abortar = new AbortController();
    ultimoPedido = Date.now();

    var url = 'https://nominatim.openstreetmap.org/search' +
      '?format=jsonv2&q=' + encodeURIComponent(texto) +
      '&viewbox=' + bboxViewbox() + '&bounded=1&countrycodes=br&limit=6&accept-language=pt-BR';
    try {
      var r = await fetch(url, { signal: abortar.signal });
      var res = await r.json();
      sugestoes = (res || []).map(function (o) {
        var partes = String(o.display_name || '').split(',');
        return {
          titulo: (o.name && o.name.trim()) ? o.name : partes[0].trim(),
          detalhe: partes.slice(1, 4).join(',').trim(),
          lat: parseFloat(o.lat), lon: parseFloat(o.lon)
        };
      }).filter(function (s) { return isFinite(s.lat) && isFinite(s.lon); });
      destacado = -1;
      desenharSugestoes();
      statusBusca.textContent = sugestoes.length
        ? sugestoes.length + ' resultado(s). Use as setas para navegar.'
        : 'Nenhum endereço encontrado dentro de Maricá.';
      if (!sugestoes.length) {
        listaSug.innerHTML = '<li class="sug-vazio" role="option" aria-selected="false">Nenhum endereço encontrado dentro de Maricá.</li>';
        listaSug.hidden = false;
      }
    } catch (e) {
      if (e.name === 'AbortError') return;
      console.error('[busca] falha no geocodificador:', e);
      statusBusca.textContent = 'Não foi possível buscar agora.';
      fecharSugestoes();
    }
  }

  var procurarAdiado = NS.debounce(function () {
    var t = inputBusca.value.trim();
    if (t.length < 3) { fecharSugestoes(); return; }
    procurar(t);
  }, 450);

  /** No celular o campo aberto cobre a lupa, então o X também serve de "fechar". */
  function fecharCampoBusca() {
    buscaWrap.classList.remove('aberto');
    $('busca-abrir').setAttribute('aria-expanded', 'false');
    fecharSugestoes();
    $('busca-abrir').focus();
  }

  function atualizarBotaoLimpar() {
    $('busca-limpar').hidden = !inputBusca.value && !buscaWrap.classList.contains('aberto');
  }

  inputBusca.addEventListener('input', function () {
    atualizarBotaoLimpar();
    procurarAdiado();
  });

  inputBusca.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!sugestoes.length) return;
      e.preventDefault();
      destacado = e.key === 'ArrowDown'
        ? (destacado + 1) % sugestoes.length
        : (destacado - 1 + sugestoes.length) % sugestoes.length;
      desenharSugestoes();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (destacado >= 0) escolher(destacado);
      else if (sugestoes.length) escolher(0);
      else procurar(inputBusca.value.trim());
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      if (!listaSug.hidden) { fecharSugestoes(); return; }
      if (buscaWrap.classList.contains('aberto')) fecharCampoBusca();
    }
  });

  inputBusca.addEventListener('blur', function () { setTimeout(fecharSugestoes, 120); });

  $('busca-limpar').addEventListener('click', function () {
    if (inputBusca.value) {
      inputBusca.value = '';
      fecharSugestoes();
      M.searchMarkerOverlay.setPosition(undefined);
      statusBusca.textContent = '';
      atualizarBotaoLimpar();
      inputBusca.focus();
      return;
    }
    if (buscaWrap.classList.contains('aberto')) fecharCampoBusca();
  });

  $('busca-abrir').addEventListener('click', function () {
    var abriu = !buscaWrap.classList.contains('aberto');
    buscaWrap.classList.toggle('aberto', abriu);
    $('busca-abrir').setAttribute('aria-expanded', String(abriu));
    atualizarBotaoLimpar();
    if (abriu) inputBusca.focus();
  });

  // =================== 5. SELETOR DE MAPA BASE ========================
  function montarSeletorMapaBase() {
    var lista = $('basemap-list');
    lista.innerHTML = M.BASEMAPS.map(function (d) {
      return '<div class="basemap-item" role="radio" tabindex="-1" aria-checked="false" data-base="' + esc(d.id) + '">' +
        '<img class="basemap-thumb" src="' + esc(M.urlExemplo(d.url)) + '" alt="" loading="lazy" width="56" height="56">' +
        '<span class="basemap-nome">' + esc(d.nome) + '</span></div>';
    }).join('');
    lista.querySelectorAll('.basemap-item').forEach(function (el) {
      el.addEventListener('click', function () { M.trocarBase(el.dataset.base); });
      el.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); M.trocarBase(el.dataset.base); }
      });
      el.querySelector('img').addEventListener('error', function () { el.classList.add('sem-thumb'); });
    });
    M.trocarBase(M.baseAtual());
  }

  // =================== 6. JANELA DE DETALHES DA CÉLULA ================
  var dashboardOverlay = $('dashboard-overlay');
  var grafico = null;
  var cliqueToken = 0;   // descarta respostas atrasadas se o usuário clicar em outra célula

  function fecharDashboard() { cliqueToken++; dashboardOverlay.style.display = 'none'; }

  function destruirGrafico() { if (grafico) { grafico.destroy(); grafico = null; } }

  /**
   * Barras em escala 1–5: 1 = vazia, 5 = cheia.
   *
   * A COR de cada barra sai da classificação de quem a barra representa, e não
   * de uma camada qualquer. Isso importa: as quebras de Jenks foram calculadas
   * mapa a mapa, então 3,30 é "Média" na Exposição e "Altíssimo" no índice
   * final — pintar as duas com a mesma régua daria uma leitura errada.
   *
   * Os GRUPOS não têm classificação publicada no estudo: são escores de 1 a 5.
   * Por isso saem numa cor neutra única, com o valor ao lado — inventar classes
   * para eles seria atribuir um significado que o estudo não deu.
   */
  function barrasHTML(lista, props) {
    return lista.map(function (m) {
      var v = props[m.field];
      var pct = isNum(v) ? Math.max(0, Math.min(100, ((v - 1) / 4) * 100)) : 0;
      // Mapas intermediários têm camada própria; grupos, não.
      var camDaBarra = null;
      M.CAMADAS.forEach(function (c) { if (c.campo === m.field) camDaBarra = c; });
      var cor = camDaBarra ? M.classifica(v, camDaBarra).color : 'var(--cor-barra-neutra)';
      var titulo = camDaBarra ? esc(m.label) + ' — ' + M.classifica(v, camDaBarra).label : esc(m.label);
      return '<div class="dash-bar-row"><div class="dash-bar-top"><span>' + esc(m.label) +
        '</span><span class="dash-bar-value">' + num(v, 2) + '</span></div>' +
        '<div class="dash-bar-track" role="meter" aria-valuemin="1" aria-valuemax="5" aria-valuenow="' +
        (isNum(v) ? v : '') + '" aria-label="' + titulo + '" title="' + titulo + '">' +
        '<div class="dash-bar-fill" style="width:' + pct + '%; background:' + cor + ';"></div>' +
        '</div></div>';
    }).join('');
  }

  function desenharRadar(grupos, props) {
    destruirGrafico();
    grafico = new Chart($('dash-radar-canvas').getContext('2d'), {
      type: 'radar',
      data: {
        labels: grupos.map(function (g) { return g.label; }),
        datasets: [{
          label: 'Indicador de grupo',
          data: grupos.map(function (g) { return isNum(props[g.field]) ? props[g.field] : null; }),
          backgroundColor: 'rgba(47, 127, 209, 0.25)', borderColor: '#2f7fd1', borderWidth: 2,
          pointBackgroundColor: '#2f7fd1', pointRadius: 3, spanGaps: true
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        layout: { padding: NS.telaEstreita() ? { left: 4, right: 4 } : 0 },
        scales: { r: {
          min: 1, max: 5,
          ticks: { stepSize: 1, backdropColor: 'transparent', font: { size: 9 } },
          pointLabels: {
            font: { size: NS.telaEstreita() ? 9 : 10 }, color: '#1e2a38',
            callback: function (rotulo) { return NS.quebraRotulo(rotulo, NS.telaEstreita() ? 14 : 18); }
          },
          grid: { color: '#e5e9ee' }, angleLines: { color: '#e5e9ee' }
        } },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: function (ctx) { return 'Valor: ' + num(ctx.parsed.r, 2); } } }
        }
      }
    });
  }

  function abrirDashboard(props, cam) {
    cam = cam || M.camadaAtiva();
    var grupos = M.gruposDaCamada(cam);
    var temGrupos = props[grupos[0].field] !== undefined;
    var temIntermediarios = props.indicador_mapa1 !== undefined;

    $('dash-h3id').textContent = props.h3_index || '-';
    $('dash-title').textContent = cam.nome;

    var v = props[cam.campo], cat = M.classifica(v, cam);
    $('dash-final-value').textContent = num(v, 2);
    var badge = $('dash-final-badge');
    badge.textContent = cat.label; badge.style.background = cat.color; badge.style.color = cat.text;

    // Bloco 1 — os três mapas que compõem o índice (ou aviso de carregamento)
    if (temIntermediarios) {
      $('dash-bars').innerHTML = barrasHTML(M.INTERMEDIATE_MAPS, props);
      $('dash-bars-titulo').textContent = 'Mapas que compõem o índice (escala 1–5)';
    } else {
      $('dash-bars').innerHTML = '<div class="dash-loading">Carregando indicadores…</div>';
    }

    // Bloco 2 — grupos da camada ativa. Com menos de 3 grupos um radar não
    // existe (2 eixos não formam polígono), então viram barras.
    var tituloGrupos = cam.mapa
      ? 'Grupos que compõem ' + cam.curto
      : 'Grupos que compõem os mapas';
    $('dash-grupos-titulo').textContent = tituloGrupos;

    if (!temGrupos) {
      $('dash-grupos').innerHTML = '<div class="dash-loading">Carregando detalhes da célula…</div>';
      $('dash-radar-wrap').hidden = true;
      destruirGrafico();
    } else if (grupos.length >= 3) {
      $('dash-grupos').innerHTML = '';
      $('dash-radar-wrap').hidden = false;
      desenharRadar(grupos, props);
    } else {
      destruirGrafico();
      $('dash-radar-wrap').hidden = true;
      $('dash-grupos').innerHTML = barrasHTML(grupos, props);
    }

    dashboardOverlay.style.display = 'flex';
    $('dashboard-close').focus();
  }

  function erroNoDashboard(msg) {
    $('dash-grupos').innerHTML = '<div class="dash-loading erro">' + esc(msg) + '</div>';
    $('dash-radar-wrap').hidden = true;
    destruirGrafico();
  }

  $('dashboard-close').addEventListener('click', fecharDashboard);
  dashboardOverlay.addEventListener('click', function (e) {
    if (e.target === dashboardOverlay) fecharDashboard();
  });

  // =================== 7. PAINEL DE ATRIBUTOS =========================
  function fecharInfo() { $('info-panel').hidden = true; }
  NS.fecharInfo = fecharInfo;
  $('info-close').addEventListener('click', fecharInfo);

  function mostrarAtributos(titulo, props) {
    var linhas = Object.keys(props)
      .filter(function (k) { return k !== 'geometry' && k.charAt(0) !== '_'; })
      .map(function (k) {
        var v = props[k];
        return '<tr><th>' + esc(k) + '</th><td>' + esc(typeof v === 'object' ? JSON.stringify(v) : v) + '</td></tr>';
      }).join('');
    $('info-content').innerHTML = '<div class="info-title">' + esc(titulo) + '</div>' +
      (linhas ? '<table>' + linhas + '</table>' : '<div class="hint-text">Sem atributos.</div>');
    $('info-panel').hidden = false;
  }

  /**
   * Pop-up simples (chave do radar desligada): mostra só o que já está
   * carregado na memória, sem nenhuma consulta nova ao banco.
   */
  function popupSimples(props, cam) {
    var cat = M.classifica(props[cam.campo], cam);
    var linhas = '<tr><th>' + esc(cam.curto) + '</th><td><strong>' + num(props[cam.campo], 2) +
      '</strong> <span class="pill" style="background:' + cat.color + ';color:' + cat.text + '">' +
      esc(cat.label) + '</span></td></tr>';
    if (props.indicador_mapa1 !== undefined) {
      linhas += M.INTERMEDIATE_MAPS.filter(function (m) { return m.field !== cam.campo; })
        .map(function (m) { return '<tr><th>' + esc(m.label) + '</th><td>' + num(props[m.field], 2) + '</td></tr>'; })
        .join('');
      if (cam.campo !== 'indicador_final') {
        linhas += '<tr><th>Índice de Risco Climático</th><td>' + num(props.indicador_final, 2) + '</td></tr>';
      }
    }
    $('info-content').innerHTML =
      '<div class="info-title">Célula ' + esc(props.h3_index || '') + '</div>' +
      '<table>' + linhas + '</table>' +
      '<div class="hint-text">Ligue "Gráfico de radar ao clicar" em Camadas para ver os grupos que compõem o valor.</div>';
    $('info-panel').hidden = false;
  }

  // =================== 8. CLIQUE NO MAPA ==============================
  M.map.on('singleclick', function (evt) {
    // No celular, tocar no mapa com um painel aberto só fecha o painel.
    if (painelAtual && NS.ehCelular()) { fecharPainel(); return; }

    // 1º: camadas do catálogo e upload (estão por cima da grade)
    var achou = null;
    M.map.forEachFeatureAtPixel(evt.pixel, function (f, layer) { achou = { f: f, layer: layer }; return true; }, {
      hitTolerance: 4,
      layerFilter: function (l) { return l === M.uploadedLayer || l.get('catalogo') === true; }
    });
    if (achou) {
      var titulo = achou.layer === M.uploadedLayer ? 'Feição enviada' : achou.layer.get('titulo');
      mostrarAtributos(titulo, achou.f.getProperties());
      return;
    }

    // 2º: grade hexagonal (só se visível e se a célula passa no filtro)
    if (!M.hexLayer.getVisible()) return;
    var cand = M.hexSource.getFeaturesAtCoordinate(evt.coordinate)
      .filter(function (f) { return M.passaFiltro(M.valorAtivo(f)); });
    if (!cand.length) return;

    var f = cand[0], cam = M.camadaAtiva();

    // Chave desligada: pop-up simples, sem consulta nova ao banco.
    if (!$('toggle-radar').checked) {
      fecharDashboard();
      popupSimples(f.getProperties(), cam);
      return;
    }

    fecharInfo();
    abrirDashboard(f.getProperties(), cam);    // mostra já o que está em memória
    if (!M.modoLeve()) return;                 // modo completo: nada mais a buscar
    var meuToken = ++cliqueToken;
    M.detalhesDaCelula(f.getId())
      .then(function (p) { if (meuToken === cliqueToken) abrirDashboard(p, cam); })
      .catch(function (e) {
        if (meuToken === cliqueToken) erroNoDashboard('Não foi possível carregar os detalhes: ' + e.message);
      });
  });

  M.map.on('pointermove', function (evt) {
    if (evt.dragging) return;
    var hit = M.map.hasFeatureAtPixel(evt.pixel, {
      layerFilter: function (l) { return l === M.hexLayer || l === M.uploadedLayer || l.get('catalogo') === true; }
    });
    M.map.getTargetElement().style.cursor = hit ? 'pointer' : '';
  });

  // =================== 9. TECLA ESC GLOBAL ============================
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (dashboardOverlay.style.display === 'flex') { fecharDashboard(); return; }
    if (!$('info-panel').hidden) { fecharInfo(); return; }
    if (!listaSug.hidden) { fecharSugestoes(); return; }
    if (painelAtual) fecharPainel();
  });

  // =================== 10. CONTROLES DAS CAMADAS ======================
  /**
   * As quatro camadas do índice compartilham a mesma geometria, então são
   * botões de rádio: só uma colore o mapa por vez.
   */
  function ligarControlesCamadas() {
    document.querySelectorAll('input[name="indice"]').forEach(function (r) {
      r.addEventListener('change', function () { if (r.checked) M.trocarIndice(r.value); });
    });

    $('toggle-hex').addEventListener('change', function (e) {
      M.hexLayer.setVisible(e.target.checked);
      $('risk-legend').style.display = e.target.checked ? 'block' : 'none';
      document.querySelectorAll('input[name="indice"]').forEach(function (r) { r.disabled = !e.target.checked; });
    });
    $('toggle-distritos').addEventListener('change', function (e) {
      M.distritosLayer.setVisible(e.target.checked);
      $('distritos-legend').style.display = e.target.checked ? 'block' : 'none';
    });
    $('toggle-distritos-labels').addEventListener('change', function (e) {
      M.setRotulosDistritos(e.target.checked);
    });
    $('opacity-slider').addEventListener('input', function (e) {
      M.hexLayer.setOpacity(e.target.value / 100);
      $('opacity-value').textContent = e.target.value;
    });
    $('toggle-paleta').addEventListener('change', function (e) {
      M.setPaletaAcessivel(e.target.checked);
    });
    $('toggle-radar').addEventListener('change', function () {
      if (!$('toggle-radar').checked) fecharDashboard(); else fecharInfo();
    });
  }

  /**
   * Chamado depois da carga: se a função da grade ainda devolve só o índice
   * final (script 05 não rodado), as três camadas intermediárias ficam
   * desabilitadas com a explicação, em vez de desenharem um mapa vazio.
   */
  function atualizarDisponibilidade() {
    var ok = M.temIntermediarios();
    document.querySelectorAll('input[name="indice"]').forEach(function (r) {
      if (r.value !== 'final') r.disabled = !ok;
    });
    $('indice-aviso').hidden = ok;
  }

  // Mantém o rótulo do filtro em dia quando a camada muda.
  NS.aoTrocarIndice = function () {
    if (NS.atualizarRotuloFiltro) NS.atualizarRotuloFiltro();
    if (NS.atualizarStatusFiltro) NS.atualizarStatusFiltro();
    var r = document.querySelector('input[name="indice"][value="' + M.camadaAtiva().id + '"]');
    if (r && !r.checked) r.checked = true;
  };

  // =================== 11. EXPOSIÇÃO ==================================
  NS.painel = {
    ligar: function () { montarSeletorMapaBase(); ligarControlesCamadas(); },
    atualizarDisponibilidade: atualizarDisponibilidade,
    abrirPainel: abrirPainel, fecharPainel: fecharPainel,
    abrirDashboard: abrirDashboard
  };

})(window.SIGWEB);
