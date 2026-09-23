/**
 * When a product was first published and last written.
 *
 * TODO: every product will write a sentinel json beside itself in the bucket, e.g.
 *   retrospective/daily.zarr/sentinel.json  {"created": "...", "updated": "...", "changelog": [...]}
 * and this will fetch it on demand (once per dataset, cached for the session). Until then it answers
 * with the placeholder dates in the catalog so the sidebar has something to show.
 */
const cache = new Map();

export function datasetDates(dataset) {
  const key = `${dataset.version}/${dataset.category}/${dataset.id}`;
  if (!cache.has(key)) {
    cache.set(key, Promise.resolve({
      created: dataset.created,
      updated: dataset.updated,
      changelog: dataset.changelog ?? [],
      placeholder: true
    }));
  }
  return cache.get(key);
}
