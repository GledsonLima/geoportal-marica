# Como personalizar o geoportal (cores, logos, layout e mais)

O site é um conjunto de **3 arquivos de texto** que você edita direto no GitHub (ícone de lápis
✏️ no arquivo → *Commit changes* → o site se atualiza em ~1 minuto):

| Arquivo | O que controla | Para mudar… |
|---|---|---|
| `css/estilo.css` | Aparência | cores, fontes, tamanhos, posição de legendas, celular |
| `index.html` | Estrutura e textos | títulos, ordem dos blocos, logos, textos de ajuda |
| `js/app.js` | Comportamento | paleta do risco, estilo das linhas, novas ferramentas |
| `js/config.js` | Conexão | URL e chave do Supabase |

Por que é simples: o visual (CSS) está separado da estrutura (HTML) e da lógica (JS). Quase tudo
que é estético se resolve sem tocar no JavaScript.

## Nível 1 — Fácil (minutos, só texto)

**Cores e fontes do portal** — no topo de `css/estilo.css` há um bloco `:root` com a paleta inteira:

```css
:root {
  --cor-painel: #1e2a38;      /* fundo da barra lateral */
  --cor-primaria: #2f7fd1;    /* botões principais */
  --cor-titulo-secao: #7ea6d1;/* títulos das seções */
  --largura-painel: 320px;    /* largura da barra lateral */
  --fonte: 'Segoe UI', Arial, sans-serif;
  ...
}
```
Trocar o valor muda o site todo. Para a identidade da instituição, normalmente basta mexer em
`--cor-painel`, `--cor-primaria` e `--cor-titulo-secao`.

**Logos** — coloque os arquivos (PNG ou SVG, fundo transparente) na pasta `img/` do repositório
(*Add file → Upload files*). Em `index.html`, logo acima do título há um bloco comentado
`LOGOS`: apague as marcas `<!--` e `-->` e ajuste os nomes. Altura máxima 44 px (mude em `.logos img`).

**Textos** — título (`<h1>`), subtítulo, nota de fonte, dicas e o `<title>` da aba estão em `index.html`.

**Cores do mapa de risco** — em `js/app.js`, lista `RISK_BREAKS` (5 linhas). A legenda, o mapa e o
painel de detalhes leem dessa lista, então mudar uma cor ali atualiza os três.
Cuidado: as **faixas** (`max`) são as quebras de Jenks do estudo; mude só as cores, a menos que
refaça a classificação. Para daltonismo, uma opção é trocar por uma paleta sequencial (ex.: ColorBrewer).

**Estilo dos limites distritais, upload e marcador** — também em `js/app.js` (procure
`ESTILO_DISTRITO_LINHA`, `uploadedLayer` e as cores `#ff00d0`).

## Nível 2 — Médio (reorganizar o layout)

- **Mover ferramentas de lugar:** cada bloco da barra lateral começa em um `<h2>` (Mapa base, Buscar
  endereço, Camadas, Filtrar…). Recorte e cole o bloco inteiro, do `<h2>` até o próximo `<h2>`, na ordem
  que quiser. É seguro: o JavaScript acha os elementos pelo `id`, não pela posição.
- **Seções recolhíveis:** troque o `<h2>` + conteúdo por `<details><summary>Título</summary> … </details>`.
- **Barra lateral à direita:** em `index.html` mova `<aside id="sidebar">` para depois de `<main>`
  e, no CSS, ajuste as regras `#sidebar` e `#legend-stack`.
- **Cabeçalho no topo** (faixa com logo e título, mapa embaixo): acrescentar um `<header>` antes do `#app`
  e dar ao `#app` `height: calc(100% - altura)` — exige um pouco de CSS (`flex`).
- **Legenda em outro canto:** `#legend-stack` no CSS (`bottom`, `left`, `right`, `top`).
- **Modo escuro do portal:** como as cores são variáveis, basta um segundo bloco
  `@media (prefers-color-scheme: dark) { :root { ... } }` com a paleta escura.

> **Regra de ouro:** pode mover, estilizar e trocar textos à vontade, mas **não renomeie nem apague
> os `id="..."`** de `index.html` — `app.js` depende deles (a verificação de ids é o primeiro teste
> que faço quando você me manda uma alteração).

## Nível 3 — Exige JavaScript (posso fazer com você)

Medição de distância/área; impressão/exportação do mapa em PDF/PNG; compartilhar a vista por link
(`#zoom/lat/lon` e camadas ligadas); abas dentro da janela de detalhes; gráfico comparando
o hexágono com a média do distrito; busca por distrito/bairro; idioma inglês/espanhol; camada de
pontos com agrupamento (cluster); linha do tempo, se houver séries temporais.

## Nível 4 — Estrutural (só se o uso crescer)

Mapa em MapLibre GL com vector tiles (PMTiles ou pg_tileserv), login de usuários com edição de dados
pelo Supabase Auth, ou múltiplas páginas/portal institucional ao redor do mapa.

## Rotina segura de alteração

1. **Guarde uma cópia** do site que funciona (o ZIP que você recebeu; o GitHub também guarda o
   histórico: *History* de cada arquivo permite voltar atrás).
2. Altere **uma coisa por vez** e teste.
3. Teste no computador antes de publicar: no OSGeo4W Shell, `cd /d C:\sigweb-marica` e
   `python -m http.server 8000`, abrindo `http://localhost:8000` (use **Ctrl+F5** para recarregar sem cache).
4. Publique no GitHub. Após enviar, aguarde ~1 minuto. Nos arquivos `index.html` as chamadas levam
   `?v=2.1.0`: ao mudar `css/estilo.css` ou `js/app.js`, **aumente esse número** (ex.: `?v=2.1.1`) para
   que os visitantes não fiquem com a versão antiga em cache.
5. Se algo quebrar: abra o site, aperte **F12 → Console** e me envie a mensagem em vermelho.

## Boas práticas ao mexer na estética

- **Contraste:** texto claro sobre fundo escuro precisa de contraste ≥ 4,5:1 (WCAG AA). Se trocar a
  cor do painel por uma clara, troque também `--cor-texto-painel` por uma escura.
- **Mapa de risco:** a escala azul → amarelo → vermelho é divergente; evite usar a mesma cor em
  outras camadas para não confundir a leitura.
- **Celular:** teste sempre abrindo o site no telefone (ou F12 → ícone de celular no navegador).
- **Logos:** use arquivos leves (< 100 KB) e inclua o texto alternativo (`alt`).
