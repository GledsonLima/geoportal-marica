# SIGWEB SBN Maricá (v3.0.0, nuvem)

> Antes chamado "Geoportal — Mapeamento de Risco Climático de Maricá-RJ".
> A v3.0.0 traz a identidade SIGWEB SBN Maricá: barra superior com logo e busca,
> faixa vertical de ícones com painéis, novos mapas base e o código dividido por assunto.
> A v3.2.0 inclui as quatro camadas do índice, as áreas prioritárias e as fichas de SbN (Passos 7 e 8).


Versão em nuvem do geoportal: **banco e API no Supabase** + **site estático no GitHub Pages**.
Substitui o conjunto local Docker (PostGIS + GeoServer + Nginx) da v1.0.0 sem perder funções.

```
 QGIS / ogr2ogr ──(importação, 1 vez)──►  SUPABASE  (PostgreSQL 15 + PostGIS)
                                          │  tabelas em EPSG:31983 (análise)
                                          │  views em EPSG:4326 + função RPC (publicação)
                                          │  RLS = somente leitura para o público
                                          ▼
                                     API REST automática (PostgREST)  https://<ref>.supabase.co/rest/v1/
                                          ▲  JSON / GeoJSON (chave pública "anon")
                                          │
 GitHub Pages ──(index.html, css, js)──► NAVEGADOR do visitante
                                          OpenLayers + h3-js + turf + Chart.js
                                          (classifica, desenha, analisa e exporta localmente)
```

**Por que assim?** O GitHub Pages só hospeda arquivos estáticos (não roda GeoServer, Docker
nem banco). O Supabase entrega o PostGIS gerenciado e uma API REST pronta, protegida por
Row Level Security (RLS). Como a grade é H3, o navegador **reconstrói cada hexágono a partir
do `h3_index`** (conferido: diferença < 1 mm para a geometria original), então basta baixar
os indicadores (~2 MB) em vez de 23.849 polígonos.

---

## Estrutura do repositório

| Arquivo | Para quê |
|---|---|
| `index.html` | Página do portal (estrutura, textos e ordem dos blocos) |
| `css/estilo.css` | Aparência — cores e medidas no bloco `:root` do topo |
| `img/logo-marica.png` | Logo da barra superior |
| `js/config.js` | **URL do projeto, chave pública e parâmetros do município** — comece por aqui |
| `js/util.js` | Funções de apoio (texto, números, download) |
| `js/api.js` | Conversa com a API REST do banco |
| `js/mapa.js` | Mapa, mapas base, grade hexagonal, distritos, classificação e legenda |
| `js/ferramentas.js` | Filtro, upload e análise, exportação, catálogo de camadas |
| `js/painel.js` | Barra superior, busca, faixa de ícones, painéis, janela de detalhes |
| `js/app.js` | Inicialização — **tem de ser o último** da lista no `index.html` |
| `.nojekyll` | Diz ao GitHub Pages para servir os arquivos como estão |
| `supabase/01_ativar_postgis.sql` | Passo 1 (antes da importação) |
| `supabase/02_preparar_tabelas_e_api.sql` | Passo 3 (depois da importação) |
| `supabase/03_modelo_nova_camada.sql` | Modelo para publicar camadas extras no catálogo |
| `supabase/04_otimizar_carga.sql` | Opcional, recomendado: carga do mapa ~8x mais leve (ver abaixo) |
| `supabase/05_camadas_do_indice.sql` | **Etapa 2**: devolve também Ameaça, Exposição e Vulnerabilidade |
| `supabase/06_areas_prioritarias_e_sbn.sql` | **Etapa 3**: cria e preenche as 60 Áreas Prioritárias, os 5 temas e as 43 SbN |
| `PERSONALIZAR.md` | Guia para mudar cores, logos, layout e textos |

> Não coloque no GitHub: `.gpkg`, `.dump`, shapefiles brutos, nem **nenhuma senha**.
> O repositório do GitHub Pages gratuito é **público**.

---

## Passo 1 — Ativar o PostGIS (painel do Supabase, no navegador)

1. Entre em <https://supabase.com/dashboard> e abra o projeto `iitjbwuopjgrsmndczxh`.
2. Menu lateral **SQL Editor** → **New query**.
3. Cole o conteúdo de `supabase/01_ativar_postgis.sql` → **Run**.
4. Deve aparecer a versão do PostGIS. Se aparecer, siga.

