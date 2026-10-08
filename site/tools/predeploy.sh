#!/bin/sh
# Run before every deploy: sh tools/predeploy.sh && vercel deploy --prod --yes
# Stops if a page still has a blank only the operator can fill (privacy, terms), and fetches the font if it's missing.
set -e
cd "$(dirname "$0")/.."
blanks=$(grep -l 'class="fill"' ./*.html 2>/dev/null || true)
if [ -n "$blanks" ]; then
  echo "Not deploying: fill the highlighted blanks first ([Your name or company], [postal address], [country], [city], [contact email]) in:"
  echo "$blanks"
  exit 1
fi
[ -f fonts/Satoshi-Variable.woff2 ] || sh tools/fetch-fonts.sh
echo "Ready to deploy."
