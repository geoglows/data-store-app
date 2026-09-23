import {useEffect, useMemo, useRef, useState} from "preact/hooks";
import {auth} from "../account/auth.js";
import {useAuth} from "../account/useAuth.js";
import {MAX_BROWSER_MB, storeUrl} from "../data/sources.js";
import {loadRegionRuns, regionRuns} from "../data/regions.js";
import {createAoiMap} from "../map/aoiMap.js";
import {MODES, createSelection} from "../map/selection.js";
import {buildRequest, cliCommands, jsExample, requestJson, runRequest} from "../download/jobs.js";
import {readTimeAxis} from "../download/zarrSubset.js";
import {fmtBytes, fmtInt} from "../dom.js";
import {Icon} from "../components/Icon.jsx";

const DISTRIBUTION_LABELS = {gumbel: "Gumbel", logpearson3: "Log-Pearson III", lognormal: "Log-normal", weibull: "Weibull"};
const CLI_TABS = [["s5cmd", "s5cmd"], ["awscli", "AWS CLI"], ["python", "Python"], ["javascript", "JavaScript"], ["request", "Request JSON"]];

const isoDay = ms => new Date(ms).toISOString().slice(0, 10);
const addDays = (iso, n) => isoDay(Date.parse(`${iso}T00:00:00Z`) + n * 8.64e7);

function defaultForecastDate() {
  const configured = import.meta.env.VITE_FORECAST_DEFAULT_DATE;
  if (configured) return configured;
  const d = new Date();
  d.setUTCHours(d.getUTCHours() - 12);
  return isoDay(d.getTime());
}

/**
 * The Download page of a dataset: the CDS form, top to bottom — area of interest, what to take from
 * the dataset, format, terms of use, the request and its download button, and the same request as
 * commands and code.
 */