---

## Passo 2 — Importar as camadas com ogr2ogr (terminal **OSGeo4W Shell**)

O mesmo `ogr2ogr` que você já usou para o Docker, agora apontando para o Supabase.

### 2.1 Pegar os dados de conexão (navegador)

1. No painel do projeto, clique no botão **Connect** (topo da página).
2. Escolha a conexão **Session pooler** (porta **5432**).
   *Por quê:* a conexão "Direct" usa só IPv6, e a maioria das redes domésticas/empresariais
   no Brasil ainda é IPv4; o *Session pooler* funciona em IPv4 e é compatível com o ogr2ogr.
3. Anote: **host** (algo como `aws-1-sa-east-1.pooler.supabase.com` — copie o seu),
   **user** (`postgres.iitjbwuopjgrsmndczxh`), **database** (`postgres`).
4. A **senha** é a do banco, definida quando o projeto foi criado. Se não lembrar:
   *Project Settings → Database → Reset database password*.
   (Essa senha **nunca** vai para o site nem para o GitHub.)

### 2.2 Importar a grade hexagonal

Abra o **OSGeo4W Shell** (vem com o QGIS) e rode, trocando `HOST_DO_POOLER` e `SUA_SENHA`
(tudo em **uma linha só**):

```
ogr2ogr -f "PostgreSQL" PG:"host=HOST_DO_POOLER port=5432 dbname=postgres user=postgres.iitjbwuopjgrsmndczxh password=SUA_SENHA sslmode=require" "C:\geoportal_postgis\hex_grupo_todos_mapa_10.gpkg" hex_grupo_todos_mapa_10 -nln public.hex_indicadores_completos -lco GEOMETRY_NAME=geom -lco SPATIAL_INDEX=GIST -t_srs EPSG:31983 -nlt PROMOTE_TO_MULTI -overwrite --config PG_USE_COPY YES -progress
```

- `-nln public.hex_indicadores_completos`: no Supabase usamos o schema **public** (é o que a API publica por padrão).
- `-overwrite`: se der erro no meio, é só rodar de novo (substitui a tabela parcial).
- Se a senha tiver espaço ou caracteres especiais, envolva-a em aspas simples: `password='minha senha'`.

### 2.3 Importar os limites distritais (escolha UMA opção)

**Opção A — do shapefile** (ajuste o caminho):

```
ogr2ogr -f "PostgreSQL" PG:"host=HOST_DO_POOLER port=5432 dbname=postgres user=postgres.iitjbwuopjgrsmndczxh password=SUA_SENHA sslmode=require" "C:\caminho\distritos.shp" -nln public.limites_distritais -lco GEOMETRY_NAME=geom -lco SPATIAL_INDEX=GIST -t_srs EPSG:31983 -nlt PROMOTE_TO_MULTI -overwrite -progress
```

**Opção B — direto do PostGIS local (Docker)**: primeiro, no **PowerShell**,
`cd C:\geoportal_postgis` e `docker compose up -d postgis`. Depois, no **OSGeo4W Shell**:

```
ogr2ogr -f "PostgreSQL" PG:"host=HOST_DO_POOLER port=5432 dbname=postgres user=postgres.iitjbwuopjgrsmndczxh password=SUA_SENHA sslmode=require" PG:"host=localhost port=5432 dbname=geoportal user=geoportal_admin password=SENHA_LOCAL" marica.limites_distritais -nln public.limites_distritais -lco GEOMETRY_NAME=geom -lco SPATIAL_INDEX=GIST -nlt PROMOTE_TO_MULTI -overwrite -progress
```

A coluna do nome do distrito precisa se chamar `nm_dist` (o ogr2ogr já converte para minúsculas).

---

## Passo 3 — Preparar tabelas e publicar a API (painel → SQL Editor)

Cole `supabase/02_preparar_tabelas_e_api.sql` → **Run**. O script:

