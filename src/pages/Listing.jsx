import {useMemo, useState} from "preact/hooks";
import {useLocation} from "preact-iso";
import {CATEGORIES, VERSIONS, categoriesOf, categoryById, datasetsFor, versionById} from "../data/catalog.js";
import {useCrumbs} from "../ui/crumbs.js";
import {routes} from "../routes.js";
import {fmtDate} from "../dom.js";
import {Icon} from "../components/Icon.jsx";
import {NotFound} from "./NotFound.jsx";

const uniq = xs => [...new Set(xs)];
const CATEGORY_ICON = {hydrography: "map", retrospective: "chart", forecasts: "bolt", floodmaps: "globe"};

/**
 * A version's catalog, laid out like the CDS search page: facets on the left, a search box and sort
 * over the results, one card per dataset. Opened on a category, that category's box starts checked.
 */
export function Listing({version: versionId}) {
  const {query} = useLocation();
  const categoryId = query.category || null;
  const version = versionById(versionId);
  const category = categoryId ? categoryById(categoryId) : null;
  const bad = !version;

  useCrumbs(bad ? [{label: "Data Store", href: routes.home()}] : [
    {label: "Data Store", href: routes.home()},
    {label: version.title, href: routes.version(version.id)},
    ...(category ? [{label: category.title, href: routes.category(version.id, category.id)}] : [])
  ]);

  const all = useMemo(() => (version ? datasetsFor(version.id) : []), [versionId]);
  const [facets, setFacets] = useState(() => ({
    category: new Set(categoryId ? [categoryId] : []),
    format: new Set(),
    resolution: new Set()
  }));
  const [text, setText] = useState("");
  const [sort, setSort] = useState("title");

  if (bad) return <NotFound/>;

  const facetDefs = [
    {key: "category", title: "Category", values: CATEGORIES.map(c => [c.id, c.title]), of: d => categoriesOf(d)},
    {key: "format", title: "Format", values: uniq(all.flatMap(d => d.formats)).map(f => [f, f]), of: d => d.formats},
    {key: "resolution", title: "Temporal resolution", values: uniq(all.map(d => d.temporalResolution)).map(r => [r, r]), of: d => d.temporalResolution}
  ];

  const matches = (d, skip) => {
    for (const f of facetDefs) {
      if (f.key === skip || !facets[f.key].size) continue;
      const v = f.of(d);
      if (!(Array.isArray(v) ? v.some(x => facets[f.key].has(x)) : facets[f.key].has(v))) return false;
    }
    if (text) {
      const hay = `${d.title} ${d.summary} ${categoriesOf(d).join(" ")} ${d.formats.join(" ")}`.toLowerCase();
      if (!text.toLowerCase().split(/\s+/).every(w => hay.includes(w))) return false;
    }
    return true;
  };

  const hits = all.filter(d => matches(d))
    .sort(sort === "updated" ? (a, b) => b.updated.localeCompare(a.updated) : (a, b) => a.title.localeCompare(b.title));

  const toggle = (key, value, on) => setFacets(prev => {
    const next = {...prev, [key]: new Set(prev[key])};
    if (on) next[key].add(value);
    else next[key].delete(value);
    return next;
  });

  const countFor = (f, value) => all.filter(d => matches(d, f.key)).filter(d => {
    const v = f.of(d);
    return Array.isArray(v) ? v.includes(value) : v === value;
  }).length;

  return (
    <section class="page">
      <div class="listing-head">
        <div class="col">
          <h1>{category ? `${version.title} · ${category.title}` : `${version.title} datasets`}</h1>
          <p class="lede">{category ? category.summary : version.summary}</p>
        </div>
        <div class="seg" role="tablist" aria-label="Model version">
          {VERSIONS.map(v => (
            <a key={v.id} class={`btn seg-btn ${v.id === version.id ? "on" : ""}`} role="tab"
               aria-selected={v.id === version.id}
               href={category ? routes.category(v.id, category.id) : routes.version(v.id)}>{v.title}</a>
          ))}
        </div>
      </div>
      {version.downloadable ? null : (
        <div class="notice">
          <Icon name="archive"/>
          <span>{version.title} is archived. Datasets can be browsed here and retrieved directly from the public buckets.</span>
        </div>
      )}
      <div class="listing">
        <aside class="facets" aria-label="Filters">
          {facetDefs.map(f => (
            <fieldset class="facet" data-facet={f.key} key={f.key}>
              <legend>{f.title}</legend>
              {f.values.map(([value, label]) => (
                <label class="checkline" key={value}>
                  <input type="checkbox" value={value} checked={facets[f.key].has(value)}
                         onChange={e => toggle(f.key, value, e.currentTarget.checked)}/>
                  <span>{label}</span>
                  <span class="count">{countFor(f, value)}</span>
                </label>
              ))}
            </fieldset>
          ))}
          <button class="btn sm-text" id="clear-facets" type="button" onClick={() => {
            setFacets({category: new Set(), format: new Set(), resolution: new Set()});
            setText("");
          }}>Clear filters
          </button>
        </aside>
        <div class="results">
          <div class="results-bar">
            <div class="search small">
              <Icon name="search"/>
              <input type="search" id="listing-q" placeholder={`Search ${version.title} datasets`} aria-label="Search datasets"
                     value={text} onInput={e => setText(e.currentTarget.value.trim())}/>
            </div>
            <span id="result-count" class="count-line">{hits.length} {hits.length === 1 ? "result" : "results"}</span>
            <label class="row sort">
              <span>Sort by</span>
              <select id="sort" value={sort} onChange={e => setSort(e.currentTarget.value)}>
                <option value="title">Title</option>
                <option value="updated">Last updated</option>
              </select>
            </label>
          </div>
          <div id="result-list" class="result-list">
            {hits.length ? hits.map(d => <ResultCard key={d.id} dataset={d}/>) : <div class="empty">No datasets match.</div>}
          </div>
        </div>
      </div>
    </section>
  );
}

function ResultCard({dataset: d}) {
  return (
    <a class="card result" href={routes.dataset(d)}>
      <span class={`thumb ${d.category}`}><Icon name={CATEGORY_ICON[d.category]}/></span>
      <div class="col grow">
        <div class="row between">
          <h3>{d.title}</h3>
          {d.preview ? <span class="badge warn">Preview</span> : null}
          {d.kind === "archive" ? <span class="badge">Archive</span> : null}
        </div>
        <p>{d.summary}</p>
        <div class="chips">
          <span class="chip strong">{categoryById(d.category).title}</span>
          {d.formats.map(f => <span class="chip" key={f}>{f}</span>)}
          <span class="chip"><Icon name="clock"/>{d.temporalResolution}</span>
          <span class="chip"><Icon name="globe"/>{d.spatialCoverage}</span>
          <span class="chip muted">Updated {fmtDate(d.updated)}</span>
        </div>
      </div>
    </a>
  );
}