export function DownloadTab({dataset: d}) {
  const hydro = d.kind === "hydrography";
  const selection = useMemo(() => createSelection({regionRuns}), [d.id]);
  const mapEl = useRef(null);
  const mapRef = useRef(null);
  const running = useRef(null);

  const [sel, setSel] = useState(() => selection.summary());
  const [axis, setAxis] = useState(null);
  const [coverage, setCoverage] = useState("—");
  const [form, setForm] = useState({
    start: null,
    end: null,
    date: d.kind === "forecast" ? defaultForecastDate() : null,
    available: null,
    product: "simplified",
    distributions: d.distributions ? ["gumbel"] : [],
    series: d.series ? ["hourly"] : [],
    maxSimulated: false
  });
  const [cliTab, setCliTab] = useState("s5cmd");
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);
  const {user, termsAccepted} = useAuth();

  const set = patch => setForm(prev => ({...prev, ...patch}));

  // The map and the region runs. One map per mounted form; it is torn down with the page.
  useEffect(() => {
    const off = selection.onChange(setSel);
    const map = createAoiMap(mapEl.current, selection);
    mapRef.current = map;
    loadRegionRuns().then(() => selection.refresh()).catch(err => console.warn("[regions]", err));
    return () => {
      off();
      map.destroy();
      mapRef.current = null;
      running.current?.abort();
    };
  }, [selection]);

  // The store's own time axis bounds the date fields and is what the size estimate counts steps on.
  useEffect(() => {
    if (d.kind !== "timeseries") return;
    let live = true;
    readTimeAxis(storeUrl(d)).then(a => {
      if (!live || !a) return;
      setAxis(a);
      const first = isoDay(a.ms[0]);
      const last = isoDay(a.ms.at(-1));
      setCoverage(`${first} – ${last}`);
      // Hourly and daily open on the last year; the aggregated series are small enough to take whole.
      set({start: d.stepHours <= 24 ? [first, addDays(last, -364)].sort().at(-1) : first, end: last});
    }).catch(err => {
      console.warn("[time axis]", err);
      if (live) setCoverage("Unavailable");
    });
    return () => (live = false);
  }, [d.id]);

  // Whether a forecast was published for the chosen initialization date.
  useEffect(() => {
    if (d.kind !== "forecast" || !form.date) return;
    let live = true;
    set({available: null});
    fetch(`${storeUrl(d, {date: form.date})}/zarr.json`, {method: "HEAD"})
      .then(r => live && set({available: r.ok}))
      .catch(() => live && set({available: false}));
    return () => (live = false);
  }, [d.id, form.date]);

  const req = buildRequest(d, form, sel, axis);
  const bad = new Set(req.problems);
  const ready = !!user && termsAccepted && req.valid && progress == null;

  const submit = async (e) => {
    e.preventDefault();
    if (!ready) return;
    const controller = new AbortController();
    running.current = controller;
    setError(null);
    setProgress(0);
    try {
      await runRequest(req, {signal: controller.signal, onProgress: p => setProgress(Math.min(1, p))});
      setProgress(1);
    } catch (ex) {
      if (ex.name !== "AbortError") {
        console.error("[download]", ex);
        setError(ex.message);
      }
    } finally {
      running.current = null;
      setTimeout(() => setProgress(null), 800);
    }
  };

  const quickRange = (span) => {
    if (!axis) return;
    const first = isoDay(axis.ms[0]);
    const last = isoDay(axis.ms.at(-1));
    set({end: last, start: span === "all" ? first : [first, addDays(last, -Number(span) + 1)].sort().at(-1)});
  };

  const code = cliTab === "request" ? requestJson(req)
    : cliTab === "javascript" ? jsExample(req)
      : cliCommands(req)[cliTab];

  const reaches = sel.mode === "global" ? (regionRuns() ? regionRuns().at(-1).hi + 1 : null) : sel.count;
  const areaText = sel.mode === "global" ? "Entire globe"
    : sel.empty ? "Nothing selected"
      : `${MODES.find(m => m.id === sel.mode).label} · ${fmtInt(req.reaches)} rivers in ${sel.regions.length} ${sel.regions.length === 1 ? "region" : "regions"}`;

  const rows = [
    ["Dataset", `${d.title} (${d.version})`],
    ["Area", areaText, bad.has("area")],
    d.kind === "timeseries" ? ["Time", form.start && form.end ? `${form.start} to ${form.end}` : "—", bad.has("time")] : null,
    d.kind === "forecast" ? ["Initialization", form.date || "—", bad.has("date")] : null,
    d.kind === "forecast" ? ["Product", form.product === "ensemble" ? "Full ensemble" : "Simplified"] : null,
    req.variables.length ? ["Variables", req.variables.join(", "), bad.has("variables")] : null,
    ["Format", hydro ? "GeoParquet" : "Zarr v3, zipped"],
    ["Estimated size", `${fmtBytes(req.bytes)}${bad.has("size") ? ` · limit ${MAX_BROWSER_MB} MB` : ""}`, bad.has("size")]
  ].filter(Boolean);

  let step = 0;
  const num = () => ++step;

  return (
    <form class="download" id="download-form" novalidate onSubmit={submit}>
      <section class="form-card">
        <h3><span class="num">{num()}</span>Area of interest</h3>
        <div class="seg modes" role="radiogroup" aria-label="Selection method">
          {MODES.map(m => (
            <button key={m.id} type="button" role="radio" data-mode={m.id}
                    class={`btn seg-btn ${sel.mode === m.id ? "on" : ""}`} aria-checked={sel.mode === m.id}
                    onClick={() => selection.setMode(m.id)}>{m.label}</button>
          ))}
        </div>
        <div class="aoi">
          <div class="aoi-map" id="aoi-map" ref={mapEl}/>
          <div class="aoi-side">
            <div class="aoi-stats" id="aoi-stats">
              <div class="stat"><span class="k">Rivers</span><span class="v">{reaches == null ? "—" : fmtInt(reaches)}</span></div>
              <div class="stat"><span class="k">Ranges</span><span class="v">{sel.mode === "global" ? "all" : fmtInt(sel.spans.length)}</span></div>
              <div class="stat"><span class="k">Regions</span><span class="v">{sel.mode === "global" ? (regionRuns()?.length ?? "—") : fmtInt(sel.regions.length)}</span></div>
            </div>
            <ul class="aoi-items" id="aoi-items">
              {items(sel).map(it => (
                <li class={it.kind} key={`${it.kind}-${it.key}`}>
                  <button type="button" class="linkish" onClick={() => mapRef.current?.flyTo({lon: it.rec.lon, lat: it.rec.lat})}>
                    <span class={`dot ${it.kind}`}/><span>{it.label}</span><code>{it.key}</code>
                    {it.rec.count && it.kind !== "reach" ? <span class="muted">{fmtInt(it.rec.count)}</span> : null}
                  </button>
                  <button type="button" class="btn mini" aria-label="Remove"
                          onClick={() => selection.remove(it.kind, it.kind === "region" ? it.key : Number(it.key))}>
                    <Icon name="close"/>
                  </button>
                </li>
              ))}
            </ul>
            <button type="button" class="btn sm-text" id="aoi-clear" disabled={sel.mode === "global" || sel.empty}
                    onClick={() => selection.clear()}>
              <Icon name="trash"/><span>Clear</span>
            </button>
          </div>
        </div>
      </section>

      <Options dataset={d} form={form} set={set} num={num} coverage={coverage} onQuickRange={quickRange}/>

      <section class="form-card">
        <h3><span class="num">{num()}</span>Format</h3>
        <label class="radio-line">
          <input type="radio" name="format" checked/>
          <span>{hydro ? "GeoParquet (.geo.parquet)" : "Zarr v3 (.zarr.zip)"}</span>
        </label>
      </section>

      <section class={`form-card ${user && termsAccepted ? "" : "needs"}`} id="sec-terms">
        <h3><span class="num">{num()}</span>Terms of use</h3>
        <p><a href={d.license.url} target="_blank" rel="noopener">{d.license.name} <Icon name="external"/></a></p>
        <ul class="terms">{d.license.summary.map(t => <li key={t}>{t}</li>)}</ul>
        <div class="row" id="terms-action">
          {!user
            ? <button type="button" class="btn primary" id="terms-sign-in" onClick={() => auth.signIn()}><Icon name="signIn"/><span>Sign in</span></button>
            : termsAccepted
              ? <span class="accepted"><Icon name="shield"/><span>Terms accepted</span></span>
              : <button type="button" class="btn primary" id="terms-accept" onClick={() => auth.acceptTerms()}><Icon name="check"/><span>Accept terms</span></button>}
        </div>
      </section>

      <section class="form-card" id="sec-request">
        <h3><span class="num">{num()}</span>Request</h3>
        <table class="facts request">
          <tbody id="request-rows">
            {rows.map(([k, v, err]) => <tr class={err ? "bad" : ""} key={k}><th>{k}</th><td>{v}</td></tr>)}
          </tbody>
        </table>
        <div class="row submit-row">
          <button type="submit" class="btn primary" id="btn-download" disabled={!ready}><Icon name="download"/><span>Download</span></button>
          {progress == null ? null : <button type="button" class="btn" id="btn-cancel" onClick={() => running.current?.abort()}>Cancel</button>}
          {progress == null ? null : (
            <div class="progress grow" id="progress">
              <div class="progress-fill" id="progress-fill" style={{width: `${Math.round(progress * 100)}%`}}/>
            </div>
          )}
        </div>
        {error ? <p class="error-line" id="run-error">{error}</p> : null}
      </section>

      <section class="form-card">
        <h3><span class="num">{num()}</span>Download it yourself</h3>
        <div class="seg cli-tabs" role="tablist">
          {CLI_TABS.map(([id, label]) => (
            <button key={id} type="button" data-cli={id} class={`btn seg-btn ${cliTab === id ? "on" : ""}`}
                    onClick={() => setCliTab(id)}>{label}</button>
          ))}
        </div>
        <div class="code">
          <pre><code id="cli-code">{code}</code></pre>
          <button type="button" class="btn icon copy" id="cli-copy" aria-label="Copy"
                  onClick={e => navigator.clipboard?.writeText(code).then(() => {
                    const b = e.currentTarget;
                    b.classList.add("done");
                    setTimeout(() => b.classList.remove("done"), 1200);
                  })}>
            <Icon name="clipboard"/><Icon name="check"/>
          </button>
        </div>
      </section>
    </form>
  );
}

