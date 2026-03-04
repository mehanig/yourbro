#!/usr/bin/env bash
set -euo pipefail

# Publish an HTML file to yourbro
# Usage: ./publish.sh <slug> <title> <html-file>

YOURBRO_API="${YOURBRO_API:-https://yourbro.ai}"
YOURBRO_TOKEN="${YOURBRO_TOKEN:?Set YOURBRO_TOKEN environment variable}"

SLUG="${1:?Usage: publish.sh <slug> <title> <html-file>}"
TITLE="${2:?Usage: publish.sh <slug> <title> <html-file>}"
HTML_FILE="${3:?Usage: publish.sh <slug> <title> <html-file>}"

if [ ! -f "$HTML_FILE" ]; then
  echo "Error: File not found: $HTML_FILE" >&2
  exit 1
fi

HTML_CONTENT=$(cat "$HTML_FILE")

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${YOURBRO_API}/api/pages" \
  -H "Authorization: Bearer $YOURBRO_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --arg slug "$SLUG" --arg title "$TITLE" --arg html "$HTML_CONTENT" \
    '{slug: $slug, title: $title, html_content: $html}')")

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" -ge 200 ] && [ "$HTTP_CODE" -lt 300 ]; then
  echo "Published successfully!"
  echo "$BODY" | jq .
else
  echo "Error ($HTTP_CODE): $BODY" >&2
  exit 1
fi
