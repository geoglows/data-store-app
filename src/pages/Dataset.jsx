import {lazy} from "preact-iso";
import {Suspense} from "preact/compat";
import {CITATION, categoryById, datasetById, datasetsFor, versionById} from "../data/catalog.js";
import {datasetDates} from "../data/sentinel.js";
import {S3_V3_ROOT, V3_BASE, hydrographyBase, storeUrl, toS3} from "../data/sources.js";
import {fmtDate} from "../dom.js";
import {routes} from "../routes.js";
import {useCrumbs} from "../ui/crumbs.js";
import {Icon} from "../components/Icon.jsx";
import {CodeBlock} from "../components/CodeBlock.jsx";
import {AccessTab} from "./AccessTab.jsx";
import {NotFound} from "./NotFound.jsx";
import {useEffect, useState} from "preact/hooks";

const CATEGORY_ICON = {hydrography: "map", retrospective: "chart", forecasts: "bolt", floodmaps: "globe"};

// The download form pulls in the map, the Zarr reader and the parquet writer. It is a page of its
// own and loads when someone opens it.
const DownloadTab = lazy(() => import("./DownloadTab.jsx").then(m => m.DownloadTab));

/**
 * One dataset. The header and the right column are the same on every tab; the tab itself is a real
 * page — /v3/retrospective/daily, /download, /documentation — so a link to one opens on it.
 */
export function Dataset({version: v, product: id, tab}) {
  const d = datasetById(v, id);
  useCrumbs(d ? [
    {label: "Data Store", href: routes.datasets()},
    {label: versionById(v).title, href: routes.version(v)},
    {label: categoryById(d.category).title, href: routes.category(v, d.category)},
    {label: d.title, href: routes.dataset(d)}
  ] : [{label: "Data Store", href: routes.home()}]);

  if (!d) return <NotFound/>;

  const action = d.kind === "archive" || d.kind === "external" ? "access" : "download";
  const tabs = [["", "Overview"], [action, action === "access" ? "Access" : "Download"], ["documentation", "Documentation"]];
  const current = tabs.some(([t]) => t === (tab ?? "")) ? (tab ?? "") : "";

  return (
    <>
      <section class="dataset-head">
        <div class="page">
          <div class="row head-row">
            <span class={`thumb lg ${d.category}`}><Icon name={CATEGORY_ICON[d.category]}/></span>
            <div class="col grow">
              <span class="eyebrow">{versionById(d.version).title} · {categoryById(d.category).title}</span>
              <h1>{d.title}</h1>
              <p class="lede">{d.summary}</p>
            </div>
          </div>
          <div class="chips">
            {d.formats.map(f => <span class="chip" key={f}>{f}</span>)}
            <span class="chip"><Icon name="clock"/>{d.temporalResolution}</span>
            <span class="chip"><Icon name="globe"/>{d.spatialCoverage}</span>
            {d.kind === "archive" ? <span class="badge">Archive</span> : null}
            {d.preview ? <span class="badge warn">Preview</span> : null}
          </div>
          <nav class="tabs" role="tablist">
            {tabs.map(([t, label]) => (
              <a key={t} class={`tab ${current === t ? "active" : ""}`} role="tab" data-tab={t || "overview"}
                 href={routes.dataset(d, t)}>{label}</a>
            ))}
          </nav>
        </div>
      </section>
      <section class="page dataset-body">
        <div class="dataset-main">
          {current === "" ? <Overview dataset={d}/> : null}
          {current === "documentation" ? <Documentation dataset={d}/> : null}
          {current === "access" ? <AccessTab dataset={d}/> : null}
          {current === "download" ? (
            <Suspense fallback={<div class="empty">Loading the download form…</div>}>
              <DownloadTab dataset={d}/>
            </Suspense>
          ) : null}
        </div>
        <Sidebar dataset={d}/>
      </section>
    </>
  );
}

