import {spanCount} from "riverforecastsystem/v3/hydrography";
import {FetchStore, get, open, slice} from "zarrita";
import {zipStore} from "./zip.js";

/**
 * Cut a subset out of a v3 Zarr store and hand it back as a zipped Zarr v3 store.
 *
 * A selection is a list of riverIndex runs, and every run is a contiguous slice of the store's
 * `riverId` axis — read in batches aligned to the store's outer chunks so one batch is one shard.
 * Which axis that is comes off `dimension_names` rather than being assumed: v3 publishes
 * `(riverId, time)` and earlier stores `(time, riverId)`, and both read the same way here. `time`,
 * where present, is cut to the requested range; every other dimension (member, percentiles,
 * recurrence_interval, p_exceed) is kept whole.
 *
 * The output has the same variables, dimension names and attributes, plus `riverIndex` beside
 * `riverId` so a subset can be joined back to the hydrography. Chunks are written uncompressed so
 * any Zarr v3 reader opens it without a codec registry.
 */

const BATCH_ALIGN = 250;
const OUT_CHUNK_BYTES = 16e6;

const joinUrl = (base, path) => `${base.replace(/\/+$/, "")}/${path}`;

/** The group's own zarr.json, which on a consolidated store also carries every array's metadata. */
const groupMetas = new Map();
const groupMeta = (storeUrl) => {
  if (!groupMetas.has(storeUrl)) {
    groupMetas.set(storeUrl, fetch(joinUrl(storeUrl, "zarr.json"))
      .then(r => (r.ok ? r.json() : null))
      .catch(() => null));
  }
  return groupMetas.get(storeUrl);
};

/**
 * One array's metadata. The per-array zarr.json is asked for first; a store that only publishes
 * consolidated metadata answers out of the group's.
 */
async function metadata(storeUrl, name) {
  const resp = await fetch(joinUrl(storeUrl, `${name}/zarr.json`)).catch(() => null);
  if (resp?.ok) return resp.json();
  const group = await groupMeta(storeUrl);
  return group?.consolidated_metadata?.metadata?.[name] ?? null;
}

const openArray = (storeUrl, name) => open.v3(new FetchStore(joinUrl(storeUrl, name)), {kind: "array"});

const TYPED = {float32: Float32Array, float64: Float64Array, int32: Int32Array, int64: BigInt64Array, int16: Int16Array, uint32: Uint32Array};

/** Parse "<unit> since <iso>" into a function from stored value to epoch ms. */
function timeDecoder(units) {
  const [unit, origin] = units.split("since").map(s => s.trim());
  const factor = {seconds: 1e3, minutes: 6e4, hours: 3.6e6, days: 8.64e7}[unit];
  const epoch = new Date(origin).getTime();
  if (!factor || Number.isNaN(epoch)) throw new Error(`Unrecognized time units: ${units}`);
  return v => epoch + Number(v) * factor;
}

/** The store's time axis: raw values, decoded dates, and the attributes to carry over. */
export async function readTimeAxis(storeUrl) {
  const meta = await metadata(storeUrl, "time");
  if (!meta) return null;
  const arr = await openArray(storeUrl, "time");
  const {data} = await get(arr, [null]);
  const decode = timeDecoder(meta.attributes.units);
  const ms = Array.from(data, decode);
  return {raw: data, ms, attrs: meta.attributes, dataType: meta.data_type};
}

/** Whether the store holds `name`, and its metadata if so. */
export const variableMeta = (storeUrl, name) => metadata(storeUrl, name);

/** [start, stop) positions on the time axis covering the inclusive date range. */
export function timeWindow(axis, {start, end}) {
  const lo = start ? Date.parse(`${start}T00:00:00Z`) : -Infinity;
  const hi = end ? Date.parse(`${end}T00:00:00Z`) + 8.64e7 : Infinity;
  let t0 = axis.ms.findIndex(t => t >= lo);
  if (t0 < 0) t0 = axis.ms.length;
  let t1 = t0;
  while (t1 < axis.ms.length && axis.ms[t1] < hi) t1++;
  return [t0, t1];
}

/**
 * Read `variables` for the rivers in `spans` and the steps in `window`.
 *
 * @returns {Promise<Blob>} the zipped store
 */
