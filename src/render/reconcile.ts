// Live reload without a full redraw: top-level blocks whose HTML did not change
// are kept as they are (images stay loaded, code stays highlighted), so the
// page height barely moves and the reader keeps their place.
//
// Comparison keys are the blocks' original HTML. They are computed lazily, on
// the first reload, so opening a file does not pay for serialising every block.
// Code that changes a block after rendering (the highlighter) calls
// `rememberOriginal` first, so the block still matches its unchanged source.

const originalHtml = new WeakMap<Element, string>();

export interface ReconcileResult {
  kept: number;
  added: number;
}

function keyOf(el: Element): string {
  return originalHtml.get(el) ?? el.outerHTML;
}

/** Record the HTML of `el`'s top-level block in `container` before mutating it. */
export function rememberOriginal(el: Element, container: Element): void {
  let block: Element | null = el;
  while (block && block.parentElement !== container)
    block = block.parentElement;
  if (block && !originalHtml.has(block))
    originalHtml.set(block, block.outerHTML);
}

export function reconcile(
  container: Element,
  fresh: DocumentFragment,
): ReconcileResult {
  if (container.childElementCount === 0) {
    // First render of this file: nothing to keep, so skip computing keys.
    const added = fresh.childElementCount;
    container.replaceChildren(fresh);
    return { kept: 0, added };
  }

  const pool = new Map<string, Element[]>();
  for (const child of Array.from(container.children)) {
    const key = keyOf(child);
    const list = pool.get(key);
    if (list) list.push(child);
    else pool.set(key, [child]);
  }

  const next: Node[] = [];
  let kept = 0;
  let added = 0;
  for (const node of Array.from(fresh.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      if ((node.textContent ?? "").trim() !== "") next.push(node);
      continue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const el = node as Element;
    const reused = pool.get(el.outerHTML)?.shift();
    if (reused) {
      next.push(reused);
      kept++;
    } else {
      next.push(el);
      added++;
    }
  }
  container.replaceChildren(...next);
  return { kept, added };
}
