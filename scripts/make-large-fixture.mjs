// Writes tests/fixtures/large.md (~1 MB) for the render-time budget check.
// Generated rather than committed to keep the repo small.
import { writeFileSync } from "node:fs";

const sections = [];
let size = 0;
for (let i = 1; size < 1024 * 1024; i++) {
  const s = `## Section ${i}

Paragraph ${i} with **bold**, *italic*, \`code\` and a [link](#section-${i}).
${"Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(6)}

- item one
- [x] done
- [ ] open

| a | b | c |
|---|:-:|--:|
| ${i} | two | three |

\`\`\`js
function f${i}(x) {
  return x * ${i}; // comment
}
\`\`\`
`;
  sections.push(s);
  size += Buffer.byteLength(s);
}
const out = new URL("../tests/fixtures/large.md", import.meta.url);
writeFileSync(out, `# Large document\n\n${sections.join("\n")}`);
console.log(
  `wrote ${out.pathname} (${(size / 1024).toFixed(0)} KB, ${sections.length} sections)`,
);
