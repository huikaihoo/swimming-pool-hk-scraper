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
  --url "http://localhost:11235/crawl" \
  --header "Authorization: Bearer ${CRAWL4AI_API_TOKEN}" \
  --header 'Content-Type: application/json' \
  --data-binary "{\"urls\":[\"${url}\"],\"crawler_config\":{\"cache_mode\":\"BYPASS\"}}" |
  python3 -c '
import json
import sys

try:
    response = json.load(sys.stdin)
except json.JSONDecodeError as error:
    print(f"Error: Crawl4AI returned invalid JSON: {error}", file=sys.stderr)
    raise SystemExit(1)

results = response.get("results")
if not isinstance(results, list) or not results or not isinstance(results[0], dict):
    detail = response.get("detail") or response.get("error")
    message = f"Crawl4AI error: {detail}" if detail else "Crawl4AI response did not contain a result"
    print(message, file=sys.stderr)
    raise SystemExit(1)

crawl_result = results[0]
if not crawl_result.get("success"):
    message = crawl_result.get("error_message") or "Crawl4AI failed to crawl the page"
    print(message, file=sys.stderr)
    raise SystemExit(1)

html = crawl_result.get("html")
if not isinstance(html, str):
    detail = response.get("detail") or response.get("error")
    message = f"Crawl4AI error: {detail}" if detail else "Crawl4AI response did not contain HTML"
    print(message, file=sys.stderr)
    raise SystemExit(1)

sys.stdout.write(html)
if html and not html.endswith("\n"):
    sys.stdout.write("\n")
'
