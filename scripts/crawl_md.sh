#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
env_file="$script_dir/../.env"

if [[ -z "${CRAWL4AI_API_TOKEN:-}" && -f "$env_file" ]]; then
  while IFS='=' read -r name value; do
    if [[ "$name" == "CRAWL4AI_API_TOKEN" ]]; then
      CRAWL4AI_API_TOKEN=$value
      break
    fi
  done < "$env_file"
fi

if [[ $# -ne 1 ]]; then
  printf 'Usage: %s <url>\n' "$0" >&2
  exit 2
fi

if [[ -z "${CRAWL4AI_API_TOKEN:-}" ]]; then
  printf 'Error: CRAWL4AI_API_TOKEN is not set\n' >&2
  exit 2
fi

url=${1//\\/\\\\}
url=${url//\"/\\\"}

curl --fail-with-body --silent --show-error \
  --request POST \
  --url "http://localhost:11235/md" \
  --header "Authorization: Bearer ${CRAWL4AI_API_TOKEN}" \
  --header 'Content-Type: application/json' \
  --data-binary "{\"url\":\"${url}\"}" |
  python3 -c '
import json
import sys

try:
    response = json.load(sys.stdin)
except json.JSONDecodeError as error:
    print(f"Error: Crawl4AI returned invalid JSON: {error}", file=sys.stderr)
    raise SystemExit(1)

markdown = response.get("markdown")
if not isinstance(markdown, str):
    detail = response.get("detail") or response.get("error")
    message = f"Crawl4AI error: {detail}" if detail else "Crawl4AI response did not contain Markdown"
    print(message, file=sys.stderr)
    raise SystemExit(1)

sys.stdout.write(markdown)
if markdown and not markdown.endswith("\n"):
    sys.stdout.write("\n")
'
