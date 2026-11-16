"""Gera os scripts supabase/07a..07d (camadas auxiliares) a partir dos GeoPackages.

Sem GDAL: lê o GeoPackage com sqlite3, tira o cabeçalho GPKG do blob e embute o
WKB (hexadecimal) no SQL. A conversão de curvas, a força 2D, a validação, a
simplificação para a web e a reprojeção para 4326 ficam com o PostGIS.
Uso: python3 -I gerar_sql07.py <pasta_dos_gpkg> <pasta_saida>
"""
import sqlite3, sys, os, re

ORIG, SAIDA = sys.argv[1], sys.argv[2]

def abrir(nome):
    arq = [f for f in os.listdir(ORIG) if f.endswith(nome)][0]
    return sqlite3.connect('file:' + os.path.join(ORIG, arq) + '?mode=ro', uri=True)

def wkb_hex(blob):
    """GeoPackageBinary -> WKB hex (pula o cabeçalho 'GP' e o envelope)."""
    assert blob[:2] == b'GP', 'blob não é GeoPackageBinary'
    env = (blob[3] >> 1) & 7
    return blob[8 + [0, 32, 48, 48, 64][env]:].hex()

def s(v):
    if v is None or (isinstance(v, str) and not v.strip()):
        return 'null'
    return "'" + str(v).strip().replace("'", "''") + "'"

def n(v):
    return 'null' if v is None else repr(float(v))

MINUSC = {'de', 'da', 'do', 'das', 'dos', 'e', 'di'}
def titulo(txt):
    """'SÃO JOSÉ DO IMBASSAÍ' -> 'São José do Imbassaí' (preposições em minúsculas)."""
    if not txt:
        return txt
    p = txt.strip().lower().split()
    return ' '.join(w if (i and w in MINUSC) else w[:1].upper() + w[1:] for i, w in enumerate(p))

CABECALHO = """-- ============================================================================
-- {arq} — SIGWEB SBN Maricá · Camadas auxiliares (v3.4.0)
--
-- {descr}
--
-- Geometria embutida em WKB hexadecimal, EPSG:31983 (SIRGAS 2000 / UTM 23S):
-- NÃO precisa de ogr2ogr, senha nem Session pooler. Cole no SQL Editor e rode.
-- IDEMPOTENTE: pode rodar de novo (a tabela é esvaziada e recarregada).
--
-- Guarda duas geometrias:
--   geom      original, em 31983, para análise (QGIS, relatórios no banco)
--   geom_web  simplificada (tolerância em metros indicada abaixo) e em 4326,
--             só para desenhar no site: o arquivo baixado fica bem menor.
-- O site lê pela função camada_auxiliar(p_camada), que devolve GeoJSON com
-- 6 casas decimais (~10 cm) — parâmetro conferido contra uma lista fixa.
-- ============================================================================

set search_path = public, extensions;
"""

def rls(tab):
    return f"""
alter table public.{tab} enable row level security;
drop policy if exists "leitura publica {tab}" on public.{tab};
create policy "leitura publica {tab}" on public.{tab} for select to anon, authenticated using (true);
revoke insert, update, delete, truncate on public.{tab} from anon, authenticated;
grant select on public.{tab} to anon, authenticated;
"""

def geom_web(tab, tol, tipo):
    """Simplifica (polígonos/linhas) e reprojeta; garante tipo e validade."""
    if tipo == 'Point':
        expr = 'ST_Transform(geom, 4326)'
    elif tipo == 'MultiLineString':
        expr = f'ST_Transform(ST_Multi(ST_SimplifyPreserveTopology(geom, {tol})), 4326)'
    else:
        expr = (f'ST_Transform(ST_Multi(ST_CollectionExtract(ST_MakeValid('
                f'ST_SimplifyPreserveTopology(geom, {tol})), 3)), 4326)')
    return f"""
-- Geometria para a web: tolerância de {tol} m (invisível na escala do município).
update public.{tab} set geom_web = {expr};
create index if not exists {tab}_geom_gix on public.{tab} using gist (geom);
analyze public.{tab};
"""

