// Outline sidebar built from the document's headings.

export interface OutlineEntry {
  id: string;
  text: string;
  level: number;
}

export function collectHeadings(root: ParentNode): OutlineEntry[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6"),
  )
    .filter((h) => h.id !== "" && !h.closest(".footnotes"))
    .map((h) => ({
      id: h.id,
      text: (h.textContent ?? "").trim(),
      level: Number(h.tagName.slice(1)),
    }));
}

export class Outline {
  private headings: HTMLElement[] = [];
  private frame = 0;

  constructor(
    private readonly nav: HTMLElement,
    private readonly list: HTMLElement,
    private readonly root: HTMLElement,
    private readonly scroller: HTMLElement,
  ) {
    scroller.addEventListener("scroll", () => this.scheduleTrack(), {
      passive: true,
    });
  }

  rebuild(): void {
    const entries = collectHeadings(this.root);
    const doc = this.nav.ownerDocument;
    const top = Math.min(...entries.map((e) => e.level));
    const items = entries.map((e) => {
      const li = doc.createElement("li");
      li.className = `depth-${e.level - top}`;
      const a = doc.createElement("a");
      a.href = `#${encodeURIComponent(e.id)}`;
      a.textContent = e.text === "" ? "(untitled)" : e.text;
      a.dataset["target"] = e.id;
      li.append(a);
      return li;
    });
    if (items.length === 0) {
      const li = doc.createElement("li");
      li.className = "outline-empty";
      li.textContent = "No headings";
      items.push(li);
    }
    this.list.replaceChildren(...items);
    this.headings = entries
      .map((e) => doc.getElementById(e.id))
      .filter((h): h is HTMLElement => h !== null);
    this.track();
  }

  clear(): void {
    this.list.replaceChildren();
    this.headings = [];
  }

  private scheduleTrack(): void {
    if (this.frame !== 0) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.track();
    });
  }

  /** Mark the section currently at the top of the view. */
  private track(): void {
    const top = this.scroller.getBoundingClientRect().top + 16;
    let current: HTMLElement | undefined;
    for (const h of this.headings) {
      if (h.getBoundingClientRect().top <= top) current = h;
      else break;
    }
    current ??= this.headings[0];
    for (const a of Array.from(
      this.list.querySelectorAll<HTMLAnchorElement>("a"),
    )) {
      if (a.dataset["target"] === current?.id)
        a.setAttribute("aria-current", "location");
      else a.removeAttribute("aria-current");
    }
  }
}
