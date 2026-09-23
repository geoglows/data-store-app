import {spanCount} from "riverforecastsystem/v3/hydrography";
import {MAX_BROWSER_MB, V3_BASE, regionFile, storeReadUrl, storeUrl, toS3} from "../data/sources.js";
import {regionRuns} from "../data/regions.js";
import {subsetZarr, summarizeMembers, variableMeta} from "./zarrSubset.js";
import {zipStore} from "./zip.js";
import {saveBlob} from "./save.js";

/**
 * A download request: what the form and the map say, turned into what to read, how big it will be,
 * how to run it in the browser, and how to fetch the same thing with a command line tool.
 */

// Rough GeoParquet bytes per row, for the size estimate before anything is read.
const BYTES_PER_FEATURE = {streams: 450, catchments: 2600, confluences: 90, lakes: 3000};

export const RETURN_PERIOD_VARIABLES = (form) => [
  ...form.distributions.flatMap(dist => form.series.map(s => `${dist}_${s}`)),
  ...(form.maxSimulated ? form.series.map(s => `max_simulated_${s}`) : [])
];

/** The data variables a request reads from its store. */
export function variablesFor(d, form) {
  if (d.kind === "forecast") return form.product === "ensemble" ? ["Q"] : ["Qpercentiles", "Qmean"];
  if (d.store === "fdc") return form.series.map(x => `${x}_annual`);
  if (d.kind === "static") return RETURN_PERIOD_VARIABLES(form);
  return [d.variable ?? "Q"];
}

/** Time steps a request covers, from the store's own axis when it has been read. */
function stepCount(d, form, axis) {
  if (d.kind === "forecast") return d.steps;
  if (d.kind === "static") return 1;
  if (axis && form.start && form.end) {
    const lo = Date.parse(`${form.start}T00:00:00Z`);
    const hi = Date.parse(`${form.end}T00:00:00Z`) + 8.64e7;
    return axis.ms.filter(t => t >= lo && t < hi).length;
  }
  if (!form.start || !form.end) return 0;
  const hours = (Date.parse(form.end) - Date.parse(form.start)) / 3.6e6 + 24;
  return Math.max(0, Math.ceil(hours / d.stepHours));
}

export function buildRequest(d, form, sel, axis) {
  const reaches = sel.mode === "global" ? spanCount(regionRuns() ?? []) : sel.count;
  const variables = d.kind === "hydrography" ? [] : variablesFor(d, form);
  let bytes;
  if (d.kind === "hydrography") {
    bytes = reaches * BYTES_PER_FEATURE[d.layer];
  } else if (d.store === "fdc") {
    // 101 whole percents on the p_exceed axis.
    bytes = reaches * 4 * 101 * form.series.length;
  } else if (d.kind === "static") {
    const fits = form.distributions.length * form.series.length;
    bytes = reaches * 4 * (fits * d.recurrenceIntervals.length + (form.maxSimulated ? form.series.length : 0));
  } else {
    const T = stepCount(d, form, axis);
    const perStep = d.kind === "forecast" ? (form.product === "ensemble" ? d.members : 12) : 1;
    bytes = reaches * T * perStep * 4;
  }
  const problems = [];
  if (sel.empty) problems.push("area");
  if (d.kind === "timeseries" && !(form.start && form.end && form.start <= form.end)) problems.push("time");
  if (d.kind === "forecast" && (!form.date || form.available === false)) problems.push("date");
  if (d.kind === "static" && !variables.length) problems.push("variables");
  if (bytes > MAX_BROWSER_MB * 1e6) problems.push("size");

  return {
    dataset: d,
    form: {...form},
    mode: sel.mode,
    spans: sel.spans,
    regions: sel.regions,
    reaches,
    variables,
    bytes,
    problems,
    valid: !problems.length
  };
}

export function requestJson(req) {
  const d = req.dataset;
  const out = {
    dataset: `${d.version}/${d.category}/${d.id}`,
    area: {
      mode: req.mode,
      reaches: req.reaches,
      regions: req.regions,
      riverIndexRanges: req.mode === "global" ? "all" : req.spans.map(s => [s.lo, s.hi])
    }
  };
  if (d.kind === "timeseries") out.time = {start: req.form.start, end: req.form.end};
  if (d.kind === "forecast") Object.assign(out, {initialization: req.form.date, product: req.form.product});
  if (req.variables.length) out.variables = req.variables;
  out.format = d.kind === "hydrography" ? "geoparquet" : "zarr";
  return JSON.stringify(out, null, 2);
}

