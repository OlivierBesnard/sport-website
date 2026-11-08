import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { create } from "tar";
import { ReleaseError } from "./exec.js";

/**
 * The archive of one package: a `.tgz` of the application directory (`app.json` at its root),
 * files in a fixed order with a fixed date and no owner, so that the same tree always gives the
 * same bytes. Links are refused: the instance extracts plain files only.
 */

/** Every file and directory under `root`, as sorted `/`-separated relative paths. */
export async function listTree(root: string): Promise<string[]> {
  const result: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    const entries = (await readdir(directory)).sort();
    for (const name of entries) {
      const path = join(directory, name);
      const info = await lstat(path);
      const relativePath = relative(root, path).split(sep).join("/");
      if (info.isSymbolicLink()) {
        throw new ReleaseError(`Lien symbolique refusé dans le paquet : ${relativePath}`);
      }
      if (info.isDirectory()) {
        result.push(`${relativePath}/`);
        await visit(path);
      } else if (info.isFile()) {
        result.push(relativePath);
      } else {
        throw new ReleaseError(`Fichier spécial refusé dans le paquet : ${relativePath}`);
      }
    }
  };
  await visit(root);
  return result;
}

/** Fixed date of every entry: the archive does not depend on when it was built. */
const ARCHIVE_DATE = new Date("2000-01-01T00:00:00Z");

/** A link cache that never remembers a file, so no entry is written as a hard link. */
const NO_LINKS = new (class extends Map<string, string> {
  override get(): undefined {
    return undefined;
  }
  override set(): this {
    return this;
  }
})() as unknown as Map<`${number}:${number}`, string>;

export interface PackedArchive {
  readonly file: string;
  readonly size: number;
  readonly sha256: string;
}

export async function packDirectory(root: string, file: string): Promise<PackedArchive> {
  const entries = await listTree(root);
  // Synchronous: the asynchronous writer of node-tar stalls on large trees (thousands of
  // files, as in node_modules), never finishing the archive.
  create(
    {
      sync: true,
      gzip: { level: 9 },
      cwd: root,
      file,
      portable: true,
      noDirRecurse: true,
      mtime: ARCHIVE_DATE,
      // pnpm installs files as hard links to its store: each one is archived as a plain file.
      linkCache: NO_LINKS,
    },
    entries,
  );
  return { file, ...(await digest(file)) };
}

export async function digest(file: string): Promise<{ size: number; sha256: string }> {
  const hash = createHash("sha256");
  let size = 0;
  for await (const chunk of createReadStream(file)) {
    hash.update(chunk as Buffer);
    size += (chunk as Buffer).length;
  }
  return { size, sha256: hash.digest("hex") };
}
