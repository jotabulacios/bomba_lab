"""Build the GitHub Pages site with versioned asset folders (cache busting).

GitHub Pages serves every file with a ~10 min cache, so right after a push a
visitor can get a new index.html with old ES modules, or the reverse, and the
app breaks. The app has no build step and its modules import each other with
relative paths, so instead of rewriting imports this script puts styles.css and
src/ under v/<commit>/ and points index.html at that folder:

    _site/index.html                 -> v/<commit>/styles.css, v/<commit>/src/main.js
    _site/v/<commit>/styles.css
    _site/v/<commit>/src/**.js       (relative imports stay inside the folder)

<commit> is the last commit that changed index.html, styles.css or src/, so a
README-only push keeps the same URLs. Every module URL is new when the app
changes, so caches can never mix two versions. The previous versions are kept
too (taken from git), so a cached old index.html still loads its own modules.

Only committed files go in (uncommitted edits are ignored).

Usage: python3 tools/build_site.py [--out _site] [--keep 3]
"""
import argparse
import io
import pathlib
import re
import shutil
import subprocess
import tarfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
SITE_PATHS = ["index.html", "styles.css", "src"]
ASSET_PATHS = ["styles.css", "src"]


def git(*args):
    return subprocess.run(["git", *args], cwd=ROOT, check=True, capture_output=True, text=True).stdout.strip()


def site_versions(keep):
    """Short hashes of the last `keep` commits that changed the app, newest first."""
    out = git("log", "--first-parent", f"-n{keep}", "--format=%h", "--abbrev=12", "HEAD", "--", *SITE_PATHS)
    versions = out.split()
    if not versions:
        raise SystemExit("no commit touches the site files")
    return versions


def extract(commit, dest):
    """Write the assets of `commit` (styles.css, src/) into dest."""
    data = subprocess.run(["git", "archive", "--format=tar", commit, *ASSET_PATHS],
                          cwd=ROOT, check=True, capture_output=True).stdout
    with tarfile.open(fileobj=io.BytesIO(data)) as tar:
        tar.extractall(dest, filter="data")


def rewrite_index(html, prefix):
    """Point the local stylesheet and entry module of index.html at prefix/."""
    count = 0

    def repl(m):
        nonlocal count
        count += 1
        return f'{m.group(1)}="{prefix}/{m.group(2)}"'

    html = re.sub(r'\b(href|src)="((?:styles\.css|src/[^"]+))"', repl, html)
    if count < 2:
        raise SystemExit(f"index.html: expected styles.css and src/main.js references, found {count}")
    return html


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--out", default="_site")
    ap.add_argument("--keep", type=int, default=3, help="app versions to keep (current one included)")
    args = ap.parse_args()

    out = (ROOT / args.out).resolve()
    if out == ROOT or ROOT not in out.parents:
        raise SystemExit("--out must be a folder inside the repository")
    shutil.rmtree(out, ignore_errors=True)
    out.mkdir(parents=True)

    versions = site_versions(args.keep)
    current = versions[0]
    for v in versions:
        extract(v, out / "v" / v)

    # Unversioned copies of the current assets, for an index.html cached from
    # before versioning (it still asks for styles.css and src/main.js).
    extract("HEAD", out)

    index = git("show", "HEAD:index.html") + "\n"  # committed, like the assets
    (out / "index.html").write_text(rewrite_index(index, f"v/{current}"), encoding="utf-8")
    (out / ".nojekyll").write_text("")
    print(f"site built in {out.relative_to(ROOT)}: current v/{current}, kept {', '.join(versions[1:]) or 'none'}")


if __name__ == "__main__":
    main()
