import {routes} from "../routes.js";
import {useCrumbs} from "../ui/crumbs.js";
import {Icon} from "../components/Icon.jsx";
import {CodeBlock} from "../components/CodeBlock.jsx";
import {NotFound} from "./NotFound.jsx";

// TODO: the JavaScript package has no documentation site yet, and the Python package's is being
// moved. Both placeholders are marked in the page as well as here.
const LINKS = {
  javascript: [
    {label: "Documentation site — not published yet", todo: true},
    {label: "Source on GitHub", href: "https://github.com/river-forecast-system/js-riverforecastsystem"},
    {label: "riverforecastsystem on npm", href: "https://www.npmjs.com/package/riverforecastsystem"}
  ],
  python: [
    {label: "Documentation site — link to be confirmed", todo: true},
    {label: "Source on GitHub", href: "https://github.com/geoglows/pygeoglows"},
    {label: "geoglows on PyPI", href: "https://pypi.org/project/geoglows/"}
  ]
};

export const PACKAGES = [
  {
    id: "javascript",
    title: "riverforecastsystem",
    language: "JavaScript",
    summary: "The client this app is built on. Builds every data url, reads discharge out of the Zarr stores, and does the riverIndex arithmetic that turns a click into a watershed."
  },
  {
    id: "python",
    title: "geoglows",
    language: "Python",
    summary: "The Python client for the same data, for notebooks and pipelines. Reads the retrospective simulation, forecasts and return periods, and draws the standard plots."
  }
];

export function PackagesIndex() {
  useCrumbs([{label: "Data Store", href: routes.home()}, {label: "Packages", href: routes.packages()}]);
  return (
    <section class="page">
      <div class="listing-head">
        <div class="col">
          <h1>Client packages</h1>
          <p class="lede">Everything in this store can be read straight from the bucket. These are the two maintained clients that do it for you.</p>
        </div>
      </div>
      <div class="result-list">
        {PACKAGES.map(p => (
          <a class="card result" href={routes.package(p.id)} key={p.id}>
            <span class={`thumb ${p.id === "javascript" ? "forecasts" : "hydrography"}`}><Icon name="terminal"/></span>
            <div class="col grow">
              <div class="row between"><h3>{p.title}</h3><span class="badge">{p.language}</span></div>
              <p>{p.summary}</p>
            </div>
          </a>
        ))}
      </div>
    </section>
  );
}

export function PackagePage({id}) {
  const pkg = PACKAGES.find(p => p.id === id);
  useCrumbs([
    {label: "Data Store", href: routes.home()},
    {label: "Packages", href: routes.packages()},
    ...(pkg ? [{label: pkg.language, href: routes.package(pkg.id)}] : [])
  ]);
  if (!pkg) return <NotFound/>;
  return (
    <section class="page doc-page">
      <div class="doc-main">
        <span class="eyebrow">{pkg.language} client</span>
        <h1>{pkg.title}</h1>
        <p class="lede">{pkg.summary}</p>
        {pkg.id === "javascript" ? <JavaScriptBody/> : <PythonBody/>}
      </div>
      <aside class="doc-side">
        <div class="side-card">
          <h4>Links</h4>
          <ul class="links">
            {LINKS[pkg.id].map(l => (
              <li key={l.label}>
                {l.todo
                  ? <><span class="muted">{l.label}</span><span class="badge warn">TODO</span></>
                  : <a href={l.href} target="_blank" rel="noopener">{l.label} <Icon name="external"/></a>}
              </li>
            ))}
          </ul>
        </div>
        <div class="side-card">
          <h4>Also see</h4>
          <ul class="links">
            <li><a href={routes.spec()}>Specification documents</a></li>
            <li><a href={routes.version("v3")}>RFS v3 datasets</a></li>
          </ul>
        </div>
      </aside>
    </section>
  );
}