// ── Overview ───────────────────────────────────────────────────────────────
function Overview({dataset: d}) {
  const rows = [
    ["Category", categoryById(d.category).title],
    ["Temporal coverage", d.temporalCoverage],
    ["Temporal resolution", d.temporalResolution],
    ["Spatial coverage", d.spatialCoverage],
    ["Spatial resolution", d.category === "floodmaps" ? "Raster tile" : "River reach (TDX-Hydro)"],
    d.geometry ? ["Geometry", d.geometry] : null,
    ["File format", d.formats.join(", ")],
    ["Update frequency", d.updateFrequency]
  ].filter(Boolean);
  return (
    <>
      <h2 class="section-title">Description</h2>
      <p>{d.summary}</p>
      <Narrative dataset={d}/>
      <table class="facts">
        <tbody>{rows.map(([k, val]) => <tr key={k}><th>{k}</th><td>{val}</td></tr>)}</tbody>
      </table>
      {d.variables ? (
        <>
          <h2 class="section-title">Variables</h2>
          <table class="data">
            <thead><tr><th>Name</th><th>Units</th><th>Dimensions</th><th>Description</th></tr></thead>
            <tbody>
              {d.variables.map(v => (
                <tr key={v.name}><td><code>{v.name}</code></td><td>{v.units}</td><td><code>{v.dims}</code></td><td>{v.description}</td></tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
      {d.columns ? (
        <>
          <h2 class="section-title">Columns</h2>
          <table class="data">
            <thead><tr><th>Name</th><th>Type</th><th>Description</th></tr></thead>
            <tbody>{d.columns.map(([n, t, desc]) => <tr key={n}><td><code>{n}</code></td><td>{t}</td><td>{desc}</td></tr>)}</tbody>
          </table>
        </>
      ) : null}
      {d.files ? (
        <>
          <h2 class="section-title">Files</h2>
          <table class="data">
            <thead><tr><th>File</th><th>Format</th><th>Description</th></tr></thead>
            <tbody>{d.files.map(([n, t, desc]) => <tr key={n}><td><code>{n}</code></td><td>{t}</td><td>{desc}</td></tr>)}</tbody>
          </table>
        </>
      ) : null}
    </>
  );
}

function Narrative({dataset: d}) {
  switch (d.kind) {
    case "hydrography":
      return <p>The network is published whole for each HydroBASINS level 2 region as one GeoParquet file, sorted on <code>riverIndex</code>.
        Every reach upstream of a reach is a contiguous run of <code>riverIndex</code>, so a watershed or a stretch of river between two
        points is one or a few ranges of rows.</p>;
    case "timeseries":
      return <p>Discharge is published as a single Zarr v3 store for the whole globe, chunked one river to a chunk so that a river's full
        series is one read. The <code>riverId</code> axis is in topological order: a river's position on it is its <code>riverIndex</code>,
        and everything upstream of a river is a contiguous range of positions.</p>;
    case "static":
      return <p>Stored as one array per series so a consumer never has to guess which record a value came from. Compare sub-daily flows with
        the <code>hourly</code> arrays and daily means with the <code>daily</code> ones.</p>;
    case "forecast":
      return <p>Each day's forecast is its own Zarr v3 store under <code>year=/month=/day=</code> partitions. The full ensemble carries all 51
        members; the simplified product carries the ensemble deciles and mean, which is what most applications plot and is about a fifth of
        the size.</p>;
    case "external":
      return <p>Flood maps are tiled on a longitude and latitude grid rather than published per reach, so they are not cut by an area of
        interest here. The Access tab says where the tiles are and how to pull the ones you need.</p>;
    default:
      return <p>This is an archived model version. It is no longer updated, and the files are served as they were published. See the Access
        tab for how to retrieve them.</p>;
  }
}

// ── Documentation ──────────────────────────────────────────────────────────
function Documentation({dataset: d}) {
  if (d.kind === "archive") {
    return (
      <>
        <h2 class="section-title">Layout</h2>
        <p>Files are under <code>{d.archiveRoot}/{d.archivePath}</code>.</p>
        <h2 class="section-title">Reading the data</h2>
        <p>The <code>geoglows</code> Python package reads {d.version} data directly from the public buckets.</p>
        <CodeBlock code="pip install geoglows"/>
        <h2 class="section-title">Related resources</h2>
        <ul class="links">
          <li><a href={routes.package("python")}>The Python package</a></li>
          <li><a href={routes.spec(d.version)}>The {d.version} specification</a></li>
        </ul>
      </>
    );
  }
  if (d.kind === "external") {
    return (
      <>
        <h2 class="section-title">Layout on S3</h2>
        <CodeBlock code={`${S3_V3_ROOT}/${d.path}\n${S3_V3_ROOT}/${d.alsoPath}`}/>
        <h2 class="section-title">Reading the tiles</h2>
        <p>The flood mapper in the RFS v3 app reads these through <code>riverforecastsystem/v3/floodmaps</code>, which resolves a tile from
          the manifest and reads the library for the reaches on screen.</p>
        <CodeBlock code={`import {urls} from "riverforecastsystem/v3";

urls.floodMapsManifest();        // the tiling
urls.floodMapsTileBoundaries();  // tile outlines for a map layer`}/>
        <h2 class="section-title">Specification</h2>
        <ul class="links"><li><a href={routes.spec("v3")}>Flood maps in the RFS v3 specification</a></li></ul>
      </>
    );
  }
  const layout = d.kind === "hydrography"
    ? `${toS3(hydrographyBase())}/region=<TDXHydroRegion>/${d.layer}_<TDXHydroRegion>.geo.parquet`
    : d.kind === "forecast"
      ? toS3(storeUrl(d, {date: "2026-01-01"})).replace("year=2026/month=01/day=01", "year=YYYY/month=MM/day=DD")
      : toS3(storeUrl(d));
  return (
    <>
      <h2 class="section-title">Layout on S3</h2>
      <CodeBlock code={layout}/>
      <h2 class="section-title">riverIndex</h2>
      <p><code>riverIndex</code> is a depth-first numbering of the network shared by the vector tiles, the hydrography files and every Zarr
        store. For any reach, <code>riverIndex − upstreamCount … riverIndex</code> is exactly the reach and everything upstream of it.
        Subsetting by watershed is therefore a range read, with no graph to walk.</p>
      {d.kind === "hydrography" ? (
        <>
          <h2 class="section-title">Downloads from this site</h2>
          <p>A subset downloaded here is a GeoParquet 1.1 file with the source's columns, WKB geometry and a recomputed bounding box. A
            selection spanning several regions downloads as a zip with one file per region.</p>
        </>
      ) : (
        <>
          <h2 class="section-title">Encoding</h2>
          <ul>
            <li>Zarr v3 with consolidated metadata. Every array is compressed with <code>blosc(zstd, clevel=5, shuffle)</code>.</li>
            <li>Discharge is bitrounded <code>float32</code>: relative error below 1.5e-05.</li>
            <li><code>time</code> is <code>int32</code> hours since a per-store reference time. Read <code>units</code> off the array.</li>
            <li>Values are left aligned: a value at <em>t</em> is the mean over <em>t</em> to the next step.</li>
            <li>The fill value is <code>NaN</code>. A NaN indicates a failure to be reported, not an expected gap.</li>
          </ul>
          <h2 class="section-title">Downloads from this site</h2>
          <p>A subset downloaded here is a zipped Zarr v3 store holding the selected rivers and times, with <code>riverId</code>,
            <code>riverIndex</code> and <code>time</code> coordinates and the source store's attributes. Chunks are written uncompressed so
            any Zarr v3 reader can open it without codec plugins; open it with
            <code>xr.open_zarr(zarr.storage.ZipStore("file.zarr.zip"))</code>.</p>
        </>
      )}
      <h2 class="section-title">Reading with riverforecastsystem (JavaScript)</h2>
      <CodeBlock code={jsExample(d)}/>
      <h2 class="section-title">Reading with Python</h2>
      <CodeBlock code={pyExample(d)}/>
    </>
  );
}

function jsExample(d) {
  if (d.kind === "hydrography") {
    return `import {urls} from "riverforecastsystem/v3";
import {upstreamRange} from "riverforecastsystem/v3/hydrography";

const url = urls.${d.layer}Geoparquet({region: 1020000010});
const {lo, hi} = upstreamRange({riverIndex, upstreamCount});  // a watershed`;
  }
  if (d.kind === "forecast") {
    return `import {forecast} from "riverforecastsystem/v3/discharge";

const {time, discharge, stats} = await forecast({date: "2026-07-10", riverIndex});`;
  }
  if (d.store === "maximums") {
    return `import {maximums} from "riverforecastsystem/v3/discharge";

const {time, discharge} = await maximums({riverIndex});`;
  }
  if (d.kind === "static") {
    return `import {returnPeriods} from "riverforecastsystem/v3/discharge";

const thresholds = await returnPeriods({riverIndex, resolution: "hourly"});`;
  }
  return `import {retrospective} from "riverforecastsystem/v3/discharge";

const {time, discharge} = await retrospective({resolution: "${d.resolution}", riverIndex});`;
}

function pyExample(d) {
  if (d.kind === "hydrography") {
    return `import geopandas as gpd

gdf = gpd.read_parquet(
    "${toS3(hydrographyBase())}/region=1020000010/${d.layer}_1020000010.geo.parquet",
    storage_options={"anon": True},
)`;
  }
  const store = d.kind === "forecast" ? toS3(storeUrl(d, {date: "2026-07-10"})) : toS3(storeUrl(d));
  const variable = d.variable ?? (d.store === "fdc" ? "hourly_annual" : d.kind === "static" ? "gumbel_hourly" : "Q");
  return `import xarray as xr

ds = xr.open_zarr("${store}", storage_options={"anon": True})
q = ds["${variable}"].isel(riverId=slice(lo, hi + 1))  # a watershed's riverIndex run`;
}

// ── Right column ───────────────────────────────────────────────────────────
function Sidebar({dataset: d}) {
  const [dates, setDates] = useState(null);
  useEffect(() => {
    let live = true;
    datasetDates(d).then(x => live && setDates(x));
    return () => (live = false);
  }, [d.id, d.version]);

  const created = dates?.created ?? d.created;
  const updated = dates?.updated ?? d.updated;
  const changelog = dates?.changelog ?? d.changelog ?? [];
  const where = d.kind === "archive" ? `${d.archiveRoot}/${d.archivePath}`
    : d.kind === "external" ? `${S3_V3_ROOT}/${d.path}`
      : d.kind === "hydrography" ? `${toS3(hydrographyBase())}/`
        : d.kind === "forecast" ? `${S3_V3_ROOT}/forecasts15/`
          : toS3(storeUrl(d));
  const related = datasetsFor(d.version, d.category).filter(x => x.id !== d.id);

  return (
    <aside class="dataset-side" id="side">
      <div class="side-card">
        <h4>Dataset</h4>
        <dl>
          <dt>Last updated</dt><dd>{fmtDate(updated)}</dd>
          <dt>Created</dt><dd>{fmtDate(created)}</dd>
          <dt>Model version</dt><dd>{versionById(d.version).title}</dd>
          <dt>Update frequency</dt><dd>{d.updateFrequency}</dd>
          <dt>Provider</dt><dd>{d.provider}</dd>
          <dt>Format</dt><dd>{d.formats.join(", ")}</dd>
          {d.crs ? <><dt>CRS</dt><dd>{d.crs}</dd></> : null}
        </dl>
      </div>
      <div class="side-card">
        <h4>License</h4>
        <p><a href={d.license.url} target="_blank" rel="noopener">{d.license.short} <Icon name="external"/></a></p>
        <p class="small">{d.license.name}</p>
      </div>
      <div class="side-card">
        <h4>Citation</h4>
        <p class="small">{CITATION}</p>
        <CodeBlock code={CITATION}/>
      </div>
      <div class="side-card">
        <h4>Storage</h4>
        <p class="mono small break">{where}</p>
        {d.kind === "archive" ? null : <p class="mono small break muted">{V3_BASE}</p>}
      </div>
      <div class="side-card">
        <h4>Changelog</h4>
        <ol class="changelog">
          {changelog.map(c => (
            <li key={c.date + c.version}>
              <div class="row between"><strong>{c.version}</strong><span class="muted">{fmtDate(c.date)}</span></div>
              <p>{c.note}</p>
            </li>
          ))}
        </ol>
      </div>
      {related.length ? (
        <div class="side-card">
          <h4>Related datasets</h4>
          <ul class="links">{related.map(r => <li key={r.id}><a href={routes.dataset(r)}>{r.title}</a></li>)}</ul>
        </div>
      ) : null}
    </aside>
  );
}
