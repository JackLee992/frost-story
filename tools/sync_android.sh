#!/usr/bin/env bash
# 把 web/ 游戏同步到 Android assets（打包前执行；Android Studio 也可配置为自动执行）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/web"
DST="$ROOT/android/app/src/main/assets/web"
rm -rf "$DST"
cp -R "$SRC" "$DST"
# 运行时不需要的切图源图，减小包体
rm -f "$DST/assets/img/sheet_"*.png "$DST/assets/img/gen_"*.png
# submodule 仅发布可执行 src，不把 Git 指针、CI、测试和文档带入 APK。
rm -f "$DST/js/engine/.git" "$DST/js/engine/README.md" "$DST/js/engine/CHANGELOG.md" \
  "$DST/js/engine/LICENSE" "$DST/js/engine/package.json" "$DST/js/engine/package-lock.json"
rm -rf "$DST/js/engine/.github" "$DST/js/engine/docs" "$DST/js/engine/test"
echo "synced -> $DST ($(find "$DST" -type f | wc -l | tr -d ' ') files)"
