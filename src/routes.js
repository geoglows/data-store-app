/**
 * Every page has a real path, and a product's page is addressed by the two things that identify it:
 *
 *   /rfs-data-store/datasets/<version>/<product short name>[/<tab>]
 *
 * A category is a filter on the listing, not a path segment, so a link to a product stays valid if
 * the product is later listed under something else — and anything that knows a version and a short
 * name can build the link without asking this app.
 */
const BASE = (import.meta.env.BASE_URL || "/").replace(/\/+$/, "");

/** An app path, base included. `path("/datasets")` → "/rfs-data-store/datasets". */
export const path = p => `${BASE}${p === "/" ? "/" : p}`;

export const routes = {
  home: () => path("/datasets"),
  datasets: () => path("/datasets"),
  version: v => path(`/datasets/${v}`),
  category: (v, c) => `${path(`/datasets/${v}`)}?category=${encodeURIComponent(c)}`,
  dataset: (d, tab) => path(`/datasets/${d.version}/${d.id}${tab ? `/${tab}` : ""}`),
  packages: () => path("/packages"),
  package: id => path(`/packages/${id}`),
  spec: doc => path(`/spec${doc ? `/${doc}` : ""}`)
};

export const BASE_PATH = BASE;
