#!/bin/sh
# Nightly dump of the CraftLayer dashboard database (master plan A1). Not Minecraft worlds.
# Connection settings arrive as PGHOST/PGUSER/PGDATABASE/PGPASSWORD (or PGPASSFILE) in the
# environment; nothing here prints them and shell tracing must stay off.
#   backup.sh         take one dump now, then one every day at BACKUP_TIME (local TZ)
#   backup.sh once    take one dump and exit 0, or exit 1 on failure
#   backup.sh health  exit 0 when the newest finished dump is recent enough
set -eu
umask 077

dir=${BACKUP_DIR:-/backups}
keep=${BACKUP_KEEP:-14}
at=${BACKUP_TIME:-03:30}
max_age_minutes=${BACKUP_MAX_AGE_MINUTES:-1560}
retry_seconds=${BACKUP_RETRY_SECONDS:-900}
# Only names this script wrote are ever listed, pruned or removed.
name='craftlayer-db-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]T[0-9][0-9][0-9][0-9][0-9][0-9]Z.dump'

stop() {
  echo "database_backup_config_invalid $(date -u +%Y%m%dT%H%M%SZ) $1"
  exit 2
}
case $keep in '' | *[!0-9]* | 0*) stop keep ;; esac
case $max_age_minutes in '' | *[!0-9]*) stop max_age ;; esac
case $retry_seconds in '' | *[!0-9]*) stop retry ;; esac
case $at in [01][0-9]:[0-5][0-9] | 2[0-3]:[0-5][0-9]) ;; *) stop time ;; esac
[ "$(id -u)" != 0 ] || stop root_user
[ -d "$dir" ] && [ -w "$dir" ] || stop directory

# Finished dumps, oldest first: the UTC timestamp in the name sorts chronologically.
dumps() { find "$dir" -maxdepth 1 -type f -name "$name" | sort; }

# Leftovers from an interrupted run; they never carry a final name.
sweep() {
  find "$dir" -maxdepth 1 -type f \( -name "$name.partial" -o -name "$name.sha256.partial" \) -exec rm -f {} +
}

prune() {
  extra=$(($(dumps | wc -l) - keep))
  [ "$extra" -gt 0 ] || return 0
  dumps | head -n "$extra" | while IFS= read -r old; do
    rm -f "$old" "$old.sha256"
  done
}

fail() {
  rm -f "$dir/$file.partial" "$dir/$file.sha256.partial"
  echo "database_backup_failed $stamp stage=$1"
  return 1
}

run() {
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  file=craftlayer-db-$stamp.dump
  sweep
  pg_dump --format=custom --no-password --file="$dir/$file.partial" || { fail dump; return 1; }
  pg_restore --list "$dir/$file.partial" >/dev/null || { fail verify; return 1; }
  sum=$(sha256sum <"$dir/$file.partial") || { fail checksum; return 1; }
  # Same layout as `sha256sum FILE`, so `sha256sum -c FILE.sha256` works in the directory.
  printf '%s  %s\n' "${sum%% *}" "$file" >"$dir/$file.sha256.partial" || { fail checksum; return 1; }
  mv "$dir/$file.sha256.partial" "$dir/$file.sha256" || { fail publish; return 1; }
  # The dump takes its final name last: a final name always means verified and summed.
  mv "$dir/$file.partial" "$dir/$file" || { rm -f "$dir/$file.sha256"; fail publish; return 1; }
  prune
  echo "database_backup_ok $stamp bytes=$(wc -c <"$dir/$file" | tr -d ' ') kept=$(dumps | wc -l | tr -d ' ')"
}

case ${1:-loop} in
once)
  run
  ;;
health)
  [ -n "$(find "$dir" -maxdepth 1 -type f -name "$name" -mmin "-$max_age_minutes")" ]
  ;;
loop)
  target=${at%:*}${at#*:}
  done_day=
  # A dump is due at start unless a finished one is under an hour old, so restarts do
  # not churn the retained set and the first day is covered before the scheduled time.
  [ -n "$(find "$dir" -maxdepth 1 -type f -name "$name" -mmin -60)" ] && pending=0 || pending=1
  [ "$(date +%H%M)" -lt "$target" ] || [ "$pending" = 1 ] || done_day=$(date +%Y%m%d)
  while :; do
    today=$(date +%Y%m%d)
    if [ "$pending" = 1 ] || { [ "$(date +%H%M)" -ge "$target" ] && [ "$done_day" != "$today" ]; }; then
      if run; then
        pending=0
        [ "$(date +%H%M)" -lt "$target" ] || done_day=$today
      else
        sleep "$retry_seconds"
        continue
      fi
    fi
    sleep 30
  done
  ;;
*)
  stop mode
  ;;
esac
