import {versionById} from "../data/catalog.js";
import {S3_V3_ROOT} from "../data/sources.js";
import {routes} from "../routes.js";
import {Icon} from "../components/Icon.jsx";
import {CodeBlock} from "../components/CodeBlock.jsx";

/**
 * The Access tab: for the archived versions, and for the v3 products that are not cut by an area of
 * interest. Nothing is downloaded through the browser — the files are listed where they live, with
 * the commands and the code that fetch them.
 */
export function AccessTab({dataset: d}) {
  const archived = d.kind === "archive";
  const version = versionById(d.version);
  const path = archived ? `${d.archiveRoot}/${d.archivePath}` : `${S3_V3_ROOT}/${d.path}`;
  const also = archived ? null : `${S3_V3_ROOT}/${d.alsoPath}`;
  const example = path.replace("YYYYMMDD00.zarr", "2025010100.zarr")
    .replace("year=YYYY/month=MM/day=DD", "year=2026/month=07/day=10")
    .replace("lon=XXX/lat=YYY", "lon=-062/lat=-04");
  const dir = example.endsWith("/");
  const local = `./${d.id}/`;
  const s5 = dir
    ? `s5cmd --no-sign-request ls ${example}\ns5cmd --no-sign-request cp '${example}*' ${local}`
    : `s5cmd --no-sign-request cp '${example}' ${local}`;
  const aws = dir
    ? `aws s3 ls --no-sign-request ${example}\naws s3 sync --no-sign-request ${example} ${local}`
    : `aws s3 cp --no-sign-request ${example} ${local}`;
  const py = archived
    ? (d.category === "hydrography"
      ? `import geopandas as gpd\n\ngdf = gpd.read_parquet("${example}", storage_options={"anon": True})`
      : `import xarray as xr\n\nds = xr.open_zarr("${example}", storage_options={"anon": True})`)
    : d.formats.includes("Zarr")
      ? `import xarray as xr\n\nds = xr.open_zarr("${example}", storage_options={"anon": True})`
      : `import geopandas as gpd\n\ngdf = gpd.read_parquet("${example}", storage_options={"anon": True})`;

  return (
    <>
      <div class="notice">
        <Icon name={archived ? "archive" : "map"}/>
        <span>{archived
          ? `${version.title} is archived and cannot be downloaded through this site. The files remain publicly readable at the location below.`
          : "Flood maps are tiled rather than published per river reach, so they are not cut by an area of interest here. Pull the tiles you need directly."}</span>
      </div>
      <section class="form-card">
        <h3><span class="num">1</span>Location</h3>
        <CodeBlock code={also ? `${path}\n${also}` : path}/>
      </section>
      <section class="form-card">
        <h3><span class="num">2</span>Download with s5cmd</h3>
        <CodeBlock code={s5}/>
      </section>
      <section class="form-card">
        <h3><span class="num">3</span>Download with the AWS CLI</h3>
        <CodeBlock code={aws}/>
      </section>
      <section class="form-card">
        <h3><span class="num">4</span>Read with Python</h3>
        <CodeBlock code={py}/>
      </section>
      <section class="form-card">
        <h3><span class="num">5</span>Terms of use</h3>
        <p><a href={d.license.url} target="_blank" rel="noopener">{d.license.name} <Icon name="external"/></a></p>
        <ul class="terms">{d.license.summary.map(t => <li key={t}>{t}</li>)}</ul>
      </section>
      <section class="form-card">
        <h3><span class="num">6</span>Elsewhere</h3>
        <ul class="links">
          {archived ? <li><a href={routes.category("v3", d.category)}>The same category in RFS v3</a></li> : null}
          <li><a href={routes.spec(archived ? d.version : "v3")}>The {archived ? d.version : "v3"} specification</a></li>
          <li><a href={routes.package("javascript")}>The JavaScript package</a></li>
        </ul>
      </section>
    </>
  );
}
