/**
 * Everything the store offers, as data. The pages are all drawn from this: the version cards on the
 * home page, the category listings, and each dataset's overview, download form and sidebar.
 *
 * A dataset's `kind` decides which download form it gets:
 *   hydrography   GeoParquet, published whole per region and subset by riverIndex
 *   timeseries    a Zarr store on (time, riverId), subset by time range and riverIndex
 *   static        a Zarr store with no time axis to cut (return periods)
 *   forecast      one Zarr store per initialization date, ensemble or simplified
 *   archive       v1 / v2, browse only with instructions for getting the files some other way
 */

export const LICENSE = {
  id: "CC-BY-NC-SA-4.0",
  name: "Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International",
  short: "CC BY-NC-SA 4.0",
  url: "https://creativecommons.org/licenses/by-nc-sa/4.0/",
  summary: [
    "You may copy and redistribute the data in any medium or format and adapt, transform and build upon it.",
    "You must give appropriate credit to GEOGLOWS and the River Forecast System, provide a link to the license, and indicate if changes were made.",
    "You may not use the data for commercial purposes without a separate agreement.",
    "If you remix, transform, or build upon the data, you must distribute your contributions under the same license."
  ]
};

export const CITATION = "GEOGLOWS River Forecast System. Global hydrography, retrospective simulation and ensemble streamflow forecasts. GEOGLOWS, ECMWF.";

export const VERSIONS = [
  {
    id: "v3",
    title: "RFS v3",
    status: "Current",
    downloadable: true,
    summary: "The current River Forecast System: 4.9 million reaches on TDX-Hydro, an hourly retrospective simulation, and 15-day ensemble forecasts issued daily.",
    years: "2026 – present"
  },
  {
    id: "v2",
    title: "RFS v2",
    status: "Archive",
    downloadable: false,
    summary: "The second generation GEOGLOWS model on TDX-Hydro with 6.8 million reaches. Browse what exists and get the files directly from the public buckets.",
    years: "2024 – 2026"
  },
  {
    id: "v1",
    title: "RFS v1",
    status: "Archive",
    downloadable: false,
    summary: "The original ECMWF-hosted GEOGLOWS streamflow service on the HydroSHEDS derived regional networks. Preserved for reproducibility.",
    years: "2019 – 2024"
  }
];

export const CATEGORIES = [
  {
    id: "hydrography",
    title: "Hydrography",
    summary: "The river network the model runs on: stream centerlines, catchment boundaries, confluence points and lakes, with the attributes the routing uses."
  },
  {
    id: "retrospective",
    title: "Retrospective",
    summary: "The retrospective simulation of discharge on every reach and the statistics derived from it: aggregated series, annual maximums and return periods."
  },
  {
    id: "forecasts",
    title: "Forecasts",
    summary: "15-day ensemble discharge forecasts issued daily, as the full ensemble or as its percentiles and mean."
  },
  {
    id: "floodmaps",
    title: "Flood maps",
    summary: "Flood extent and depth where the forecast leaves its banks, and the FLDPLN libraries the flood mapper reads to make them."
  }
];

/**
 * TODO: created/updated are placeholders. They will be read on demand from the sentinel json each
 * product writes beside itself in the bucket — see src/data/sentinel.js — and these go away.
 */
const PLACEHOLDER_DATES = {created: "2026-03-01", updated: "2026-09-21"};

// TODO: placeholder changelogs, to be read from the same sentinel json as the dates.
const HYDRO_CHANGELOG = [
  {date: "2026-09-01", version: "3.0.2", note: "Added river names and TDXHydroRegion to every stream reach."},
  {date: "2026-06-15", version: "3.0.1", note: "Rewrote region files with 50,000 row groups sorted on riverIndex so a watershed reads in one range request."},
  {date: "2026-03-01", version: "3.0.0", note: "First release of the v3 hydrography."}
];

const RETRO_CHANGELOG = [
  {date: "2026-09-21", version: "3.0.3", note: "Appended the most recent days of simulation."},
  {date: "2026-07-01", version: "3.0.2", note: "Rechunked Q as one shard per river so a single reach reads its whole series in one request."},
  {date: "2026-03-01", version: "3.0.0", note: "First release of the v3 retrospective simulation."}
];

const FORECAST_CHANGELOG = [
  {date: "2026-07-10", version: "3.0.1", note: "Added Qpercentiles and Qmean ensemble summaries beside the members."},
  {date: "2026-03-01", version: "3.0.0", note: "First v3 forecasts, 51 members at 3-hourly steps for 15 days."}
];

