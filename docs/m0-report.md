# M0 Corpus-Spike Analysis Report (Gate G0)

Status: **complete — Gate G0 decision data**. Date: 2026-06-10.
Inputs: `corpus-report.json` / `corpus-report.md` (spike run of 2026-06-10T16:04Z, `scripts/corpusSpike.ts` over `corpus/`), plus one subset re-run of the same script (see §2.2).
Companion deliverable: the proposed tier-2 whitelist in [`docs/tier2-rules.md`](./tier2-rules.md).

Every number below is computed from `corpus-report.json` (or from re-running the unmodified spike script on a corpus subdirectory). Where a number is derived, the method is stated inline.

## 1. Corpus composition

From `corpus-report.json` → `corpus`:

| Metric | Count |
| --- | ---: |
| .cs files | 539 |
| Workflow files | 80 |
| Helper files | 458 |
| Generated files (excluded) | 1 |
| Sniff false positives | 0 |
| Files with parse errors | 0 |

Per-repo composition (method: group `workflows[]` rows by first path segment; one class per file in this corpus, so rows = files):

| Repo | Workflow files | Stmts | Tier 1 | Tier 3 | Tier-1 ratio | Character |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| codedautomations-samples | 42 | 390 | 134 | 256 | 0.34 | Official UiPath sample set; service demos + tech-interop demos (Java, Python, MongoDB, ASP.NET, 2FA crypto) |
| AIDemo | 30 | 359 | 200 | 159 | 0.56 | One invoice-validation project: a 147-stmt pure-C# rules engine + 29 small test cases heavy on the `testing` service |
| chunk-dispatcher | 1 | 64 | 3 | 61 | 0.05 | Byte-level file-chunking utility; almost no UiPath surface |
| CodedAndLowCodeWorkflow | 5 | 20 | 17 | 3 | 0.85 | Small mixed-mode demos; closest to "client-style" service density |
| DemoCodedAutomation2 | 2 | 7 | 1 | 6 | 0.14 | Toy Fibonacci demo |
| **Total** | **80** | **840** | **355** | **485** | **0.42** | |

`Community.Activities` was cloned but contributed 0 workflow files (helpers only); `corpus/private/` is currently empty (reserved for client samples).

**Skew warning (stated up front).** This corpus is demo/sample/test code, and two repos dominate (89% of statements come from codedautomations-samples + AIDemo). Two concrete distortions:

1. `Console.WriteLine` (68 simple-shape hits, ranks 1/2/5) is demo logging style. Real client code uses the tier-1 `Log()` base API, so this mass largely does not exist in client code.
2. `AddCriticalError`/`AddWarning`/`AddInfo` (55 hits) plus `TestHelpers.*` (27) and `Validate*` (11) are project-LOCAL helpers of one repo (AIDemo). They generalize to nothing; any rule cut to them would be overfit. Per-example provenance is analyzed bucket-by-bucket in §5.

A third caveat from the spike itself: handle tracking is deliberately over-approximate (any variable initialized from a service-rooted call is treated as a service handle), so the measured tier-1 counts are slightly inflated. The targets in §6 carry margin for this.

## 2. Aggregate ratios and projections

From `corpus-report.json` → `aggregate`:

| Metric | Value |
| --- | ---: |
| Leaf statements | 840 |
| Tier 1 | 355 |
| Tier 3 | 485 |
| Tier-1 ratio | 0.42 |

Projected ratio if the top-K unmatched signature buckets became tier-2 rules (as emitted by the spike):

| K | Projected ratio |
| ---: | ---: |
| 5 | 0.55 |
| 10 | 0.61 |
| 15 | 0.65 |

**Important:** this K-projection counts *signature buckets*, not *rules*. One whitelist rule legitimately covers many buckets (e.g. `console-write` covers ranks 1, 2 and 5; `assign-literal` covers ranks 6, 11, 15, 17, 22 plus singletons). The naive 0.65 ceiling at K=15 therefore *understates* what 15 honest rules can do; the per-rule accounting in §6 reaches 0.73 with 9 rules, before any classifier fix.

### 2.2 The official-samples subset, measured exactly

Method: re-ran the unmodified spike on the subset only — `npx tsx scripts/corpusSpike.ts --corpus ./corpus/codedautomations-samples` — so subset numbers are exact, not example-attributed.

| Metric | codedautomations-samples | Corpus-wide |
| --- | ---: | ---: |
| Leaf statements | 390 | 840 |
| Tier 1 | 134 | 355 |
| Tier-1 ratio | **0.34** | 0.42 |
| Top-5 buckets as tier-2 | 0.58 | 0.55 |
| Top-10 | 0.64 | 0.61 |
| Top-15 | 0.69 | 0.65 |