1. renomeia `grupo_1_mapa_2_população` → `grupo_1_mapa_2_populacao` (sem acento, melhor para API);
2. define `h3_index` como chave primária;
3. liga o **RLS** com política de **somente leitura** e revoga escrita da chave pública;
4. cria as views em EPSG:4326 (`vw_limites_distritais`, `vw_hex_web`) com `security_invoker`;
5. cria a função `hex_dados_web()` (todos os indicadores em 1 pedido);
6. cria a tabela `catalogo_camadas` (painel "Camadas do Supabase").

A última consulta deve mostrar **23849** hexágonos, mínimo ≈ **1,263**, máximo ≈ **3,588**,
`populacao_nula` = 0 e **4** distritos.

Depois, abra **Advisors → Security Advisor** no painel e confira se não há alerta de
"RLS disabled" nas tabelas do `public`.

---

### Passo 3b (recomendado) — Carga mais rápida

Cole `supabase/04_otimizar_carga.sql` → **Run** (resultado esperado: `23849`). Ele cria a função
`hex_mapa_web()`, que entrega só `h3_index` + `indicador_final` (~0,3 MB em vez de 2,6 MB). O site
a usa automaticamente e busca os outros 12 indicadores só do hexágono que você clica. Sem este
passo o site continua funcionando, apenas mais devagar.

## Passo 4 — Testar a API (navegador)

Cole na barra de endereço (troque `CHAVE_ANON` pela chave de `js/config.js`):

```
https://iitjbwuopjgrsmndczxh.supabase.co/rest/v1/vw_limites_distritais?select=nm_dist&apikey=CHAVE_ANON
```

Deve aparecer a lista dos 4 distritos em JSON.

---

## Passo 5 — Testar o site no seu computador (terminal **OSGeo4W Shell**)

```
cd /d C:\caminho\da\pasta\sigweb-marica
python -m http.server 8000
```

Abra <http://localhost:8000>. A barra lateral deve mostrar
"Conectado ao Supabase · 23.849 hexágonos · 4 distritos". Para parar o servidor: `Ctrl+C`.

---

## Passo 6 — Publicar no GitHub Pages (navegador)

1. Crie uma conta em <https://github.com> (se ainda não tiver).
2. **New repository** → nome `geoportal-marica` → **Public** → *Create repository*.
3. Na página do repositório: **Add file → Upload files** → arraste **o conteúdo** da pasta
   `sigweb-marica` (`index.html`, `.nojekyll`, `README.md` e as pastas `css`, `js`, `supabase`)
   → **Commit changes**.
   *Dica:* o arquivo `.nojekyll` começa com ponto e pode ficar oculto no Windows; se não
   conseguir enviá-lo, crie-o no GitHub com **Add file → Create new file** (nome `.nojekyll`, vazio).
4. **Settings → Pages** → *Source*: **Deploy from a branch** → Branch **main**, pasta **/(root)** → **Save**.
5. Em 1–2 minutos o site estará em `https://SEU_USUARIO.github.io/geoportal-marica/`.

Para atualizar o site depois: edite/envie os arquivos de novo no GitHub (ou use o GitHub Desktop);
o Pages republica sozinho.

---

## Passo 7 — As camadas novas (v3.1.0)

São duas situações diferentes, e só uma delas é upload.

### 7.1 Mapas intermediários — **não há nada para subir**

Ameaça Climática, Exposição Socioambiental e Vulnerabilidade Climática **já estão no banco**,
na mesma tabela e na mesma grade H3 do índice final (`hex_indicadores_completos`, colunas
`indicador_mapa1`, `indicador_mapa2` e `indicador_mapa3`). Eles nunca foram "espacializados"
porque a função que alimenta o mapa só devolvia o índice final.

No **SQL Editor**, rode `supabase/05_camadas_do_indice.sql`. Ele troca a função `hex_mapa_web()`
para devolver as cinco colunas de uma vez. Confira as três consultas do fim do arquivo:

- a primeira tem de dar **23849**;
- a segunda mostra mínimo e máximo de cada mapa — compare com as legendas do estudo
  (Ameaça 1,31–3,21; Exposição 1,00–4,55; Vulnerabilidade 1,00–4,91);
- a terceira conta quantas células caem exatamente em cima de uma quebra de classe.

Recarregue o site com **Ctrl+F5**: as três camadas aparecem no painel *Camadas*. Enquanto o
script não rodar, elas ficam desabilitadas com um aviso — nada quebra.

### 7.2 Áreas Prioritárias por Temática — **esta sim é camada nova**

