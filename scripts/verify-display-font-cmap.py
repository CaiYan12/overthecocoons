#!/usr/bin/env python3
"""展示字体子集 cmap 覆盖校验（T12 审查修复，UI 票 #29）——再生成流程第 3 步的脚本化。

原流程第 3 步为手工描述（「fontTools 校验 woff2 cmap 覆盖清单全部字符」），现固化为
可复跑命令：读取 public/fonts/display-charset.json 清单与其指向的 woff2 子集，用
fontTools 解析 cmap，逐字符断言清单全覆盖，缺失即非零退出（不通过不得提交）。

用法（依赖 fonttools + brotli，装在仓库外：python -m pip install --user fonttools brotli）：
  python scripts/verify-display-font-cmap.py

本脚本只被手动运行：构建、CI 与页面运行期均不依赖它，也不依赖任何字体工具。
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MANIFEST_FILE = ROOT / "public" / "fonts" / "display-charset.json"


def main() -> int:
    from fontTools.ttLib import TTFont

    manifest = json.loads(MANIFEST_FILE.read_text(encoding="utf-8"))
    font_file = ROOT / "public" / "fonts" / manifest["file"]
    best_cmap = TTFont(str(font_file)).getBestCmap()
    missing = [
        {"char": ch, "codepoint": f"U+{ord(ch):04X}"}
        for ch in manifest["charset"]
        if ord(ch) not in best_cmap
    ]
    if missing:
        for item in missing:
            print(f"缺失 {item['codepoint']} {item['char']!r}")
        print(
            f"cmap 覆盖校验失败：{len(missing)}/{manifest['charCount']} 缺失"
            f"（{manifest['file']}，清单 {MANIFEST_FILE.name}）"
        )
        return 1
    print(
        f"cmap 覆盖校验通过：{manifest['charCount']}/{manifest['charCount']} 字符全覆盖"
        f"（{manifest['file']}，族「{manifest['family']}」）"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
