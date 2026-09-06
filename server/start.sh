#!/bin/sh
# Mac / Linux launcher. Double-clickable from a terminal.
cd "$(dirname "$0")" || exit 1
exec node server.js "$@"
