import {addProtocol, Map as MaplibreMap, NavigationControl, removeProtocol, setWorkerUrl} from "maplibre-gl";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import {Protocol} from "pmtiles";
import {streamsPmtiles} from "../data/sources.js";
import {currentTheme, onThemeChange} from "../ui/theme.js";
import {recordFromFeature} from "./selection.js";

setWorkerUrl(maplibreWorkerUrl);

const BASEMAPS = {
  dark: "https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
  light: "https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}"
};

// The map's colors are data, not chrome, and match the hydrography explorer's: the network in the
// standard blue, a selection washed amber, its outlet and inlets in the dark orange drawn over it.
const COLORS = {stream: "#3182bd", upstream: "#F5A623", outlet: "#B45309", inlet: "#ef4444"};

const noMatch = prop => ["in", ["get", prop], ["literal", []]];
const inFilter = (prop, ids) => (ids?.length ? ["in", ["get", prop], ["literal", ids]] : noMatch(prop));
const spanExpr = ({lo, hi}) => ["all", ["has", "riverIndex"], [">=", ["get", "riverIndex"], lo], ["<=", ["get", "riverIndex"], hi]];
const spansFilter = spans => (!spans?.length ? noMatch("riverIndex")
  : spans.length === 1 ? spanExpr(spans[0]) : ["any", ...spans.map(spanExpr)]);
const zoomInterp = stops => ["interpolate", ["linear"], ["zoom"], ...stops];
const orderWidth = (lo, hi) => ["interpolate", ["linear"], ["to-number", ["get", "strahlerOrder"], 1], 1, lo, 8, hi];

const line = (id, color, width, filter, opacity = 1) => ({
  id, type: "line", source: "streams", "source-layer": "streams",
  // A layer spec may carry no filter at all, but not a null one.
  ...(filter ? {filter} : {}),
  layout: {"line-cap": "round", "line-join": "round"},
  paint: {"line-color": color, "line-width": width, "line-opacity": opacity}
});

const CENTER = [Number(import.meta.env.VITE_MAP_CENTER_LON) || 0, Number(import.meta.env.VITE_MAP_CENTER_LAT) || 20];
const ZOOM = Number(import.meta.env.VITE_MAP_ZOOM) || 1.5;

let protocolUsers = 0;
let protocol = null;

/**
 * The area of interest picker: the streams network over a gray basemap, the current selection
 * painted on it, and clicks handed to `selection.pick()`.
 */
export function createAoiMap(container, selection) {
  if (!protocolUsers++) {
    protocol = new Protocol({metadata: true});
    addProtocol("pmtiles", protocol.tile);
  }

  const map = new MaplibreMap({
    container,
    style: {
      version: 8,
      sources: {
        "base-dark": {type: "raster", tiles: [BASEMAPS.dark], tileSize: 256, maxzoom: 16, attribution: "Esri, HERE, Garmin, © OpenStreetMap contributors"},
        "base-light": {type: "raster", tiles: [BASEMAPS.light], tileSize: 256, maxzoom: 16, attribution: "Esri, HERE, Garmin, © OpenStreetMap contributors"}
      },
      layers: [
        {id: "base-dark", type: "raster", source: "base-dark", layout: {visibility: currentTheme() === "dark" ? "visible" : "none"}},
        {id: "base-light", type: "raster", source: "base-light", layout: {visibility: currentTheme() === "dark" ? "none" : "visible"}}
      ]
    },
    center: CENTER,
    zoom: ZOOM,
    maxZoom: 13,
    maxPitch: 0,
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
    attributionControl: {compact: true}
  });
  map.touchZoomRotate.disableRotation();
  map.keyboard.disableRotation();
  map.addControl(new NavigationControl({showCompass: false}), "top-left");
  // A handle for the dev console and for tests/smoke.mjs, which has to move the camera before it
  // can click a river. Dev only.
  if (import.meta.env.DEV) window.__map = map;

  const offTheme = onThemeChange(theme => {
    if (!map.getLayer("base-dark")) return;
    map.setLayoutProperty("base-dark", "visibility", theme === "dark" ? "visible" : "none");
    map.setLayoutProperty("base-light", "visibility", theme === "dark" ? "none" : "visible");
  });

  let ready = false;
  let lastSummary = selection.summary();

  map.on("load", () => {
    map.addSource("streams", {
      type: "vector",
      url: `pmtiles://${streamsPmtiles()}`,
      promoteId: {streams: "riverId"},
      attribution: "GEOGLOWS"
    });
    map.addLayer(line("streams", COLORS.stream, orderWidth(0.6, 3.2), null, zoomInterp([2, 0.7, 9, 0.95])));
    map.addLayer(line("sel", COLORS.upstream, zoomInterp([2, 1.6, 9, 3.2, 13, 5.5]), noMatch("riverIndex"), 0.95));
    map.addLayer(line("outlets", COLORS.outlet, zoomInterp([2, 4, 9, 7, 13, 11]), noMatch("riverId")));
    map.addLayer(line("inlets", COLORS.inlet, zoomInterp([2, 4, 9, 6, 13, 9]), noMatch("riverId")));
    ready = true;
    paint(lastSummary);
  });

  function paint(s) {
    lastSummary = s;
    if (!ready) return;
    // The whole globe is every reach; painting it amber would only hide the network.
    map.setFilter("sel", s.mode === "global" ? noMatch("riverIndex") : spansFilter(s.spans));
    map.setFilter("outlets", inFilter("riverId", [...s.outlets, ...s.reaches].map(r => r.riverId)));
    map.setFilter("inlets", inFilter("riverId", s.inlets.map(r => r.riverId)));
  }
  const offSel = selection.onChange(paint);

  const hitBox = ({x, y}) => [[x - 6, y - 6], [x + 6, y + 6]];
  map.on("mousemove", (e) => {
    if (!ready || selection.mode === "global") return (map.getCanvas().style.cursor = "");
    const hit = map.queryRenderedFeatures(hitBox(e.point), {layers: ["streams"]});
    map.getCanvas().style.cursor = hit.length ? "pointer" : "";
  });
  map.on("click", (e) => {
    if (!ready || selection.mode === "global") return;
    const hits = map.queryRenderedFeatures(hitBox(e.point), {layers: ["streams"]});
    if (!hits.length) return;
    // The biggest river under the cursor is the one people aim for at a confluence.
    hits.sort((a, b) => Number(b.properties.strahlerOrder ?? 0) - Number(a.properties.strahlerOrder ?? 0));
    selection.pick(recordFromFeature(hits[0], e.lngLat));
  });

  return {
    map,
    resize: () => map.resize(),
    flyTo: ({lon, lat}) => lon != null && map.easeTo({center: [lon, lat], zoom: Math.max(map.getZoom(), 7), duration: 700}),
    destroy() {
      offSel();
      offTheme();
      map.remove();
      if (!--protocolUsers) removeProtocol("pmtiles");
    }
  };
}