const V3_COMMON = {
  version: "v3",
  license: LICENSE,
  provider: "GEOGLOWS",
  spatialCoverage: "Global",
  crs: "EPSG:3857",
  ...PLACEHOLDER_DATES
};

const hydro = (id, title, file, geometry, summary, extra = {}) => ({
  ...V3_COMMON,
  id,
  category: "hydrography",
  kind: "hydrography",
  layer: file,
  title,
  summary,
  formats: ["GeoParquet"],
  geometry,
  temporalCoverage: "Static",
  temporalResolution: "None",
  updateFrequency: "With each model version",
  changelog: HYDRO_CHANGELOG,
  ...extra
});

const retro = (id, title, summary, extra) => ({
  ...V3_COMMON,
  id,
  category: "retrospective",
  kind: "timeseries",
  formats: ["Zarr"],
  variables: [{name: "Q", units: "m3 s-1", dims: "(riverId, time)", description: "Discharge at the catchment outlet, left aligned on its time step."}],
  temporalCoverage: "1940-01-01 to present",
  changelog: RETRO_CHANGELOG,
  title,
  summary,
  ...extra
});

export const DATASETS = [
  // ── v3 hydrography ──────────────────────────────────────────────────────
  hydro("streams", "Stream centerlines", "streams", "LineString",
    "One line per river reach with its topology, length, stream order, routing parameters and the riverIndex that keys every other dataset.",
    {
      columns: [
        ["riverId", "int32", "Unique reach identifier, the TDX-Hydro LINKNO."],
        ["nextRiverId", "int32", "riverId of the next reach downstream, or -1 at an outlet."],
        ["outletRiverId", "int32", "riverId of the terminal reach the watershed drains to."],
        ["riverIndex", "int32", "Position on the topological axis every Zarr store shares."],
        ["upstreamCount", "int32", "Reaches upstream; everything upstream is the contiguous run riverIndex − upstreamCount … riverIndex."],
        ["strahlerOrder", "int32", "Strahler stream order."],
        ["shreveOrder", "int32", "Shreve stream magnitude."],
        ["USContArea", "float", "Contributing area at the upstream end, m²."],
        ["DSContArea", "float", "Contributing area at the downstream end, m²."],
        ["areaM2", "float", "Area of the reach's own catchment, m²."],
        ["Length", "float", "Reach length, m."],
        ["TDXHydroRegion", "int", "HydroBASINS level 2 region the reach belongs to."],
        ["musk_k", "float", "Muskingum k routing parameter."],
        ["musk_x", "float", "Muskingum x routing parameter."],
        ["velocity_factor", "float", "Velocity scaling used to derive musk_k."],
        ["geometry", "LineString", "Reach centerline."]
      ]
    }),
  hydro("catchments", "Catchment boundaries", "catchments", "Polygon",
    "The land area draining directly to each reach, one polygon per riverId.",
    {
      columns: [
        ["riverId", "int32", "The reach the catchment drains to."],
        ["riverIndex", "int32", "Position on the topological axis."],
        ["geometry", "Polygon", "Catchment boundary."]
      ]
    }),
  hydro("confluences", "Confluence points", "confluences", "Point",
    "A point at every junction where two or more reaches meet, keyed to the reach that leaves it.",
    {
      // No riverIndex column: a subset is matched on the riverIds of the selected reaches instead.
      joinOn: "riverId",
      columns: [
        ["riverId", "int32", "The reach flowing out of the confluence."],
        ["upstream_ids", "string", "Comma separated riverIds of the reaches meeting at the confluence."],
        ["geometry", "Point", "Confluence location."]
      ]
    }),
  hydro("lakes", "Lakes", "lakes", "Polygon",
    "Lake and reservoir polygons the routing treats specially, with the reaches that enter and leave them.",
    {
      // TODO: lakes are in the spec but not yet published or in riverforecastsystem's url builders.
      preview: true,
      columns: [
        ["lakeId", "int32", "Unique lake identifier."],
        ["outletRiverId", "int32", "The reach leaving the lake."],
        ["riverIndex", "int32", "riverIndex of the outlet reach."],
        ["areaSqKm", "float32", "Surface area in square kilometers."],
        ["geometry", "Polygon", "Lake outline."]
      ]
    }),

  // ── v3 retrospective ────────────────────────────────────────────────────
  retro("retrospective-hourly", "Hourly discharge", "The native resolution of the retrospective simulation: hourly mean discharge on every reach.",
    {resolution: "hourly", stepHours: 1, temporalResolution: "1 hour", updateFrequency: "Daily"}),
  retro("retrospective-daily", "Daily discharge", "Daily mean discharge on every reach, aggregated from the hourly simulation.",
    {resolution: "daily", stepHours: 24, temporalResolution: "1 day", updateFrequency: "Daily"}),
  retro("retrospective-monthly", "Monthly discharge", "Calendar month mean discharge on every reach.",
    {resolution: "monthly", stepHours: 730.5, temporalResolution: "1 month", updateFrequency: "Monthly on the 5th"}),
  retro("retrospective-yearly", "Yearly discharge", "Calendar year mean discharge on every reach.",
    {resolution: "yearly", stepHours: 8766, temporalResolution: "1 year", updateFrequency: "Yearly on January 5"}),
  retro("return-periods", "Return periods", "Discharge at the 1.5, 2, 5, 10, 25, 50 and 100 year recurrence intervals from four distributions, each fit to both the hourly and daily annual maximums.",
    {
      kind: "static",
      store: "return-periods",
      temporalCoverage: "Fit to the full retrospective record",
      temporalResolution: "None",
      updateFrequency: "With each model version",
      recurrenceIntervals: [1.5, 2, 5, 10, 25, 50, 100],
      distributions: ["gumbel", "logpearson3", "lognormal", "weibull"],
      series: ["hourly", "daily"],
      variables: [
        {name: "<distribution>_<series>", units: "m3 s-1", dims: "(riverId, recurrence_interval)", description: "Flow at each recurrence interval, e.g. gumbel_hourly."},
        {name: "max_simulated_<series>", units: "m3 s-1", dims: "(riverId)", description: "Largest value in the retrospective record."}
      ]
    }),
  retro("flow-duration-curves", "Flow duration curves", "The flow each reach exceeds at every whole percent of the record, fit to both the hourly and daily series.",
    {
      kind: "static",
      store: "fdc",
      temporalCoverage: "Derived from the full retrospective record",
      temporalResolution: "None",
      updateFrequency: "With each model version",
      pExceed: true,
      series: ["hourly", "daily"],
      variables: [{name: "<series>_annual", units: "m3 s-1", dims: "(riverId, p_exceed)", description: "Flow exceeded p percent of the time, e.g. hourly_annual[95] is Q95."}]
    }),
  retro("annual-maximums-hourly", "Annual maximums (hourly)", "The largest hourly discharge of each year on every reach — the series the hourly return period fits are made from.",
    {
      store: "maximums",
      variable: "hourly",
      stepHours: 8766,
      temporalResolution: "1 year",
      updateFrequency: "Yearly on January 5",
      variables: [{name: "hourly", units: "m3 s-1", dims: "(riverId, time)", description: "Annual maximum of the hourly series."}]
    }),
  retro("annual-maximums-daily", "Annual maximums (daily)", "The largest daily mean discharge of each year on every reach — the series the daily return period fits are made from.",
    {
      store: "maximums",
      variable: "daily",
      stepHours: 8766,
      temporalResolution: "1 year",
      updateFrequency: "Yearly on January 5",
      variables: [{name: "daily", units: "m3 s-1", dims: "(riverId, time)", description: "Annual maximum of the daily mean series."}]
    }),

  // ── v3 forecasts ────────────────────────────────────────────────────────
  {
    ...V3_COMMON,
    id: "forecast-15day",
    category: "forecasts",
    kind: "forecast",
    title: "15-day ensemble forecast",
    summary: "Discharge forecasts for every reach issued daily at 00 UTC: 51 ensemble members at 3-hourly steps for 15 days, or their percentiles and mean.",
    formats: ["Zarr"],
    temporalCoverage: "15 days from each initialization",
    temporalResolution: "3 hours",
    updateFrequency: "Daily, available 06–12 UTC",
    stepHours: 3,
    steps: 120,
    members: 51,
    changelog: FORECAST_CHANGELOG,
    variables: [
      {name: "Q", units: "m3 s-1", dims: "(riverId, member, time)", description: "Discharge for each of the 50 perturbed members and the control."},
      {name: "Qpercentiles", units: "m3 s-1", dims: "(riverId, percentiles, time)", description: "Ensemble deciles 0 (min), 10 … 50 (median) … 90, 100 (max)."},
      {name: "Qmean", units: "m3 s-1", dims: "(riverId, time)", description: "Ensemble mean."}
    ]
  },


  // ── v3 flood maps ───────────────────────────────────────────────────────
  // Tiled rather than published per reach, so nothing here is subset by the area of interest yet:
  // these pages say where the tiles are and how to get them.
  // TODO: browser downloads for flood maps, once a tile index the map can query is published.
  {
    ...V3_COMMON,
    id: "forecast-flood-maps",
    category: "floodmaps",
    categories: ["floodmaps", "forecasts"],
    kind: "external",
    preview: true,
    title: "Forecast flood maps",
    summary: "The extent and depth of flooding implied by each day's forecast, as vector extents per forecast and as raster tiles.",
    formats: ["GeoParquet", "GeoTIFF"],
    temporalCoverage: "15 days from each initialization",
    temporalResolution: "3 hours",
    updateFrequency: "Daily, available 06–12 UTC",
    path: "forecasts15/year=YYYY/month=MM/day=DD/fim.geo.parquet",
    alsoPath: "flood-maps/lat=YYY/lon=XXX/arc/",
    changelog: FORECAST_CHANGELOG,
    files: [
      ["fim.geo.parquet", "GeoParquet", "Vector flood extent polygons for the whole forecast."],
      ["arc/fim.tiff", "GeoTIFF", "Flood inundation extent for one tile."],
      ["arc/depth.tiff", "GeoTIFF", "Inundation depth for one tile."],
      ["arc/velocity.tiff", "GeoTIFF", "Flow velocity for one tile."]
    ]
  },
  {
    ...V3_COMMON,
    id: "return-period-flood-maps",
    category: "floodmaps",
    categories: ["floodmaps", "retrospective"],
    kind: "external",
    preview: true,
    title: "Return period flood maps",
    summary: "Reference inundation extent and depth for each recurrence interval, mapped from the return period discharges rather than from a forecast.",
    formats: ["GeoTIFF"],
    temporalCoverage: "Static",
    temporalResolution: "None",
    updateFrequency: "With each model version",
    path: "flood-maps/lat=YYY/lon=XXX/return-periods/",
    alsoPath: "flood-maps/tile_boundaries.pmtiles",
    changelog: RETRO_CHANGELOG,
    recurrenceIntervals: [1.5, 2, 5, 10, 25, 50, 100],
    files: [
      ["return-periods/fim_<interval>.tiff", "GeoTIFF", "Inundation extent at one recurrence interval."],
      ["return-periods/depth_<interval>.tiff", "GeoTIFF", "Inundation depth at one recurrence interval."],
      ["tile_boundaries.pmtiles", "PMTiles", "Tile outlines, for drawing what is mapped."]
    ]
  },

  {
    ...V3_COMMON,
    id: "fldpln-libraries",
    category: "floodmaps",
    kind: "external",
    preview: true,
    title: "FLDPLN libraries",
    summary: "The per-tile flood library the flood mapper reads to turn a discharge into an inundation depth, with the tile boundaries that index it.",
    formats: ["Zarr", "PMTiles"],
    temporalCoverage: "Static",
    temporalResolution: "None",
    updateFrequency: "With each model version",
    path: "flood-maps/lat=YYY/lon=XXX/fldpln.zarr/",
    alsoPath: "flood-maps/tile_boundaries.pmtiles",
    changelog: HYDRO_CHANGELOG,
    files: [
      ["fldpln.zarr/", "Zarr v3", "The FLDPLN library for one tile, read directly by the flood worker."],
      ["manifest.json", "JSON", "The tiling: which tiles exist and what they cover."],
      ["tile_boundaries.pmtiles", "PMTiles", "Tile outlines, for drawing what is mappable."]
    ]
  },

  // ── v2 archive ──────────────────────────────────────────────────────────
  // Paths verified against the public bucket listing.
  ...archive("v2", [
    ["hydrography", "streams", "Stream centerlines", "TDX-Hydro stream lines with model attributes, one GeoPackage per VPU, plus a global PMTiles archive.", "hydrography/vpu=<vpu>/streams_<vpu>.gpkg"],
    ["hydrography", "catchments", "Catchment boundaries", "TDX-Hydro catchments, one Parquet per VPU.", "hydrography/vpu=<vpu>/catchments_<vpu>.parquet"],
    ["hydrography", "lakes", "Lakes and nexus points", "Lake polygons and nexus points per VPU, and the global lake layer.", "hydrography/vpu=<vpu>/lakes_<vpu>.gpkg"],
    ["retrospective", "retrospective-hourly", "Hourly discharge", "Hourly retrospective simulation, 1940 to the end of the v2 record.", "retrospective/hourly.zarr"],
    ["retrospective", "retrospective-daily", "Daily discharge", "Daily mean retrospective discharge.", "retrospective/daily.zarr"],
    ["retrospective", "retrospective-monthly", "Monthly discharge", "Monthly mean retrospective discharge, as a series and as time steps.", "retrospective/monthly-timeseries.zarr"],
    ["retrospective", "retrospective-yearly", "Yearly discharge", "Yearly mean retrospective discharge, as a series and as time steps.", "retrospective/yearly-timeseries.zarr"],
    ["retrospective", "annual-maximums", "Annual maximums", "Annual maximum discharge, the series the v2 return periods were fit to.", "retrospective/maximums.zarr"],
    ["retrospective", "return-periods", "Return periods", "Gumbel return periods fit to the annual maximums.", "retrospective/return-periods.zarr"],
    ["retrospective", "flow-duration-curves", "Flow duration curves", "Exceedance probability curves for every reach.", "retrospective/fdc.zarr"],
    ["forecasts", "forecast-15day", "15-day ensemble forecast", "52 member 15-day forecasts, one store per initialization named YYYYMMDD00.zarr.", "YYYYMMDD00.zarr"]
  ]),

  // ── v1 archive ──────────────────────────────────────────────────────────
  ...archive("v1", [
    ["hydrography", "streams", "Regional stream networks", "The HydroSHEDS derived drainage lines for each of the v1 regions.", "hydrography/"],
    ["retrospective", "retrospective-daily", "ERA5 historical simulation", "Daily discharge driven by ERA5 for each region, 1979 onward.", "retrospective/"],
    ["retrospective", "return-periods", "Return periods", "Return periods fit to the ERA5 historical simulation.", "retrospective/"],
    ["forecasts", "forecast-15day", "15-day ensemble forecast", "Archived daily ensemble forecasts by region.", "forecasts/"]
  ])
];