export async function subsetZarr({storeUrl, variables, spans, timeRange, derive, coords = [], attrs = {}, onProgress, signal}) {
  const N = spanCount(spans);
  const storeGroup = await groupMeta(storeUrl);

  const metas = {};
  for (const v of variables) {
    metas[v] = await metadata(storeUrl, v);
    if (!metas[v]) throw new Error(`${v} is not in ${storeUrl}`);
  }
  // A store whose riverId axis is shorter than the selection is not the store the selection was made
  // against — a sample or a partial publication. Said here, where it can name both numbers, rather
  // than as an empty read further down.
  const riverIdMeta = await metadata(storeUrl, "riverId");
  const axisLength = riverIdMeta?.shape?.[0] ?? 0;
  const beyond = spans.filter(s => s.hi >= axisLength);
  if (beyond.length) {
    throw new Error(`This store covers ${axisLength.toLocaleString()} rivers, and the selection reaches riverIndex ${Math.max(...beyond.map(s => s.hi)).toLocaleString()}.`);
  }

  const needsTime = Object.values(metas).some(m => m.dimension_names?.includes("time"));
  const axis = needsTime ? await readTimeAxis(storeUrl) : null;
  const [t0, t1] = axis ? timeWindow(axis, timeRange ?? {}) : [0, 0];
  if (axis && t1 <= t0) throw new Error("The time range selects no time steps in this dataset.");

  // ── progress: one tick per river batch per variable, plus the coordinates ──
  const batches = [];
  for (const s of spans) {
    let lo = s.lo;
    while (lo <= s.hi) {
      const hi = Math.min(s.hi, (Math.floor(lo / BATCH_ALIGN) + 1) * BATCH_ALIGN - 1);
      batches.push({lo, hi});
      lo = hi + 1;
    }
  }
  const totalTicks = batches.length * (variables.length + 1) + 1;
  let ticks = 0;
  const tick = () => onProgress?.(++ticks / totalTicks);
  const check = () => {
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
  };

  // ── riverId and riverIndex for the selection ──
  const riverIdArr = await openArray(storeUrl, "riverId");
  const riverId = new Int32Array(N);
  const riverIndex = new Int32Array(N);
  {
    let off = 0;
    for (const b of batches) {
      check();
      const {data} = await get(riverIdArr, [slice(b.lo, b.hi + 1)]);
      riverId.set(Int32Array.from(data, Number), off);
      for (let i = 0; i <= b.hi - b.lo; i++) riverIndex[off + i] = b.lo + i;
      off += b.hi - b.lo + 1;
      tick();
    }
  }

  // ── each variable, batch by batch, into one C-order array the shape of the subset ──
  const out = {};
  for (const v of variables) {
    const meta = metas[v];
    const dims = meta.dimension_names;
    const axis = dims.indexOf("riverId");
    if (axis < 0) throw new Error(`${v}: has no riverId dimension (${dims.join(", ")})`);
    const arr = await openArray(storeUrl, v);
    const shape = dims.map((d, i) => (d === "riverId" ? N : d === "time" ? t1 - t0 : meta.shape[i]));
    // Everything before the river axis is copied block by block; everything after it rides along
    // inside each block, so one memcpy per outer position per batch whichever axis riverId is on.
    const outer = shape.slice(0, axis).reduce((a, b) => a * b, 1);
    const inner = shape.slice(axis + 1).reduce((a, b) => a * b, 1);
    const Typed = TYPED[meta.data_type] ?? Float32Array;
    const data = new Typed(outer * N * inner);
    let off = 0;
    for (const b of batches) {
      check();
      const nb = b.hi - b.lo + 1;
      const sel = dims.map(d => (d === "riverId" ? slice(b.lo, b.hi + 1) : d === "time" ? slice(t0, t1) : null));
      const chunk = await get(arr, sel);
      for (let o = 0; o < outer; o++) {
        data.set(chunk.data.subarray(o * nb * inner, (o + 1) * nb * inner), (o * N + off) * inner);
      }
      off += nb;
      tick();
    }
    out[v] = {data, shape, dims, dataType: meta.data_type, attrs: meta.attributes ?? {}, fill: meta.fill_value};
  }

  // ── derived variables (the simplified forecast when the store has no summaries) ──
  if (derive) {
    for (const [k, v] of Object.entries(derive(out))) {
      if (v === undefined) delete out[k];
      else out[k] = v;
    }
  }

  // ── coordinates: time cut to the window, every other non-river dimension whole ──
  const out_coords = {};
  if (axis) {
    out_coords.time = {data: axis.raw.slice(t0, t1), shape: [t1 - t0], dims: ["time"], dataType: axis.dataType, attrs: axis.attrs, fill: 0};
    // Coordinates that ride on the time axis without being dimensions — the forecasts' lead_time.
    // Named by the caller rather than probed for, so a store that has none is not asked.
    for (const name of coords) {
      const meta = await metadata(storeUrl, name);
      if (!meta) continue;
      const {data} = await get(await openArray(storeUrl, name), [slice(t0, t1)]);
      out_coords[name] = {data, shape: [t1 - t0], dims: ["time"], dataType: meta.data_type, attrs: meta.attributes ?? {}, fill: 0};
    }
  }
  const otherDims = new Set(Object.values(out).flatMap(o => o.dims).filter(d => d !== "riverId" && d !== "time"));
  for (const d of otherDims) {
    if (out_coords[d] || out[d]) continue;
    const m = await metadata(storeUrl, d);
    if (!m) continue;
    const {data} = await get(await openArray(storeUrl, d), [null]);
    out_coords[d] = {data, shape: m.shape, dims: m.dimension_names ?? [d], dataType: m.data_type, attrs: m.attributes ?? {}, fill: m.fill_value};
  }
  out_coords.riverId = {data: riverId, shape: [N], dims: ["riverId"], dataType: "int32", attrs: {long_name: "River reach identifier"}, fill: 0};
  out_coords.riverIndex = {data: riverIndex, shape: [N], dims: ["riverId"], dataType: "int32", attrs: {long_name: "Position on the source store's riverId axis"}, fill: 0};
  tick();

  return writeZarrZip({
    arrays: {...out_coords, ...out},
    attributes: {
      ...(storeGroup?.attributes ?? {}),
      ...attrs,
      source: storeUrl,
      subset_created: new Date().toISOString()
    }
  });
}

