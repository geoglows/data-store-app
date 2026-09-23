import {asyncBufferFromUrl, parquetMetadataAsync, parquetReadObjects} from "hyparquet";
import {compressors} from "hyparquet-compressors";
import {watershedsParquet} from "./sources.js";

/**
 * Every region as one run of riverIndex, `[{lo, hi, region}]` ascending.
 *
 * watersheds.parquet has one row per terminal watershed with its riverIndex range and region. The
 * global axis is the regions laid end to end, so adjacent rows of one region collapse into a run —
 * about fifty for the whole world. Read once, on demand.
 */
let runs = null;
let pending = null;

async function read() {
  const file = await asyncBufferFromUrl({url: watershedsParquet()});
  const metadata = await parquetMetadataAsync(file);
  const rows = await parquetReadObjects({
    file, metadata, compressors, columns: ["TDXHydroRegion", "riverIndexStart", "riverIndexEnd"]
  });
  rows.sort((a, b) => Number(a.riverIndexStart) - Number(b.riverIndexStart));
  const out = [];
  for (const row of rows) {
    const region = String(row.TDXHydroRegion);
    const lo = Number(row.riverIndexStart);
    const hi = Number(row.riverIndexEnd);
    const last = out[out.length - 1];
    if (last && last.region === region && last.hi + 1 === lo) last.hi = hi;
    else out.push({lo, hi, region});
  }
  return out;
}

export function loadRegionRuns() {
  if (runs) return Promise.resolve(runs);
  pending ??= read().then(r => (runs = r)).finally(() => {
    pending = null;
  });
  return pending;
}

export const regionRuns = () => runs;
export const totalReaches = () => (runs?.length ? runs[runs.length - 1].hi + 1 : null);
