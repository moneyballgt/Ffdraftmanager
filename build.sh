#!/bin/sh
# Generates the two deliverables from src/app.html
set -e
cp src/app.html artifact.html
{
  echo '<!doctype html><html lang="en"><head><meta charset="utf-8">'
  echo '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
  echo '<meta name="color-scheme" content="dark">'
  echo '<meta name="apple-mobile-web-app-capable" content="yes">'
  echo '<style>html{color-scheme:dark}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>'
  cat src/app.html
  echo '</head><body></body></html>'
} > /dev/null
# real build: title/style/script must sit inside a valid document
{
  echo '<!doctype html><html lang="en"><head><meta charset="utf-8">'
  echo '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
  echo '<meta name="color-scheme" content="dark">'
  echo '<meta name="apple-mobile-web-app-capable" content="yes">'
  echo '<style>html{color-scheme:dark}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>'
  echo '</head><body>'
  cat src/app.html
  echo '</body></html>'
} > index.html
echo "built index.html ($(wc -c < index.html) bytes) and artifact.html"
