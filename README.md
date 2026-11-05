# Geoportal — Mapeamento de Risco Climático de Maricá-RJ (v2.1.0, nuvem)

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
| `index.html` | Página do geoportal (estrutura) |
| `css/estilo.css` | Aparência (inclui layout para celular) |
| `js/config.js` | **URL do projeto e chave pública** — único arquivo a editar |
| `js/app.js` | Lógica: mapa, dados, dashboard, catálogo, upload, exportação |
| `.nojekyll` | Diz ao GitHub Pages para servir os arquivos como estão |
| `supabase/01_ativar_postgis.sql` | Passo 1 (antes da importação) |
| `supabase/02_preparar_tabelas_e_api.sql` | Passo 3 (depois da importação) |
| `supabase/03_modelo_nova_camada.sql` | Modelo para publicar camadas extras no catálogo |
| `supabase/04_otimizar_carga.sql` | Opcional, recomendado: carga do mapa ~8x mais leve (ver abaixo) |
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

## Atualizar o site depois de receber uma versão nova

1. No repositório do GitHub, entre em cada pasta e use *Add file → Upload files* para enviar os
   arquivos novos com o **mesmo nome** (ele substitui o antigo): `index.html`, `css/estilo.css`,
   `js/app.js`, `js/config.js` (e, se houver, `supabase/…`). *Commit changes*.
2. Rode no Supabase os scripts SQL novos que acompanham a versão (ex.: o `04`).
3. Aguarde ~1 minuto e abra o site com **Ctrl+F5**.

> Atenção: se você já mudou `js/config.js`, não o substitua sem conferir; mantenha sua URL e chave.

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
