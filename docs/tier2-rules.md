# Tier-2 Whitelist Manifest (proposed at Gate G0)

The deterministic C# patterns that render as pseudo-step cards. Hard cap: **15 rules**. This manifest is the source of truth the M3 manifest-parity tests will check against the implementation.

Admission criteria (all three required):
1. **Deterministic without type inference** — decidable from the statement AST alone.
2. **General C# or UiPath-universal** — never a project-local symbol.
3. **Worth a slot** — corpus frequency, or floor status fixed by the transpiler spec.

Selection data: M0 corpus spike (`corpus-report.json`, 840 leaf statements, 485 tier-3) and the codedautomations-samples subset re-run. Per-rule statement estimates are exact sums of `normalizeStatement` bucket counts; the full bucket-to-rule mapping is Appendix A of [`docs/m0-report.md`](./m0-report.md).

## Active rules (9 of 15 slots)

> **`*(proposed)*` convention:** an id marked `*(proposed)*` is a Gate-G0 proposal whose rule has not shipped yet. The manifest-parity guard (`tests/model/codedWorkflow/tier2Cap.test.ts`) treats a row as **active** only when its id appears *without* the marker, and requires the set of unmarked ids to exactly equal the shipped `TIER2_RULES` registry. T3.2 removes the marker from each row as its rule lands with implementation + fixtures.

