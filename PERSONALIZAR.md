# Como personalizar o SIGWEB (cores, logos, layout e mais)

O site é um conjunto de arquivos de texto que você edita direto no GitHub (ícone de lápis ✏️ no
arquivo → *Commit changes* → o site se atualiza em ~1 minuto).

| Arquivo | O que controla |
|---|---|
| `css/estilo.css` | **Aparência**: cores, fontes, tamanhos, posição da legenda, celular |
| `index.html` | **Estrutura e textos**: título, ordem dos blocos, logo, conteúdo do "Sobre" |
| `js/config.js` | **Conexão** com o banco, caixa do município, chave da CARTO |
| `js/mapa.js` | Mapas base, cores do risco, estilo dos distritos |
| `js/painel.js` | Comportamento da barra superior, busca, painéis e janela de detalhes |
| `js/fichas.js` | Painel inferior: Área → Tema → lista de SbN → ficha (altura, arraste, modelo da ficha) |
| `js/ferramentas.js` | Filtro, upload, exportação e catálogo de camadas |
| `js/util.js`, `js/api.js`, `js/app.js` | Apoio, conversa com o banco e inicialização |

Por que é simples: o visual (CSS) está separado da estrutura (HTML) e da lógica (JS). Quase tudo
que é estético se resolve sem tocar no JavaScript.

> **Ordem dos arquivos JS:** eles se usam uns aos outros e são carregados na ordem escrita no fim do
> `index.html`. Não troque essa ordem, e mantenha o `app.js` por último.

## Nível 1 — Fácil (minutos, só texto)

**Cores e medidas** — no topo de `css/estilo.css` há um bloco `:root` com tudo:

```css
:root {
  --cor-primaria: #bc1f28;     /* vermelho da Prefeitura: barra superior e botões */
  --cor-rail: #1f2933;         /* faixa vertical de ícones */
  --cor-painel: #ffffff;       /* fundo dos painéis */
  --altura-topbar: 56px;
  --largura-rail: 56px;
  --largura-painel: 320px;
  --fonte: 'Segoe UI', system-ui, Arial, sans-serif;
}
```
Trocar o valor muda o site todo.

> **Contraste:** se clarear `--cor-primaria`, confira o contraste do texto branco sobre ela. O
> mínimo da WCAG AA é 4,5:1; o vermelho atual dá 6,85:1. Há verificadores gratuitos na web
> (procure por "contrast checker"). Se precisar de um vermelho mais claro, troque também
> `--cor-sobre-primaria` por um tom escuro.

**Logo** — substitua `img/logo-marica.png` por outro arquivo de mesmo nome (PNG ou SVG, quadrado,
de preferência com fundo transparente). Para trocar o nome do arquivo, ajuste o `src` em
`index.html`, no bloco `<button id="brand">`. O tamanho está em `#brand-logo` no CSS.

**Nome do portal** — em `index.html`, dentro de `<span id="brand-nome">`. Também há o `<title>`
da aba logo acima.

**Textos do "Sobre"** — em `index.html`, na seção `data-secao="sobre"`. É ali que ficam a
descrição do projeto, as fontes e os créditos.

**Cores do mapa de risco** — em `js/mapa.js`, lista `RISK_BREAKS` (5 linhas). O mapa, a legenda do
canto e a legenda do painel leem todos dessa lista, então mudar uma cor ali atualiza os três.
Mexa só nas cores: as **faixas** (`max`) são as quebras de Jenks do estudo, e alterá-las muda o
significado do mapa, não a aparência.

**Mapas base** — em `js/mapa.js`, lista `BASEMAPS`: nome, URL do provedor e atribuição. Para
acrescentar um, copie um item existente. Para voltar à CARTO, preencha `CARTO_API_KEY` em
`js/config.js`.

**Busca restrita ao município** — `BBOX_MARICA` em `js/config.js`, na ordem
`[oeste, sul, leste, norte]` em graus.

## Nível 2 — Médio (reorganizar o layout)

- **Mover blocos de lugar:** cada seção do painel é uma `<section data-secao="...">`, e dentro dela
  os blocos começam em um `<h3>`. Recorte e cole o bloco inteiro, do `<h3>` até o próximo `<h3>`,
  na ordem que quiser. É seguro: o JavaScript acha os elementos pelo `id`, não pela posição.
- **Trocar a ordem dos ícones:** reordene os `<button class="rail-btn">` dentro de `<nav id="rail">`.
  O `data-painel` é que liga o botão ao conteúdo; o `rail-fim` empurra o item para o pé da faixa.
