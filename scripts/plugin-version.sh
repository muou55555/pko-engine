#!/usr/bin/env bash
# 开发期插件状态：link 目标、版本号、源码 HEAD、构建是否过期。
#
# 用法：
#   bash scripts/plugin-version.sh                # 默认看 web profile
#   bash scripts/plugin-version.sh --profile headless
#   npm run dev:info
#
# 退出码：0 = 就绪；1 = 构建落后于源码；2 = 未安装或链接失效

set -u

PKG_NAME="@pko/dsh"
PROFILE="web"

while [ $# -gt 0 ]; do
  case "$1" in
    --profile) PROFILE="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) PROFILE="$1"; shift ;;
  esac
done

if [ -z "$PROFILE" ]; then
  echo "错误：缺少 profile 名称" >&2
  exit 2
fi

PROFILE_DIR="${HOME}/.dsh/profiles/${PROFILE}"
FAIL=0

if [ ! -d "$PROFILE_DIR" ]; then
  echo "✗ profile 不存在：$PROFILE_DIR"
  echo "  先创建一个：dsh --profile $PROFILE --from-default-profile headless --dump-config"
  exit 2
fi

# 读 profile 里记录的依赖 spec
DEP=$(node -e '
const path = process.argv[1]
try {
  const pkg = require(path)
  process.stdout.write((pkg.dependencies ?? {})[process.argv[2]] ?? "")
} catch {
  process.stdout.write("")
}
' "$PROFILE_DIR/package.json" "$PKG_NAME" 2>/dev/null || true)

if [ -z "$DEP" ]; then
  echo "✗ profile「${PROFILE}」没有安装 $PKG_NAME"
  echo "  安装：dsh plugin --profile $PROFILE add link:$PWD/packages/dsh"
  exit 2
fi

INSTALLED="$PROFILE_DIR/node_modules/$PKG_NAME"
VERSION=""
if [ -e "$INSTALLED/package.json" ]; then
  VERSION=$(node -e 'process.stdout.write(String(require(process.argv[1]).version ?? "?"))' "$INSTALLED/package.json" 2>/dev/null || true)
fi

echo "$PKG_NAME 开发状态（profile: ${PROFILE}）"
echo "  安装方式  $DEP${VERSION:+（版本 ${VERSION}）}"

case "$DEP" in
  link:*)
    RAW="${DEP#link:}"
    TARGET=$(node -e 'process.stdout.write(require("path").resolve(process.argv[1], process.argv[2]))' "$PROFILE_DIR" "$RAW")

    if [ ! -d "$TARGET" ]; then
      echo "  link 目标 ✗ 不存在：$TARGET"
      exit 2
    fi
    echo "  link 目标 $TARGET ✓"

    if [ -d "$TARGET/.git" ] || git -C "$TARGET" rev-parse --git-dir >/dev/null 2>&1; then
      HEAD_SHA=$(git -C "$TARGET" rev-parse --short HEAD 2>/dev/null || echo "?")
      BRANCH=$(git -C "$TARGET" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "?")
      DIRTY=$(git -C "$TARGET" status --porcelain 2>/dev/null | wc -l | tr -d ' ')
      echo "  源码 HEAD ${HEAD_SHA}（${BRANCH}）未提交改动：$DIRTY 个文件"
    fi

    # link 可能指向包目录（packages/dsh），也可能指向仓库根
    if [ -f "$TARGET/package.json" ]; then
      PKG_DIR="$TARGET"
      REPO=$(cd "$TARGET/../.." 2>/dev/null && pwd || true)
    elif [ -f "$TARGET/packages/dsh/package.json" ]; then
      PKG_DIR="$TARGET/packages/dsh"
      REPO="$TARGET"
    else
      echo "  目标     ✗ 不像 @pko/dsh 的包目录：${TARGET}"
      exit 2
    fi

    LIB="$PKG_DIR/lib"
    SRC_DIRS=()
    [ -d "$PKG_DIR/src" ] && SRC_DIRS+=("$PKG_DIR/src")
    [ -n "$REPO" ] && [ -d "$REPO/packages/core/src" ] && SRC_DIRS+=("$REPO/packages/core/src")
    [ -n "$REPO" ] && [ -d "$REPO/packages/skills" ] && SRC_DIRS+=("$REPO/packages/skills")

    if [ ! -d "$LIB" ]; then
      echo "  构建     ✗ 没有 lib/，先跑：npm run build:dsh"
      FAIL=1
    elif [ ${#SRC_DIRS[@]} -eq 0 ]; then
      echo "  构建     ✓ lib/ 存在（未找到源码目录，跳过新鲜度检查）"
    else
      MTIME_FMT=(-f "%m")
      if ! stat -f "%m" "$LIB" >/dev/null 2>&1; then MTIME_FMT=(-c "%Y"); fi

      newest_src=$(find "${SRC_DIRS[@]}" -type f \( -name '*.ts' -o -name '*.md' \) -exec stat "${MTIME_FMT[@]}" {} \; 2>/dev/null | sort -rn | head -1)
      newest_lib=$(find "$LIB" -type f -exec stat "${MTIME_FMT[@]}" {} \; 2>/dev/null | sort -rn | head -1)

      if [ -n "$newest_src" ] && [ -n "$newest_lib" ] && [ "$newest_src" -gt "$newest_lib" ]; then
        echo "  构建     ✗ lib 落后于源码，先跑：npm run build:dsh"
        FAIL=1
      else
        echo "  构建     ✓ 与源码一致"
      fi
    fi

    if [ "$FAIL" -eq 0 ]; then
      echo "  提示     重编译后仍需重启 DSH 才生效（不热加载插件代码）"
    fi
    ;;
  file:*)
    TARBALL="${DEP#file:}"
    if [ -f "$TARBALL" ]; then
      echo "  安装包   $TARBALL ✓"
    else
      echo "  安装包   ✗ 不存在：$TARBALL"
      FAIL=1
    fi
    ;;
  *)
    echo "  来源     $DEP"
    ;;
esac

exit "$FAIL"
