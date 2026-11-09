/* =====================================================================
   util.js — funções de apoio usadas por todos os outros arquivos.
   Não depende de nada além do navegador.
   ===================================================================== */
window.SIGWEB = window.SIGWEB || {};
(function (NS) {
  'use strict';

  /** Atalho para document.getElementById. */
  NS.$ = function (id) { return document.getElementById(id); };

  /**
   * Escapa texto antes de inserir em HTML.
   * Obrigatório para qualquer valor vindo do banco ou de arquivo do usuário:
   * sem isso, um nome de camada com <script> viraria XSS.
   */
  NS.esc = function (v) {
    return String(v === null || v === undefined ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };

  /** true só para número finito (descarta null, undefined, NaN e texto). */
  NS.isNum = function (v) { return typeof v === 'number' && isFinite(v); };

  /** Número no formato brasileiro, com casas decimais fixas. */
  NS.num = function (v, casas) {
    if (v === null || v === undefined || isNaN(v)) return '-';
    return Number(v).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
  };

  /** Dispara o download de um conteúdo gerado no navegador. */
  NS.baixar = function (conteudo, nomeArquivo, mime) {
    var url = URL.createObjectURL(new Blob([conteudo], { type: mime }));
    var a = document.createElement('a');
    a.href = url; a.download = nomeArquivo;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  };

  /** Quebra um rótulo longo em linhas curtas (usado nos eixos do radar). */
  NS.quebraRotulo = function (txt, max) {
    var linhas = [], atual = '';
    String(txt).split(' ').forEach(function (p) {
      if (atual && (atual + ' ' + p).length > max) { linhas.push(atual); atual = p; }
      else atual = atual ? atual + ' ' + p : p;
    });
    if (atual) linhas.push(atual);
    return linhas;
  };

  /** Largura de tela em que o radar e os painéis ficam apertados. */
  NS.telaEstreita = function () { return window.innerWidth < 520; };

  /** true quando o layout está em modo celular (painel sobre o mapa). */
  NS.ehCelular = function () { return window.matchMedia('(max-width: 768px)').matches; };

  /** O usuário pediu menos animação no sistema operacional? */
  NS.menosMovimento = function () {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  };

  /** Adia a execução até parar de chamar por `ms` (usado na busca com autocompletar). */
  NS.debounce = function (fn, ms) {
    var t = null;
    return function () {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms);
    };
  };

  /** Pausa de um quadro, para a interface não travar em laços longos. */
  NS.pausa = function () { return new Promise(function (r) { setTimeout(r, 0); }); };

})(window.SIGWEB);