Finding that reshapes the Goal-3 recommendation: **the official UiPath samples are currently the *weaker* subset on raw tier-1 (0.34 < 0.42)**, not the stronger one the provisional goal assumed. Causes, in the data: (a) 68 of its 256 tier-3 statements are `Console.WriteLine` demo logging; (b) it contains non-UiPath tech demos (MongoDB driver, IronPython interop, ASP.NET host, 2FA crypto math) that are *correctly* tier-3; (c) three entire UiPath service families in it never match for classifier reasons, not corpus reasons — see §4. After fixing (c) and applying the whitelist, this subset becomes the strongest (0.86, §6).

## 3. Top-50 unmatched signatures

Imported verbatim from `corpus-report.md` (full 235-signature list lives in `corpus-report.json` → `unmatchedPatterns`):

| # | Signature | Count | % of tier 3 | Example |
| ---: | --- | ---: | ---: | --- |
| 1 | `call:Console.WriteLine(interp)` | 31 | 6.4 | codedautomations-samples/CodedCredentialsDemo/CodedCredentialsT.cs:33 `Console.WriteLine($"added credential for target {target}: {added}");` |
| 2 | `call:Console.WriteLine(str)` | 23 | 4.7 | codedautomations-samples/CodedExcelDemo/UseExcelFile_1Simple.cs:58 `Console.WriteLine("start print data table");` |
| 3 | `call:AddCriticalError(var,str,str)` | 20 | 4.1 | AIDemo/InvoiceValidationWorkflow.cs:191 `AddCriticalError(result, "InvoiceNumber", "Invoice number is required and cannot be empty");` |
| 4 | `call:AddWarning(var,str,str,str)` | 16 | 3.3 | AIDemo/InvoiceValidationWorkflow.cs:238 `AddWarning(result, "DueDate", "Due date is missing", "Using default payment terms (NET 30)");` |
| 5 | `call:Console.WriteLine(var)` | 14 | 2.9 | codedautomations-samples/CodedExcelDemo/UseExcelFile_1Simple.cs:67 `Console.WriteLine(row);` |
| 6 | `decl=str` | 14 | 2.9 | codedautomations-samples/CodedCredentialsDemo/CodedCredentialsT.cs:28 `string target = "someTarget";` |
| 7 | `call:var.Columns.Add(str,expr)` | 12 | 2.5 | codedautomations-samples/CodedDatabaseDemo/SqliteCodedTests.cs:74 `ndt.Columns.Add("ID", typeof(decimal));` |
| 8 | `decl=TestHelpers.CreateValidInvoice()` | 10 | 2.1 | AIDemo/Tests/ApprovalWorkflow/DepartmentManagerApprovalTest.cs:26 `var invoice = TestHelpers.CreateValidInvoice();` |
| 9 | `decl=expr` | 10 | 2.1 | AIDemo/InvoiceValidationWorkflow.cs:493 `var genericTerms = new[] { "item", "product", "service", "misc", "miscellaneous" };` |
| 10 | `return expr` | 8 | 1.6 | AIDemo/InvoiceValidationWorkflow.cs:746 `return !ApprovedVendors.Contains(vendorName);` |
| 11 | `assign= str` | 7 | 1.4 | AIDemo/InvoiceValidationWorkflow.cs:557 `requiredApprovalLevel = "Department Manager";` |
| 12 | `return var` | 7 | 1.4 | AIDemo/InvoiceValidationWorkflow.cs:168 `return validationResult;` |
| 13 | `call:AddCriticalError(var,str,interp)` | 6 | 1.2 | AIDemo/InvoiceValidationWorkflow.cs:231 `AddCriticalError(result, "InvoiceDate", $"Invoice date cannot be older than {MAX_INVOICE_AGE_DAYS} days");` |
| 14 | `call:AddWarning(var,interp,str,str)` | 6 | 1.2 | AIDemo/InvoiceValidationWorkflow.cs:490 `AddWarning(result, $"{fieldPrefix}.ItemDescription", "Item description should be between 3 and 500 characters", "Provide` |
| 15 | `assign= num` | 5 | 1.0 | AIDemo/Tests/ApprovalWorkflow/DepartmentManagerApprovalTest.cs:27 `invoice.TotalAmount = 750.00m;` |
| 16 | `decl=index:handle:testing` | 5 | 1.0 | codedautomations-samples/GenerateTestData/TestDataGenerator.cs:55 `string country = address["Country"];` |
| 17 | `decl=num` | 5 | 1.0 | DemoCodedAutomation2/Workflow.cs:28 `int a = 0, b = 1, c = 0;` |
| 18 | `return` | 5 | 1.0 | AIDemo/InvoiceValidationWorkflow.cs:266 `return;` |
| 19 | `assign+= binop:+(var.ToString(),str)` | 4 | 0.8 | codedautomations-samples/CodedExcelDemo/UseExcelFile_1Simple.cs:65 `row += value.ToString() + " ";` |
| 20 | `call:Console.WriteLine(expr)` | 4 | 0.8 | codedautomations-samples/CodedExcelDemo/UseWorkbook_4.cs:28 `Console.WriteLine( wb.GetTableRange("Sheet2","Table1",false));` |
| 21 | `call:PrintSheets(var)` | 4 | 0.8 | codedautomations-samples/CodedExcelDemo/UseWorkbook_Create_5.cs:41 `PrintSheets(wb);` |
| 22 | `decl=prop:string.Empty` | 4 | 0.8 | codedautomations-samples/CodedExcelDemo/UseExcelFile_1Simple.cs:62 `string row = string.Empty;` |
| 23 | `stmt:break_statement` | 4 | 0.8 | chunk-dispatcher/Generator.cs:118 `break;` |
| 24 | `assign= var` | 3 | 0.6 | DemoCodedAutomation2/Workflow.cs:32 `a = b;` |
| 25 | `call:AddCriticalError(var,interp,str)` | 3 | 0.6 | AIDemo/InvoiceValidationWorkflow.cs:483 `AddCriticalError(result, $"{fieldPrefix}.ItemDescription", "Item description is required");` |
| 26 | `call:File.Delete(var)` | 3 | 0.6 | codedautomations-samples/CodedExcelDemo/UseWorkbook_Create_5.cs:37 `File.Delete(myFile);` |
| 27 | `call:PrintDataTable(var)` | 3 | 0.6 | codedautomations-samples/CodedExcelDemo/UseExcelFile_1Simple.cs:30 `PrintDataTable(table);` |
| 28 | `call:var.Add(expr)` | 3 | 0.6 | chunk-dispatcher/Generator.cs:61 `ends.Add(starts[i + 1]);` |
| 29 | `call:var.Add(var)` | 3 | 0.6 | chunk-dispatcher/Generator.cs:62 `ends.Add(fileSize);` |
| 30 | `call:var.AddNewSlide(str)` | 3 | 0.6 | codedautomations-samples/CodedPowerPointDemo/CreateNewDocument.cs:52 `ppt.AddNewSlide("Blank");` |
| 31 | `call:var.InfoMessages.Add(interp)` | 3 | 0.6 | AIDemo/InvoiceValidationWorkflow.cs:582 `result.InfoMessages.Add($"Required approval level: {requiredApprovalLevel}");` |
| 32 | `decl=ternary` | 3 | 0.6 | chunk-dispatcher/Generator.cs:47 `var maxProcs = procs > 0 ? procs : Environment.ProcessorCount;` |
| 33 | `decl=var.ConvertObject(var)` | 3 | 0.6 | codedautomations-samples/CodedJavaDemo/JavaCodedTests.cs:39 `var arr = js.ConvertObject<int[]>(JavaObjectResultStaticMethod);` |
| 34 | `throw` | 3 | 0.6 | codedautomations-samples/MongoDBSample/MongoDBCodedWorkflowsSample_StudioProject/TestConnection.cs:42 `throw;` |
| 35 | `throw new:ArgumentException(str)` | 3 | 0.6 | chunk-dispatcher/Generator.cs:42 `throw new ArgumentException("filePath is required.");` |
| 36 | `call:AddWarning(var,str,interp,str)` | 2 | 0.4 | AIDemo/InvoiceValidationWorkflow.cs:392 `AddWarning(result, "TaxAmount", $"Tax rate ({taxRate:P1}) exceeds reasonable maximum ({MAX_TAX_RATE:P1})", "Verify tax c` |
| 37 | `call:var.Add(str)` | 2 | 0.4 | AIDemo/InvoiceValidationWorkflow.cs:573 `specialApprovals.Add("Finance Team");` |
| 38 | `call:var.AddNewSlide(expr,expr,str)` | 2 | 0.4 | codedautomations-samples/CodedPowerPointDemo/AddNewSlide.cs:44 `pow.AddNewSlide(ConstClass2.TitleOnly, InsertPositionType.Beginning, "Office Theme");` |
| 39 | `call:var.Append(expr)` | 2 | 0.4 | codedautomations-samples/GenerateTestData/TestDataGenerator.cs:78 `sb.Append(dataTable.Columns[i].ColumnName);` |
| 40 | `call:var.Append(str)` | 2 | 0.4 | codedautomations-samples/GenerateTestData/TestDataGenerator.cs:80 `sb.Append(",");` |
| 41 | `call:var.AppendLine()` | 2 | 0.4 | codedautomations-samples/GenerateTestData/TestDataGenerator.cs:82 `sb.AppendLine();` |
| 42 | `call:var.Columns.Add(str)` | 2 | 0.4 | codedautomations-samples/CodedWordDemo/UseWordDocument_InsertDataTable.cs:37 `dt.Columns.Add("C1");` |
| 43 | `call:var.Errors.Add(new:ValidationError)` | 2 | 0.4 | AIDemo/InvoiceValidationWorkflow.cs:174 `validationResult.Errors.Add(new ValidationError { FieldName = "System", ErrorMessage = $"Validation process failed: {ex.` |
| 44 | `call:var.InfoMessages.Add(str)` | 2 | 0.4 | AIDemo/InvoiceValidationWorkflow.cs:604 `result.InfoMessages.Add("GL code validation required - route to accounting for code assignment");` |
| 45 | `decl=` | 2 | 0.4 | AIDemo/InvoiceValidationWorkflow.cs:552 `string requiredApprovalLevel;` |
| 46 | `decl=TestHelpers.CreateHighValueInvoice(num)` | 2 | 0.4 | AIDemo/Tests/ApprovalWorkflow/DirectorApprovalTest.cs:26 `var invoice = TestHelpers.CreateHighValueInvoice(25000.00m);` |
| 47 | `decl=TestHelpers.CreateInvoiceWithInvalidAmount(expr)` | 2 | 0.4 | AIDemo/Tests/FinancialValidation/ExcessiveAmountTest.cs:26 `var invoice = TestHelpers.CreateInvoiceWithInvalidAmount(TestHelpers.BoundaryValues.ExcessiveAmount);` |
| 48 | `decl=TestHelpers.CreateInvoiceWithInvalidNumber(str)` | 2 | 0.4 | AIDemo/Tests/InvoiceHeaderValidation/EmptyInvoiceNumberTest.cs:26 `var invoice = TestHelpers.CreateInvoiceWithInvalidNumber("");` |
| 49 | `decl=TestHelpers.CreateInvoiceWithUnknownVendor()` | 2 | 0.4 | AIDemo/Tests/ApprovalWorkflow/NewVendorApprovalTest.cs:26 `var invoice = TestHelpers.CreateInvoiceWithUnknownVendor();` |
| 50 | `decl=interp` | 2 | 0.4 | AIDemo/InvoiceValidationWorkflow.cs:478 `var fieldPrefix = $"LineItems[{i}]";` |