def carga_geom(tipo):
    """Do WKB cru para o tipo final em 31983: curvas -> linhas, 2D, válido, multi."""
    if tipo == 'Point':
        return "ST_Force2D(ST_SetSRID('{h}'::geometry, 31983))"
    if tipo == 'MultiLineString':
        return "ST_Multi(ST_Force2D(ST_SetSRID('{h}'::geometry, 31983)))"
    return ("ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_Force2D(ST_CurveToLine("
            "ST_SetSRID('{h}'::geometry, 31983)))), 3))")

FUNCAO = """
-- ------------------------------------------------ função única de leitura (site)
-- Recebe o nome de uma camada e devolve um FeatureCollection. O nome é comparado
-- com uma lista fixa (CASE): nenhum texto do usuário vira SQL. Se uma das tabelas
-- ainda não existir (outro script 07 não rodou), só aquela camada falha.
create or replace function public.camada_auxiliar(p_camada text)
returns json
language plpgsql stable security invoker
set search_path = public, extensions
as $$
declare r json;
begin
  case p_camada
  when 'bairros' then
    select json_build_object('type','FeatureCollection','features', coalesce(json_agg(json_build_object(
      'type','Feature','id',b.id,
      'properties', json_build_object('nome', b.nome, 'distrito', b.distrito, 'cod_bairro', b.cod_bairro),
      'geometry', ST_AsGeoJSON(b.geom_web, 6)::json) order by b.id), '[]'::json))
      into r from public.aux_bairros b;
  when 'unidades_conservacao' then
    select json_build_object('type','FeatureCollection','features', coalesce(json_agg(json_build_object(
      'type','Feature','id',u.id,
      'properties', json_build_object('nome', u.nome, 'categoria', u.categoria, 'grupo', u.grupo,
                                      'esfera', u.esfera, 'area_ha', u.area_ha),
      'geometry', ST_AsGeoJSON(u.geom_web, 6)::json) order by u.area_ha desc), '[]'::json))
      into r from public.aux_unidades_conservacao u;
  when 'corpos_hidricos' then
    select json_build_object('type','FeatureCollection','features', coalesce(json_agg(json_build_object(
      'type','Feature','id',h.id,
      'properties', json_build_object('nome', h.nome, 'tipo', h.tipo),
      'geometry', ST_AsGeoJSON(h.geom_web, 6)::json) order by h.id), '[]'::json))
      into r from public.aux_corpos_hidricos h;
  when 'zoneamento' then
    select json_build_object('type','FeatureCollection','features', coalesce(json_agg(json_build_object(
      'type','Feature','id',z.id,
      'properties', json_build_object('zona', z.zona, 'nome', z.nome, 'sigla', z.sigla, 'tipo', z.tipo, 'ordem', z.ordem),
      'geometry', ST_AsGeoJSON(z.geom_web, 6)::json) order by z.ordem, z.id), '[]'::json))
      into r from public.aux_zoneamento z;
  when 'zoneamento_pontos' then
    select json_build_object('type','FeatureCollection','features', coalesce(json_agg(json_build_object(
      'type','Feature','id',p.id,
      'properties', json_build_object('nome', p.nome, 'categoria', p.categoria),
      'geometry', ST_AsGeoJSON(p.geom_web, 6)::json) order by p.id), '[]'::json))
      into r from public.aux_zoneamento_pontos p;
  when 'zoneamento_viario' then
    select json_build_object('type','FeatureCollection','features', coalesce(json_agg(json_build_object(
      'type','Feature','id',v.id,
      'properties', json_build_object('classe', v.classe, 'acao', v.acao),
      'geometry', ST_AsGeoJSON(v.geom_web, 6)::json) order by v.id), '[]'::json))
      into r from public.aux_zoneamento_viario v;
  else
    raise exception 'Camada auxiliar desconhecida: %', p_camada using errcode = '22023';
  end case;
  return r;
end $$;

revoke all on function public.camada_auxiliar(text) from public;
grant execute on function public.camada_auxiliar(text) to anon, authenticated;

-- Avisa a API (PostgREST) de que há tabela/função nova.
notify pgrst, 'reload schema';
"""

def gravar(nome, texto):
    with open(os.path.join(SAIDA, nome), 'w', encoding='utf-8') as f:
        f.write(texto)
    print(nome, round(len(texto.encode()) / 1024), 'KB')

