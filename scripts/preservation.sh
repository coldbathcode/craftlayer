#!/bin/sh
set -eu
script_root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
cd -- "$script_root"
exec node --import tsx "$script_root/scripts/minecraft/preservation-cli.ts" "$@"