// ── writing ────────────────────────────────────────────────────────────────

function arrayMeta({shape, dims, dataType, attrs, fill}, chunkShape) {
  const isFloat = dataType.startsWith("float");
  return {
    zarr_format: 3,
    node_type: "array",
    shape,
    data_type: dataType,
    chunk_grid: {name: "regular", configuration: {chunk_shape: chunkShape}},
    chunk_key_encoding: {name: "default", configuration: {separator: "/"}},
    fill_value: isFloat ? (fill === undefined || fill === null || Number.isNaN(Number(fill)) ? "NaN" : fill) : (fill ?? 0),
    codecs: [{name: "bytes", configuration: {endian: "little"}}],
    attributes: attrs,
    dimension_names: dims
  };
}

/** Split a C-order array along `axis` into chunks of `width`, padding the edge chunk. */
function* axisChunks(data, shape, axis, width, fillValue) {
  const n = shape[axis];
  const outer = shape.slice(0, axis).reduce((a, b) => a * b, 1);
  const inner = shape.slice(axis + 1).reduce((a, b) => a * b, 1);
  const Typed = data.constructor;
  for (let c = 0, k = 0; c < n; c += width, k++) {
    const len = Math.min(width, n - c);
    const chunk = new Typed(outer * width * inner);
    if (len < width && fillValue !== 0 && !Number.isNaN(fillValue)) chunk.fill(fillValue);
    else if (len < width && Number.isNaN(fillValue)) chunk.fill(NaN);
    for (let o = 0; o < outer; o++) {
      chunk.set(data.subarray((o * n + c) * inner, (o * n + c + len) * inner), o * width * inner);
    }
    yield {k, chunk};
  }
}