Long-tail shape (method: histogram of `unmatchedPatterns[].count`): 235 signatures; 175 are singletons (175 statements), 25 have count 2, 12 have count 3. Buckets with count ≥ 4 (23 buckets) cover 224 of 485 tier-3 statements — the tail matters, which is why rules are defined as *shapes*, not per-signature.

## 4. Classifier levers (not rules)

Tier-3 mass that is reclaimable by fixing the tier-1 classifier/catalog, spending **zero** whitelist slots. Method for each: sum of the exact `unmatchedPatterns` bucket counts attributed to the gap (bucket lists in Appendix A), with source files inspected to confirm root cause.

| # | Lever | Reclaims (stmts) | Root cause and evidence |
| --- | --- | ---: | --- |
| L1 | **Service family-id fixes** (`powerpoint` casing; `java`, `python` missing) | **30** | The corpus calls `powerpoint.UsePresentationDocument(...)` (15 root uses) but the catalog id is `powerPoint` — exact-text receiver matching means the whole PowerPoint family **never matches** (`src/model/codedWorkflow/classify/tier1Catalog.ts` id vs `corpus/codedautomations-samples/CodedPowerPointDemo/*`). The `java` and `python` services are absent from the catalog entirely (`java.UseJavaScope`, `python.UsePythonScope` in CodedJavaDemo/CodedPythonDemo), so their scope handles (`js`, `pyScope`) are never tracked and every member call falls to tier-3. PowerPoint 16 + Java 10 + Python 4. |
| L2 | **Element-access reads on tracked handles** | **5** | `decl=index:handle:testing` (rank 16): `string country = address["Country"];` where `address` is a tracked `testing`-family handle. The matcher walks *through* indexers on call chains but a bare indexer read is not an `invocation_expression`, so it never matches. Treat element-access reads on tracked handles as tier-1 data access. |
| L3 | **`as_expression` unwrap** | **2** | `unwrapExpression` in `tier1Match.ts` strips `await`/parens/`cast_expression` but not `as_expression`. Method: grep `\bas\s+\w` over all 80 workflow files → exactly 3 hits; 2 are `var cellValue = wb.ReadCell(sheet, "B7", true) as string;` (UseWorkbook_Create_5.cs:80, 89) where `wb` is confirmed tracked (declared from `excel.UseWorkBook(...)` in the enclosing `using`) — both become tier-1 with the unwrap. The third is a reflection call (FormatSlideContent.cs:45) and correctly stays tier-3. Explicit `(T)x` value casts: 0 found in workflow files (already handled). |
| L4 | (minor, not counted) Parameter-typed handles; possible `_base` members | ~2 | `var sheets = wb.GetSheets();` inside `PrintSheets(IWorkHandle wb)` is tier-3 because handle tracking is method-local and parameters are never tracked (+1). Bare `Delay(TimeSpan...)` in PythonTests.cs:54 may be a base-class API (+1) — verify against the SDK before adding to `_base`. Excluded from projections. |