const stamp = s => (s ?? "").replaceAll("-", "");

function fileName(req) {
  const d = req.dataset;
  const where = req.mode === "global" ? "global" : `${req.reaches}rivers`;
  const when = d.kind === "timeseries" && req.form.start && req.form.end ? `_${stamp(req.form.start)}-${stamp(req.form.end)}`
    : d.kind === "forecast" ? `_${stamp(req.form.date)}_${req.form.product}` : "";
  return `rfs-${d.version}_${d.id}${when}_${where}`;
}

// ── running a request in the browser ───────────────────────────────────────

function runWorker(msg, onProgress, signal) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./hydrographyWorker.js", import.meta.url), {type: "module"});
    const stop = () => {
      worker.terminate();
      reject(new DOMException("Cancelled", "AbortError"));
    };
    signal?.addEventListener("abort", stop, {once: true});
    worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === "progress") return onProgress?.(m.pct / 100);
      signal?.removeEventListener("abort", stop);
      worker.terminate();
      if (m.type === "done") resolve(m);
      else reject(new Error(m.message));
    };
    worker.onerror = (err) => {
      worker.terminate();
      reject(new Error(err.message || "The subsetting worker failed"));
    };
    worker.postMessage(msg);
  });
}

async function fetchWhole(url, onProgress, signal) {
  const resp = await fetch(url, {signal});
  if (!resp.ok) throw new Error(`${resp.status} for ${url.split("/").pop()}`);
  const total = Number(resp.headers.get("content-length")) || 0;
  const reader = resp.body.getReader();
  const parts = [];
  let got = 0;
  for (;;) {
    const {done, value} = await reader.read();
    if (done) break;
    parts.push(value);
    got += value.length;
    if (total) onProgress?.(got / total);
  }
  return new Blob(parts);
}

async function runHydrography(req, {onProgress, signal}) {
  const d = req.dataset;
  const runs = regionRuns() ?? [];
  const byRegion = new Map();
  for (const s of req.spans) {
    if (!byRegion.has(s.region)) byRegion.set(s.region, []);
    byRegion.get(s.region).push({lo: s.lo, hi: s.hi});
  }
  const files = [];
  let i = 0;
  for (const [region, spans] of byRegion) {
    const part = p => onProgress?.((i + p) / byRegion.size);
    const url = regionFile(d, region);
    const run = runs.find(r => r.region === region);
    const whole = run && spans.length === 1 && spans[0].lo === run.lo && spans[0].hi === run.hi;
    const name = url.split("/").pop();
    if (whole) {
      files.push({name, data: new Uint8Array(await (await fetchWhole(url, part, signal)).arrayBuffer())});
    } else {
      const msg = {url, spans, joinUrl: d.joinOn === "riverId" ? regionFile({layer: "streams"}, region) : null};
      const {buffer} = await runWorker(msg, part, signal);
      files.push({name: name.replace(".geo.parquet", "_subset.geo.parquet"), data: new Uint8Array(buffer)});
    }
    i++;
  }
  if (files.length === 1) {
    return {blob: new Blob([files[0].data], {type: "application/vnd.apache.parquet"}), name: `${fileName(req)}.geo.parquet`};
  }
  return {blob: zipStore(files), name: `${fileName(req)}.zip`};
}

async function runZarr(req, {onProgress, signal}) {
  const d = req.dataset;
  const url = storeReadUrl(d, {date: req.form.date});
  let variables = req.variables;
  let derive = null;
  // Stores published before the ensemble summaries existed get them computed from the members.
  if (d.kind === "forecast" && req.form.product !== "ensemble" && !(await variableMeta(url, "Qpercentiles"))) {
    variables = ["Q"];
    derive = summarizeMembers;
  }
  const blob = await subsetZarr({
    storeUrl: url,
    variables,
    spans: req.spans,
    timeRange: d.kind === "timeseries" ? {start: req.form.start, end: req.form.end} : null,
    derive,
    // lead_time rides on the forecasts' time axis and exists nowhere else.
    coords: d.kind === "forecast" ? ["lead_time"] : [],
    attrs: {rfs_dataset: `${d.version}/${d.category}/${d.id}`, license: d.license.short},
    onProgress,
    signal
  });
  return {blob, name: `${fileName(req)}.zarr.zip`};
}

