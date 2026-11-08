import { ReleaseError, run } from "./exec.js";
import {
  emptyManifest,
  parseManifestText,
  type RawManifest,
  serializeManifest,
} from "./manifest.js";

/**
 * The manifest on GitHub Pages: `manifest.json` at the root of the `gh-pages` branch, which
 * Pages serves (`https://<owner>.github.io/<repo>/manifest.json`, the supervisor's default).
 * The branch is written with Git's plumbing commands (blob, tree, commit, push), without a
 * checkout: the working tree of `main` is never touched.
 */

export const PAGES_BRANCH = "gh-pages";
const REMOTE_REF = `refs/remotes/origin/${PAGES_BRANCH}`;

export interface PagesManifest {
  readonly manifest: RawManifest;
  /** Commit the manifest was read from; `undefined` when the branch does not exist yet. */
  readonly parent: string | undefined;
}

/** Fetches `gh-pages` and reads its manifest (an empty one before the first release). */
export async function readPagesManifest(repository: string): Promise<PagesManifest> {
  const branches = await run(
    "git",
    ["ls-remote", "--heads", "origin", `refs/heads/${PAGES_BRANCH}`],
    {
      cwd: repository,
    },
  );
  if (branches === "") {
    return { manifest: emptyManifest(), parent: undefined };
  }
  await run("git", ["fetch", "--quiet", "origin", `+refs/heads/${PAGES_BRANCH}:${REMOTE_REF}`], {
    cwd: repository,
  });
  const parent = await run("git", ["rev-parse", REMOTE_REF], { cwd: repository });
  const listed = await run("git", ["ls-tree", "--name-only", parent, "manifest.json"], {
    cwd: repository,
  });
  if (listed === "") {
    return { manifest: emptyManifest(), parent };
  }
  const text = await run("git", ["show", `${parent}:manifest.json`], { cwd: repository });
  return { manifest: parseManifestText(text), parent };
}

/**
 * Commits the manifest on `gh-pages` and pushes it. The branch only ever holds `manifest.json`
 * and `.nojekyll` (served as is). The push is not forced: if someone else published in the
 * meantime, it fails and nothing is lost.
 */
export async function writePagesManifest(
  repository: string,
  manifest: RawManifest,
  parent: string | undefined,
  message: string,
): Promise<string> {
  const git = (args: string[], input?: string) => run("git", args, { cwd: repository, input });
  const manifestBlob = await git(["hash-object", "-w", "--stdin"], serializeManifest(manifest));
  const emptyBlob = await git(["hash-object", "-w", "--stdin"], "");
  const tree = await git(
    ["mktree"],
    `100644 blob ${emptyBlob}\t.nojekyll\n100644 blob ${manifestBlob}\tmanifest.json\n`,
  );
  const commit = await git([
    "commit-tree",
    tree,
    ...(parent === undefined ? [] : ["-p", parent]),
    "-m",
    message,
  ]);
  try {
    await git(["push", "--quiet", "origin", `${commit}:refs/heads/${PAGES_BRANCH}`]);
  } catch (error) {
    throw new ReleaseError(
      `Le manifeste n'a pas pu être publié sur ${PAGES_BRANCH} (une autre publication a-t-elle eu lieu entre-temps ? relancez la commande).\n${error instanceof Error ? error.message : String(error)}`,
    );
  }
  await git(["update-ref", REMOTE_REF, commit]);
  return commit;
}