- **Renomear um item do menu:** troque o texto em `<span class="rail-dica">` **e** a entrada
  correspondente no objeto `TITULOS`, em `js/painel.js`.
- **Mudar o ícone de um item:** os ícones são `<symbol>` no topo do `index.html` (biblioteca Lucide).
  Cole o `<path>` de outro ícone Lucide dentro do `<symbol>` correspondente.
- **Painel à direita:** no CSS, troque `left: var(--largura-rail)` por `right: 0` em `#painel`, e
  ajuste `#legend-stack` (que hoje se desloca para a direita quando o painel abre).
- **Legenda em outro canto:** `#legend-stack` no CSS (`bottom`, `left`, `right`, `top`).
- **Modo escuro:** como as cores são variáveis, basta um segundo bloco
  `@media (prefers-color-scheme: dark) { :root { ... } }` com a paleta escura.

> **Regra de ouro:** pode mover, estilizar e trocar textos à vontade, mas **não renomeie nem apague
> os `id="..."` nem os `data-painel` / `data-secao`** — o JavaScript depende deles. A verificação de
> ids é o primeiro teste que eu faço quando você me manda uma alteração.

## Nível 3 — Exige JavaScript (posso fazer com você)

Medição de distância e área; exportar o mapa em PDF/PNG; compartilhar a vista por link
(`#zoom/lat/lon` e camadas ligadas); gráfico comparando o hexágono com a média do distrito;
busca por distrito ou bairro; idioma inglês/espanhol; camada de pontos com agrupamento (cluster);
linha do tempo, se houver séries temporais.

## Nível 4 — Estrutural (só se o uso crescer)

Mapa em MapLibre GL com vector tiles (PMTiles ou pg_tileserv), login de usuários com edição de
dados, ou múltiplas páginas em torno do mapa.

## Rotina segura de alteração

1. **Guarde uma cópia** do site que funciona (o ZIP que você recebeu; o GitHub também guarda o
   histórico — *History* de cada arquivo permite voltar atrás).
2. Altere **uma coisa por vez** e teste.
3. Teste no computador antes de publicar: no OSGeo4W Shell, `cd /d C:\sigweb-marica` e
   `python -m http.server 8000`, abrindo `http://localhost:8000` (**Ctrl+F5** recarrega sem cache).
   Abrir o `index.html` com duplo clique também funciona, mas pelo servidor é mais fiel.
4. Publique no GitHub e aguarde ~1 minuto. No `index.html`, as chamadas levam `?v=3.0.0`:
   ao mudar qualquer arquivo de `css/` ou `js/`, **aumente esse número em todas as linhas**
   (ex.: `?v=3.0.1`) para os visitantes não ficarem com a versão antiga em cache.
5. Se algo quebrar: abra o site, aperte **F12 → Console** e me mande a mensagem em vermelho.

## Boas práticas ao mexer na estética

- **Contraste:** texto claro sobre fundo escuro precisa de contraste ≥ 4,5:1 (WCAG AA).
- **Mapa de risco:** a escala azul → amarelo → vermelho é a do estudo. Evite usar as mesmas cores
  em outras camadas, para não confundir a leitura.
- **Animação:** quem liga "reduzir movimento" no sistema não vê transição — já está tratado no CSS.
  Se acrescentar animações, inclua-as na regra `@media (prefers-reduced-motion: reduce)`.
- **Celular:** teste sempre no telefone (ou F12 → ícone de celular no navegador).
- **Logos:** use arquivos leves (< 100 KB) e preencha o texto alternativo (`alt`).

## Áreas prioritárias e fichas (v3.2.0)

**Cores dos temas** — vêm da tabela `tema_estrategico` (coluna `cor`). Mude no Table Editor do
Supabase; o site não precisa ser republicado. `TEMAS_PADRAO`, em `js/mapa.js`, só vale se a tabela
não puder ser lida.

**Altura do painel inferior** — em `js/fichas.js`: `FRACAO_MIN`, `FRACAO_MAX`, `FRACAO_MAX_CELULAR`,
`FRACAO_INICIAL` e `LIMIAR_FECHAR` (fração da altura da coluna do mapa).

**Aparência da ficha** — em `css/estilo.css`: variáveis `--cor-ficha*` e `--cor-restricao-*` (bloco
`:root`) e as classes `.ficha-*`. O conteúdo vem de `rpc/ficha_sbn`; a estrutura está na função
`fichaHTML`, em `js/fichas.js`.
