#!/bin/sh
# Puts Satoshi in site/fonts/, from Fontshare's own download, before a deploy. The site serves its own copy (no
# visitor's browser talks to Fontshare), but the files stay out of git: the ITF Free Font License allows self-hosting
# on our site and forbids making the files available through a public repository. `vercel deploy` uploads them anyway
# (it reads .vercelignore, not .gitignore). Run from anywhere: sh site/tools/fetch-fonts.sh
set -e
cd "$(dirname "$0")/.."
tmp=$(mktemp -d)
curl -fsSL "https://api.fontshare.com/v2/fonts/download/satoshi" -o "$tmp/satoshi.zip"
unzip -q -o "$tmp/satoshi.zip" -d "$tmp"
mkdir -p fonts
cp "$tmp/Satoshi_Complete/Fonts/WEB/fonts/Satoshi-Variable.woff2" fonts/
cp "$tmp/Satoshi_Complete/License/FFL.txt" fonts/LICENSE-Satoshi-FFL.txt
rm -rf "$tmp"
echo "fonts/Satoshi-Variable.woff2 ready"