**Lever total: +37 statements.** Corpus-wide tier-1 moves 355 → 392 (**0.42 → 0.47**); the official-samples subset moves 134 → 171 (**0.34 → 0.44**) — all 37 lever statements sit in that subset. These are M1 classifier/catalog work items, not whitelist rules.

## 5. Provenance analysis of the top-20 buckets

Method: every example in `unmatchedPatterns[].examples` carries a file path; a bucket is attributed to a repo when all its examples share that repo. Example sets are complete for buckets with count ≤ 3 (the spike caps examples at 3); for the larger buckets the subset re-run (§2.2) confirms attribution exactly. Note the distinction between a *project-local symbol* (the named method exists in one repo — rule-hostile) and a *general C# shape* whose examples merely happen to come from one repo (rule-friendly).

| Rank | Signature | Count | Repo(s) | Classification |
| ---: | --- | ---: | --- | --- |
| 1 | `call:Console.WriteLine(interp)` | 31 | samples | General C# — demo-logging style (skew; client code uses tier-1 `Log()`) |
| 2 | `call:Console.WriteLine(str)` | 23 | samples | General C# — demo-logging style |
| 3 | `call:AddCriticalError(var,str,str)` | 20 | AIDemo only | **Project-local symbol** — generalizes to nothing |
| 4 | `call:AddWarning(var,str,str,str)` | 16 | AIDemo only | **Project-local symbol** |
| 5 | `call:Console.WriteLine(var)` | 14 | samples | General C# — demo-logging style |
| 6 | `decl=str` | 14 | samples | General C# shape |
| 7 | `call:var.Columns.Add(str,expr)` | 12 | samples | General C#/.NET (DataTable API) |
| 8 | `decl=TestHelpers.CreateValidInvoice()` | 10 | AIDemo only | **Project-local symbol** (shape itself = generic assign-from-call) |
| 9 | `decl=expr` | 10 | AIDemo + chunk-dispatcher | General but unboundable (arbitrary expression) |
| 10 | `return expr` | 8 | AIDemo + CodedAndLowCode | General C# — control flow |
| 11 | `assign= str` | 7 | AIDemo | General C# shape (examples single-repo; pattern is not) |
| 12 | `return var` | 7 | AIDemo + Demo2 | General C# — control flow |
| 13 | `call:AddCriticalError(var,str,interp)` | 6 | AIDemo only | **Project-local symbol** |
| 14 | `call:AddWarning(var,interp,str,str)` | 6 | AIDemo only | **Project-local symbol** |
| 15 | `assign= num` | 5 | AIDemo | General C# shape |
| 16 | `decl=index:handle:testing` | 5 | samples | **Classifier gap** — lever L2, not a rule |
| 17 | `decl=num` | 5 | Demo2 + chunk-dispatcher | General C# shape |
| 18 | `return` | 5 | AIDemo | General C# — control flow |
| 19 | `assign+= binop:+(var.ToString(),str)` | 4 | samples | General C# — string concat (string-op floor) |
| 20 | `call:Console.WriteLine(expr)` | 4 | samples | Demo logging with nested service call — designated near-miss |

