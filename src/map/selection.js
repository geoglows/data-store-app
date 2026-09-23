import {aoiSpans, isDownstreamOf, spanCount, upstreamRange} from "riverforecastsystem/v3/hydrography";

/**
 * What the area of interest holds, as runs of riverIndex.
 *
 * Every reach upstream of a reach is a contiguous run of riverIndex ending at it, so every way of
 * picking rivers comes out as a short list of runs:
 *
 *   global      the whole axis
 *   region      one run per HydroBASINS level 2 region
 *   watershed   one run per picked outlet, merged where one sits inside another
 *   aoi         an outlet's run with the runs above each inlet cut out ("rivers between 2+ points")
 *   reach       one run of length one per picked reach
 *
 * No reach drains across a region boundary, so a run never spans two regions and each run carries
 * the region its rows are published in.
 */
export const MODES = [
  {id: "watershed", label: "Watersheds"},
  {id: "aoi", label: "Rivers between points"},
  {id: "reach", label: "Individual rivers"},
  {id: "region", label: "Regions"},
  {id: "global", label: "Entire globe"}
];

const num = v => (v == null || v === "" ? null : Number(v));

/** A clicked tile feature as the numbers a subset is cut from. */
export function recordFromFeature(f, lngLat) {
  const p = f.properties ?? {};
  const riverId = num(p.riverId);
  const riverIndex = num(p.riverIndex);
  const upstreamCount = num(p.upstreamCount);
  if (riverId == null || riverIndex == null || upstreamCount == null) return null;
  const run = upstreamRange({riverIndex, upstreamCount});
  return {
    riverId,
    riverIndex,
    upstreamCount,
    lo: run.lo,
    hi: run.hi,
    count: run.count,
    region: p.TDXHydroRegion == null ? null : String(p.TDXHydroRegion),
    order: num(p.strahlerOrder),
    lon: lngLat?.lng ?? null,
    lat: lngLat?.lat ?? null
  };
}

// The package has subtractSpans but no merge, and this one also has to keep regions apart.
// TODO: move to the package once it publishes a region-aware mergeSpans.
/** Sort and merge runs that overlap or touch, never across regions. */
function mergeSpans(spans) {
  const sorted = [...spans].sort((a, b) => a.lo - b.lo);
  const out = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && last.region === s.region && s.lo <= last.hi + 1) last.hi = Math.max(last.hi, s.hi);
    else out.push({...s});
  }
  return out;
}

export function createSelection({regionRuns}) {
  let mode = "watershed";
  const st = {
    watersheds: [],
    reaches: [],
    regions: [],
    aoi: {outlet: null, inlets: []}
  };
  const listeners = new Set();
  const emit = () => listeners.forEach(fn => fn(summary()));

  function spans() {
    switch (mode) {
      case "global": {
        const runs = regionRuns();
        return runs ? runs.map(r => ({...r})) : [];
      }
      case "region": {
        const runs = regionRuns() ?? [];
        return st.regions.map(id => runs.find(r => r.region === id)).filter(Boolean).map(r => ({...r}));
      }
      case "watershed":
        return mergeSpans(st.watersheds.map(w => ({lo: w.lo, hi: w.hi, region: w.region})));
      case "reach":
        return mergeSpans(st.reaches.map(r => ({lo: r.riverIndex, hi: r.riverIndex, region: r.region})));
      case "aoi": {
        const {outlet, inlets} = st.aoi;
        return aoiSpans(outlet, inlets).map(s => ({...s, region: outlet.region}));
      }
      default:
        return [];
    }
  }

  function summary() {
    const list = spans();
    return {
      mode,
      spans: list,
      count: mode === "global" && !list.length ? null : spanCount(list),
      regions: [...new Set(list.map(s => s.region))],
      outlets: mode === "watershed" ? st.watersheds : mode === "aoi" && st.aoi.outlet ? [st.aoi.outlet] : [],
      inlets: mode === "aoi" ? st.aoi.inlets : [],
      reaches: mode === "reach" ? st.reaches : [],
      regionIds: mode === "region" ? st.regions : [],
      empty: mode !== "global" && !list.length
    };
  }

  const toggleBy = (list, rec, key) => {
    const i = list.findIndex(x => x[key] === rec[key]);
    if (i >= 0) list.splice(i, 1);
    else list.push(rec);
  };

  return {
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    summary,
    get mode() {
      return mode;
    },
    setMode(next) {
      if (next === mode) return;
      mode = next;
      emit();
    },
    /** One click on the map, read according to the mode. */
    pick(rec) {
      if (!rec) return;
      switch (mode) {
        case "watershed":
          toggleBy(st.watersheds, rec, "riverId");
          break;
        case "reach":
          toggleBy(st.reaches, rec, "riverId");
          break;
        case "region":
          if (rec.region) {
            const i = st.regions.indexOf(rec.region);
            if (i >= 0) st.regions.splice(i, 1);
            else st.regions.push(rec.region);
          }
          break;
        case "aoi": {
          const a = st.aoi;
          // The first click is the outlet. After that a click inside the outlet's watershed adds or
          // removes an inlet; a click on the outlet or outside it starts over from there.
          if (!a.outlet || rec.riverId === a.outlet.riverId || rec.hi < a.outlet.lo || rec.hi > a.outlet.hi) {
            const downstream = isDownstreamOf(rec, a.outlet);
            a.outlet = rec.riverId === a.outlet?.riverId ? null : rec;
            if (!downstream) a.inlets = [];
          } else {
            toggleBy(a.inlets, rec, "riverId");
          }
          break;
        }
        default:
          return;
      }
      emit();
    },
    remove(kind, key) {
      if (kind === "watershed") st.watersheds = st.watersheds.filter(w => w.riverId !== key);
      if (kind === "reach") st.reaches = st.reaches.filter(r => r.riverId !== key);
      if (kind === "region") st.regions = st.regions.filter(r => r !== key);
      if (kind === "inlet") st.aoi.inlets = st.aoi.inlets.filter(r => r.riverId !== key);
      if (kind === "outlet") st.aoi = {outlet: null, inlets: []};
      emit();
    },
    clear() {
      if (mode === "watershed") st.watersheds = [];
      if (mode === "reach") st.reaches = [];
      if (mode === "region") st.regions = [];
      if (mode === "aoi") st.aoi = {outlet: null, inlets: []};
      emit();
    },
    refresh: emit
  };
}
