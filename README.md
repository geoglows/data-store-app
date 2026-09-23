# RFS Data Store

A Copernicus Climate Data Store style catalog for GEOGLOWS River Forecast System data: browse the
datasets by model version and category, cut an area of interest out of the river network on a map,
and download the subset as Zarr (time series) or GeoParquet (hydrography) — or copy the command that
fetches the same thing from S3 yourself.

Built to be deployed inside the apps.geoglows portal at `/rfs-data-store`, the same way
`webapp-rfs-v3` is: JavaScript, Vite, Preact with preact-iso for routing, MapLibre, and the
[`riverforecastsystem`](https://github.com/river-forecast-system/js-riverforecastsystem) package for
every data url and for the riverIndex arithmetic.

## Running it

```bash
npm install
npm run dev        # http://127.0.0.1:5173/rfs-data-store/
npm run build      # dist/, built with --base=/rfs-data-store/
npm run smoke      # headless click-through with downloads, needs `npm run dev` running
```

By default the app reads the v3 bucket, `s3://river-forecast-system-v3`, through the CDN that
`riverforecastsystem` (0.10.0) defaults to. The bucket does not hold the retrospective or forecast
Zarr stores yet, so `VITE_RFS_V3_ZARR_BASE` in `.env` points the browser's Zarr reads at the sample
tree, `https://cdn.apps.geoglows.org/rfs-v3-sample-data`, which is cut on the same riverIndex axis.
Empty it once those stores are published. To read a local copy of the v3 tree instead, symlink it
and point the app at it:

```bash
ln -s /path/to/v3-data ./data
echo 'VITE_RFS_V3_BASE=data' >> .env.local
echo 'VITE_RFS_V3_ZARR_BASE=' >> .env.local
```

`vite.config.js` serves `./data` by byte range from the dev and preview servers, which is what
PMTiles, parquet footers and Zarr chunks all need.

## Addresses

Every page is a real page with a real path — no hash — and a product's page is addressed by the two
things that identify it:

```
/rfs-data-store/datasets/<version>/<product short name>[/<tab>]
/rfs-data-store/datasets/v3/retrospective-daily/download
```

A category is a filter on the listing (`?category=retrospective`), not a path segment, so a link to a
product survives being filed somewhere else, and any tool that knows a version and a short name can
build the permalink without asking this site.

The names live in the specification documents, under *Available Products → Product short names* in
each version's spec — visible in the app at `/spec/v3`. That list is the source; the catalog in
`src/data/catalog.js` follows it. A product added there needs a name in the spec too, or the two
drift and a permalink stops resolving.

The build writes an `index.html` at each of those addresses (plus a `404.html`), so opening one
directly loads that page rather than the home page rerouting to it. That is the `route-pages` plugin
in `vite.config.js`; it enumerates the addresses from the catalog rather than crawling.

## What is here

The top bar has three sections: **Datasets**, **Packages** and **Specification**.

- **Landing** (`/datasets`) — the three model versions as catalog rows, tagged with the categories
  each one publishes. v3 carries downloads; v1 and v2 are marked *Archive · browse only* and stay
  that way everywhere below.
- **Catalog** (`/datasets/v3`) — CDS style search with facets for category, format and temporal
  resolution. A product can be listed under more than one category: the forecast flood maps appear
  under both Forecasts and Flood maps.
- **Product** (`/datasets/v3/retrospective-daily`) — Overview, Download (or Access) and
  Documentation tabs, with the product's dates, license, citation, storage location and changelog in
  the right column.
- **Download** — the area of interest map (watersheds, rivers between 2+ points, individual rivers,
  regions, the whole globe), the dataset's own options, terms of use behind a sign in, the request
  summary and its download button, and the same request as `s5cmd`, AWS CLI and Python.
- **v1 and v2**, and the v3 flood maps, are browse only: their Access tab gives the bucket paths and
  the commands instead. Flood maps are tiled on a lon/lat grid rather than published per reach, so
  an area of interest cannot cut them.
- **Packages** (`/packages`) — short pages for `riverforecastsystem` (JavaScript) and `geoglows`
  (Python): install, configure, the handful of calls that cover most use, and links out. The
  documentation-site links are placeholders, marked TODO in the page.
- **Specification** (`/spec`) — the specification documents, verbatim, with a document list, a
  table of contents built from the headings, and the commit they were taken from.

## The specification documents

The masters live in
[rfs-specification-documents](https://github.com/river-forecast-system/rfs-specification-documents)
and are **not** part of this repository: `docs/spec/` is a gitignored working copy that the build reads.

```bash
./scripts/sync-spec.sh [path-to-spec-repo]     # default ../rfs-specification-documents
```

copies the documents in and records the upstream commit in `docs/spec/SOURCE.json`, which the sidebar of
every specification page shows. The build does this for itself when `docs/spec/` is missing — the portal
runs a bare `vite build`, so an npm pre-script would not fire — falling back to a shallow clone into
`.spec-src/`. Nothing about it can fail a build: with no documents to be had, the specification pages
say they were not synced and everything else works.

## How a subset is cut

`riverIndex` is a depth-first numbering of the network, so everything upstream of a reach is one
contiguous run of it. Every selection the map makes is therefore a short list of runs:

- **Zarr** — `src/download/zarrSubset.js` reads each run as a slice of the store's `riverId` axis,
  cuts `time` to the requested range, and writes a Zarr v3 store (uncompressed chunks, so any reader
  opens it) into a zip. `riverId` and `riverIndex` ride along as coordinates.
- **GeoParquet** — `src/download/hydrographyWorker.js` uses the region file's row group statistics on
  `riverIndex` to read only the row groups a run touches, re-encodes geometry as WKB and writes
  GeoParquet 1.1. Confluences carry no `riverIndex`, so they are matched on the `riverId`s read from
  the streams file first. A selection spanning several regions comes back as a zip, one file per
  region.

Requests larger than `VITE_MAX_BROWSER_MB` (500 MB) are not assembled in the browser; the request
summary says so and the command line section is how to get them.

## Still to do

- **Downloads need an account and, every time, the terms.** Sign in is `@geoglows/geoglows-auth`,
  configured by `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. The Download button stays
  disabled until the signed-in user ticks both boxes — agreeing to the data usage agreement
  (`docs/data-usage-agreement.md`) and acknowledging receipt of the dataset's license — and they
  clear once a download starts. Nothing records the agreement. The agreement's definitive text is
  `docs/data-usage-agreement.md`, beside the synced specification documents in `docs/spec/`. It is
  a template provided by Harvard Dataverse:
  [Sample Data Usage Agreement](https://support.dataverse.harvard.edu/sample-data-usage-agreement).
- **Dates and changelogs are placeholders.** `src/data/sentinel.js` is where each product's
  `sentinel.json` will be read from the bucket; until then the catalog's literals are shown.
- **The v3 bucket is partly published.** `s3://river-forecast-system-v3` holds the hydrography and
  the flood maps; the retrospective and forecast stores are read from the sample tree until they
  land (see `VITE_RFS_V3_ZARR_BASE`).
- **Lakes are not published yet** — the dataset is in the catalog, marked Preview, with the file path
  laid out the way the other region files are.
- **The JavaScript download example** on each Download tab uses `riverforecastsystem`, the same
  package the app reads through; the flow-duration-curve snippet falls back to zarrita because the
  package has no reader for that store yet.
- The sample tree has only the hourly and daily retrospective stores, the annual maximums and one
  synthetic 16-river forecast (2026-07-10), so monthly, yearly, return periods and flow duration
  curves cannot be downloaded until the bucket has them.