Concentration summary: 5 of the top-20 buckets (58 statements) are project-local AIDemo symbols; the full project-local helper-call family (AddCriticalError/AddWarning/AddInfo 55, `Validate*` 11, misc. 12) is 68 AIDemo statements + 10 from other repos = **78 statements (16% of tier-3) that no honest general rule can claim**.

## 6. Goal-3 assessment and recommendation

**Measured ceiling, naive reading:** top-15 signature buckets as rules → 0.65 corpus-wide (0.69 on the subset). This is the floor of what 15 rules achieve, not the ceiling, because rules are shapes spanning many buckets (§2).

**Projected coverage of the actual proposal** (9 rules of the 15-rule cap — see `docs/tier2-rules.md`; method: tier-1 + lever sums + per-rule bucket sums from Appendix A, each bucket counted once):

| Population | Now (tier-1) | + levers (§4) | + 9-rule whitelist | Whitelist only (no levers) |
| --- | ---: | ---: | ---: | ---: |
| Corpus-wide (840) | 0.42 | 0.47 | **0.77** (647/840) | 0.73 (610/840) |
| codedautomations-samples (390) | 0.34 | 0.44 | **0.86** (336/390) | 0.77 (299/390) |

What remains tier-3 corpus-wide after levers + whitelist (193 statements) is dominated by: project-local helper calls (78), `return`/`throw` control flow (35), `Console.WriteLine(expr)` near-misses (4), and irreducible expression-level code — bit math, ternaries, `break`, arbitrary `decl=expr` (76). That is **correct** tier-3 behavior, not failure: these render as raw-code chips by design.