/** What the selection holds, as rows: an outlet and its inlets, watersheds, reaches or regions. */
function items(sel) {
  const out = [];
  if (sel.mode === "aoi" && sel.outlets[0]) out.push({kind: "outlet", rec: sel.outlets[0], label: "Outlet", key: sel.outlets[0].riverId});
  sel.inlets.forEach(r => out.push({kind: "inlet", rec: r, label: "Inlet", key: r.riverId}));
  if (sel.mode === "watershed") sel.outlets.forEach(r => out.push({kind: "watershed", rec: r, label: "Watershed", key: r.riverId}));
  sel.reaches.forEach(r => out.push({kind: "reach", rec: r, label: "River", key: r.riverId}));
  sel.regionIds.forEach(r => out.push({kind: "region", rec: {}, label: "Region", key: r}));
  return out;
}

function Options({dataset: d, form, set, num, coverage, onQuickRange}) {
  if (d.kind === "timeseries") {
    return (
      <section class="form-card">
        <h3><span class="num">{num()}</span>Time range</h3>
        <div class="fields">
          <label class="field"><span>Start</span>
            <input type="date" name="start" value={form.start ?? ""} onInput={e => set({start: e.currentTarget.value})}/>
          </label>
          <label class="field"><span>End</span>
            <input type="date" name="end" value={form.end ?? ""} onInput={e => set({end: e.currentTarget.value})}/>
          </label>
          <div class="field"><span>Available</span><span class="value" id="coverage">{coverage}</span></div>
        </div>
        <div class="row wrap quick">
          {d.stepHours <= 24 ? (
            <>
              <button type="button" class="btn chip-btn" onClick={() => onQuickRange("30")}>Last 30 days</button>
              <button type="button" class="btn chip-btn" onClick={() => onQuickRange("365")}>Last year</button>
              <button type="button" class="btn chip-btn" onClick={() => onQuickRange("3653")}>Last 10 years</button>
            </>
          ) : null}
          <button type="button" class="btn chip-btn" onClick={() => onQuickRange("all")}>Full record</button>
        </div>
      </section>
    );
  }
  if (d.kind === "forecast") {
    return (
      <section class="form-card">
        <h3><span class="num">{num()}</span>Forecast</h3>
        <div class="fields">
          <label class="field"><span>Initialization date (00 UTC)</span>
            <input type="date" name="date" value={form.date ?? ""} onInput={e => set({date: e.currentTarget.value})}/>
          </label>
        </div>
        {form.available === false ? <p class="error-line" id="date-missing">No forecast is published for this date.</p> : null}
        <div class="choices">
          <label class="choice">
            <input type="radio" name="product" value="simplified" checked={form.product === "simplified"}
                   onChange={() => set({product: "simplified"})}/>
            <span class="col">
              <strong>Simplified forecast</strong>
              <span>Ensemble percentiles (0, 10 … 90, 100) and mean. <code>Qpercentiles</code>, <code>Qmean</code></span>
            </span>
          </label>
          <label class="choice">
            <input type="radio" name="product" value="ensemble" checked={form.product === "ensemble"}
                   onChange={() => set({product: "ensemble"})}/>
            <span class="col">
              <strong>Full ensemble</strong>
              <span>All 51 members. <code>Q</code></span>
            </span>
          </label>
        </div>
      </section>
    );
  }
  if (d.store === "fdc") {
    return (
      <section class="form-card">
        <h3><span class="num">{num()}</span>Variables</h3>
        <div class="option-grid">
          <fieldset>
            <legend>Series</legend>
            {d.series.map(x => (
              <label class="checkline" key={x}>
                <input type="checkbox" name="series" value={x} checked={form.series.includes(x)}
                       onChange={e => set({series: toggle(form.series, x, e.currentTarget.checked)})}/>
                <span>{x[0].toUpperCase() + x.slice(1)}</span>
              </label>
            ))}
          </fieldset>
        </div>
        <p class="small muted">Exceedance probabilities: every whole percent, 0 to 100</p>
      </section>
    );
  }
  if (d.kind === "static") {
    return (
      <section class="form-card">
        <h3><span class="num">{num()}</span>Variables</h3>
        <div class="option-grid">
          <fieldset>
            <legend>Distribution</legend>
            {d.distributions.map(x => (
              <label class="checkline" key={x}>
                <input type="checkbox" name="distribution" value={x} checked={form.distributions.includes(x)}
                       onChange={e => set({distributions: toggle(form.distributions, x, e.currentTarget.checked)})}/>
                <span>{DISTRIBUTION_LABELS[x]}</span>
              </label>
            ))}
          </fieldset>
          <fieldset>
            <legend>Annual maximum series</legend>
            {d.series.map(x => (
              <label class="checkline" key={x}>
                <input type="checkbox" name="series" value={x} checked={form.series.includes(x)}
                       onChange={e => set({series: toggle(form.series, x, e.currentTarget.checked)})}/>
                <span>{x[0].toUpperCase() + x.slice(1)}</span>
              </label>
            ))}
          </fieldset>
          <fieldset>
            <legend>Also include</legend>
            <label class="checkline">
              <input type="checkbox" name="maxSimulated" checked={form.maxSimulated}
                     onChange={e => set({maxSimulated: e.currentTarget.checked})}/>
              <span>Maximum simulated flow</span>
            </label>
          </fieldset>
        </div>
        <p class="small muted">Recurrence intervals: {d.recurrenceIntervals.join(", ")} years</p>
      </section>
    );
  }
  return null;
}

const toggle = (list, value, on) => (on ? [...list, value] : list.filter(x => x !== value));