São 60 polígonos de clusterização das piores áreas do mapeamento, cada um com `num_area`,
ligados a 5 temas estratégicos, que por sua vez levam ao catálogo de Soluções Baseadas na
Natureza (SbN).

**Não precisa de ogr2ogr.** São só 60 polígonos (129 KB de geometria), então o próprio
`supabase/06_areas_prioritarias_e_sbn.sql` já traz a geometria embutida em WKB hexadecimal,
além dos temas, dos vínculos e das 43 soluções da planilha. Abra o arquivo num editor de texto,
copie tudo, cole no **SQL Editor** e rode. Leva alguns segundos (o arquivo tem ~220 KB).

O script é **idempotente**: pode rodar de novo sem duplicar nada. Ao final, confira:

| Consulta | Esperado |
|---|---|
| `areas` | 60 |
| `vinculos` | 90 |
| `areas_com_tema` | 60 |
| `solucoes` | 43 |
| `geom_invalidas` | 0 |
| `area_total_ha` | 3060.5 |

Soluções por tema: 1 = 14, 2 = 13, 3 = 6, 4 = 6, 5 = 4.

**Por que N:N entre área e tema:** 24 áreas têm dois temas e 3 têm três (por exemplo, a área 1
é ao mesmo tempo Águas Urbanas, Costeira e Lagunar, e Infraestrutura Verde). Uma coluna
`tema` única obrigaria a repetir o polígono ou a escolher um tema só.

> Se preferir carregar o `.gpkg` por ogr2ogr (por exemplo, para atualizar as geometrias depois),
> importe para `public.areas_60_import` e depois rode um `insert ... select` para
> `areas_prioritarias`. O script 06 continua necessário para temas, vínculos e SbN.

---

## Passo 8 — Áreas Prioritárias e fichas de SbN (v3.2.0)

Pré-requisito: o script `supabase/06_areas_prioritarias_e_sbn.sql` já rodou (Passo 7.2).
**Não há mais nada a subir no banco** — esta versão só traz arquivos do site.

**O que o visitante vê**
1. Painel **Camadas → Áreas Prioritárias por Temática**: uma chave geral, uma chave por tema
   (com cor e número de áreas) e a chave dos rótulos (número da área).
2. Uma área com mais de um tema aparece em cada tema ligado. O contorno sai em **faixas**,
   uma cor por tema, em vez de camadas empilhadas que escondem umas às outras.
3. **Clique numa área** → abre o painel inferior e o mapa **encolhe** (não é coberto) e se
   reenquadra na área. Fluxo: **Área → Tema → lista de SbN → ficha**. Área com um só tema
   vai direto à lista. Há trilha de navegação e botão Voltar.
4. O painel abre com 50% da altura; a alça no topo ajusta entre 30% e 60% (70% no celular), com
   mouse, toque ou setas do teclado. Fecha com o X, com `Esc` ou arrastando a alça até embaixo.
5. A ficha tem **um único modelo**. Campo sem texto aparece como "Em elaboração"; solução com
   status diferente de "Concluído" ganha o aviso "Ficha em elaboração"; sem ilustração, aparece
   o espaço reservado.

**Como o site conversa com o banco** (cada passo é uma consulta pequena, com cache)

| Ação | Chamada | Parâmetro |
|---|---|---|
| Carga das áreas | `vw_areas_prioritarias` (GeoJSON, EPSG:4326) | — |
| Cores dos temas | `tema_estrategico` | — |
| Clique na área | `rpc/temas_da_area` | `p_num_area` (smallint) |
| Escolha do tema | `rpc/sbn_do_tema` | `p_tema` (smallint) |
| Escolha da solução | `rpc/ficha_sbn` | `p_slug` (text) |
| Grade de 20 funções | `rpc/sbn_funcoes` | — |

Os parâmetros são **tipados no banco**, o equivalente a uma consulta parametrizada: o valor nunca
vira texto de SQL. No navegador, o número passa por `Number.isInteger` e o slug por uma expressão
regular antes de entrar na URL.

**Para alimentar uma ficha** basta editar a linha da solução na tabela `sbn_solucao` (Table Editor
do Supabase): preencha os campos e mude `status_conteudo` para `Concluído`. Para mostrar uma
ilustração, preencha `ilustracao_url` com um endereço `https://…` ou com um caminho `img/…` de
um arquivo enviado ao repositório. Nada precisa ser republicado no site.

