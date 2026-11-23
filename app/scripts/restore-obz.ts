/**
 * One account's boards from an encrypted backup (tools/backup.py) as an Open Board file:
 *
 *   node --experimental-strip-types app/scripts/restore-obz.ts --backup <dir> --user <id> \
 *     --identity key.txt [--snapshot <name>] [--board <id>] --out boards.obz
 *
 * The account (or a new one) adds it in edit mode: "Dodaj tablicę" → "Z pliku" — the whole
 * tree becomes one folder, own photos included, through the same validation and quotas as
 * any other file. ARASAAC symbols travel as references (the app shows them from its
 * mirror), the extra set as references only, as in every Open Board file of the app.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { Decrypter } from 'age-encryption';
import { strToU8, zipSync, type Zippable } from 'fflate';
// Direct module paths: the package index also re-exports code Node's type stripping
// cannot run.
import {
  packageToObz,
  subtreePackage,
  symbolKey,
  type ObzPicture,
} from '../../packages/shared/src/obf.ts';
import { restoreTree, type VaultDump } from '../../packages/shared/src/restore.ts';
import { SHARE_LIMITS } from '../../packages/shared/src/share.ts';

const { values: args } = parseArgs({
  options: {
    backup: { type: 'string' },
    user: { type: 'string' },
    identity: { type: 'string' },
    snapshot: { type: 'string' },
    board: { type: 'string' },
    out: { type: 'string' },
  },
});
const fail = (message: string): never => {
  console.error(message);
  process.exit(1);
};
if (!args.backup || !args.user || !args.identity || !args.out) {
  fail('usage: --backup <dir> --user <id> --identity key.txt [--snapshot] [--board] --out file');
}
const backup = args.backup as string;
const user = args.user as string;
if (!/^[a-z2-7]{26}$/.test(user)) fail('the account ID is 26 letters a-z and digits 2-7');

const identity = readFileSync(args.identity as string, 'utf8')
  .split('\n')
  .find((line) => line.startsWith('AGE-SECRET-KEY-'));
if (!identity) fail('no AGE-SECRET-KEY line in the identity file');
const decrypter = new Decrypter();
decrypter.addIdentity(identity as string);

const snapshots = readdirSync(join(backup, 'snapshots'))
  .filter((name) => existsSync(join(backup, 'snapshots', name, 'COMPLETE')))
  .sort();
const snapshot = args.snapshot ?? snapshots.at(-1);
if (!snapshot || !snapshots.includes(snapshot)) fail('no such complete snapshot');
const sealed = readFileSync(
  join(backup, 'snapshots', snapshot as string, 'users', `${user}.json.age`),
);
const dump = JSON.parse(await decrypter.decrypt(sealed, 'text')) as VaultDump;

const { tree, photos } = restoreTree(dump);
const rootId = args.board ?? tree.homeId;
const boards = new Map(tree.boards.map((b) => [b.id, b]));
const opener = tree.boards.flatMap((b) => b.tiles).find((t) => t.targetBoardId === rootId);
const built = rootId ? subtreePackage(boards, rootId, opener ?? null) : null;
if (!built) fail('no such board in this backup');
const {
  package: pkg,
  photoIds,
  boards: boardCount,
  tiles: tileCount,
} = built as NonNullable<typeof built>;

const pictures = new Map<string, ObzPicture>();
let missing = 0;
for (const id of photoIds) {
  const file = join(backup, 'media', user, `${id}.age`);
  const meta = photos.find((p) => p.id === id);
  if (!existsSync(file) || !meta) {
    missing++;
    continue;
  }
  pictures.set(symbolKey({ set: 'own', ref: id }), {
    mime: meta.mime,
    width: meta.width,
    height: meta.height,
    data: await decrypter.decrypt(readFileSync(file)),
  });
}

const zippable: Zippable = {};
for (const [path, content] of Object.entries(packageToObz(pkg, pictures))) {
  zippable[path] = typeof content === 'string' ? strToU8(content) : [content, { level: 0 }];
}
writeFileSync(args.out as string, zipSync(zippable, { level: 6, mtime: new Date('2000-01-01') }));

const tooBig =
  boardCount > SHARE_LIMITS.maxBoards ||
  tileCount > SHARE_LIMITS.maxTiles ||
  photoIds.length > SHARE_LIMITS.maxPhotos;
console.log(
  `${args.out}: „${pkg.name}”, ${boardCount} boards, ${tileCount} tiles, ` +
    `${pictures.size} photos${missing ? ` (${missing} missing from the backup)` : ''}` +
    ` — snapshot ${snapshot}`,
);
if (tooBig) {
  console.log(
    `Larger than one import (${SHARE_LIMITS.maxBoards} boards, ${SHARE_LIMITS.maxTiles} tiles, ` +
      `${SHARE_LIMITS.maxPhotos} photos): restore its folders one by one with --board <id>.`,
  );
}
