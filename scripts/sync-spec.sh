#!/usr/bin/env bash
# Copy the specification documents into ./spec verbatim, and record where they came from.
#
# The masters live in https://github.com/river-forecast-system/rfs-specification-documents. ./spec is
# a working copy, not part of this repository — it is gitignored, and this is what puts it there:
# from a sibling checkout when there is one, otherwise from a shallow clone in ./.spec-src.
#
#   ./scripts/sync-spec.sh [path-to-spec-repo]     (default: ../rfs-specification-documents)
#
# It never fails the build: with no documents to be had it warns and leaves ./spec as it is, and the
# specification pages say they have not been synced.
set -uo pipefail
cd "$(dirname "$0")/.."

REMOTE="https://github.com/river-forecast-system/rfs-specification-documents.git"
SRC="${1:-${SPEC_REPO:-../rfs-specification-documents}}"

if [ ! -d "$SRC/docs/specs" ]; then
  echo "no specification documents at $SRC — cloning $REMOTE into ./.spec-src"
  if [ -d .spec-src/.git ]; then
    git -C .spec-src pull --ff-only --quiet || echo "could not update ./.spec-src"
  else
    rm -rf .spec-src
    git clone --depth 1 --quiet "$REMOTE" .spec-src || {
      echo "could not clone the specification documents; leaving ./spec as it is" >&2
      exit 0
    }
  fi
  SRC=.spec-src
fi

mkdir -p spec/specs
cp "$SRC/docs/index.md" spec/index.md
cp "$SRC/docs/specs/rfs-v1.md" "$SRC/docs/specs/rfs-v2.md" "$SRC/docs/specs/rfs-v3.md" spec/specs/
cp "$SRC/rfs-v3-spec-document.md" spec/rfs-v3-spec-document.md 2>/dev/null || true
cp "$SRC/organization.md" spec/organization.md 2>/dev/null || true

commit=$(git -C "$SRC" rev-parse HEAD 2>/dev/null || echo unknown)
subject=$(git -C "$SRC" log -1 --pretty=%s 2>/dev/null || echo unknown)
authored=$(git -C "$SRC" log -1 --pretty=%cI 2>/dev/null || echo unknown)
cat > spec/SOURCE.json <<JSON
{
  "repository": "https://github.com/river-forecast-system/rfs-specification-documents",
  "commit": "$commit",
  "commitSubject": "$subject",
  "commitDate": "$authored",
  "syncedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
JSON

echo "synced spec/ from $SRC at $commit"