**Observação de uso:** com a camada de áreas ligada, o clique dentro de uma área abre o painel
inferior. Para ver o radar de um hexágono, clique fora das áreas ou desligue a camada.

## Atualizar o site depois de receber uma versão nova

1. No repositório do GitHub, use *Add file → Upload files* e arraste as pastas `css`, `js` e `img`
   mais o `index.html`. Arquivos de mesmo nome e caminho são substituídos. *Commit changes*.
2. Rode no Supabase os scripts SQL novos que acompanham a versão (ex.: o `04`).
3. Aguarde ~1 minuto e abra o site com **Ctrl+F5**.

> Atenção: se você já mudou `js/config.js`, não o substitua sem conferir; mantenha sua URL e chave.

### Mapas base: por que a CARTO saiu

Até a v2.1.0 as opções "Claro" e "Escuro" usavam `basemaps.cartocdn.com` sem chave. A CARTO
encerrou esse acesso gratuito: a URL **continua respondendo HTTP 200 com um PNG válido**, mas o
tile traz a marca d'água *"API KEY REQUIRED"*. Como a resposta é um sucesso para o navegador,
**nenhum fallback automático detecta isso** — por isso a troca de provedor, e não só um remendo.

Na v3.0.0, "Claro" e "Escuro" usam os *Canvas* da Esri (base + rótulos, sem chave, 24 níveis de
zoom). Se quiser a CARTO de volta, crie uma conta gratuita em carto.com/basemaps e preencha
`CARTO_API_KEY` em `js/config.js`: as opções CARTO passam a aparecer na lista. Lembre que essa
chave, como a do banco, fica visível no navegador.

Havia ainda um defeito menor na URL antiga: o marcador `{r}` (tile retina) é convenção do
**Leaflet**; o OpenLayers não o substitui, e o navegador pedia `.../{y}%7Br%7D.png`. A CARTO
ignorava o sufixo, então isso não quebrava nada — mas saiu junto.

## Shapefile no upload: acentos

Envie junto o arquivo `.cpg` (já é gerado pelo QGIS). Sem ele, nomes com acento de shapefiles
em codificação antiga (Windows-1252/ISO-8859-1) podem aparecer com caracteres trocados (ex.: "�rea").
O `.prj` continua obrigatório: é ele que permite reprojetar de UTM/SIRGAS para o mapa.

## Publicar uma camada nova no painel "Camadas do Supabase"

A chave pública **não consegue listar** as tabelas do banco (bloqueio de segurança do Supabase),
por isso o site lê a tabela `catalogo_camadas`. Para publicar, por exemplo, áreas de risco:

1. Importe com ogr2ogr (como no Passo 2) para `public.minha_camada` em EPSG:31983.
2. Rode o modelo `supabase/03_modelo_nova_camada.sql` trocando os nomes: ele cria a view em
   EPSG:4326, o RLS de leitura e o registro no catálogo.
3. Recarregue o site: a camada aparece na lista. Para testar sem cadastrar, use
   **"Conectar outra tabela/view"** (vale só para aquela visita).

---

## Usar o banco no QGIS (análises e GeoPackage)

*Camada → Gerenciador de Fontes de Dados → PostgreSQL → Nova*: host do **Session pooler**,
porta 5432, banco `postgres`, usuário `postgres.iitjbwuopjgrsmndczxh`, SSL **require**.
Daí dá para analisar no SRC do projeto (EPSG:31983) e exportar GeoPackage.

---

## Segurança — o que está protegido e como

| Item | Situação |
|---|---|
| Chave **anon** no `config.js` | Pública por desenho. Só lê o que o RLS permite. |
| Chave **service_role / sb_secret_** | **Nunca** no site. O `app.js` se recusa a rodar se detectar uma. |
| Senha do banco | Só no seu computador (ogr2ogr/QGIS). Nunca no GitHub. |
| Escrita pela API | Bloqueada (RLS sem política de escrita + `revoke`). |
| Upload do usuário | Processado só no navegador; textos escapados contra XSS. |
| Painel administrativo | O painel do Supabase exige login — não há mais `/geoserver/web` exposto. |
| Consultas com parâmetro | Vão por RPC com argumentos tipados no banco; valores passam por `encodeURIComponent` e nomes de tabela por lista de caracteres permitidos. Nada é montado por concatenação de texto do usuário. |

