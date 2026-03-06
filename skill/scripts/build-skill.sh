#!/usr/bin/env bash
set -euo pipefail

# Build the yourbro skill folder for ClawHub upload.
# Usage: ./build-skill.sh [output-dir]
#
# Creates a folder ready to drag-and-drop into ClawHub's "Publish a skill" UI.
# The folder contains SKILL.md + contrib/ (text files only).
#
# Binaries are NOT included — ClawHub skills are text bundles.
# Binaries are hosted on Cloudflare R2 and referenced via
# metadata.openclaw.install download URLs in SKILL.md.
#
# Release flow:
#   1. Tag a version: git tag v1.0.0 && git push origin v1.0.0
#   2. GitHub Actions builds binaries and creates a Release with assets
#   3. Run this script to build the ClawHub skill folder
#   4. Drag-and-drop the folder into ClawHub to publish
#
# The SKILL.md install URLs point to:
#   https://github.com/mehanig/yourbro/releases/latest/download/yourbro-agent-{os}-{arch}
# These resolve to the latest GitHub Release assets.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILL_DIR="$(dirname "$SCRIPT_DIR")"
OUTPUT_DIR="${1:-$SKILL_DIR/dist/yourbro}"

rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"

# Copy skill files (text only — no binaries)
cp "$SKILL_DIR/SKILL.md" "$OUTPUT_DIR/"
cp -r "$SKILL_DIR/contrib" "$OUTPUT_DIR/"

echo "Skill folder ready at: $OUTPUT_DIR"
echo ""
echo "Contents:"
find "$OUTPUT_DIR" -type f | sort | while read -r f; do
  echo "  ${f#$OUTPUT_DIR/}"
done
echo ""
echo "NOTE: Binaries are NOT included. They are downloaded from Cloudflare R2"
echo "      via the install URLs in SKILL.md metadata."
echo ""
echo "Drag-and-drop this folder into ClawHub to publish."
