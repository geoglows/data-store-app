import {CATEGORIES, VERSIONS, datasetsFor} from "../data/catalog.js";
import {useCrumbs} from "../ui/crumbs.js";
import {routes} from "../routes.js";
import {Icon} from "../components/Icon.jsx";

/**
 * The landing page: the model versions, drawn the way the catalog draws datasets. Picking one opens
 * its products. v1 and v2 are archives — the row says so, and everything below stays browse only.
 */
export function Versions() {
  useCrumbs([{label: "Data Store", href: routes.home()}]);
  return (
    <section class="page">
      <div class="listing-head">
        <div class="col">
          <h1>River Forecast System Data Store</h1>
          <p class="lede">Hydrography, retrospective discharge, ensemble forecasts and flood maps for every river on Earth. Choose a model version to see what it publishes.</p>
        </div>
      </div>
      <div class="result-list">
        {VERSIONS.map(v => <VersionRow key={v.id} version={v}/>)}
      </div>
    </section>
  );
}

function VersionRow({version: v}) {
  const has = CATEGORIES.filter(c => datasetsFor(v.id, c.id).length);
  return (
    <a class={`card result version-row ${v.downloadable ? "current" : "archived"}`} href={routes.version(v.id)}>
      <span class={`thumb ${v.downloadable ? "retrospective" : "archive"}`}>
        <Icon name={v.downloadable ? "stack" : "archive"}/>
      </span>
      <div class="col grow">
        <div class="row between">
          <h3>{v.title}</h3>
          <span class={`badge ${v.downloadable ? "accent" : "warn"}`}>
            {v.downloadable ? "Current · downloads" : "Archive · browse only"}
          </span>
        </div>
        <p>{v.summary}</p>
        <div class="chips">
          {has.map(c => <span class="chip strong" key={c.id}>{c.title}</span>)}
          <span class="chip"><Icon name="clock"/>{v.years}</span>
          {v.downloadable ? null : <span class="chip warn-chip"><Icon name="archive"/>No downloads in this app</span>}
        </div>
      </div>
    </a>
  );
}