| # | id | family | M0 rank | Est. stmts (corpus / subset) | Rationale | Near-miss boundary (stays tier-3) |
| ---: | --- | --- | --- | --- | --- | --- |
| 1 | `assign-from-call` | assign | floor (top bucket #8) | 51 / 16 | Spec floor. `x = Foo(...)` / `var x = Obj.Foo(...)` is the single most common honest pseudo-step ("Assign x from call"); generically absorbs project-local factories (TestHelpers.\*, 27) without naming them. Yields to any more specific shipped floor rule (string-op/linq/file/datetime) so the generic Assign card never shadows a specialized card. | Receiver chain must root at an identifier or static type name; calls chained on expressions (`new Random().Next(...)`) and `return Foo(...)` stay tier-3, as does any RHS containing await/lambda/query. |
| 2 | `string-op` | string | floor (top bucket #19) | 20 / 13 | Spec floor. Single string operation bound to a variable: one whitelisted method (`Trim`/`TrimStart`/`TrimEnd`/`ToUpper`/`ToLower`/`Replace`/`Substring`/`Split`/`IndexOf`/`ToString`/`Append`/`AppendLine`) on an identifier receiver with literal/identifier args; `+` concatenation; `$"..."` interpolation initializers and `+=` appends. Honesty shrink (no type inference): concat needs ≥1 string-literal/interpolated operand, and `+=` needs a string-ish RHS — identifier-only `+`/`+=` could be numeric and stays tier-3. Escape-hatch rule (same fence as `assign-from-call`): any `await`/lambda/query **anywhere** in the RHS — interpolation holes included — rejects the match. | Fluent chains of ≥2 ops (a trailing case fold included — `s.Trim().ToUpper()` stays tier-3), format expressions nested inside other calls, identifier-only `+`/`+=` arithmetic shapes, and any RHS with an await/lambda/query descendant — `$"total: {await GetTotalAsync()}"` and `prefix + items.Select(i => i.Name).First()` stay tier-3. |
| 3 | `linq-single-chain` | linq | floor | 5 / 2 | Spec floor. Short LINQ chain bound to a variable: ≤3 links from {`Where`, `Select`, `Sum`, `Count`, `First`, `FirstOrDefault`, `ToList`, `ToArray`} rooted at an identifier or property path (`invoices.Where(...).ToList()`, `order.Lines.Count()`). `Where`/`Select`/`Sum` take exactly one single-param expression-bodied lambda with no nested call or object creation; the rest take zero args. Wording is exact: `ToArray` renders “→ to array” (title “To array” when it terminates an otherwise-untitled chain) and `FirstOrDefault` renders “→ first or default” under the “Take first” title. | Operators outside the set — `tasks.OrderBy(...).Select(...).ToList()` is the measured counter-example and stays tier-3 — plus chains >3 links, lambdas with nested calls (`lines.Sum(l => l.GetAmount())`) or allocations (`rows.Select(r => new Dto(r))` — a `new T(...)` hides work like a call does), and predicate overloads (`Count(x => ...)`). |
| 4 | `file-op` | file | floor | 6 / 4 | Spec floor. Fixed static-API whitelist — `File.{ReadAllText, ReadAllLines, WriteAllText, AppendAllText, Copy, Move, Delete, Exists}`, `Directory.{CreateDirectory, Delete, Exists, GetFiles}`, `Path.{Combine, GetFileName, GetDirectoryName}` — as bare statements or bound values, every arg a literal or identifier AND the arity inside a per-method whitelist (`FILE_OP_ARITIES`), so a card never drops an argument. `File.Copy`'s 3-arg form requires a **literal** `true`/`false` overwrite flag, rendered “, overwrite” / “, no overwrite”. RPA-meaningful titles (“Delete file”, “Create folder”) with per-method text shapes documented on the rule. | Instance stream I/O (`fin.Read(buffer, 0, n)`, `fs.Write(...)`) — byte-level code reads better as a chip; computed/`new`-expression args, wrong arities (`File.Delete(tempPath, force)` — encoding/SearchOption/recursive overloads included), and a non-literal `File.Copy` overwrite flag (`File.Copy(a, b, shouldOverwrite)`) stay tier-3. |
| 5 | `datetime-arith` | datetime | floor | 6 / 1 | Spec floor, shrunk to the type-inference-free core: bare `DateTime.{Now, Today, UtcNow}` clock reads (“Read clock”) and a single `Add{Days, Months, Years, Hours, Minutes}(n)` call on such a read with n an integer literal, unary-minus literal, or identifier (“Calculate date”, e.g. `dueDate = today + 30 days`). The wider G0 scope (`DateTimeOffset`/`TimeSpan` property reads, general +/− arithmetic like `span.Days`) needs type info to stay honest and remains tier-3. | Culture/format parsing and `ToString` formatting (string-op or tier-3); property reads over date arithmetic (`(DateTime.Today - birthDate).Days`) and chained Add calls stay tier-3. |
| 6 | `console-write` | console | #1, #2, #5 | 68 / 68 | Largest tier-3 mass by far (14% of corpus tier-3). ONE rule for the three simple-argument shapes: `Console.WriteLine(literal \| interpolated \| identifier)` → “Write line” card. Honest even though corpus-skewed: the shape is universal C#. | `Console.WriteLine(expr)` with a nested call in the argument (4 hits, e.g. `Console.WriteLine(wb.GetTableRange(...))`) — the call inside is the real action and must not be hidden inside a log card. |
| 7 | `assign-literal` *(proposed)* | assign | #6, #11, #15, #17, #22 | 37 / 24 | `var x = "lit" \| 42 \| true \| null \| string.Empty` and the same as reassignment. Trivially deterministic, reads as a Studio Assign card. | Declarations without initializers (`string s;`), `decl=expr`, ternaries, arithmetic binops — value must be a single literal token (or `string.Empty`). |
| 8 | `collection-add` *(proposed)* | collection | #7 + tail (16 buckets) | 37 / 22 | `recv[.Prop]*.Add(args)` → “Add item” card, with specialized titles when the path ends in `.Columns`/`.Rows` (“Add column/row” — DataTable demos are rank #7). Subsumes the evaluated `datatable-collection-add` candidate in one slot. | Receiver must be an identifier/property path — `.Add` on computed receivers (method-call results) and dictionary indexer writes stay tier-3. |
| 9 | `assign-new-object` *(proposed)* | assign | long tail (21 buckets, counts ≤ 2) | 25 / 15 | `var x = new T(...)` (incl. collection initializers) → “Create T” card. No single big bucket, but the aggregated long tail is the 4th-largest honest mass; type name is purely syntactic. | Implicit arrays (`new[] {...}`), `return new T()`, and `new` nested inside argument lists. |

Projected totals (from `docs/m0-report.md` §6): rules cover 255/485 corpus tier-3 statements (165/256 on the subset). With the M1 classifier levers (+37, no slots), tier-1+tier-2 projects to **0.77 corpus-wide / 0.86 on the official-samples subset**.

**Slots intentionally left open: 6.** Nothing else in the corpus clears the admission bar (see rejections); the open slots are reserved for whatever the client corpus (`corpus/private/`) actually shows. Padding to 15 now would optimize the ratio against demo skew, not user value.

## Evaluated and rejected candidates

| Candidate | Corpus stmts | Verdict — one-line reason |
| --- | ---: | --- |
| `console-write` (3 WriteLine shapes as one rule) | 68 | **Accepted** — rule #6 above; `WriteLine(expr)` (4) kept out as the near-miss. |
| `assign-literal` (`decl=str`/`decl=num`/...) | 37 | **Accepted** — rule #7. |
| `datatable-collection-add` (`.Columns.Add`/`.Rows.Add`) | 18 | **Accepted, merged** — folded into `collection-add` (#8) as specialized titles; a separate rule would waste a slot on the same shape. |
| `string-interpolation-assign` | 2 | **Rejected as a slot** — only 2 hits; covered as `$"..."` initializers under the `string-op` floor rule instead. |
| `AddCriticalError(...)` (4 shapes) | 30 | Rejected — project-local symbol, 100% AIDemo; generalizes to nothing. |
| `AddWarning(...)` / `AddInfo(...)` (4 shapes) | 25 | Rejected — same: single-repo local helpers. |
| `TestHelpers.*` (14 shapes) | 27 | Rejected as a named rule — project-local; the *shape* is already claimed generically by `assign-from-call`. |
| Generic bare-helper-call (`Foo(args);`) | 78 | Rejected — would add ~9 pp corpus-wide but a “Call Foo” card for an arbitrary local method is a chip in card clothing; gaming Goal 3, not aiding comprehension. |
| `decl=expr` | 10 | Rejected — arbitrary expression; too generic to be honest. |
| `return expr` / `return var` / `return` family | 29 | Rejected — control-flow semantics; belongs to future flow/end-node rendering, not a pseudo-step card. |
| `throw` family | 6 | Rejected — same control-flow reasoning; low count. |
| Property-read assigns (`decl=prop:*`, non-datetime) | 9 | Rejected — deterministic but adds no comprehension over the raw chip; cheap to admit later if client corpus demands. |
| Arithmetic/bit binop assigns (singleton buckets) | ~20 | Rejected — the expression text *is* the content; a card adds nothing. |
| `decl=index:handle:testing` | 5 | Not a rule — classifier lever L2 (tier-1 handle data access); see m0-report §4. |
| PowerPoint/Java/Python member calls | 30 | Not rules — classifier lever L1 (catalog family-id fixes); see m0-report §4. |
| `break` / `continue` / ternary decls | 7 | Rejected — control flow / needs condition rendering; low count. |
| `Parallel.ForEach` / `Task.Run` | 3 | Rejected — concurrency requires a real design, not a card. |

## Provisional note

Ranks and estimates above are measured on the M0 public corpus (demo/sample-skewed; see m0-report §1). They will be **re-measured when client samples land in `corpus/private/`**, and the whitelist re-ranked at M3 before the manifest-parity tests freeze it. After G0, changes obey the cap rule: the cap stays at 15 and **adding a rule requires removing one** (or consuming one of the 6 open slots with fresh corpus evidence attached to the PR).