# =============================================================== 07a BAIRROS
c = abrir('bairros_marica.gpkg')
linhas = []
for cod, nome, distrito, geom in c.execute('select cod_bairro, bairro, distrito, geom from bairros_marica order by cod_bairro'):
    linhas.append(f"  ({cod}, {s(titulo(nome))}, {s(nome)}, {s(distrito)}, " +
                  carga_geom('MultiPolygon').format(h=wkb_hex(geom)) + ')')
sql = CABECALHO.format(arq='07a_bairros.sql', descr='Limites dos 50 bairros de Maricá. Rótulo: nome do bairro em maiúsculas/minúsculas\n-- (o original, em caixa alta, fica em nome_original). Tolerância web: 2 m.') + """
create table if not exists public.aux_bairros (
  id             serial primary key,
  cod_bairro     integer,
  nome           text not null,
  nome_original  text,
  distrito       text,
  geom           geometry(MultiPolygon, 31983) not null,
  geom_web       geometry(MultiPolygon, 4326)
);
truncate public.aux_bairros restart identity;

-- O arquivo original guarda os bairros como MultiSurface/CurvePolygon:
-- ST_CurveToLine converte para polígonos comuns antes de validar.
insert into public.aux_bairros (cod_bairro, nome, nome_original, distrito, geom) values
""" + ',\n'.join(linhas) + ';\n' + geom_web('aux_bairros', 2, 'MultiPolygon') + rls('aux_bairros') + FUNCAO + """
-- ------------------------------------------------------------- conferência
-- Esperado: bairros 50 · geom_invalidas 0 · area_total_km2 ≈ área do município
select count(*) as bairros,
       count(*) filter (where not ST_IsValid(geom)) as geom_invalidas,
       round((sum(ST_Area(geom)) / 1e6)::numeric, 2) as area_total_km2,
       count(*) filter (where geom_web is null or ST_IsEmpty(geom_web)) as sem_geom_web
  from public.aux_bairros;
"""
gravar('07a_bairros.sql', sql)

# ================================================== 07b UNIDADES DE CONSERVAÇÃO
c = abrir('unidades_conservacao.gpkg')
linhas = []
for nome, cat, grupo, esfera, area, geocode, geom in c.execute(
        'select nome_uc, categoria_, grupo, esfera_cri, area_ha, geocode, geom from ucs_matheus order by fid'):
    linhas.append(f"  ({s(nome)}, {s(cat)}, {s(grupo)}, {s(esfera)}, {n(area)}, {s(geocode)}, " +
                  carga_geom('MultiPolygon').format(h=wkb_hex(geom)) + ')')
sql = CABECALHO.format(arq='07b_unidades_conservacao.sql', descr='8 Unidades de Conservação que incidem em Maricá (fonte: INEA, 2026).\n-- Rótulo: nome da UC. Tolerância web: 3 m.') + """
create table if not exists public.aux_unidades_conservacao (
  id        serial primary key,
  nome      text not null,
  categoria text,
  grupo     text,          -- Proteção Integral | Uso Sustentável
  esfera    text,          -- Municipal | Estadual
  area_ha   numeric(14,4),
  geocode   text,
  fonte     text not null default 'INEA, 2026',
  geom      geometry(MultiPolygon, 31983) not null,
  geom_web  geometry(MultiPolygon, 4326)
);
truncate public.aux_unidades_conservacao restart identity;

insert into public.aux_unidades_conservacao (nome, categoria, grupo, esfera, area_ha, geocode, geom) values
""" + ',\n'.join(linhas) + ';\n' + geom_web('aux_unidades_conservacao', 3, 'MultiPolygon') + rls('aux_unidades_conservacao') + FUNCAO + """
-- ------------------------------------------------------------- conferência
-- Esperado: ucs 8 · geom_invalidas 0
select count(*) as ucs,
       count(*) filter (where not ST_IsValid(geom)) as geom_invalidas,
       count(*) filter (where geom_web is null or ST_IsEmpty(geom_web)) as sem_geom_web,
       string_agg(nome || ' (' || grupo || ')', ' · ' order by nome) as nomes
  from public.aux_unidades_conservacao;
"""
gravar('07b_unidades_conservacao.sql', sql)

