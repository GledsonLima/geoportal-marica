/* =====================================================================
   app.js — inicialização: confere a configuração, liga os controles e
            carrega os dados. Deve ser o ÚLTIMO arquivo da lista no HTML.
   ===================================================================== */
(function (NS) {
  'use strict';

  var $ = NS.$;
  var M = NS.mapa;

  function setLoading(texto, erro) {
    var ov = $('loading-overlay');
    ov.classList.remove('hidden');
    ov.classList.toggle('erro', !!erro);
    $('loading-text').textContent = texto;
  }
  function esconderLoading() { $('loading-overlay').classList.add('hidden'); }
  function setConn(texto, classe) {
    var el = $('conn-status');
    el.textContent = texto;
    el.className = 'conn-status ' + (classe || '');
  }

  async function iniciar() {
    // 1. Legendas e controles já funcionam antes dos dados chegarem.
    M.redesenharLegendas();
    NS.painel.ligar();
    NS.ferramentas.ligar();

    // 2. Guardas de configuração.
    var papel = NS.api.papelDaChave();
    if (!NS.api.URL_BASE || !NS.api.CHAVE) {
      setLoading('Configuração incompleta: preencha SUPABASE_URL e SUPABASE_ANON_KEY em js/config.js.', true);
      setConn('Sem configuração', 'erro');
      return;
    }
    if (papel === 'service_role' || papel === 'secret') {
      // Chave secreta ignora o RLS: qualquer visitante poderia apagar o banco.
      setLoading('PERIGO: a chave em js/config.js é uma chave secreta. Ela dá acesso total ao banco e ' +
                 'não pode ficar num site público. Troque pela chave pública e gere uma nova chave secreta.', true);
      setConn('Chave secreta detectada — site bloqueado', 'erro');
      console.error('[app] chave de papel "' + papel + '" detectada em js/config.js. Site bloqueado.');
      return;
    }

    // 3. Catálogo em paralelo: não depende da grade.
    NS.ferramentas.carregarCatalogo();

    // 4. Grade e distritos juntos; um não derruba o outro.
    var tarefas = await Promise.allSettled([M.carregarGrade(setLoading), M.carregarDistritos(), M.carregarAreas()]);
    var grade = tarefas[0], distr = tarefas[1], areas = tarefas[2];

    if (grade.status === 'rejected') {
      console.error('[app] grade:', grade.reason);
      setLoading('Não foi possível carregar a grade: ' + grade.reason.message, true);
      setConn('Erro de conexão', 'erro');
    } else {
      esconderLoading();
      setConn('Conectado · ' + grade.value.toLocaleString('pt-BR') + ' hexágonos' +
              (distr.status === 'fulfilled' ? ' · ' + distr.value + ' distritos' : ''), 'ok');
      // Só agora dá para saber se a base trouxe os três mapas intermediários.
      NS.painel.atualizarDisponibilidade();
    }

    // Áreas prioritárias: falhar não derruba o resto do portal.
    if (areas.status === 'fulfilled') {
      NS.painel.montarTemas();
    } else {
      console.error('[app] áreas prioritárias:', areas.reason);
      NS.painel.areasIndisponiveis();
    }

    if (distr.status === 'rejected') {
      console.error('[app] distritos:', distr.reason);
      $('toggle-distritos').checked = false;
      $('toggle-distritos').disabled = true;
      $('distritos-legend').style.display = 'none';
      if (grade.status === 'fulfilled') setConn($('conn-status').textContent + ' · distritos indisponíveis', 'ok');
    }
  }

  iniciar();

  // Exposto só para depuração no Console (F12): window.__sigweb
  window.__sigweb = {
    map: M.map, hexSource: M.hexSource, distritosSource: M.distritosSource,
    hexPorId: M.hexPorId, areasSource: M.areasSource, classifyRisk: M.classifyRisk, RISK_BREAKS: M.RISK_BREAKS,
    modoLeve: M.modoLeve, BASEMAPS: M.BASEMAPS, NS: NS
  };
  // Compatibilidade com a versão anterior
  window.__geoportal = window.__sigweb;

})(window.SIGWEB);
