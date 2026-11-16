// Live reload without a full redraw: top-level blocks whose HTML did not change
// are kept as they are (images stay loaded, code stays highlighted), so the
// page height barely moves and the reader keeps their place.

const sourceOf = new WeakMap<Element, string>();

export interface ReconcileResult {
  kept: number;
  added: number;
}

export function reconcile(
  container: Element,
  fresh: DocumentFragment,
): ReconcileResult {
  const pool = new Map<string, Element[]>();
  for (const child of Array.from(container.children)) {
    const key = sourceOf.get(child);
    if (key === undefined) continue;
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
    const key = el.outerHTML;
    const reused = pool.get(key)?.shift();
    if (reused) {
      next.push(reused);
      kept++;
    } else {
      sourceOf.set(el, key);
      next.push(el);
      added++;
    }
  }
  container.replaceChildren(...next);
  return { kept, added };
}
