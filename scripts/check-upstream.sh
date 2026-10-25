#!/usr/bin/env bash
# Read-only comparison of the working branch and the public upstream main.
# Updates only refs/remotes/upstream/main and ignored report files; no checkout,
# merge, cherry-pick, push, tag, or credential is needed.
set -euo pipefail

project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$project_root"

if [[ $# -gt 2 ]]; then
  printf '%s\n' 'Usage: bash scripts/check-upstream.sh [glass-ref] [report-directory]' >&2
  exit 2
fi

glass_ref="${1:-HEAD}"
report_dir="${2:-artifacts/upstream-check}"
upstream_url='https://github.com/juananzzz/resonus.git'
upstream_ref='refs/remotes/upstream/main'
baseline_file='docs/UPSTREAM-REVIEW-BASE'

if [[ "$(git rev-parse --is-shallow-repository)" == true ]]; then
  printf '%s\n' 'Full history is required. Fetch the complete Glass history before comparing.' >&2
  exit 1
fi
glass_commit="$(git rev-parse --verify --end-of-options "${glass_ref}^{commit}")"
review_base="$(tr -d '\r\n' < "$baseline_file")"
if [[ ! "$review_base" =~ ^[0-9a-f]{40}$ ]]; then
  printf '%s\n' "Invalid review baseline in $baseline_file; expected one full commit SHA." >&2
  exit 1
fi

# Use the fixed public URL rather than a configurable remote or saved credential.
# Do not import upstream tags: original v* tags are not Glass release tags.
git -c credential.helper= -c http.extraHeader= fetch --no-tags "$upstream_url" \
  '+refs/heads/main:refs/remotes/upstream/main'
upstream_commit="$(git rev-parse --verify "${upstream_ref}^{commit}")"
git cat-file -e "${review_base}^{commit}"
if ! git merge-base --is-ancestor "$review_base" "$upstream_commit"; then
  printf '%s\n' 'The last-reviewed upstream commit is not an ancestor of upstream main. Stop and inspect its history before changing the baseline.' >&2
  exit 1
fi
common_base="$(git merge-base "$glass_commit" "$upstream_commit")"
new_count="$(git rev-list --count "${review_base}..${upstream_commit}")"
upstream_only="$(git rev-list --count "${glass_commit}..${upstream_commit}")"
glass_only="$(git rev-list --count "${upstream_commit}..${glass_commit}")"
mkdir -p "$report_dir"

# Keep upstream text in separate files; commit messages and changelog content
# are source material for review, not commands or automatic merge instructions.
git log --reverse --date=short --format='%H %ad %s' \
  "${review_base}..${upstream_commit}" > "$report_dir/new-since-review.txt"
git log --cherry-pick --right-only --no-merges --reverse --date=short \
  --format='%H %ad %s' "${glass_commit}...${upstream_commit}" \
  > "$report_dir/not-patch-equivalent.txt"
git diff --stat "$review_base" "$upstream_commit" > "$report_dir/changed-files.txt"
git diff "$review_base" "$upstream_commit" -- CHANGELOG.md > "$report_dir/changelog.diff"
git show "${upstream_commit}:CHANGELOG.md" > "$report_dir/upstream-CHANGELOG.md"

cat > "$report_dir/report.md" <<EOF
# Upstream update comparison

- Compared at: $(date -u '+%Y-%m-%d %H:%M:%S UTC')
- Glass commit: \`$glass_commit\`
- Upstream: [juananzzz/resonus](https://github.com/juananzzz/resonus), main at \`$upstream_commit\`
- Last reviewed upstream commit: \`$review_base\`
- Common ancestor: \`$common_base\`
- **Commits since the last review: $new_count**
- Git history divergence: $glass_only Glass-side / $upstream_only upstream-side commits

[Changes since the last review](https://github.com/juananzzz/resonus/compare/${review_base}...${upstream_commit})

This is a comparison report, not a merge recommendation. The review baseline
records the last inspected upstream state, not a promise that every change was
merged. This branch selectively ports fixes, so an upstream-only commit is not
necessarily missing: its behavior may already have been ported or intentionally
excluded. Exact patch equivalence also cannot recognize rewritten or combined
ports. Review code, tests, and Glass behavior before choosing an update.

## Report files

- \`new-since-review.txt\`: new upstream commits after the recorded review point.
- \`changed-files.txt\`: file summary over that same range.
- \`changelog.diff\`: changelog changes over that same range.
- \`upstream-CHANGELOG.md\`: complete changelog at the fetched upstream commit.
- \`not-patch-equivalent.txt\`: broader history candidates, with exact equivalent
  patches excluded; **not a list of required or absent fixes**.

No working branch, source file, tag, or GitHub resource was changed. The script
only fetched upstream main and wrote this local report. It did not merge,
publish, or update the review baseline.
EOF

printf '%s\n' "Upstream comparison: $report_dir/report.md" \
  "New commits since review: $new_count (review still required)."