**Why this corpus likely understates client-code ratios.** (a) Client workflows are service-call dense — this corpus's densest service users (SAP demo 1.00, AIDemo tests 0.82–0.94, CodedAndLowCodeWorkflow 0.85) look nothing like its aggregate; (b) demo `Console.WriteLine` becomes tier-1 `Log()` in client code; (c) two of the five repos (chunk-dispatcher 0.05, the 2FA crypto demo 0.00) are general-purpose C# utilities that merely *run* under UiPath; (d) AIDemo's single 147-statement pure-C# rules engine alone is 17.5% of all corpus statements at ratio 0.17. Counterweight: the measured tier-1 baseline is slightly inflated by over-approximate handle tracking, so margins below are deliberately conservative.

**The provisional spec target ("≥80% of corpus statements tier-1/tier-2") is not honestly attainable corpus-wide** — reaching it would require claiming project-local helper calls and bare control flow as pseudo-steps, i.e. chips in card clothing. Recommendation, following the data:

> **Goal 3 (v1, FINAL from M0):**
> 1. **≥80% tier-1+tier-2 on the UiPath-service-heavy subset** = the official `codedautomations-samples` corpus subset. Projected 0.86 — feasible with ~6 pp margin, but **conditional on the M1 classifier levers** (without L1–L3 the subset projects 0.77 and the gate fails). The levers are therefore M1-mandatory scope.
> 2. **≥70% corpus-wide.** Projected 0.77 with levers; still met at 0.73 by the whitelist alone, so this gate does not depend on the levers. (The prompt-era floor of ≥65% is met even by the naive top-15 projection; 70% is the tightest target the data supports with margin.)
> 3. **Re-measure when client samples land in `corpus/private/`** (currently empty): re-run the spike, re-rank the buckets, and re-confirm both gates at M3 before the manifest-parity tests freeze the whitelist. Rule swaps under the cap rule only (add one ⇒ remove one).

Note the recommendation differs from the provisional framing in two data-driven ways: the official-samples subset is *not* currently service-heavy in the measured sense (0.34 raw), so the 80% subset gate is only meaningful *after* the lever fixes; and corpus-wide 70% (not 65%) is supportable because per-rule accounting beats the per-bucket projection.

## Appendix A — bucket-to-rule/lever mapping (computation record)

