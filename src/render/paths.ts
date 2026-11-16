// Resolving links and image sources against the open file's folder.
// All paths are POSIX; this app targets macOS.

export type LinkTarget =
  | { kind: "anchor"; id: string }
  | { kind: "external"; url: string }
  | { kind: "local"; path: string; fragment: string }
  | { kind: "blocked" };

export type ImageSource =
  | { kind: "local"; url: string; path: string }
  | { kind: "remote"; url: string }
  | { kind: "inline" }
  | { kind: "blocked" };

const SCHEME = /^([a-z][a-z0-9+.-]*):/i;
const EXTERNAL_SCHEMES = new Set(["http", "https", "mailto"]);
const MARKDOWN_EXT = /\.(md|markdown|mdown|mkd)$/i;

export function isMarkdownPath(path: string): boolean {
  return MARKDOWN_EXT.test(path);
}

/** Join and normalise POSIX paths, resolving `.` and `..`. */
export function resolvePath(baseDir: string, relative: string): string {
  const start = relative.startsWith("/") ? [] : baseDir.split("/");
  const parts: string[] = [];
  for (const seg of [...start, ...relative.split("/")]) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return "/" + parts.join("/");
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    // Not valid percent-encoding (e.g. a literal "100%.md"): use it as written.
    return s;
  }
}

function splitFragment(href: string): { path: string; fragment: string } {
  const hash = href.indexOf("#");
  const beforeHash = hash === -1 ? href : href.slice(0, hash);
  const fragment = hash === -1 ? "" : href.slice(hash + 1);
  const query = beforeHash.indexOf("?");
  return {
    path: query === -1 ? beforeHash : beforeHash.slice(0, query),
    fragment,
  };
}

export function classifyLink(rawHref: string, baseDir: string): LinkTarget {
  const href = rawHref.trim();
  if (href === "") return { kind: "blocked" };
  if (href.startsWith("#")) {
    return { kind: "anchor", id: safeDecode(href.slice(1)) };
  }
  const scheme = SCHEME.exec(href)?.[1]?.toLowerCase();
  if (scheme !== undefined) {
    if (EXTERNAL_SCHEMES.has(scheme)) return { kind: "external", url: href };
    if (scheme === "file") {
      const { path, fragment } = splitFragment(
        href.replace(/^file:\/\/(localhost)?/i, ""),
      );
      return {
        kind: "local",
        path: resolvePath("/", safeDecode(path)),
        fragment: safeDecode(fragment),
      };
    }
    return { kind: "blocked" };
  }
  if (href.startsWith("//")) return { kind: "external", url: "https:" + href };
  const { path, fragment } = splitFragment(href);
  if (path === "") return { kind: "anchor", id: safeDecode(fragment) };
  return {
    kind: "local",
    path: resolvePath(baseDir, safeDecode(path)),
    fragment: safeDecode(fragment),
  };
}

/** Build an `mdimg://` URL; each path segment is percent-encoded. */
export function localImageUrl(absPath: string): string {
  return (
    "mdimg://localhost" + absPath.split("/").map(encodeURIComponent).join("/")
  );
}

export function classifyImage(rawSrc: string, baseDir: string): ImageSource {
  const src = rawSrc.trim();
  if (src === "") return { kind: "blocked" };
  const scheme = SCHEME.exec(src)?.[1]?.toLowerCase();
  if (scheme === "data") return { kind: "inline" };
  if (scheme === "http" || scheme === "https")
    return { kind: "remote", url: src };
  if (src.startsWith("//")) return { kind: "remote", url: "https:" + src };
  if (scheme === "file") {
    const path = resolvePath(
      "/",
      safeDecode(
        splitFragment(src.replace(/^file:\/\/(localhost)?/i, "")).path,
      ),
    );
    return { kind: "local", url: localImageUrl(path), path };
  }
  if (scheme !== undefined) return { kind: "blocked" };
  const path = resolvePath(baseDir, safeDecode(splitFragment(src).path));
  return { kind: "local", url: localImageUrl(path), path };
}
