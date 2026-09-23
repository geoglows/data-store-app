import * as hp from "hyparquet";
import {compressors} from "hyparquet-compressors";
import {geojsonToWkb, parquetWriteBuffer} from "hyparquet-writer";

/**
 * Cut the rows of one region's GeoParquet file that belong to a selection, and write them back out
 * as GeoParquet 1.1 with WKB geometry.
 *
 * The region files are sorted on riverIndex with statistics on every row group, so a selection —
 * a list of riverIndex runs — only reads the row groups it overlaps. A file without a riverIndex
 * column (the confluences) is matched on riverId instead: the ids of the selected reaches are read
 * from the streams file first (`joinUrl`) and every row group whose id range could hold one is read.
 *
 * Messages in:  {url, spans: [{lo, hi}], joinUrl?}
 * Messages out: {type: "progress", pct} · {type: "done", buffer, rows} · {type: "error", message}
 */

const post = (type, extra) => self.postMessage({type, ...extra});

function topLevelColumns(schema) {
  const out = [];
  let pos = 1;
  const consume = () => {
    const node = schema[pos++];
    for (let k = 0; k < (node.num_children ?? 0); k++) consume();
    return node;
  };
  while (pos < schema.length) out.push(consume());
  return out;
}

function rowGroupSpan(rg) {
  let lo = Infinity, hi = 0;
  for (const c of rg.columns) {
    const m = c.meta_data;
    if (!m) continue;
    const s = Number(m.dictionary_page_offset ?? m.data_page_offset);
    const e = s + Number(m.total_compressed_size);
    if (s < lo) lo = s;
    if (e > hi) hi = e;
  }
  return [lo, hi];
}

const statsOf = (rg, column) => {
  const st = rg.columns.find(c => c.meta_data.path_in_schema[0] === column)?.meta_data?.statistics;
  const lo = st?.min_value ?? st?.min;
  const hi = st?.max_value ?? st?.max;
  return lo == null || hi == null ? null : [Number(lo), Number(hi)];
};

const NATIVE_GEOMETRY_TYPES = {
  point: "Point", linestring: "LineString", polygon: "Polygon",
  multipoint: "MultiPoint", multilinestring: "MultiLineString", multipolygon: "MultiPolygon"
};
const nativeCoords = v => (Array.isArray(v) ? v.map(nativeCoords) : (v.z == null ? [v.x, v.y] : [v.x, v.y, v.z]));

function asGeoJson(value, nativeType) {
  if (value == null) return null;
  if (!Array.isArray(value)) {
    // A WKB source decodes to GeoJSON already; a native point is a bare {x, y} struct.
    if (value.type && value.coordinates) return value;
    return typeof value.x === "number" ? {type: "Point", coordinates: nativeCoords(value)} : null;
  }
  if (!nativeType) return null;
  return {type: nativeType, coordinates: nativeCoords(value)};
}

function scanGeometry(g, acc, types) {
  if (!g?.coordinates) return;
  types.add(g.type);
  const walk = c => {
    if (typeof c[0] === "number") {
      if (c[0] < acc[0]) acc[0] = c[0];
      if (c[1] < acc[1]) acc[1] = c[1];
      if (c[0] > acc[2]) acc[2] = c[0];
      if (c[1] > acc[3]) acc[3] = c[1];
    } else for (const sub of c) walk(sub);
  };
  walk(g.coordinates);
}

const writerType = el =>
  el.type === "BYTE_ARRAY" ? (el.converted_type === "UTF8" || el.logical_type?.type === "STRING" ? "STRING" : "BYTE_ARRAY") : el.type;

/**
 * Read every row of `url` whose `column` passes `keep`, only touching row groups `mayHold` admits.
 * Progress is reported over [pctFrom, pctTo].
 */