Method: each `unmatchedPatterns` signature was assigned to exactly one of {lever, rule, rejected, residual}; sums below are exact bucket-count sums from `corpus-report.json` (corpus) and the subset re-run (subset). No bucket is counted twice; the only partial-bucket attribution is L3 (2 of `decl=expr`'s 10 statements, verified by source inspection).

| Assignment | Corpus | Subset | Buckets (count in parens where > 1) |
| --- | ---: | ---: | --- |
| L1 family-id | 30 | 30 | `decl=var.UsePresentationDocument(...)`, `call:var.AddNewSlide(str)` (3), `call:var.AddNewSlide(expr,expr,str)` (2), `AddDataTableToSlide`, `AddFileToSlide`, `AddImageOrVideoToSlide`, `AddTextToSlide`, `DeleteSlide`, `FormatSlideContent`, `ReplaceTextInPresentation`, `RunMacro`, `SaveAsPdf`, `SavePresentationAsPDF`, `decl=var.UseJavaScope(...)`, `LoadJar`, `CreateObject` (2 buckets), `InvokeMethod(str,var)` (2), `InvokeStaticMethod`, `ConvertObject` (3), `decl=var.UsePythonScope(...)`, `LoadCode`, `InvokeMethod(var,str,...)`, `GetObject` |
| L2 handle indexer | 5 | 5 | `decl=index:handle:testing` (5) |
| L3 as-unwrap | 2 | 2 | 2 of `decl=expr` (UseWorkbook_Create_5.cs:80,89) |
| assign-from-call | 51 | 16 | `decl=TestHelpers.*` (14 buckets, 27), `decl=GetPurchaseOrder`, `Base32Decode`, `BuildClient`, `ParseHeaderMode`, `RunPythonScript`, `assign= ReadHeaderBytes`, `Int32.Parse`, `long.Parse`, `Math.Min`, `Array.IndexOf`, `BitConverter.GetBytes`, `GetValueOrDefault`, `var.Next(num,num)` (2), `ComputeHash`, `NewRow`, `ReadByte`, `Read(var,num,var)`, `Build`, `CreateScope`, `GetSheets`, `ExecuteFile`, `WebApplication.CreateBuilder`, `PythonEngineBuilder.Build` |
| string-op | 20 | 13 | `assign+= binop:+(var.ToString(),str)` (4), `*.Trim()` (3), `expr.Trim.ToLowerInvariant`, `IndexOf` (2 buckets), `var.ToString(expr)`, `binop:+(str,Guid...)`, `decl=interp` (2), `var.Append(expr)` (2), `var.Append(str)` (2), `var.AppendLine()` (2) |
| linq-single-chain | 5 | 2 | `FirstOrDefault(lambda)`, `Sum(lambda)`, `return var.ToArray()` (2), `assign= var.ListDatabaseNames.ToList()` — `OrderBy.Select.ToList` (3 ops) deliberately excluded → residual |
| file-op | 6 | 4 | `File.Delete(var)` (3), `File.WriteAllText`, `Directory.CreateDirectory`, `Path.Combine` |
| datetime-arith | 6 | 1 | `prop:DateTime.Now` (2), `prop:DateTime.Now.Date`, `prop:expr.Days`, `prop:expr.TotalMilliseconds`, `DateTimeOffset.UtcNow.ToUnixTimeSeconds` |
| console-write | 68 | 68 | `Console.WriteLine(interp)` (31), `(str)` (23), `(var)` (14) |
| assign-literal | 37 | 24 | `decl=str` (14), `decl=num` (5), `decl=prop:string.Empty` (4), `assign= str` (7), `assign= num` (5), `assign= bool`, `assign= null` |
| collection-add | 37 | 22 | `var.Columns.Add(*)` (3 buckets, 15), `var.Rows.Add(*)` (3 buckets, 3), `var.Add(*)` (4 buckets, 9), `var.InfoMessages.Add(*)` (5), `var.Errors.Add` (2), `var.Warnings.Add`, `var.Values.Add`, `var.Filters.Add` |
| assign-new-object | 25 | 15 | 19 `decl=new:*` buckets (23) + `assign= new:List<LineItem>()` + `assign= new:List<long>(num)` |
| Rejected: helper-call family | 78 | 10 | `AddCriticalError`/`AddWarning`/`AddInfo` (8 buckets, 55), `Validate*` (11 buckets, 11), `PrintSheets` (4), `PrintDataTable` (3), `LogValidationResults`, `SaveTestData`, `FindChunkStartOffsets`, `Delay(expr)`, `Close()` |
| Rejected: return family | 29 | 7 | `return expr` (8), `return var` (7), `return` (5), `return bool` (2), + 7 singletons |
| Rejected: console near-miss | 4 | 4 | `Console.WriteLine(expr)` (4) |
| Rejected: throw family | 6 | 4 | `throw` (3), `throw new:ArgumentException(str)` (3) |
| Residual tier-3 | 76 | 29 | `decl=expr` (8 after L3), `break` (4), `assign= var` (3), `decl=ternary` (3), `OrderBy.Select.ToList`, bit/arith binops, `Parallel.ForEach`, `Task.Run`, `MapGet`, IronPython interop, etc. |
| **Total** | **485** | **256** | = measured tier-3 ✓ |

## Addendum — M3 / Gate G3: measured tier ratios with the shipped 9-rule whitelist

**Date:** 2026-06-13. **Method:** `scripts/corpusSpike.ts` now runs the production `applyTier2` engine (the same one `buildModel` uses) on every leaf that misses tier-1, before bucketing the remainder as tier-3 — so the spike measures the *real shipped classifier*, not a projection. Re-run over the full corpus and over the official-samples subset:

```
npx tsx scripts/corpusSpike.ts --corpus ./corpus --out corpus-report.json --md corpus-report.md
npx tsx scripts/corpusSpike.ts --corpus ./corpus/codedautomations-samples --out subset-report.json --md subset-report.md
```

### Result — both Goal-3 targets met

| Scope | Leaf stmts | Tier-1 | Tier-2 | Tier-3 | Coverage (T1+T2) | Goal-3 target | Verdict |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | :--: |
| Full corpus | 840 | 392 | 222 | 226 | **0.73** | ≥ 0.70 | ✅ pass |
| Official-samples subset | 390 | 171 | 147 | 72 | **0.82** | ≥ 0.80 | ✅ pass |

Counts are internally consistent (392 + 222 + 226 = 840; 171 + 147 + 72 = 390). Tier-1 392 / subset 171 match this report's post-lever projections (§4) exactly.

### Tier-2 leaves by rule (measured vs the Appendix-A bucket-signature projection)

| Rule | Corpus measured | Corpus proj. | Subset measured | Subset proj. |
| --- | ---: | ---: | ---: | ---: |
| `console-write` | 66 | 68 | 66 | 68 |
| `assign-from-call` | 57 | 51 | 17 | 16 |
| `collection-add` | 37 | 37 | 22 | 22 |
| `assign-literal` | 27 | 37 | 21 | 24 |
| `assign-new-object` | 25 | 25 | 16 | 15 |
| `string-op` | 4 | 20 | 2 | 13 |
| `file-op` | 3 | 6 | 3 | 4 |
| `datetime-arith` | 2 | 6 | 0 | 1 |
| `linq-single-chain` | 1 | 5 | 0 | 2 |
| **Total tier-2** | **222** | **255** | **147** | **165** |

### Why measured (222) runs below the bucket-signature projection (255)

Appendix A counted `normalizeStatement` *signatures* that looked rule-shaped; the shipped matchers are stricter because they enforce the honesty fences the lossy signature could not see:

- **`string-op`** is the largest gap (20→4 corpus): the projected buckets include `x += a.ToString() + b` (a method-call concat leaf), `"x" + Guid.NewGuid()`, `s.ToString(fmt)` with a non-literal format, and `s.Trim().ToLower()` fluent chains — all correctly **rejected** (a concat/format that hides a call, or a ≥2-op chain, stays tier-3).
- **`assign-literal`** (37→27): `String.Empty` (capital-S identifier) stays tier-3 by design — only the lowercase keyword `string.Empty` is decidable as the constant without type info.
- **`datetime-arith` / `linq-single-chain` / `file-op`** trail their small projections for the same reason (chained `Add` calls and property-read date arithmetic, >3-link or predicate-overload LINQ, non-literal `File.Copy` flags — all deliberately tier-3).

Crucially this is **under-matching, the safe direction**: a rejected borderline statement becomes a grey tier-3 chip (honest), never a card that hides a semantic. And the generic **`assign-from-call` floor rule cushions the shortfall** — it measured *above* its projection (51→57 corpus) precisely because `x = <call>` statements the stricter specialized rules reject still land an honest `Assign | x = call()` card instead of dropping to tier-3.

### Whitelist discipline held — the ratio was not gamed

The largest remaining tier-3 buckets are exactly the candidates the manifest *deliberately rejected*: `AddCriticalError`/`AddWarning`/`AddInfo` project-local helpers (AIDemo-only, 55 corpus stmts), the `return`/`throw` control-flow families (35), and `decl=expr`/bit-arith residual. The measured "+ top-K remaining buckets" headroom (corpus → 0.80 at K=5) is entirely those rejected project-local helpers; whitelisting them would optimise the ratio against demo skew, not user comprehension — so they stay out and the cap holds at **9 of 15 slots**.

### Gate G3 — passed

Cap / manifest / evidence guard tests green (full suite **487 passed**); measured coverage **0.73 corpus / 0.82 subset**, both above the Goal-3 floor. Per the plan, **launch is gated on the Goal-1 legibility sessions (M4), not on this ratio** — the ratio is reported here, it is not itself a launch gate.
