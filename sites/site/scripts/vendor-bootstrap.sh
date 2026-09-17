#!/bin/sh
# Refreshes vendor/bootstrap.min.css and vendor/bootstrap.bundle.min.js -- the
# copy this site serves from its own origin instead of jsDelivr.
#
# Not an npm dependency: Bootstrap ships nothing this site's own code
# imports, only two files it serves as-is, and the version and hashes below
# are the same ones bootstrap-kit/parts/base.htm pins for every page that
# DOESN'T vendor its own copy. Bump both together, and this script's own
# checksum fails loudly rather than committing a copy that doesn't match
# what the kit's default already tells every other page to trust.
set -eu
CSS_URL="https://cdn.jsdelivr.net/npm/bootstrap@5.3.8/dist/css/bootstrap.min.css"
JS_URL="https://cdn.jsdelivr.net/npm/bootstrap@5.3.8/dist/js/bootstrap.bundle.min.js"
CSS_SHA384="sRIl4kxILFvY47J16cr9ZwB07vP4J8+LH7qKQnuqkuIAvNWLzeN8tE5YBujZqJLB"
JS_SHA384="FKyoEForCGlyvwx9Hj09JcYn3nv7wiPVlz7YYwJrWVcXK/BmnVDxM+D2scQbITxI"

cd "$(dirname "$0")/.."

verify() {
  actual=$(openssl dgst -sha384 -binary "$1" | openssl base64 -A)
  if [ "$actual" != "$2" ]; then
    echo "checksum mismatch for $1: got $actual, expected $2" >&2
    exit 1
  fi
}

mkdir -p vendor
curl -fsSL "$CSS_URL" -o vendor/bootstrap.min.css
curl -fsSL "$JS_URL" -o vendor/bootstrap.bundle.min.js
verify vendor/bootstrap.min.css "$CSS_SHA384"
verify vendor/bootstrap.bundle.min.js "$JS_SHA384"
echo "vendored bootstrap.min.css and bootstrap.bundle.min.js, hashes verified"
