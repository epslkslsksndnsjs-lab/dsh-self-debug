import { existsSync } from 'node:fs';
import { join } from 'node:path';

// The runner shells out to `npm`/`node`. On the developer machine the bundled
// Node toolchain is preferred (no global install, offline-safe). In CI a Node
// toolchain is already on PATH, so the default path is absent and we leave PATH
// untouched. Override with DSH_NODE_BIN_DIR if needed.
const DEFAULT_NODE_BIN = '/Users/Admin/.workbuddy/binaries/node/versions/22.22.2-2/bin';
const nodeBin = process.env.DSH_NODE_BIN_DIR ?? DEFAULT_NODE_BIN;

if (existsSync(join(nodeBin, 'node'))) {
  const sep = process.platform === 'win32' ? ';' : ':';
  process.env.PATH = `${nodeBin}${sep}${process.env.PATH ?? ''}`;
}
