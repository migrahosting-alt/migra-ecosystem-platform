import fs from 'node:fs';
import path from 'node:path';
import type { WorkspaceFs } from './adapters.js';

/** A Node-backed WorkspaceFs. Writes are atomic (temp file + rename on the same
 * directory) so a crash mid-write never leaves a half-written file. Hosts pair
 * this with their own root/scope enforcement (the tools enforce containment). */
export function nodeWorkspaceFs(): WorkspaceFs {
  return {
    readFile: (p) => fs.readFileSync(p, 'utf8'),
    writeFile: (p, content) => {
      const tmp = path.join(path.dirname(p), `.wt-${process.pid}-${Math.floor(process.hrtime()[1])}-${path.basename(p)}.tmp`);
      fs.writeFileSync(tmp, content, 'utf8');
      fs.renameSync(tmp, p);
    },
    exists: (p) => fs.existsSync(p),
    realPath: (p) => fs.realpathSync(p),
    dirname: (p) => path.dirname(p),
    resolve: (root, rel) => path.resolve(root, rel),
    isAbsolute: (p) => path.isAbsolute(p),
    sep: path.sep,
  };
}
