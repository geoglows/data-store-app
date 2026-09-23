import {defineConfig} from "vite";
import preact from "@preact/preset-vite";
import {execFileSync} from "node:child_process";
import {createReadStream, existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync} from "node:fs";
import {extname, join, normalize, sep} from "node:path";
import {fileURLToPath} from "node:url";

// ./data, when present, is a symlink to a local copy of the v3 tree (same layout as the bucket). It is
// served by byte range from the dev and preview servers so PMTiles, parquet and zarr reads work
// against it exactly as they do against the CDN. Point the app at it with VITE_RFS_V3_BASE=data.
const here = fileURLToPath(new URL(".", import.meta.url));
const dataLink = `${here}data`;
const dataRoot = existsSync(dataLink) ? realpathSync(dataLink) : null;

const TYPES = {
  ".json": "application/json",
  ".parquet": "application/vnd.apache.parquet",
  ".pmtiles": "application/octet-stream"
};

// 206 with a correct Content-Range is the whole job: PMTiles refuses a 200 for a ranged read and a
// parquet footer read would otherwise pull the whole file.
const serveRange = (root, req, res, next) => {
  const rel = decodeURIComponent((req.url || "/").split("?")[0]);
  const path = join(root, normalize(`/${rel}`));
  if (path !== root && !path.startsWith(root + sep)) {
    res.statusCode = 403;
    return res.end("forbidden\n");
  }
  let stat;
  try {
    stat = statSync(path);
  } catch {
    return next();
  }
  if (!stat.isFile()) return next();
  const size = stat.size;
  res.setHeader("accept-ranges", "bytes");
  res.setHeader("content-type", TYPES[extname(path).toLowerCase()] ?? "application/octet-stream");
  res.setHeader("cache-control", "no-cache");
  res.setHeader("etag", `"${size.toString(16)}-${Math.trunc(stat.mtimeMs).toString(16)}"`);
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
  let start = 0;
  let end = size - 1;
  if (m) {
    if (m[1] === "") start = Math.max(0, size - Number(m[2]));
    else {
      start = Number(m[1]);
      if (m[2] !== "") end = Math.min(Number(m[2]), size - 1);
    }
    if (!(start <= end) || start >= size) {
      res.statusCode = 416;
      res.setHeader("content-range", `bytes */${size}`);
      return res.end();
    }
    res.statusCode = 206;
    res.setHeader("content-range", `bytes ${start}-${end}/${size}`);
  }
  res.setHeader("content-length", end - start + 1);
  if (req.method === "HEAD") return res.end();
  createReadStream(path, {start, end}).on("error", () => res.destroy()).pipe(res);
};

// Mounted under the base so VITE_RFS_V3_BASE=data resolves to it whatever --base the app runs with.
// The explicit 404 keeps Vite's SPA fallback from answering a missing artifact with index.html.
const serveData = () => {
  const mount = (server) => {
    if (!dataRoot) return;
    const base = server.config.base.replace(/\/$/, "");
    server.middlewares.use(`${base}/data`, (req, res) => serveRange(dataRoot, req, res, () => {
      res.statusCode = 404;
      res.end(`no such file under data: ${req.url}\n`);
    }));
  };
  return {name: "serve-data-symlink", configureServer: mount, configurePreviewServer: mount};
};


/**
 * Write a real page at every route.
 *
 * The app routes on paths rather than on a hash, and it is served as static files from a folder on
 * the portal's bucket, where a request for /rfs-data-store/v3/retrospective/daily has to find
 * something. So the build copies the built index.html to an index.html under every address the app
 * answers — enumerated from the catalog, not crawled — plus a 404.html for hosts that ask for one.
 * Each copy references the same hashed assets, so this costs a couple of kilobytes per page.
 */

/**
 * Make sure ./spec holds the specification documents before anything imports them.
 *
 * ./spec is a working copy rather than part of this repository, and the portal builds every app with
 * a bare `npx vite build`, so an npm pre-script would not run. This does it from inside the build:
 * missing documents are fetched by scripts/sync-spec.sh, which falls back to a shallow clone and
 * never fails — the specification pages say when they have nothing to show.
 */
const ensureSpec = () => ({
  name: "ensure-spec",
  config() {
    const root = fileURLToPath(new URL(".", import.meta.url));
    if (existsSync(join(root, "spec", "specs", "rfs-v3.md"))) return;
    try {
      execFileSync(join(root, "scripts", "sync-spec.sh"), {stdio: "inherit"});
    } catch (err) {
      console.warn(`the specification documents could not be synced: ${err.message}`);
    }
  }
});

const routePages = () => {
  let outDir = "dist";
  return {
    name: "route-pages",
    apply: "build",
    configResolved(config) {
      outDir = config.build.outDir;
    },
    // writeBundle rather than generateBundle: the HTML is written by Vite's own html handling, and
    // this copies what actually landed on disk.
    async writeBundle() {
      const root = fileURLToPath(new URL(".", import.meta.url));
      const dist = join(root, outDir);
      const index = readFileSync(join(dist, "index.html"), "utf8");
      const {DATASETS, VERSIONS} = await import("./src/data/catalog.js");
      const {SPEC_DOCS} = await import("./src/data/specDocs.js");

      const paths = new Set(["datasets", "packages", "packages/javascript", "packages/python", "spec"]);
      for (const doc of SPEC_DOCS) paths.add(`spec/${doc.id}`);
      for (const v of VERSIONS) paths.add(`datasets/${v.id}`);
      for (const d of DATASETS) {
        const at = `datasets/${d.version}/${d.id}`;
        const action = d.kind === "archive" || d.kind === "external" ? "access" : "download";
        paths.add(at);
        paths.add(`${at}/${action}`);
        paths.add(`${at}/documentation`);
      }

      for (const path of paths) {
        const dir = join(dist, path);
        mkdirSync(dir, {recursive: true});
        writeFileSync(join(dir, "index.html"), index);
      }
      // For hosts that serve an error document rather than falling back to index.html.
      writeFileSync(join(dist, "404.html"), index);
      console.log(`route-pages: wrote ${paths.size + 1} pages`);
    }
  };
};

// The portal builds every app with `vite build --base="/rfs-data-store/"` (see apps.geoglows
// scripts/build-local.sh), so `base` is left at the default here and supplied on the command line.
export default defineConfig({
  plugins: [ensureSpec(), preact(), serveData(), routePages()],
  optimizeDeps: {
    include: ["riverforecastsystem/v3", "riverforecastsystem/v3/hydrography", "zarrita", "numcodecs/blosc"]
  },
  // Unknown paths fall back to index.html in dev and preview, the way the deployed copies do.
  appType: "spa",
  worker: {format: "es"},
  build: {
    target: ["es2020", "safari14"],
    chunkSizeWarningLimit: 1500
  },
  server: {host: "127.0.0.1"},
  preview: {host: "127.0.0.1"}
});
