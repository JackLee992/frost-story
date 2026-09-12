#!/usr/bin/env bash
set -euo pipefail

version="${1:-}"
min_app_code="${2:-1}"
output_dir="${3:-distribution}"

if [[ ! "${version}" =~ ^[0-9A-Za-z][0-9A-Za-z._-]{0,63}$ ]]; then
  echo "usage: $0 <content-version> [min-app-version-code] [output-dir]" >&2
  exit 2
fi
if [[ ! "${min_app_code}" =~ ^[1-9][0-9]*$ ]]; then
  echo "min-app-version-code must be a positive integer" >&2
  exit 2
fi
if find web -type l -print -quit | grep -q .; then
  echo "content package must not contain symbolic links" >&2
  exit 2
fi
for engine_module in action-result display-meta stable-view; do
  if [[ ! -f "web/js/engine/src/${engine_module}.js" ]]; then
    echo "missing initialized frost-merge-core submodule: ${engine_module}.js" >&2
    exit 2
  fi
done

mkdir -p "${output_dir}"
archive_name="FrostStory-content-${version}.zip"
archive_path="${output_dir}/${archive_name}"
rm -f "${archive_path}"
(
  cd web
  zip -X -q -r "../${archive_path}" . \
    -x '*.DS_Store' 'js/engine/.git' 'js/engine/.github/*' 'js/engine/docs/*' \
       'js/engine/test/*' 'js/engine/README.md' 'js/engine/CHANGELOG.md' \
       'js/engine/LICENSE' 'js/engine/package.json' 'js/engine/package-lock.json'
)

size="$(wc -c < "${archive_path}" | tr -d ' ')"
if command -v sha256sum >/dev/null 2>&1; then
  sha256="$(sha256sum "${archive_path}" | awk '{print $1}')"
else
  sha256="$(shasum -a 256 "${archive_path}" | awk '{print $1}')"
fi

if (( size > 67108864 )); then
  echo "content archive exceeds the app's 64 MiB download limit" >&2
  exit 3
fi

manifest_tmp="${output_dir}/content-manifest.json.tmp"
printf '{\n  "schema": 1,\n  "version": "%s",\n  "archiveUrl": "https://github.com/JackLee992/frost-story/releases/download/content-v%s/%s",\n  "sha256": "%s",\n  "size": %s,\n  "minAppVersionCode": %s\n}\n' \
  "${version}" "${version}" "${archive_name}" "${sha256}" "${size}" "${min_app_code}" > "${manifest_tmp}"
mv "${manifest_tmp}" "${output_dir}/content-manifest.json"
printf '%s  %s\n' "${sha256}" "${archive_name}" > "${archive_path}.sha256"

echo "created ${archive_path} (${size} bytes)"
echo "sha256 ${sha256}"
