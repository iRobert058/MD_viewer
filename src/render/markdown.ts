// markdown-it configured for GitHub Flavored Markdown.
// Tables, strikethrough and autolinks are built in; footnotes come from the
// official plugin; task lists and heading ids are small local plugins.

import markdownit, { type MarkdownIt, type StateCore } from "markdown-it";
import footnote from "markdown-it-footnote";

export function createMarkdown(): MarkdownIt {
  const md = markdownit({
    // Raw HTML is allowed like on GitHub; everything is sanitised afterwards.
    html: true,
    linkify: true,
    typographer: false,
  });
  md.use(footnote);
  md.use(taskLists);
  md.use(headingIds);
  return md;
}

/** GitHub-style heading slugs: lower case, punctuation removed, spaces to dashes. */
export class Slugger {
  private seen = new Map<string, number>();

  slug(text: string): string {
    const base =
      text
        .trim()
        .toLowerCase()
        .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, "")
        .replace(/ /g, "-") || "section";
    const count = this.seen.get(base);
    if (count === undefined) {
      this.seen.set(base, 0);
      return base;
    }
    let n = count + 1;
    while (this.seen.has(`${base}-${n}`)) n++;
    this.seen.set(base, n);
    this.seen.set(`${base}-${n}`, 0);
    return `${base}-${n}`;
  }
}

function headingIds(md: MarkdownIt): void {
  md.core.ruler.push("heading_ids", (state: StateCore) => {
    const slugger = new Slugger();
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length; i++) {
      const open = tokens[i];
      const inline = tokens[i + 1];
      if (open?.type !== "heading_open" || inline?.type !== "inline") continue;
      const text = (inline.children ?? [])
        .filter((t) => t.type === "text" || t.type === "code_inline")
        .map((t) => t.content)
        .join("");
      open.attrSet("id", slugger.slug(text));
    }
  });
}

const TASK = /^\[([ xX])\][ \t]/;

function taskLists(md: MarkdownIt): void {
  md.core.ruler.after("inline", "task_lists", (state: StateCore) => {
    const tokens = state.tokens;
    for (let i = 2; i < tokens.length; i++) {
      const inline = tokens[i];
      const para = tokens[i - 1];
      const item = tokens[i - 2];
      if (
        inline?.type !== "inline" ||
        para?.type !== "paragraph_open" ||
        item?.type !== "list_item_open"
      ) {
        continue;
      }
      const match = TASK.exec(inline.content);
      const first = inline.children?.[0];
      if (
        !match ||
        !first ||
        first.type !== "text" ||
        !first.content.startsWith(match[0])
      ) {
        continue;
      }
      first.content = first.content.slice(match[0].length);
      const checkbox = new state.Token("html_inline", "", 0);
      const checked = match[1] !== " ";
      checkbox.content = `<input type="checkbox" class="task-list-item-checkbox" disabled${checked ? " checked" : ""}> `;
      inline.children?.unshift(checkbox);
      item.attrJoin("class", "task-list-item");
      for (let j = i - 3; j >= 0; j--) {
        const list = tokens[j];
        if (
          list &&
          (list.type === "bullet_list_open" ||
            list.type === "ordered_list_open") &&
          list.level === item.level - 1
        ) {
          if (
            !String(list.attrGet("class") ?? "").includes("contains-task-list")
          ) {
            list.attrJoin("class", "contains-task-list");
          }
          break;
        }
      }
    }
  });
}