function archive(version, rows) {
  const root = {v2: "s3://geoglows-v2", v1: "s3://river-forecast-system/v1"}[version];
  return rows.map(([category, id, title, summary, path]) => ({
    version,
    id,
    category,
    kind: "archive",
    title,
    summary,
    formats: [path.endsWith(".zarr") ? "Zarr"
      : path.endsWith(".gpkg") ? "GeoPackage"
        : path.endsWith(".parquet") ? "Parquet"
          : version === "v1" ? "NetCDF" : "Zarr"],
    archivePath: path,
    archiveRoot: version === "v2" && category === "forecasts" ? "s3://geoglows-v2-forecasts" : root,
    license: LICENSE,
    provider: "GEOGLOWS",
    spatialCoverage: "Global",
    temporalCoverage: version === "v2" ? "1940 – 2026" : "1979 – 2024",
    temporalResolution: category === "hydrography" ? "None" : "See documentation",
    updateFrequency: "No longer updated",
    created: version === "v2" ? "2024-01-01" : "2019-06-01",
    updated: version === "v2" ? "2026-03-01" : "2024-06-30",
    changelog: [{date: version === "v2" ? "2026-03-01" : "2024-06-30", version: `${version.slice(1)}.x`, note: "Archived. Superseded by RFS v3; no further updates."}]
  }));
}

/**
 * A product's short name is its `id`: unique within a model version, stable, and what the address
 * of its page is built from — /rfs-data-store/datasets/v3/retrospective-daily. Other tools can
 * build that link from the version and the short name alone, which is why the category is a filter
 * here rather than a path segment.
 *
 * The names are the ones in the "Product short names" table of each version's specification
 * document; this list follows that one.
 */
export const shortName = d => d.id;

/**
 * Which categories a dataset is listed under. Most sit under one; a product that is genuinely two
 * things — the forecast flood maps are a forecast and a flood map — carries `categories` and is
 * listed under each, while `category` stays the one its address is built from.
 */
export const categoriesOf = d => d.categories ?? [d.category];

export const versionById = id => VERSIONS.find(v => v.id === id) ?? null;
export const categoryById = id => CATEGORIES.find(c => c.id === id) ?? null;
export const datasetsFor = (version, category) =>
  DATASETS.filter(d => d.version === version && (!category || categoriesOf(d).includes(category)));
export const datasetById = (version, id) =>
  DATASETS.find(d => d.version === version && d.id === id) ?? null;
