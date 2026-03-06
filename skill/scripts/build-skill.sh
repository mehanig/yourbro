#!/usr/bin/env bash
set -euo pipefail

# Build the yourbro skill folder for ClawHub upload.
# Usage: ./build-skill.sh [output-dir]
#
# Creates a folder ready to drag-and-drop into ClawHub's "Publish a skill" UI.
# ClawHub only accepts text files — so this is just SKILL.md.
#
# Binaries are downloaded by OpenClaw from Cloudflare R2 via
# metadata.openclaw.install download URLs in SKILL.md.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILL_DIR="$(dirname "$SCRIPT_DIR")"
OUTPUT_DIR="${1:-$SKILL_DIR/dist/yourbro}"

rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"

cp "$SKILL_DIR/SKILL.md" "$OUTPUT_DIR/"

echo "Skill folder ready at: $OUTPUT_DIR"
echo ""
echo "Contents:"
find "$OUTPUT_DIR" -type f | sort | while read -r f; do
  echo "  ${f#$OUTPUT_DIR/}"
done
echo ""
echo "Drag-and-drop this folder into ClawHub to publish."