async function readRows(url, {columns, column, keep, mayHold, pctFrom = 0, pctTo = 100}) {
  const file = await hp.asyncBufferFromUrl({url}).catch(() => null);
  if (!file) throw new Error(`${url.split("/").pop()} could not be opened`);
  const md = await hp.parquetMetadataAsync(file);
  const schemaCols = topLevelColumns(md.schema);
  const cols = columns ?? schemaCols.map(s => s.name);
  const ci = cols.indexOf(column);
  if (ci < 0) throw new Error(`${url.split("/").pop()} has no ${column} column`);

  const picked = [];
  let row = 0;
  for (const rg of md.row_groups) {
    const n = Number(rg.num_rows);
    const st = statsOf(rg, column);
    if (!st || mayHold(st[0], st[1])) picked.push({start: row, end: row + n, span: rowGroupSpan(rg)});
    row += n;
  }

  const kept = [];
  for (let i = 0; i < picked.length; i++) {
    const g = picked[i];
    const [lo, hi] = g.span;
    const buf = await file.slice(lo, hi);
    const view = {
      byteLength: file.byteLength,
      slice: (s, e = file.byteLength) => (s >= lo && e <= hi ? buf.slice(s - lo, e - lo) : file.slice(s, e))
    };
    await new Promise((resolve, reject) => {
      hp.parquetRead({
        file: view, metadata: md, compressors, columns: cols, rowFormat: "array", utf8: false,
        rowStart: g.start, rowEnd: g.end,
        onComplete: rows => {
          for (const r of rows) if (keep(r[ci])) kept.push(r);
          resolve();
        }
      }).catch(reject);
    });
    post("progress", {pct: pctFrom + (pctTo - pctFrom) * (i + 1) / picked.length});
  }
  return {rows: kept, cols, schemaCols, md};
}

self.onmessage = async (e) => {
  const {url, spans, joinUrl} = e.data;
  try {
    // TODO: move to the package once it publishes span predicates; it has no contains/overlaps.
    const inSpans = ix => spans.some(s => ix >= s.lo && ix <= s.hi);
    const overlapsSpans = (lo, hi) => spans.some(s => hi >= s.lo && lo <= s.hi);

    let column = "riverIndex";
    let keep = v => inSpans(Number(v));
    let mayHold = overlapsSpans;
    let from = 0;

    if (joinUrl) {
      const ids = await readRows(joinUrl, {
        columns: ["riverId", "riverIndex"], column: "riverIndex", keep: v => inSpans(Number(v)), mayHold: overlapsSpans, pctTo: 40
      });
      const set = new Set(ids.rows.map(r => Number(r[0])));
      const sorted = [...set].sort((a, b) => a - b);
      column = "riverId";
      keep = v => set.has(Number(v));
      // A row group can hold a selected id if any id falls inside its [min, max].
      mayHold = (lo, hi) => {
        let a = 0, b = sorted.length;
        while (a < b) {
          const m = (a + b) >> 1;
          if (sorted[m] < lo) a = m + 1;
          else b = m;
        }
        return a < sorted.length && sorted[a] <= hi;
      };
      from = 40;
    }

    const {rows, cols, schemaCols, md} = await readRows(url, {column, keep, mayHold, pctFrom: from, pctTo: 90});

    const srcGeo = md.key_value_metadata?.find(k => k.key === "geo")?.value;
    const geo = srcGeo ? JSON.parse(srcGeo) : {version: "1.1.0", primary_column: "geometry", columns: {}};
    const primary = geo.primary_column || "geometry";
    const gcol = geo.columns[primary] || (geo.columns[primary] = {});
    const nativeType = NATIVE_GEOMETRY_TYPES[String(gcol.encoding ?? "").toLowerCase()] ?? null;
    const gi = cols.indexOf(primary);

    const bbox = [Infinity, Infinity, -Infinity, -Infinity];
    const types = new Set();
    const wkb = rows.map(r => {
      const g = asGeoJson(r[gi], nativeType);
      if (!g) return null;
      scanGeometry(g, bbox, types);
      return geojsonToWkb(g);
    });
    gcol.encoding = "WKB";
    gcol.geometry_types = [...types].sort();
    if (Number.isFinite(bbox[0])) gcol.bbox = bbox;
    geo.version = "1.1.0";

    const columnData = cols.map((name, i) => {
      if (i === gi) return {name, data: wkb, type: "BYTE_ARRAY"};
      const el = schemaCols[i];
      let data = rows.map(r => r[i]);
      // Nested non-geometry columns (the confluences' upstream_ids) are written as JSON text: the
      // writer cannot build a LIST schema from values.
      if (el.num_children) {
        return {name, data: data.map(v => (v == null ? null : JSON.stringify(v, (_, x) => (typeof x === "bigint" ? Number(x) : x)))), type: "STRING"};
      }
      const type = writerType(el);
      if (type === "INT32") data = data.map(v => (v == null ? null : Number(v)));
      return {name, data, type};
    });

    const out = parquetWriteBuffer({
      columnData,
      kvMetadata: [{key: "geo", value: JSON.stringify(geo)}],
      codec: "SNAPPY",
      rowGroupSize: 10000
    });
    const buffer = out.buffer ? out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) : out;
    post("progress", {pct: 100});
    self.postMessage({type: "done", buffer, rows: rows.length}, [buffer]);
  } catch (err) {
    post("error", {message: err.message});
  }
};
