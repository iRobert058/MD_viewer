// Find in document, drawn with the CSS Custom Highlight API so the document
// DOM is never modified (no wrapper spans to clean up after a live reload).

/** All case-insensitive matches of `query` in the text under `root`. */
export function findMatches(root: Node, query: string): Range[] {
  const needle = query.toLocaleLowerCase();
  if (needle === "") return [];
  const doc = root.ownerDocument ?? (root as Document);
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const ranges: Range[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = (node.nodeValue ?? "").toLocaleLowerCase();
    // Only search where lower-casing kept the length, so offsets stay valid.
    if (text.length !== (node.nodeValue ?? "").length) continue;
    let from = 0;
    for (;;) {
      const at = text.indexOf(needle, from);
      if (at === -1) break;
      const range = doc.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + needle.length);
      ranges.push(range);
      from = at + needle.length;
    }
  }
  return ranges;
}

export interface FindElements {
  bar: HTMLElement;
  input: HTMLInputElement;
  status: HTMLElement;
  prev: HTMLButtonElement;
  next: HTMLButtonElement;
  close: HTMLButtonElement;
}

export class FindBar {
  private matches: Range[] = [];
  private current = -1;
  private readonly supported =
    typeof CSS !== "undefined" && "highlights" in CSS;

  constructor(
    private readonly el: FindElements,
    private readonly root: HTMLElement,
    private readonly scroller: HTMLElement,
  ) {
    el.input.addEventListener("input", () => this.search(true));
    el.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.step(e.shiftKey ? -1 : 1);
      } else if (e.key === "Escape") {
        e.preventDefault();
        this.close();
      }
    });
    el.prev.addEventListener("click", () => this.step(-1));
    el.next.addEventListener("click", () => this.step(1));
    el.close.addEventListener("click", () => this.close());
  }

  get isOpen(): boolean {
    return !this.el.bar.hidden;
  }

  open(): void {
    this.el.bar.hidden = false;
    this.el.input.focus();
    this.el.input.select();
    if (!this.supported) {
      this.el.status.textContent = "Find needs a newer version of macOS";
      return;
    }
    this.search(true);
  }

  close(): void {
    this.el.bar.hidden = true;
    this.clear();
    this.root.focus({ preventScroll: true });
  }

  /** Re-run the search after the document re-rendered. */
  refresh(): void {
    if (this.isOpen) this.search(false);
  }

  step(direction: 1 | -1): void {
    if (!this.isOpen) {
      this.open();
      return;
    }
    if (this.matches.length === 0) return;
    this.current =
      (this.current + direction + this.matches.length) % this.matches.length;
    this.paint();
    this.reveal();
  }

  private search(revealFirst: boolean): void {
    if (!this.supported) return;
    const query = this.el.input.value;
    this.matches = findMatches(this.root, query);
    this.current = this.matches.length > 0 ? this.firstVisibleMatch() : -1;
    this.paint();
    if (revealFirst) this.reveal();
  }

  /** Start from the first match at or below the top of the view. */
  private firstVisibleMatch(): number {
    const top = this.scroller.getBoundingClientRect().top;
    const i = this.matches.findIndex(
      (r) => r.getBoundingClientRect().bottom >= top,
    );
    return i === -1 ? 0 : i;
  }

  private paint(): void {
    if (!this.supported) return;
    CSS.highlights.set("find", new Highlight(...this.matches));
    const cur = this.matches[this.current];
    if (cur) CSS.highlights.set("find-current", new Highlight(cur));
    else CSS.highlights.delete("find-current");
    const n = this.matches.length;
    this.el.status.textContent =
      this.el.input.value === ""
        ? ""
        : n === 0
          ? "No matches"
          : `${this.current + 1} of ${n}`;
    this.el.prev.disabled = n === 0;
    this.el.next.disabled = n === 0;
  }

  private reveal(): void {
    const range = this.matches[this.current];
    if (!range) return;
    const rect = range.getBoundingClientRect();
    const view = this.scroller.getBoundingClientRect();
    if (rect.top < view.top + 40 || rect.bottom > view.bottom - 40) {
      this.scroller.scrollBy({ top: rect.top - view.top - view.height / 3 });
    }
  }

  private clear(): void {
    this.matches = [];
    this.current = -1;
    if (this.supported) {
      CSS.highlights.delete("find");
      CSS.highlights.delete("find-current");
    }
    this.el.status.textContent = "";
  }
}
