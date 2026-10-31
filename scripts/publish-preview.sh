#!/usr/bin/env bash
# Publishes a demo build to the gh-pages branch, or removes one, for GitHub Pages.
#
#   scripts/publish-preview.sh pr-12 dist      the demo for pull request 12
#   scripts/publish-preview.sh . dist          the main demo, at the site root
#   scripts/publish-preview.sh pr-12 --remove  drop a closed pull request's demo
#
# The branch is always a single commit, so previews never pile up history. Runs for
# different pull requests can overlap, so each push is leased on the commit it was
# built from, and the whole update is retried if another run got there first.
set -euo pipefail

target="$1"
source="$2"
git_dir="$(git rev-parse --absolute-git-dir)"
export GIT_DIR="$git_dir"

for attempt in 1 2 3 4 5; do
  site="$(mktemp -d)"
  base=""
  if git fetch --quiet --depth 1 origin gh-pages 2>/dev/null; then
    base="$(git rev-parse FETCH_HEAD)"
    git archive "$base" | tar -x -C "$site"
  fi

  if [ "$target" = "." ]; then
    find "$site" -mindepth 1 -maxdepth 1 ! -name 'pr-*' -exec rm -rf {} +
  else
    rm -rf "${site:?}/$target"
  fi
  if [ "$source" != "--remove" ]; then
    mkdir -p "$site/$target"
    cp -R "$source"/. "$site/$target"/
  fi
  touch "$site/.nojekyll"

  export GIT_INDEX_FILE="$site.index"
  (cd "$site" && GIT_WORK_TREE="$site" git add -A .)
  tree="$(git write-tree)"
  unset GIT_INDEX_FILE
  commit="$(git -c user.name="github-actions[bot]" \
    -c user.email="41898282+github-actions[bot]@users.noreply.github.com" \
    commit-tree "$tree" -m "Publish ${target} (${GITHUB_SHA:-local})")"

  if git push --quiet --force-with-lease="refs/heads/gh-pages:${base}" \
    origin "${commit}:refs/heads/gh-pages"; then
    echo "Published ${target}"
    exit 0
  fi
  echo "gh-pages moved while publishing (attempt ${attempt}); retrying…"
  sleep $((attempt * 5))
done
echo "Could not publish ${target} to gh-pages" >&2
exit 1
