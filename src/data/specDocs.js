/**
 * Which specification documents exist, without their text.
 *
 * The documents themselves are hundreds of kilobytes and are imported by src/views/spec.js, which
 * the router loads only when someone opens the section. This list is what the router needs to build
 * a breadcrumb before that happens.
 */
/**
 * `file` is the path in the specification repository, which the page cites; `vendored` is where
 * scripts/sync-spec.sh puts it under ./docs/spec, which is what the build reads.
 */
export const SPEC_DOCS = [
  {id: "overview", title: "Overview", file: "docs/index.md", vendored: "index.md", summary: "The model versions and what each one covers."},
  {id: "v3", title: "RFS v3", file: "docs/specs/rfs-v3.md", vendored: "specs/rfs-v3.md", summary: "The specification of the current model version."},
  {id: "v3-full", title: "RFS v3 specification (long form)", file: "rfs-v3-spec-document.md", vendored: "rfs-v3-spec-document.md", summary: "Products, Zarr details, data access and the working notes behind them."},
  {id: "organization", title: "RFS v3 data organization", file: "organization.md", vendored: "organization.md", summary: "The bucket layout, file by file."},
  {id: "v2", title: "RFS v2", file: "docs/specs/rfs-v2.md", vendored: "specs/rfs-v2.md", summary: "The previous model version, archived."},
  {id: "v1", title: "RFS v1", file: "docs/specs/rfs-v1.md", vendored: "specs/rfs-v1.md", summary: "The original model version, archived."}
];

/** The document the section opens on: the current model version, not the index page. */
export const DEFAULT_SPEC_DOC = "v3";

export const specDoc = id => SPEC_DOCS.find(d => d.id === id) ?? SPEC_DOCS.find(d => d.id === DEFAULT_SPEC_DOC);
