#!/bin/sh
# HOOK_IN_REPO_20261113: 换机/re-clone 后执行一次即可恢复交付前自检门禁
# 用法：sh tools/install-hooks.sh   （或 sh tools/install-hooks.sh <repo_root>）
set -e
ROOT=${1:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}
mkdir -p "$ROOT/.git/hooks"
cp "$ROOT/tools/pre-push" "$ROOT/.git/hooks/pre-push"
chmod +x "$ROOT/.git/hooks/pre-push"
echo "✅ pre-push hook 已安装到 $ROOT/.git/hooks/pre-push"