function writeZarrZip({arrays, attributes}) {
  const entries = [{name: "zarr.json", data: JSON.stringify({zarr_format: 3, node_type: "group", attributes}, null, 2)}];
  for (const [name, a] of Object.entries(arrays)) {
    // Chunked along the river axis, the way the source stores are: one chunk is a run of rivers with
    // everything else about them whole. An array with no river axis is small and goes in one chunk.
    const axis = Math.max(0, a.dims.indexOf("riverId"));
    const n = a.shape[axis];
    const perSlice = (a.shape.reduce((x, y) => x * y, 1) / Math.max(1, n)) * a.data.BYTES_PER_ELEMENT;
    const width = a.dims.includes("riverId")
      ? Math.max(1, Math.min(n, Math.floor(OUT_CHUNK_BYTES / Math.max(1, perSlice))))
      : n;
    const chunkShape = a.shape.map((s, i) => (i === axis ? width : s));
    entries.push({name: `${name}/zarr.json`, data: JSON.stringify(arrayMeta(a, chunkShape), null, 2)});
    const fill = a.dataType.startsWith("float") ? NaN : 0;
    for (const {k, chunk} of axisChunks(a.data, a.shape, axis, width, fill)) {
      // Only the chunked axis has more than one index; every other one is 0.
      const key = a.shape.map((_, i) => (i === axis ? k : 0)).join("/");
      entries.push({name: `${name}/c/${key}`, data: chunk});
    }
  }
  return zipStore(entries);
}

// ── the simplified forecast, computed from the members ─────────────────────

export const PERCENTILES = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

/**
 * Qpercentiles and Qmean from Q, for a store published without the summaries. Works whichever axis
 * order the store carries — the member axis is found by name and the other two are kept as they
 * are. Percentiles interpolate linearly between order statistics, as numpy's default does.
 */
export function summarizeMembers({Q}) {
  const dims = Q.dims;
  const mAxis = dims.indexOf("member");
  if (mAxis < 0 || dims.length !== 3) throw new Error(`Q must have a member dimension and three axes, got (${dims.join(", ")})`);
  const M = Q.shape[mAxis];
  // The two axes that survive, in the order the source carries them — (riverId, time) in v3, and
  // (time, riverId) in the stores written before the axes were swapped.
  const keep = dims.map((d, i) => i).filter(i => i !== mAxis);
  const [a0, a1] = keep;
  const n0 = Q.shape[a0];
  const n1 = Q.shape[a1];
  const srcStride = strides(Q.shape);

  const pctShape = Q.shape.map((s, i) => (i === mAxis ? PERCENTILES.length : s));
  const pctDims = dims.map(d => (d === "member" ? "percentiles" : d));
  const pctStride = strides(pctShape);
  const meanShape = [n0, n1];
  const meanDims = [dims[a0], dims[a1]];
  const meanStride = strides(meanShape);

  const pct = new Float32Array(pctShape.reduce((x, y) => x * y, 1));
  const mean = new Float32Array(n0 * n1);
  const col = new Float32Array(M);

  for (let i0 = 0; i0 < n0; i0++) {
    for (let i1 = 0; i1 < n1; i1++) {
      const base = i0 * srcStride[a0] + i1 * srcStride[a1];
      let sum = 0;
      for (let m = 0; m < M; m++) {
        const v = Q.data[base + m * srcStride[mAxis]];
        col[m] = v;
        sum += v;
      }
      col.sort();
      mean[i0 * meanStride[0] + i1 * meanStride[1]] = sum / M;
      const pctBase = i0 * pctStride[a0] + i1 * pctStride[a1];
      for (let p = 0; p < PERCENTILES.length; p++) {
        const pos = (PERCENTILES[p] / 100) * (M - 1);
        const lo = Math.floor(pos);
        const hi = Math.min(M - 1, lo + 1);
        pct[pctBase + p * pctStride[mAxis]] = col[lo] + (col[hi] - col[lo]) * (pos - lo);
      }
    }
  }

  const attrs = {...Q.attrs};
  delete attrs.long_name;
  return {
    Q: undefined,
    percentiles: {data: Int32Array.from(PERCENTILES), shape: [PERCENTILES.length], dims: ["percentiles"], dataType: "int32", attrs: {units: "percent"}, fill: 0},
    Qpercentiles: {data: pct, shape: pctShape, dims: pctDims, dataType: "float32", attrs: {...attrs, long_name: "Ensemble discharge percentiles"}, fill: "NaN"},
    Qmean: {data: mean, shape: meanShape, dims: meanDims, dataType: "float32", attrs: {...attrs, long_name: "Ensemble mean discharge"}, fill: "NaN"}
  };
}

/** Row-major strides for a shape, in elements. */
function strides(shape) {
  const out = new Array(shape.length);
  let step = 1;
  for (let i = shape.length - 1; i >= 0; i--) {
    out[i] = step;
    step *= shape[i];
  }
  return out;
}