# ======================================================== 07c CORPOS HÍDRICOS
c = abrir('corpos_hidricos_marica.gpkg')
linhas = []
TIPO = {'water': 'Água', 'wetland': 'Área úmida', 'riverbank': 'Margem de rio'}
for nome, fclass, osm, geom in c.execute('select name, fclass, osm_id, geom from corpos_hidricos order by fid'):
    linhas.append(f"  ({s(nome)}, {s(TIPO.get(fclass, fclass))}, {s(osm)}, " +
                  carga_geom('MultiPolygon').format(h=wkb_hex(geom)) + ')')
sql = CABECALHO.format(arq='07c_corpos_hidricos.sql', descr='189 polígonos de corpos hídricos (sistema lagunar, canais, áreas úmidas),\n-- origem OpenStreetMap. Rótulo: nome (só 9 têm nome). Tolerância web: 1,5 m.') + """
create table if not exists public.aux_corpos_hidricos (
  id        serial primary key,
  nome      text,
  tipo      text,          -- Água | Área úmida | Margem de rio (fclass do OSM)
  osm_id    text,
  geom      geometry(MultiPolygon, 31983) not null,
  geom_web  geometry(MultiPolygon, 4326)
);
truncate public.aux_corpos_hidricos restart identity;

insert into public.aux_corpos_hidricos (nome, tipo, osm_id, geom) values
""" + ',\n'.join(linhas) + ';\n' + geom_web('aux_corpos_hidricos', 1.5, 'MultiPolygon') + rls('aux_corpos_hidricos') + FUNCAO + """
-- ------------------------------------------------------------- conferência
-- Esperado: poligonos 189 · com_nome 9 · geom_invalidas 0
select count(*) as poligonos,
       count(nome) as com_nome,
       count(*) filter (where not ST_IsValid(geom)) as geom_invalidas,
       count(*) filter (where geom_web is null or ST_IsEmpty(geom_web)) as sem_geom_web,
       round((sum(ST_Area(geom)) / 1e6)::numeric, 2) as area_km2
  from public.aux_corpos_hidricos;
"""
gravar('07c_corpos_hidricos.sql', sql)

# ============================================================ 07d ZONEAMENTO
# Siglas e ordem de desenho. Macrozonas (cobrem o território) primeiro;
# áreas especiais (sobrepostas às macrozonas) depois, por cima.
ZONAS = {
    'Macrozona de Consolidação e Qualificação Urbana 1': ('MCQU 1', 'macrozona', 1),
    'Macrozona de Consolidação e Qualificação Urbana 2': ('MCQU 2', 'macrozona', 2),
    'Macrozona de Consolidação e Qualificação Urbana 3': ('MCQU 3', 'macrozona', 3),
    'Macrozona de Urbanização Progressiva 1': ('MUP 1', 'macrozona', 4),
    'Macrozona de Urbanização Progressiva 2': ('MUP 2', 'macrozona', 5),
    'Macrozona de Urbanização Progressiva 3': ('MUP 3', 'macrozona', 6),
    'Macrozona de Amortecimento da Urbanização': ('MAU', 'macrozona', 7),
    'Macrozona de Desenvolvimento Econômico': ('MDE', 'macrozona', 8),
    'Macrozona da Orla': ('MO', 'macrozona', 9),
    'Macrozona Rural': ('MR', 'macrozona', 10),
    'APA': ('APA', 'area_especial', 11),
    'Áreas Especiais de Interesse Ambiental': ('AEIA', 'area_especial', 12),
    'Área Especial de Interesse de Desenvolvimento': ('AEID', 'area_especial', 13),
    'Área Especial de Interesse Social': ('AEIS', 'area_especial', 14),
}
c = abrir('zoneamento_marica.gpkg')
lp = []
for zona, nome, geom in c.execute('select zona, nome, geom from zoneamento_marica_1 order by fid'):
    sig, tipo, ordem = ZONAS[zona]
    lp.append(f"  ({s(zona)}, {s(nome)}, {s(sig)}, {s(tipo)}, {ordem}, " + carga_geom('MultiPolygon').format(h=wkb_hex(geom)) + ')')
lpt = []
for nome, cat, geom in c.execute('select Name, FolderPath, geom from zoneamento_marica_pontos_1 order by fid'):
    lpt.append(f"  ({s(nome)}, {s(cat)}, " + carga_geom('Point').format(h=wkb_hex(geom)) + ')')
