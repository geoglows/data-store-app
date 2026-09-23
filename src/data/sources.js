import {configure, getConfig, urls} from "riverforecastsystem/v3";

// Where the app reads v3 data from. Set once, here, before anything touches `urls.*`. A relative
// value resolves against the Vite base so `data` finds the dev server's ./data mount.
const base = import.meta.env.VITE_RFS_V3_BASE;
if (base) {
  const root = new URL(import.meta.env.BASE_URL || "/", location.origin);
  configure({v3Base: /^[a-z][a-z0-9+.-]*:/i.test(base) ? base : new URL(base, root).href});
}

export const V3_BASE = getConfig().v3Base;
export const S3_V3_ROOT = (import.meta.env.VITE_S3_V3_ROOT || "s3://river-forecast-system-v3").replace(/\/+$/, "");

// Where the browser reads the Zarr stores from, when that is not V3_BASE. The v3 bucket has the
// hydrography and flood maps but not yet the retrospective or forecast stores, which are read from
// the sample tree meanwhile — the same riverIndex axis, so a selection made on the map cuts either.
// TODO: remove VITE_RFS_V3_ZARR_BASE once the stores are published in the bucket.
const zarrBase = (import.meta.env.VITE_RFS_V3_ZARR_BASE || "").replace(/\/+$/, "");
export const MAX_BROWSER_MB = Number(import.meta.env.VITE_MAX_BROWSER_MB) || 500;

/** The same object, addressed as a bucket key instead of an https url. */
export const toS3 = url => (url.startsWith(V3_BASE) ? S3_V3_ROOT + url.slice(V3_BASE.length) : url);

// Not in riverforecastsystem's url builders yet; laid out the way the other region files are.
// TODO: move to urls.lakesGeoparquet() once the package publishes one.
const lakesGeoparquet = ({region}) => `${urls.hydrographyRegion({region})}/lakes_${region}.geo.parquet`;

const REGION_FILES = {
  streams: urls.streamsGeoparquet,
  catchments: urls.catchmentsGeoparquet,
  confluences: urls.confluencesGeoparquet,
  lakes: lakesGeoparquet
};

/** The region file a hydrography dataset is published as. */
export const regionFile = (dataset, region) => REGION_FILES[dataset.layer]({region});

/** The Zarr store a timeseries, static or forecast dataset reads from. */
export function storeUrl(dataset, {date} = {}) {
  if (dataset.kind === "forecast") return urls.forecastZarr({date});
  if (dataset.store === "return-periods") return urls.returnPeriodsZarr();
  if (dataset.store === "maximums") return urls.maximumsZarr();
  // Not in riverforecastsystem's url builders yet; named as the specification has it.
  // TODO: move to urls.fdcZarr() once the package publishes one.
  if (dataset.store === "fdc") return `${V3_BASE}/retrospective/fdc.zarr`;
  return urls.retrospectiveZarr({resolution: dataset.resolution});
}

/**
 * The url the browser reads a store at. Everything the page shows — the layout, the commands, the
 * code — keeps the canonical `storeUrl`; only the bytes come from here.
 */
export function storeReadUrl(dataset, opts) {
  const url = storeUrl(dataset, opts);
  return zarrBase && url.startsWith(V3_BASE) ? zarrBase + url.slice(V3_BASE.length) : url;
}

export const streamsPmtiles = () => urls.streamsPmtiles();
export const watershedsParquet = () => urls.watershedsParquet();
export const hydrographyRegionDir = region => urls.hydrographyRegion({region});
export const hydrographyBase = () => urls.hydrographyBase();
export const forecastDir = date => urls.forecastDir({date});
