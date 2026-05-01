#!/usr/bin/env bash
set -euo pipefail

SOURCE_PDF="${1:?用法: compare-docx-pdf-visual.sh <source.pdf> <docx-file> [out-dir]}"
DOCX_FILE="${2:?用法: compare-docx-pdf-visual.sh <source.pdf> <docx-file> [out-dir]}"
OUT_DIR="${3:-/tmp/mdv-docx-visual-compare}"

SOFFICE_BIN="${SOFFICE_BIN:-$(command -v soffice || true)}"
if [[ -z "$SOFFICE_BIN" && -x /Applications/LibreOffice.app/Contents/MacOS/soffice ]]; then
  SOFFICE_BIN="/Applications/LibreOffice.app/Contents/MacOS/soffice"
fi

if [[ -z "$SOFFICE_BIN" ]]; then
  echo "缺少 soffice，请安装 LibreOffice 或设置 SOFFICE_BIN" >&2
  exit 1
fi

for cmd in pdfinfo pdftoppm magick; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "缺少 $cmd，请先安装 poppler/ImageMagick 相关工具" >&2
    exit 1
  fi
done

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR/renders" "$OUT_DIR/pairs"

"$SOFFICE_BIN" --headless --convert-to pdf --outdir "$OUT_DIR" "$DOCX_FILE" >/dev/null
DOCX_PDF="$OUT_DIR/$(basename "${DOCX_FILE%.docx}.pdf")"

echo "=== source pdf ==="
pdfinfo "$SOURCE_PDF" | grep -E 'Pages|Page size|File size'

echo "=== docx converted pdf ==="
pdfinfo "$DOCX_PDF" | grep -E 'Pages|Page size|File size'

pdftoppm -png -r 120 -f 1 -l 8 "$SOURCE_PDF" "$OUT_DIR/renders/source"
pdftoppm -png -r 120 -f 1 -l 8 "$DOCX_PDF" "$OUT_DIR/renders/docx"

for n in 01 02 03 04 05 06 07 08; do
  magick "$OUT_DIR/renders/source-${n}.png" -resize 900x \
    "$OUT_DIR/renders/docx-${n}.png" -resize 900x \
    +append "$OUT_DIR/pairs/page-${n}-source-vs-docx.png"
done

echo "视觉对比图：$OUT_DIR/pairs"