lv = []
CLASSE = {'Primarias': 'Primárias', 'Secundarias': 'Secundárias', 'Via paque': 'Via parque'}
ACAO = {'Adequacao': 'Adequação', 'Pavimentacao': 'Pavimentação'}
for classe, acao, comp, geom in c.execute('select class, acao, st_length_, geom from zoneamento_hierarquia_viaria_marica_1_ order by fid'):
    lv.append(f"  ({s(CLASSE.get(classe, classe))}, {s(ACAO.get(acao, acao))}, {n(comp)}, " +
              carga_geom('MultiLineString').format(h=wkb_hex(geom)) + ')')

sql = CABECALHO.format(arq='07d_zoneamento.sql', descr='Macrozoneamento de Maricá — Lei Complementar nº 400, de 17/01/2025 (Plano Diretor).\n-- Três tabelas: aux_zoneamento (94 polígonos: 10 macrozonas + áreas especiais),\n-- aux_zoneamento_pontos (13 áreas especiais de interesse pesqueiro/indígena) e\n-- aux_zoneamento_viario (127 trechos da hierarquia viária). Tolerância web: 2 m.') + """
create table if not exists public.aux_zoneamento (
  id        serial primary key,
  zona      text not null,       -- classificação (campo "zona" do arquivo)
  nome      text,                -- rótulo (campo "nome")
  sigla     text,                -- sigla usada no rótulo das macrozonas
  tipo      text not null check (tipo in ('macrozona', 'area_especial')),
  ordem     smallint not null,   -- ordem de desenho e da legenda
  geom      geometry(MultiPolygon, 31983) not null,
  geom_web  geometry(MultiPolygon, 4326)
);
truncate public.aux_zoneamento restart identity;

insert into public.aux_zoneamento (zona, nome, sigla, tipo, ordem, geom) values
""" + ',\n'.join(lp) + """;

create table if not exists public.aux_zoneamento_pontos (
  id        serial primary key,
  nome      text not null,       -- rótulo (campo "Name")
  categoria text not null,       -- classificação (campo "FolderPath")
  geom      geometry(Point, 31983) not null,
  geom_web  geometry(Point, 4326)
);
truncate public.aux_zoneamento_pontos restart identity;

-- Os pontos vêm com coordenada Z (KML): ST_Force2D descarta a altitude.
insert into public.aux_zoneamento_pontos (nome, categoria, geom) values
""" + ',\n'.join(lpt) + """;

create table if not exists public.aux_zoneamento_viario (
  id          serial primary key,
  classe      text not null,     -- Estruturantes | Primárias | Secundárias | Coletoras | Via parque
  acao        text,              -- Adequação | Abertura | Pavimentação
  extensao_m  numeric(12,2),
  geom        geometry(MultiLineString, 31983) not null,
  geom_web    geometry(MultiLineString, 4326)
);
truncate public.aux_zoneamento_viario restart identity;

insert into public.aux_zoneamento_viario (classe, acao, extensao_m, geom) values
""" + ',\n'.join(lv) + ';\n' + geom_web('aux_zoneamento', 2, 'MultiPolygon') + geom_web('aux_zoneamento_pontos', 0, 'Point') + \
      geom_web('aux_zoneamento_viario', 2, 'MultiLineString') + rls('aux_zoneamento') + rls('aux_zoneamento_pontos') + \
      rls('aux_zoneamento_viario') + FUNCAO + """
-- ------------------------------------------------------------- conferência
-- Esperado: poligonos 94 · pontos 13 · trechos_viarios 127 · geom_invalidas 0
select (select count(*) from public.aux_zoneamento)          as poligonos,
       (select count(*) from public.aux_zoneamento_pontos)   as pontos,
       (select count(*) from public.aux_zoneamento_viario)   as trechos_viarios,
       (select count(*) from public.aux_zoneamento where not ST_IsValid(geom)) as geom_invalidas,
       (select count(*) from public.aux_zoneamento where geom_web is null or ST_IsEmpty(geom_web)) as sem_geom_web;

-- Polígonos por zona (esperado: AEIS 58, Orla 9 ...)
select ordem, sigla, zona, count(*) as poligonos, round((sum(ST_Area(geom)) / 1e4)::numeric, 1) as area_ha
  from public.aux_zoneamento group by ordem, sigla, zona order by ordem;
"""
gravar('07d_zoneamento.sql', sql)
