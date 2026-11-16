# GitHub Flavored Markdown

## Tables

| Left | Center | Right |
|:-----|:------:|------:|
| a    |   b    |     c |
| long cell text | `code` | 1,234.56 |

## Task lists

- [x] Done item
- [ ] Open item
  - [ ] Nested open item
- Not a task

## Strikethrough

This is ~~wrong~~ right.

## Autolinks

Visit https://example.com or www.example.org, mail someone@example.com.

## Footnotes

Here is a claim.[^1] And another one.[^note]

[^1]: The first footnote.
[^note]: A named footnote with **formatting**.

## Code

```ts
interface Note {
  title: string;
  tags: string[];
}
const note: Note = { title: "Hi", tags: ["a"] };
```

```python
def greet(name: str) -> str:
    return f"Hello, {name}!"
```

```bash
echo "Hello" | tr a-z A-Z
```

```
Plain block without a language.
```

```unknownlang
Unknown language stays plain.
```

## Heading with `code` and *emphasis*

## Duplicate

## Duplicate

### Deeper heading

#### Even deeper