function JavaScriptBody() {
  return (
    <>
      <h2 class="section-title">Install</h2>
      <CodeBlock code="npm install riverforecastsystem"/>
      <p>The package ships as ES modules with subpath exports, so a bundle only carries what it imports.
        <code>riverforecastsystem/v3</code> is urls and configuration, <code>/v3/discharge</code> the readers,
        <code>/v3/hydrography</code> the riverIndex arithmetic, <code>/v3/plots</code> the standard charts (Chart.js is a peer
        dependency) and <code>/v3/floodmaps</code> the FLDPLN libraries.</p>

      <h2 class="section-title">Point it at the data</h2>
      <p>One endpoint — the root of the v3 tree — settles where everything is read from. Unset, the package reads the public CDN.</p>
      <CodeBlock code={`import {configure, getConfig, urls} from "riverforecastsystem/v3";

configure({v3Base: "https://cdn.apps.geoglows.org/rfs-v3-sample-data"});
getConfig();                       // {v3Base: "..."}
urls.retrospectiveZarr({resolution: "daily"});
urls.forecastZarr({date: "2026-07-10"});
urls.streamsGeoparquet({region: 1020000010});`}/>

      <h2 class="section-title">Read discharge</h2>
      <p>Every reader takes a <code>riverIndex</code> — a reach's position on the shared axis, which the vector tiles carry — or a
        <code>riverId</code>, which costs a scan of the id coordinate to translate.</p>
      <CodeBlock code={`import {forecast, maximums, retrospective, returnPeriods} from "riverforecastsystem/v3/discharge";

const past = await retrospective({resolution: "daily", riverIndex});
const next = await forecast({date: "2026-07-10", riverIndex});   // members + ensemble stats
const fits = await returnPeriods({riverIndex, resolution: "hourly"});
const peaks = await maximums({riverIndex});`}/>

      <h2 class="section-title">Select rivers without a graph</h2>
      <p>Everything upstream of a reach is a contiguous run of <code>riverIndex</code>, so selection is arithmetic: this app's whole area
        of interest map is these four functions.</p>
      <CodeBlock code={`import {aoiSpans, corridorBetween, spanCount, upstreamRange} from "riverforecastsystem/v3/hydrography";

const watershed = upstreamRange({riverIndex, upstreamCount});   // {lo, hi, count}
const between = aoiSpans(watershed, inlets);                     // outlet minus what came in above
const {corridor} = corridorBetween(picks, runs);                 // the river joining several picks
spanCount(between);`}/>

      <h2 class="section-title">Download a subset</h2>
      <p>The Download tab of every dataset prints this same snippet for whatever is selected on the map.</p>
      <CodeBlock code={`import {configure} from "riverforecastsystem/v3";
import {retrospective} from "riverforecastsystem/v3/discharge";

// riverIndex runs, exactly as the area of interest reports them
const runs = [[1000, 1009], [5000, 5002]];

for (const [lo, hi] of runs) {
  for (let riverIndex = lo; riverIndex <= hi; riverIndex++) {
    const {time, discharge} = await retrospective({resolution: "daily", riverIndex});
    // ... write it wherever you keep it
  }
}`}/>
    </>
  );
}

function PythonBody() {
  return (
    <>
      <h2 class="section-title">Install</h2>
      <CodeBlock code="pip install geoglows"/>
      <h2 class="section-title">Read discharge</h2>
      <CodeBlock code={`import geoglows

df = geoglows.data.retrospective(river_id)
fc = geoglows.data.forecast_ensembles(river_id)
rp = geoglows.data.return_periods(river_id)`}/>
      <h2 class="section-title">Read a store directly</h2>
      <p>Nothing about the data needs a client: the stores are plain Zarr v3 and the hydrography is plain GeoParquet, both publicly
        readable.</p>
      <CodeBlock code={`import xarray as xr

ds = xr.open_zarr(
    "s3://river-forecast-system/v3/retrospective/daily.zarr",
    storage_options={"anon": True},
)
q = ds["Q"].isel(riverId=slice(lo, hi + 1))   # a watershed's riverIndex run`}/>
      <h2 class="section-title">Plots</h2>
      <CodeBlock code={`geoglows.plots.forecast(fc)
geoglows.plots.retrospective(df)`}/>
    </>
  );
}