export async function runRequest(req, opts) {
  const {blob, name} = req.dataset.kind === "hydrography" ? await runHydrography(req, opts) : await runZarr(req, opts);
  saveBlob(blob, name);
  return {name, size: blob.size};
}

// ── doing it yourself ──────────────────────────────────────────────────────

/** Paths under a Zarr store that hold what a request reads. */
function zarrPaths(req) {
  const d = req.dataset;
  const vars = new Set(["zarr.json", "riverId"]);
  if (d.kind !== "static") vars.add("time");
  if (d.kind === "forecast") {
    vars.add("lead_time");
    if (req.form.product === "ensemble") ["Q", "member"].forEach(v => vars.add(v));
    else ["Qpercentiles", "Qmean", "percentiles"].forEach(v => vars.add(v));
  } else if (d.store === "fdc") {
    ["p_exceed", ...req.variables].forEach(v => vars.add(v));
  } else if (d.kind === "static") {
    ["recurrence_interval", "annual_exceedance_probability", ...req.variables].forEach(v => vars.add(v));
  } else {
    vars.add(req.variables[0]);
  }
  return [...vars];
}

const pyRanges = spans => spans.map(s => `np.arange(${s.lo}, ${s.hi + 1})`).join(", ");


const jsRuns = spans => spans.map(s => `[${s.lo}, ${s.hi}]`).join(", ");

/**
 * The same request as a few lines of `riverforecastsystem` — the package this app itself reads
 * every byte through. The readers take one reach at a time, which is what the loop over the
 * selection's riverIndex runs is for.
 */
export function jsExample(req) {
  const d = req.dataset;
  const base = V3_BASE ? `\nconfigure({v3Base: "${V3_BASE}"});\n` : "\n";
  const runs = req.mode === "global" ? "// every reach: read the riverId axis off any store instead"
    : `const runs = [${jsRuns(req.spans)}];   // riverIndex runs from the area of interest`;

  if (d.kind === "hydrography") {
    const regions = req.mode === "global" || !req.regions.length ? ["1020000010"] : req.regions;
    return `import {configure, urls} from "riverforecastsystem/v3";
import {parquetReadObjects, asyncBufferFromUrl, parquetMetadataAsync} from "hyparquet";
import {compressors} from "hyparquet-compressors";
${base}
${runs}
const regions = ${JSON.stringify(regions)};

for (const region of regions) {
  const url = urls.${d.layer === "lakes" ? "hydrographyRegion({region}) + `/lakes_${region}.geo.parquet`" : `${d.layer}Geoparquet({region})`};
  const file = await asyncBufferFromUrl({url});
  const metadata = await parquetMetadataAsync(file);
  const rows = await parquetReadObjects({file, metadata, compressors});
  const wanted = rows.filter(r => runs.some(([lo, hi]) => r.riverIndex >= lo && r.riverIndex <= hi));
  console.log(region, wanted.length);
}`;
  }

  if (d.kind === "forecast") {
    return `import {configure} from "riverforecastsystem/v3";
import {forecast, forecastsBulk} from "riverforecastsystem/v3/discharge";
${base}
${runs}
const riverIndices = runs.flatMap(([lo, hi]) => Array.from({length: hi - lo + 1}, (_, i) => lo + i));

// one reach, with its members and the ensemble statistics
const {time, discharge, stats} = await forecast({date: "${req.form.date}", riverIndex: riverIndices[0]});

// or every selected reach in one pass, median per reach
const {forecasts} = await forecastsBulk({date: "${req.form.date}", riverIndices});`;
  }

  if (d.store === "fdc") {
    const series = req.form.series[0] ?? "hourly";
    return `import {configure, getConfig} from "riverforecastsystem/v3";
// TODO: riverforecastsystem has no flow duration curve reader yet — read the store directly.
import {FetchStore, get, open, slice} from "zarrita";
${base}
${runs}

const url = getConfig().v3Base + "/retrospective/fdc.zarr/${series}_annual";
const fdc = await open.v3(new FetchStore(url), {kind: "array"});
const [[lo, hi]] = runs;
const {data} = await get(fdc, [slice(lo, hi + 1), null]);   // (riverId, p_exceed)`;
  }

  if (d.kind === "static") {
    const series = req.form.series[0] ?? "hourly";
    return `import {configure} from "riverforecastsystem/v3";
import {returnPeriods} from "riverforecastsystem/v3/discharge";
${base}
${runs}

for (const [lo, hi] of runs) {
  for (let riverIndex = lo; riverIndex <= hi; riverIndex++) {
    const thresholds = await returnPeriods({riverIndex, resolution: "${series}"});
    // {1.5: q, 2: q, 5: q, ...} in m3/s
  }
}`;
  }

  const reader = d.store === "maximums"
    ? `const {time, discharge} = await maximums({riverIndex});`
    : `const {time, discharge} = await retrospective({resolution: "${d.resolution}", riverIndex});`;
  const imported = d.store === "maximums" ? "maximums" : "retrospective";
  const window = d.kind === "timeseries" && req.form.start
    ? `\n    const from = Date.parse("${req.form.start}");\n    const to = Date.parse("${req.form.end}") + 864e5;\n    const kept = time.map((t, i) => [t, discharge[i]]).filter(([t]) => t >= from && t < to);`
    : "";
  return `import {configure} from "riverforecastsystem/v3";
import {${imported}} from "riverforecastsystem/v3/discharge";
${base}
${runs}

for (const [lo, hi] of runs) {
  for (let riverIndex = lo; riverIndex <= hi; riverIndex++) {
    ${reader}${window}
  }
}`;
}

