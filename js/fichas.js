/* =====================================================================
   fichas.js — painel inferior: Área -> Tema -> lista de SbN -> ficha.

   Fluxo (um clique do usuário = uma consulta pequena ao banco):
     clique na área      -> rpc/temas_da_area?p_num_area=N     (cards de tema)
     escolhe o tema      -> rpc/sbn_do_tema?p_tema=T           (cards de SbN)
     escolhe a solução   -> rpc/ficha_sbn?p_slug=...           (a ficha)
   As três são funções do banco com ARGUMENTO TIPADO (script 06): o valor nunca
   é concatenado em SQL. Do lado do navegador, o número passa por Number.isInteger
   e o slug por uma expressão regular antes de entrar na URL.
   Tudo o que já foi buscado fica em cache: voltar e avançar não vão à rede.

   O painel mora DENTRO da coluna do mapa. Ao abrir, o mapa encolhe
   (map.updateSize) e é reenquadrado na área — nada fica coberto.
   ===================================================================== */
(function (NS) {
  'use strict';

  var CFG = window.GEOPORTAL_CONFIG || {};
  var $ = NS.$, esc = NS.esc, M = NS.mapa;

  // Limites de altura, como fração da coluna do mapa (briefing: 30–60%; 70% no celular)
  var FRACAO_MIN = 0.30, FRACAO_MAX = 0.60, FRACAO_MAX_CELULAR = 0.70, FRACAO_INICIAL = 0.50;
  var LIMIAR_FECHAR = 0.20;     // arrastar a alça abaixo disto fecha o painel

  var coluna = $('coluna-mapa'), painel = $('sbn-painel'), corpo = $('sbn-corpo');
  var alca = $('sbn-alca'), trilha = $('sbn-trilha'), btnVoltar = $('sbn-voltar');

  var fracao = FRACAO_INICIAL;
  var aberto = false;
  var visaoAnterior = null;      // enquadramento do mapa antes de abrir (para restaurar ao fechar)
  var ficha = { nivel: 'tema', area: null, areaHa: null, temas: [], tema: null, lista: [], solucao: null };
  var token = 0;                 // descarta respostas atrasadas quando o usuário já foi para outro lugar

  var cacheTemas = new Map(), cacheLista = new Map(), cacheFicha = new Map(), cacheFuncoes = null;

  // =================== 1. ALTURA, ARRASTE E TECLADO ====================
  function maxFracao() { return NS.ehCelular() ? FRACAO_MAX_CELULAR : FRACAO_MAX; }
  function limitar(f) { return Math.max(FRACAO_MIN, Math.min(maxFracao(), f)); }

  var rafId = 0;
  function atualizarMapa() {
    if (rafId) return;
    rafId = requestAnimationFrame(function () { rafId = 0; M.map.updateSize(); });
  }

  function aplicarAltura(f) {
    var H = coluna.clientHeight;
    painel.style.height = Math.round(H * f) + 'px';
    alca.setAttribute('aria-valuenow', String(Math.round(limitar(fracao) * 100)));
    alca.setAttribute('aria-valuemax', String(Math.round(maxFracao() * 100)));
    atualizarMapa();
  }

  alca.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    alca.setPointerCapture(e.pointerId);
    painel.classList.add('arrastando');
    var H = coluna.clientHeight, base = coluna.getBoundingClientRect().bottom;
    var bruta = fracao;

    function mover(ev) {
      bruta = (base - ev.clientY) / H;
      // Enquanto arrasta dá para ir um pouco abaixo do mínimo: é o gesto de fechar.
      aplicarAltura(Math.max(0.1, Math.min(maxFracao(), bruta)));
      painel.style.opacity = bruta < LIMIAR_FECHAR ? '0.55' : '';
    }
    function soltar(ev) {
      alca.removeEventListener('pointermove', mover);
      alca.removeEventListener('pointerup', soltar);
      alca.removeEventListener('pointercancel', soltar);
      try { alca.releasePointerCapture(ev.pointerId); } catch (x) { /* já liberado */ }
      painel.classList.remove('arrastando');
      painel.style.opacity = '';
      if (bruta < LIMIAR_FECHAR) { fechar(); return; }
      fracao = limitar(bruta);
      aplicarAltura(fracao);
    }
    alca.addEventListener('pointermove', mover);
    alca.addEventListener('pointerup', soltar);
    alca.addEventListener('pointercancel', soltar);
  });

  // Teclado: o mesmo ajuste para quem não usa o mouse
  alca.addEventListener('keydown', function (e) {
    var passo = 0.05;
    if (e.key === 'ArrowUp') fracao = limitar(fracao + passo);
    else if (e.key === 'ArrowDown') fracao = limitar(fracao - passo);
    else return;
    e.preventDefault();
    aplicarAltura(fracao);
  });

  window.addEventListener('resize', function () {
    if (!aberto) return;
    fracao = limitar(fracao);
    aplicarAltura(fracao);
  });

  // =================== 2. ABRIR / FECHAR ==============================
  function mostrarPainel() {
    if (aberto) return;
    aberto = true;
    visaoAnterior = { centro: M.map.getView().getCenter(), zoom: M.map.getView().getZoom() };
    painel.hidden = false;
    coluna.classList.add('com-sbn');
    fracao = limitar(fracao);
    aplicarAltura(fracao);
    M.map.updateSize();          // já, de forma síncrona: o enquadramento abaixo depende do tamanho novo
  }

  function enquadrarArea(num) {
    var f = M.areaPorNum(num);
    var g = f && f.getGeometry();
    if (!g) return;
    // maxZoom evita encostar na área: o entorno (e o município) continua à vista
    M.map.getView().fit(g.getExtent(), { padding: [50, 50, 50, 50], maxZoom: 15, duration: NS.menosMovimento() ? 0 : 450 });
  }

  function fechar() {
    if (!aberto) return;
    aberto = false;
    token++;                      // qualquer resposta em andamento deixa de valer
    painel.hidden = true;
    painel.style.opacity = '';
    coluna.classList.remove('com-sbn');
    M.selecionarArea(null);
    M.map.updateSize();
    if (visaoAnterior && visaoAnterior.centro) {
      M.map.getView().animate({
        center: visaoAnterior.centro, zoom: visaoAnterior.zoom, duration: NS.menosMovimento() ? 0 : 350
      });
    }
    visaoAnterior = null;
  }

  $('sbn-fechar').addEventListener('click', fechar);

  // =================== 3. CONSULTAS COM CACHE ==========================
  function inteiro(n) {
    n = Number(n);
    if (!Number.isInteger(n) || n < 0 || n > 32767) throw new Error('Identificador inválido.');
    return n;
  }

  async function temasDaArea(num) {
    num = inteiro(num);
    if (!cacheTemas.has(num)) {
      cacheTemas.set(num, await NS.api.get('rpc/' + (CFG.RPC_TEMAS_DA_AREA || 'temas_da_area') + '?p_num_area=' + num));
    }
    return cacheTemas.get(num);
  }
  async function listaDoTema(id) {
    id = inteiro(id);
    if (!cacheLista.has(id)) {
      cacheLista.set(id, await NS.api.get('rpc/' + (CFG.RPC_SBN_DO_TEMA || 'sbn_do_tema') + '?p_tema=' + id));
    }
    return cacheLista.get(id);
  }
  async function fichaDa(slug) {
    if (!/^[a-z0-9-]{1,80}$/.test(slug)) throw new Error('Identificador de solução inválido.');
    if (!cacheFicha.has(slug)) {
      var r = await NS.api.get('rpc/' + (CFG.RPC_FICHA || 'ficha_sbn') + '?p_slug=' + encodeURIComponent(slug));
      if (Array.isArray(r)) r = r[0];
      if (!r) throw new Error('Ficha não encontrada.');
      cacheFicha.set(slug, r);
    }
    return cacheFicha.get(slug);
  }
  async function funcoes() {
    if (!cacheFuncoes) cacheFuncoes = await NS.api.get('rpc/' + (CFG.RPC_FUNCOES || 'sbn_funcoes'));
    return cacheFuncoes;
  }

  // =================== 4. TRILHA E BOTÃO VOLTAR ========================
  function atualizarTrilha() {
    var partes = [];
    partes.push({ txt: 'Área ' + ficha.area, nivel: 'tema' });
    if (ficha.tema) partes.push({ txt: ficha.tema.nome_curto || ficha.tema.nome, nivel: 'lista' });
    if (ficha.solucao) partes.push({ txt: ficha.solucao.nome, nivel: 'ficha' });

    trilha.innerHTML = partes.map(function (p, i) {
      var ultimo = i === partes.length - 1;
      var sep = i ? '<svg class="icone sep" aria-hidden="true"><use href="#i-chevron"></use></svg>' : '';
      return sep + (ultimo
        ? '<span class="atual" aria-current="page">' + esc(p.txt) + '</span>'
        : '<button type="button" data-ir="' + p.nivel + '">' + esc(p.txt) + '</button>');
    }).join('');

    var pode = ficha.nivel !== 'tema';
    btnVoltar.hidden = !pode;
    btnVoltar.setAttribute('aria-label', ficha.nivel === 'ficha' ? 'Voltar à lista de soluções' : 'Voltar à escolha do tema');
  }

  function voltar() {
    if (ficha.nivel === 'ficha') irPara('lista');
    else if (ficha.nivel === 'lista') irPara('tema');
  }
  btnVoltar.addEventListener('click', voltar);

  function irPara(nivel) {
    token++;
    if (nivel === 'tema') { ficha.tema = null; ficha.solucao = null; ficha.nivel = 'tema'; desenharTemas(); }
    else if (nivel === 'lista') { ficha.solucao = null; ficha.nivel = 'lista'; desenharLista(); }
  }

  trilha.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-ir]');
    if (b) irPara(b.dataset.ir);
  });

  function paraOTopo() { corpo.scrollTop = 0; corpo.focus({ preventScroll: true }); }

  // =================== 5. TELAS =======================================
  function carregando(msg) {
    corpo.innerHTML = '<div class="sbn-vazio" role="status">' + esc(msg) + '</div>';
  }
  function erro(e) {
    corpo.innerHTML = '<div class="sbn-erro" role="alert">' + esc(e && e.message ? e.message : 'Algo deu errado.') + '</div>';
  }
  function plural(n, um, varios) { return n + ' ' + (n === 1 ? um : varios); }

  /** Passo 1 — temas da área */
  function desenharTemas() {
    atualizarTrilha();
    var ha = typeof ficha.areaHa === 'number' ? ficha.areaHa.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' ha' : '';
    var cartoes = ficha.temas.map(function (t) {
      return '<button type="button" class="sbn-cartao' + (ficha.tema && ficha.tema.id === t.id ? ' marcado' : '') +
        '" style="border-left-color:' + esc(t.cor) + '" data-tema="' + esc(t.id) + '">' +
        '<span class="t">' + esc(t.nome) + '</span>' +
        '<span class="s">' + plural(Number(t.n_solucoes), 'solução indicada', 'soluções indicadas') + '</span>' +
        '<span class="mais">Ver soluções ›</span></button>';
    }).join('');
    corpo.innerHTML =
      '<div class="sbn-cabeca"><h3>Área prioritária ' + esc(ficha.area) + '</h3>' +
      '<p>' + (ha ? esc(ha) + ' · ' : '') + plural(ficha.temas.length, 'tema estratégico', 'temas estratégicos') + '</p></div>' +
      '<p class="sbn-instrucao">' + (ficha.temas.length > 1
        ? 'Esta área é prioritária para mais de um tema. Escolha um para ver as soluções baseadas na natureza indicadas:'
        : 'Tema estratégico desta área:') + '</p>' +
      '<div class="sbn-grade">' + (cartoes || '<div class="sbn-vazio">Esta área ainda não tem tema associado.</div>') + '</div>';
    paraOTopo();
  }

  /** Passo 2 — soluções do tema */
  function desenharLista() {
    atualizarTrilha();
    var t = ficha.tema;
    var cartoes = ficha.lista.map(function (s) {
      var completa = String(s.status_conteudo || '').toLowerCase() === 'concluído';
      var desc = String(s.descricao || '');
      if (desc.length > 150) desc = desc.slice(0, 147).replace(/\s+\S*$/, '') + '…';
      return '<button type="button" class="sbn-cartao" style="border-left-color:' + esc(t.cor) + '" data-slug="' + esc(s.slug) + '">' +
        '<span class="t">' + esc(s.nome) + '</span>' +
        (s.grupo_funcional ? '<span class="s"><strong>' + esc(s.grupo_funcional) + '</strong></span>' : '') +
        (desc ? '<span class="s">' + esc(desc) + '</span>' : '') +
        '<span class="selo' + (completa ? ' ok' : '') + '">' + (completa ? 'Ficha completa' : 'Ficha em elaboração') + '</span>' +
        '<span class="mais">Abrir a ficha ›</span></button>';
    }).join('');
    corpo.innerHTML =
      '<div class="sbn-cabeca"><h3>' + esc(t.nome) + '</h3>' +
      '<p>Área ' + esc(ficha.area) + ' · ' + plural(ficha.lista.length, 'solução baseada na natureza', 'soluções baseadas na natureza') + '</p></div>' +
      '<div class="sbn-grade">' + (cartoes || '<div class="sbn-vazio">Nenhuma solução cadastrada para este tema.</div>') + '</div>';
    paraOTopo();
  }

  // ---- Ficha ---------------------------------------------------------
  var NIVEL = { 'baixa': 1, 'baixo': 1, 'média': 2, 'media': 2, 'médio': 2, 'alta': 3, 'alto': 3 };

  function nivelHTML(rotulo, valor) {
    var n = NIVEL[String(valor || '').trim().toLowerCase()] || 0;
    if (!n) return '';
    var q = '';
    for (var i = 1; i <= 3; i++) q += '<i class="' + (i <= n ? 'on' : '') + '"></i>';
    return '<div class="nivel" role="img" aria-label="' + esc(rotulo + ': ' + valor + ' (' + n + ' de 3)') + '">' +
      '<span class="rot">' + esc(rotulo) + '</span><span class="q" aria-hidden="true">' + q + '</span></div>';
  }

  function par(v) {
    v = v == null ? '' : String(v).trim();
    return v ? '<p>' + esc(v) + '</p>' : '<p><span class="pendente">Em elaboração</span></p>';
  }

  /** "Poluição hídrica; aporte de sedimentos." -> ["Poluição hídrica", "Aporte de sedimentos"] */
  function itens(v) {
    return String(v || '').split(/[;\n]+/).map(function (x) {
      x = x.trim().replace(/[.\s]+$/, '');
      return x ? x.charAt(0).toUpperCase() + x.slice(1) : '';
    }).filter(Boolean);
  }

  function urlSegura(u) {
    u = String(u || '').trim();
    return /^(https:\/\/|img\/)/i.test(u) ? u : '';
  }

  function fichaHTML(d, todasFuncoes) {
    var completa = String(d.status_conteudo || '').toLowerCase() === 'concluído';
    var ativas = new Set((d.funcoes || []).map(Number));
    var desafios = itens(d.desafio_ambiental), ameacas = itens(d.ameaca_climatica);
    var custo = String(d.custo || '').trim();
    var unidade = String(d.custo_unidade || '').trim();
    var img = urlSegura(d.ilustracao_url);

    var grade = todasFuncoes.map(function (f) {
      var on = ativas.has(Number(f.id));
      return '<div class="funcao' + (on ? ' on' : '') + '"><svg class="icone" aria-hidden="true"><use href="#i-folha"></use></svg>' +
        '<span>' + esc(f.nome) + (on ? '<span class="sr-only"> (indicada)</span>' : '') + '</span></div>';
    }).join('');

    var ben = [['Ambientais', d.beneficios_ambientais], ['Sociais', d.beneficios_sociais], ['Econômicos', d.beneficios_economicos]];
    var temBen = ben.some(function (b) { return b[1] && String(b[1]).trim(); });

    return '<article class="ficha" aria-label="Ficha: ' + esc(d.nome) + '">' +
      (completa ? '' :
        '<div class="ficha-aviso" role="note"><strong>Ficha em elaboração.</strong>' +
        '<span>Parte do conteúdo ainda será revisada e complementada pela equipe técnica; os campos marcados como "Em elaboração" ainda não têm texto definitivo.</span></div>') +

      '<div class="ficha-topo">' +
        '<div class="ficha-num" aria-hidden="true">' + esc(d.ordem) + '</div>' +
        '<div class="ficha-titulo"><h3>' + esc(d.nome) + '</h3>' +
          '<span class="chip-tema" style="background:' + esc(d.tema_cor) + ';color:' + M.corDoTexto(d.tema_cor) + '">' + esc(d.tema_nome) + '</span></div>' +
        '<div class="ficha-niveis">' + nivelHTML('Complexidade', d.complexidade) + nivelHTML('Manutenção', d.manutencao) + '</div>' +
      '</div>' +

      '<div class="ficha-corpo">' +
        '<div class="ficha-col">' +
          (custo ? '<div class="ficha-custo"><span class="moeda" aria-hidden="true">$</span><span>' +
            esc(custo) + (unidade ? ' / ' + esc(unidade) : '') + '</span></div>' : '') +
          par(d.descricao) +
          '<h4>Aplicação:</h4>' + par(d.aplicacao) +
          '<h4>Desafios:</h4>' +
          (desafios.length ? '<div class="chips">' + desafios.map(function (x) { return '<span class="chip">' + esc(x) + '</span>'; }).join('') + '</div>'
                           : '<p><span class="pendente">Em elaboração</span></p>') +
          (ameacas.length ? '<h4>Ameaças climáticas relacionadas:</h4><div class="chips linha">' +
            ameacas.map(function (x) { return '<span class="chip">' + esc(x) + '</span>'; }).join('') + '</div>' : '') +
        '</div>' +

        '<div class="ficha-col">' +
          '<div class="ficha-ilustra">' + (img
            ? '<img src="' + esc(img) + '" alt="Ilustração: ' + esc(d.nome) + '" loading="lazy">'
            : '<div><svg class="icone" aria-hidden="true"><use href="#i-folha"></use></svg>Ilustração em elaboração</div>') + '</div>' +
        '</div>' +

        '<div class="ficha-col direita">' +
          '<div class="ficha-grupo"><svg class="icone" aria-hidden="true"><use href="#i-folha"></use></svg><h4>' +
            esc(d.grupo_funcional || 'Funções') + '</h4></div>' +
          '<div class="ficha-direita">' +
            '<div class="funcoes" role="list" aria-label="Funções da solução">' + grade + '</div>' +
            '<div class="restricoes"><h4>Restrições e situações não indicadas</h4>' +
              (String(d.restricoes || '').trim() ? esc(d.restricoes) : '<span class="pendente">Em elaboração</span>') + '</div>' +
          '</div>' +
          (temBen ? '<section class="beneficios" aria-label="Benefícios"><h4>Benefícios</h4><div class="beneficios-cols">' +
            ben.map(function (b) { return '<div><h5>' + esc(b[0]) + '</h5><p>' + esc(String(b[1] || '—')) + '</p></div>'; }).join('') +
          '</div></section>' : '') +
        '</div>' +
      '</div>' +

      ((d.escala_aplicacao || d.tempo_resultado || d.referencias) ? '<div class="ficha-rodape">' +
        (d.escala_aplicacao ? '<div><b>Escala de aplicação:</b> ' + esc(d.escala_aplicacao) + '</div>' : '') +
        (d.tempo_resultado ? '<div><b>Tempo até o resultado:</b> ' + esc(d.tempo_resultado) + '</div>' : '') +
        (d.referencias ? '<div><b>Referências:</b> ' + esc(d.referencias) + '</div>' : '') +
      '</div>' : '') +
    '</article>';
  }

  // =================== 6. NAVEGAÇÃO ENTRE OS PASSOS ===================
  async function abrirTema(id) {
    var t = ficha.temas.filter(function (x) { return Number(x.id) === Number(id); })[0];
    if (!t) return;
    var meu = ++token;
    ficha.tema = t; ficha.solucao = null; ficha.nivel = 'lista';
    atualizarTrilha();
    carregando('Carregando as soluções do tema…');
    try {
      var lista = await listaDoTema(t.id);
      if (meu !== token) return;
      ficha.lista = lista;
      desenharLista();
    } catch (e) { if (meu === token) erro(e); }
  }

  async function abrirFicha(slug) {
    var meu = ++token;
    var resumo = ficha.lista.filter(function (s) { return s.slug === slug; })[0];
    ficha.solucao = { slug: slug, nome: resumo ? resumo.nome : 'Ficha' };
    ficha.nivel = 'ficha';
    atualizarTrilha();
    carregando('Carregando a ficha…');
    try {
      var r = await Promise.all([fichaDa(slug), funcoes()]);
      if (meu !== token) return;
      ficha.solucao = { slug: slug, nome: r[0].nome };
      atualizarTrilha();
      corpo.innerHTML = fichaHTML(r[0], r[1]);
      paraOTopo();
    } catch (e) { if (meu === token) erro(e); }
  }

  corpo.addEventListener('click', function (e) {
    var t = e.target.closest('[data-tema]'), s = e.target.closest('[data-slug]');
    if (t) abrirTema(t.dataset.tema);
    else if (s) abrirFicha(s.dataset.slug);
  });

  /** Ponto de entrada: clique numa área do mapa. */
  async function abrirArea(num) {
    var f = M.areaPorNum(num);
    if (!f) return;
    num = Number(num);
    var meu = ++token;
    mostrarPainel();
    M.selecionarArea(num);
    enquadrarArea(num);
    ficha.area = num;
    ficha.areaHa = Number(f.get('area_ha'));
    if (!isFinite(ficha.areaHa)) ficha.areaHa = null;
    ficha.tema = null; ficha.solucao = null; ficha.lista = []; ficha.nivel = 'tema';
    atualizarTrilha();
    carregando('Carregando os temas da área ' + num + '…');
    try {
      var temas = await temasDaArea(num);
      if (meu !== token) return;
      ficha.temas = temas;
      // Um único tema: segue direto para a lista (o passo "escolher tema" ainda
      // existe e fica a um clique de distância, pelo Voltar ou pela trilha).
      if (temas.length === 1) { await abrirTema(temas[0].id); return; }
      desenharTemas();
    } catch (e) { if (meu === token) erro(e); }
  }

  NS.fichas = {
    abrirArea: abrirArea,
    fechar: fechar,
    aberto: function () { return aberto; },
    fracao: function () { return fracao; }
  };

})(window.SIGWEB);