### "Por que a chave não fica num `.env`?"

Porque não existe `.env` que o navegador leia. O GitHub Pages serve arquivos estáticos: não há
servidor nem etapa de build. Mesmo adicionando um build (Vite + GitHub Actions), a chave seria
**compilada dentro do JavaScript publicado** e continuaria visível no F12 — seria segurança
aparente, com uma engrenagem a mais para manter.

A chave `anon` foi feita para ser pública: ela **identifica** o projeto, não **autoriza** nada.
Quem decide o que pode ser lido é o RLS no banco. É o mesmo modelo de uma chave de Google Maps JS.
Quem precisa esconder credenciais de verdade (por exemplo, para permitir escrita) tem de pôr um
servidor no meio — uma Edge Function do Supabase ou um Worker da Cloudflare —, o que muda a
arquitetura e acrescenta latência. Hoje o portal é só leitura, então não compensa.

---

## Limites do plano gratuito (conferir em supabase.com/pricing antes de uso institucional)

- **Pausa por inatividade:** projetos Free podem ser pausados após ~1 semana de baixa atividade.
  O site mostrará "Não foi possível contatar o Supabase"; reative no painel (*Restore project*).
- **Banco:** 500 MB (a grade ocupa poucos MB). **Tráfego (egress):** ~5 GB/mês não cacheados —
  sem o script 04 cada visita baixa ~2,6 MB (≈2 mil visitas/mês); com o script 04, ~0,3 MB (≈15 mil visitas/mês).
- **Sem backup baixável** no Free: mantenha os `.gpkg` originais e faça `pg_dump` periódico
  (pela string do Session pooler).
- Se o tráfego crescer, a alternativa barata é publicar um retrato estático dos indicadores
  (JSON) no próprio GitHub Pages e deixar o Supabase só para camadas dinâmicas.

---

## O que mudou em relação à v1.0.0 (local)

- **Simbologia na fonte única** (`RISK_BREAKS` em `app.js`): quebras e cores conferidas com o SLD
  `indicador_final_jenks5` (iguais). Mapa e legenda não divergem mais.
- **Distritos só com contorno** (opacidade 0,7) — antes o preenchimento categórico por cima da
  grade alterava a cor percebida do risco. Rótulos continuam opcionais.
- **Clique** só abre o dashboard se a grade estiver visível e a célula passar no filtro.
- **Filtro** aceita só mínimo, só máximo ou os dois; clicar na legenda oculta/exibe classes.
- **Upload**: pontos usam a célula H3 exata; polígonos mostram **média ponderada pela área**,
  média simples e distribuição de área por classe; **linhas** agora são aceitas.
- **Barras do dashboard** em escala 1–5 (antes a barra começava em 0).
- **Exportação**: GeoJSON, KML e CSV gerados no navegador (respeitam o filtro).
  GeoPackage passou a ser feito pelo QGIS conectado ao banco.

## Problemas comuns

| Sintoma | Causa provável | Solução |
|---|---|---|
| `could not translate host name` / timeout no ogr2ogr | Usou a conexão Direct (IPv6) | Use o host do **Session pooler** |
| `password authentication failed` | Senha ou usuário errado | Usuário é `postgres.iitjbwuopjgrsmndczxh`; resete a senha se preciso |
| `Tenant or user not found` | Host de outra região | Copie o host exato do botão **Connect** |
| Site: "função hex_dados_web não existe" | Script 02 não rodou ou falhou | Rode o 02 de novo e veja a mensagem de erro |
| Site: "tabela/view não encontrada" | Nome errado ou cache da API | Confira o nome; rode `notify pgrst, 'reload schema';` |
| Site: "Acesso negado" | Chave errada ou RLS sem política | Confira `js/config.js` e o script 02 |
| Camada do catálogo: "não está em EPSG:4326" | View publicada em UTM | Use `ST_Transform(geom, 4326)` na view |
| Página 404 no GitHub Pages | Pages não ativado ou arquivos dentro de subpasta | `index.html` precisa estar na raiz do repositório |