export function cliCommands(req) {
  const d = req.dataset;
  if (d.kind === "hydrography") {
    const layer = d.layer;
    const regions = req.mode === "global" || !req.regions.length ? null : req.regions;
    const base = toS3(regionFile(d, "REGION")).replace(/\/region=REGION\/.*$/, "");
    const s5 = regions
      ? regions.map(r => `s5cmd --no-sign-request cp ${toS3(regionFile(d, r))} ./${layer}/`).join("\n")
      : `s5cmd --no-sign-request cp '${base}/region=*/${layer}_*.geo.parquet' ./${layer}/`;
    const aws = regions
      ? regions.map(r => `aws s3 cp --no-sign-request ${toS3(regionFile(d, r))} ./${layer}/`).join("\n")
      : `aws s3 cp --no-sign-request --recursive ${base}/ ./${layer}/ \\\n  --exclude "*" --include "*/${layer}_*.geo.parquet"`;
    const spans = req.mode === "global" ? [] : req.spans;
    const filter = d.joinOn === "riverId" ? "" : spans.length
      ? `,\n    filters=[${spans.map(s => `[("riverIndex", ">=", ${s.lo}), ("riverIndex", "<=", ${s.hi})]`).join(",\n             ")}]`
      : "";
    const region = regions?.[0] ?? "1020000010";
    const py = `import geopandas as gpd

gdf = gpd.read_parquet(
    "${toS3(regionFile(d, region))}",
    storage_options={"anon": True}${filter},
)
gdf.to_parquet("${layer}_subset.geo.parquet")`;
    return {s5cmd: s5, awscli: aws, python: py};
  }

  const store = toS3(storeUrl(d, {date: req.form.date || "2026-01-01"}));
  const local = `./${store.split("/").filter(Boolean).slice(-1)[0]}`;
  const paths = zarrPaths(req);
  const s5 = paths.map(p => (p === "zarr.json"
    ? `s5cmd --no-sign-request cp ${store}/zarr.json ${local}/`
    : `s5cmd --no-sign-request cp '${store}/${p}/*' ${local}/${p}/`)).join("\n");
  const aws = `aws s3 sync --no-sign-request ${store} ${local} \\\n  --exclude "*" ${paths.map(p => (p === "zarr.json" ? `--include "zarr.json"` : `--include "${p}/*"`)).join(" ")}`;
  const sel = req.mode === "global" ? "" : `\nrivers = np.concatenate([${pyRanges(req.spans)}])\nds = ds.isel(riverId=rivers)`;
  const time = d.kind === "timeseries" && req.form.start ? `\nds = ds.sel(time=slice("${req.form.start}", "${req.form.end}"))` : "";
  const py = `import numpy as np
import xarray as xr

ds = xr.open_zarr("${store}", storage_options={"anon": True}, consolidated=False)
ds = ds[${JSON.stringify(req.variables)}]${sel}${time}
ds.to_zarr("${fileName(req)}.zarr", zarr_format=3)`;
  return {s5cmd: s5, awscli: aws, python: py};
}
