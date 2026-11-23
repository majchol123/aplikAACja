"""Fetch an encrypted backup of relAACja into a directory (PLAN §6, F7).

RELAACJA_BACKUP_TOKEN=… uv run backup.py --origin https://relaacja.example --out /srv/backup

The token comes from the admin panel (Kopie zapasowe), via the environment or --token-file;
every file arrives encrypted for the age key set there (decrypt: age -d -i key.txt FILE).
"""

import argparse
import os
import sys
from datetime import timedelta
from pathlib import Path

from relaacja_tools.backup import BackupError, Client, prune, run_backup


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--origin", required=True, help="https://host of the app")
    parser.add_argument("--out", type=Path, required=True, help="backup directory")
    parser.add_argument("--token-file", type=Path, help="file with the token (else the env)")
    parser.add_argument("--keep", type=int, default=30, help="complete snapshots to keep")
    parser.add_argument(
        "--max-age-days", type=int, default=30, help="remove snapshots older than this"
    )
    args = parser.parse_args()
    if args.max_age_days < 1:
        parser.error("--max-age-days must be at least 1")
    max_age = timedelta(days=args.max_age_days)

    if args.token_file:
        token = args.token_file.read_text("utf-8").strip()
    else:
        token = os.environ.get("RELAACJA_BACKUP_TOKEN", "").strip()
    if not token:
        print("no token: --token-file or RELAACJA_BACKUP_TOKEN", file=sys.stderr)
        return 2
    try:
        stats = run_backup(Client(args.origin, token), args.out, keep=args.keep, max_age=max_age)
    except (BackupError, OSError) as err:
        print(f"backup failed: {err}", file=sys.stderr)
        # The age limit is a promise of the privacy policy: it holds without a new snapshot.
        expired = prune(args.out, keep=args.keep, max_age=max_age)
        if expired:
            print(f"removed expired snapshots: {len(expired)}", file=sys.stderr)
        return 1
    print(
        f"backup OK: {stats.users} accounts, {stats.photos_new} new photos "
        f"({stats.photos_kept} already there), removed snapshots: {len(stats.snapshots_removed)}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
