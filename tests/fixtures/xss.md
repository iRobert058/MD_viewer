# Untrusted HTML

None of the following may run script or reach Tauri APIs.

<script>window.__pwned = true; document.title = "PWNED";</script>

<img src="x" onerror="window.__pwned = true; document.title = 'PWNED'">

[javascript link](javascript:alert(1))

<a href="javascript:alert(1)">raw javascript link</a>

<iframe src="https://example.com"></iframe>

<div style="position:fixed;inset:0;background:red">style attribute must be dropped</div>

<svg><script>window.__pwned = true</script></svg>

<form action="https://example.com"><button>Submit</button></form>

<details><summary>Allowed HTML</summary>Details/summary are fine.</details>
