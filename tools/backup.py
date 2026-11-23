"""Fetch an encrypted backup of relAACja into a directory (PLAN §6, F7).

RELAACJA_BACKUP_TOKEN=… uv run backup.py --origin https://relaacja.example --out /srv/backup

The token comes from the admin panel (Kopie zapasowe), via the environment or --token-file;
every file arrives encrypted for the age key set there (decrypt: age -d -i key.txt FILE).
"""

import argparse
import os
import sys
from pathlib import Path

from relaacja_tools.backup import BackupError, Client, run_backup


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--origin", required=True, help="https://host of the app")
    parser.add_argument("--out", type=Path, required=True, help="backup directory")
    parser.add_argument("--token-file", type=Path, help="file with the token (else the env)")
    parser.add_argument("--keep", type=int, default=30, help="complete snapshots to keep")
    args = parser.parse_args()

    if args.token_file:
        token = args.token_file.read_text("utf-8").strip()
    else:
        token = os.environ.get("RELAACJA_BACKUP_TOKEN", "").strip()
    if not token:
        print("no token: --token-file or RELAACJA_BACKUP_TOKEN", file=sys.stderr)
        return 2
    try:
        stats = run_backup(Client(args.origin, token), args.out, keep=args.keep)
    except BackupError as err:
        print(f"backup failed: {err}", file=sys.stderr)
        return 1
    print(
        f"backup OK: {stats.users} accounts, {stats.photos_new} new photos "
        f"({stats.photos_kept} already there), removed snapshots: {len(stats.snapshots_removed)}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
