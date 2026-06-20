# Goal-1 Legibility Session Protocol & Answer Key

Think-aloud legibility test for the **UiPath Coded Workflow Canvas** — the
visual rendering of C# coded automations. The question this session answers:

> Can a low-code developer who has **never seen the C#** read a coded workflow
> from the canvas alone — its purpose, its control flow, its data and the
> sub-processes it calls — *without ever needing the source code*?

Everything below the line "ANSWER KEY" was transcribed from the **actual
rendered canvas** produced by the shipped classifier (verified with
`scripts/dumpModel.ts` against the real `buildModel` / call-graph layer). Card
titles, container headers and graph edges are quoted exactly as they render.
Do **not** paraphrase from the C#; the canvas is the source of truth.

The three fixtures live in `docs/legibility/InvoiceProcessing/` — a realistic
accounts-payable automation:

| ID | File | Shape |
| -- | ---- | ----- |
| **W1** | `Workflows/IngestInvoices.cs` | Linear, tier-1-heavy intake |
| **W2** | `Workflows/ValidateAndRoute.cs` | Branch + loop + Integration Service |
| **W3** | `Workflows/ReconcilePayments.cs` | Nested error handling + sub-invocations + call graph |

---

## Facilitator instructions

**Setup (before the participant joins)**
1. Open the folder `docs/legibility/InvoiceProcessing/` in VS Code with the
   extension installed. Confirm `project.json` lists the three entry points.
2. **Screen share the canvas only.** The participant must never see the C#
   text. Do not open the file as text, do not show the editor source, do not
   reveal the `.cs` in a diff. If you must reset, close and reopen on the
   canvas.
3. Open each workflow on the canvas via **Open With → "UiPath Coded Workflow
   Canvas"** (right-click the `.cs` → *Open With…* → pick the canvas). The
   canvas editor ships at **priority "option"**, so it is reached through
   *Open With…* or the **"UiPath: Open Designer"** command — it is not the
   default double-click editor. Say this out loud so the participant knows the
   canvas is a deliberate view, not the raw file.
4. For **W3**, after the think-aloud on the workflow view, toggle the
   **Workflow | Call-graph** control (or run **"UiPath: Show Call Graph"**) to
   show the project call graph, then ask W3-Q3.

**Running each workflow**
- **5-minute cap per workflow.** If the clock runs out, stop and score what you
  heard.
- Let the participant **think aloud** freely first ("walk me through what this
  automation does"), then ask the **3 scripted questions** in order.
- **Never volunteer the answer** and never show the C#. If the participant asks
  "what's the actual code here?", that is a **fail signal for that question** —
  note it. The whole point is that the canvas is sufficient.
- A grey **chip** on the canvas is *untranslated code* shown verbatim. If a
  participant reads a chip as a *missing step* or *a bug* rather than "a bit of
  raw code the canvas didn't simplify", note it — that is a scoring distinction
  (see scoring).

**The 3 scripted questions (same shape for W1 & W2; W3-Q3 differs)**
- **Q1 — Purpose:** "In one or two sentences, what does this automation do?"
- **Q2 — Control flow:** "What is the order of steps? Where does it branch, loop
  or handle errors?"
- **Q3 — Data & targets** *(W1, W2)*: "What data does it read or write, and what
  external systems does it touch?"
- **Q3 — Call graph** *(W3 only, on the call-graph view)*: "What other workflows
  or helpers does this invoke, and which of those targets are **unresolved**
  (dashed / not found)?"

---

## ANSWER KEY

> Quoted card titles / container headers / graph labels are the **literal**
> rendered strings. Verified tier counts are stated per workflow so the
> facilitator can sanity-check the canvas they are looking at.

### W1 — `IngestInvoices.cs`  (verified tiers: **tier1 = 11, tier2 = 1, tier3 = 0**)

A straight-line sequence of activity cards, top to bottom, with a single
**"Use Excel File"** resource container holding three reads. No branches, no
loops, no chips.

Rendered canvas (top → bottom):
```
Log — "Starting daily invoice ingestion run"
Get Asset — Name=InvoiceLibraryUrl            → sharePointUrl
Get Asset — Name=DailyBatchFolder             → batchFolder
Get Credential — Name=FinanceApiUser          → financeApiCredential
Assign — runLabel = "INV-" + batchFolder      (tier-2 "Build text")
Use Excel File — File=invoices.xlsx, Options=ReadOnly: true   → workbook
    Body:
        Read Range — Summary    → header
        Read Range — Invoices   → invoiceRows
        Read Range — Controls   → controlTotals
Add Queue Item — Queue=InvoicesToValidate
Log — "Invoice batch queued for validation"
Get Asset — Name=CurrentRunId
```

- **Q1 (Purpose).** Reads the daily invoice batch and queues it for validation.
  It logs the start, fetches configuration (the SharePoint library URL, the
  daily batch folder) and a service credential, opens the Excel batch workbook,
  reads its three ranges, drops the batch onto the **"InvoicesToValidate"**
  queue, and returns the current run id.
  - **1.0** — names "read invoices from Excel + put them on a queue" (intake).
  - **0.5** — "it reads a spreadsheet and gets some assets" but misses the
    queue / hand-off purpose.
  - **0** — cannot say what the automation is for.

- **Q2 (Control flow).** A single straight-line sequence, no branching or
  looping. The only nesting is the **"Use Excel File"** container, whose **Body**
  holds the three **"Read Range"** cards. Order is exactly top-to-bottom as
  listed.
  - **1.0** — "it's linear / one path; the three reads sit inside the Excel
    block."
  - **0.5** — reads it top-to-bottom but mis-describes the Excel container
    (e.g. thinks the reads are separate from the workbook).
  - **0** — invents control flow that is not there (a loop, a branch).

- **Q3 (Data & targets).** *Reads:* three Excel ranges — **Summary**,
  **Invoices**, **Controls** — from `invoices.xlsx` (opened read-only); plus
  Orchestrator assets **InvoiceLibraryUrl**, **DailyBatchFolder**,
  **CurrentRunId** and the credential **FinanceApiUser**. *Writes:* one queue
  item to **"InvoicesToValidate"**. External systems: Orchestrator
  (assets/credential/queue) and Excel.
  - **1.0** — names the Excel file/ranges **and** the queue **and** at least
    one asset/credential.
  - **0.5** — names Excel **or** the queue but not both.
  - **0** — cannot identify the data or targets from the cards.

### W2 — `ValidateAndRoute.cs`  (verified tiers: **tier1 = 7, tier2 = 2, tier3 = 0**)

The control-flow workflow: a **For Each** over the invoices with an **If / Else**
inside, and two **Integration Service** connector cards (one per branch).

Rendered canvas:
```
Log — "Validating and routing the pending invoice batch"
Assign — approvedCount = 0                     (tier-2 "Assign", assign-literal)
For Each invoice in invoices
    Body:
        Assign — vendorName = invoice.Vendor.Trim()   (tier-2 "Assign", assign-from-call)
        If invoice.Amount > approvalThreshold
            Then:
                Log — "High-value invoice routed for manager approval"
                Send Message — finance-approvals, vendorName   → ticket   (Integration Service)
                Add Queue Item — Queue=ManagerApprovals
            Else:
                Log — "Invoice auto-approved under threshold"
                Create Bill — AccountsPayable, invoice               (Integration Service)
Log — "Routing complete"
```

- **Q1 (Purpose).** Walks each pending invoice and routes it by value:
  high-value invoices (over the approval threshold) go to a manager for
  approval; the rest are auto-approved. Each decision is logged.
  - **1.0** — "for each invoice, branch on amount: route high-value ones for
    approval, auto-approve the rest."
  - **0.5** — "it processes invoices and sends some messages" but misses the
    threshold-based routing decision.
  - **0** — cannot state the purpose.

- **Q2 (Control flow).** A **For Each** loop over `invoices`; inside it an
  **"If invoice.Amount > approvalThreshold"** with a **Then** and an **Else**
  branch. The **Then** logs, sends the Slack message and queues a manager
  approval; the **Else** logs and creates the bill. A trailing **"Routing
  complete"** log runs after the loop.
  - **1.0** — identifies **both** the loop **and** the if/else, and which work
    sits in each branch (correctly reads the header **"If invoice.Amount >
    approvalThreshold"**).
  - **0.5** — spots the loop **or** the branch but not both, or cannot say what
    distinguishes the two branches.
  - **0** — misreads the structure (e.g. no loop, or branches swapped with no
    basis).

- **Q3 (Data & targets).** Touches two **Integration Service** connectors: a
  **"Send Message"** to the **finance-approvals** channel (Slack) in the
  high-value branch, and a **"Create Bill"** on **AccountsPayable** in the
  auto-approve branch. Also writes a **"ManagerApprovals"** queue item. The two
  tier-2 **"Assign"** steps (`approvedCount = 0`, `vendorName =
  invoice.Vendor.Trim()`) are bookkeeping, not external calls.
  - **1.0** — names **both** connector actions (Send Message / Create Bill) as
    the external integrations, ideally noting they are per-branch.
  - **0.5** — names one connector action, or calls them "external calls"
    without identifying them.
  - **0** — cannot identify the Integration Service calls.

### W3 — `ReconcilePayments.cs`  (verified tiers: **tier1 = 12, tier2 = 2, tier3 = 2**)

The error-handling + orchestration workflow. **Try / Catch** nested ≥ 3 deep
(**Try → For Each → If**), two **Catch** clauses and a **Finally**, with
literal- and dynamic-XAML invocations and sub-workflow calls.

Rendered canvas (workflow view):
```
Log — "Starting end-of-day payment reconciliation"
Assign — total = 0m                            (tier-2 "Assign", assign-literal)
Get Asset — Name=FxRates                       → rates
Try / Catch
    Try:
        For Each payment in payments
            Body:
                If payment.IsSettled
                    Then:
                        Log — "Reconciling settled payment"
                        ▓ CHIP #1 ▓  total += payment.Amounts[payment.Index] * payment.Rates[payment.Index];
                        Run Workflow — Workflow=Legacy/ArchiveInvoice.xaml
        Invoke Workflow PostToLedger — total    → summary
        Invoke Workflow ReconcileBank — total
    Catch TimeoutException ex:
        Log — "Transient timeout — scheduling a retry"
        Assign — backoff = RetryPolicy.NextDelay(3)   (tier-2 "Assign", assign-from-call)
        Add Queue Item — Queue=ReconciliationRetries
    Catch Exception ex:
        Log — "Reconciliation failed"
        ▓ CHIP #2 ▓  var firstFailure = payments[0];
        Set Asset — Name=LastReconciliationError
    Finally:
        Run Workflow — Workflow=monthEndWorkflow
        Log — "Reconciliation run finished"
```

**The two tier-3 chips (the only grey blocks in W3):**
- **Chip #1** — `total += payment.Amounts[payment.Index] * payment.Rates[payment.Index];`
  (a compound-assign that multiplies two indexed array reads). Off-whitelist: no
  tier-2 rule simplifies a `+=` of an indexed product, and a card must never
  hide an index or arithmetic side-effect — so it honestly stays raw.
- **Chip #2** — `var firstFailure = payments[0];` (an element-access read by
  index). Off-whitelist: element access on the right-hand side is plain C#, not
  a recognized activity, so it stays raw rather than masquerading as an
  "Assign" card.

A correct participant describes both chips as **"a bit of raw / untranslated
code shown as-is"**, *not* as a missing step or a defect.

Call-graph view (verified: **8 nodes, 5 edges**):
```
NODES
  (coded-workflow)  IngestInvoices      [entry]
  (coded-workflow)  PostToLedger
  (coded-workflow)  ReconcilePayments   [entry]
  (coded-workflow)  ValidateAndRoute    [entry]
  (xaml-workflow)   ArchiveInvoice.xaml
  (helper-class)    RetryPolicy
  (unresolved)      <dynamic workflow>
  (unresolved)      ReconcileBank

EDGES (all from ReconcilePayments)
  solid  call-helper      → RetryPolicy
  solid  invoke-workflow  → PostToLedger
  solid  run-xaml         → ArchiveInvoice.xaml
  dashed run-xaml         → <dynamic workflow>   (reason: dynamic-argument)
  dashed invoke-workflow  → ReconcileBank        (reason: no-match / unresolved)
```

- **Q1 (Purpose).** The end-of-day reconciliation step: for each settled
  payment it reconciles the amount against the ledger, archives each processed
  invoice through a legacy workflow, posts the day's total to the ledger, and on
  failure retries (timeout) or records the error. A month-end workflow runs at
  the close regardless.
  - **1.0** — "reconcile settled payments, archive + post to the ledger, with
    error handling."
  - **0.5** — "it reconciles payments and has try/catch" but misses the
    archive/post-to-ledger or the retry intent.
  - **0** — cannot state the purpose.

- **Q2 (Control flow).** A **Try / Catch** block. The **Try** loops **For Each
  payment in payments**, and inside the loop an **"If payment.IsSettled"** does
  the per-payment work (the nesting is Try → For Each → If, ≥ 3 deep). After the
  loop it invokes two sub-workflows. There are **two Catch** clauses — **"Catch
  TimeoutException ex"** (retry path) and **"Catch Exception ex"** (record the
  error) — and a **Finally** that always runs the month-end workflow and logs
  completion.
  - **1.0** — reads the try/catch/finally **and** the loop **and** the inner
    `if`, and notes there are two distinct catch clauses (timeout vs general).
  - **0.5** — gets the try/catch and loop but flattens the nesting or misses the
    second catch / the finally.
  - **0** — does not recognize the error-handling structure.

- **Q3 (Call graph).** From the call-graph view: ReconcilePayments invokes, with
  **solid** (resolved) edges — the **PostToLedger** sub-workflow, the
  **ArchiveInvoice.xaml** legacy workflow, and the **RetryPolicy** helper class.
  It has **two dashed (unresolved)** edges: **ReconcileBank** (no matching
  workflow file in the project — *no-match*) and **`<dynamic workflow>`** (a
  `RunWorkflow` whose target is a variable, not a literal — *dynamic-argument*).
  - **1.0** — names at least one solid target **and** correctly identifies
    **both** dashed/unresolved targets (`ReconcileBank` and the dynamic one) as
    the ones that are not resolved.
  - **0.5** — reads the graph and finds the invocations but identifies only one
    unresolved target, or cannot say *why* it is unresolved.
  - **0** — cannot read the graph / cannot tell resolved from unresolved.

---

## Scoring

Each question scores **0 / 0.5 / 1.0** per the rubric above. **9 points total**
(3 workflows × 3 questions).

A participant **PASSES** the legibility gate when **all** of:
- **Total ≥ 7 / 9**, and
- **no single workflow scores < 1.5 / 3** (legibility must not collapse on any
  one workflow), and
- **the source code was never needed** — the participant never asked to see, and
  the facilitator never showed, the `.cs` text, and
- **chips were correctly described as "untranslated code"** — W3's two grey
  chips were read as raw code shown as-is, **not** as missing steps or bugs.

If a participant asks to see the C# to answer any question, that question scores
**0** and the "source never needed" condition fails for that participant.

### Results-recording table

Run with **at least 1** participant; **target 2**.

**Participant 1 — _______________  Date: __________**

| Workflow | Q1 Purpose | Q2 Control flow | Q3 Data/Graph | WF subtotal (/3) | Notes |
| -------- | :--------: | :-------------: | :-----------: | :--------------: | ----- |
| W1 IngestInvoices |  |  |  |  |  |
| W2 ValidateAndRoute |  |  |  |  |  |
| W3 ReconcilePayments |  |  |  |  |  |
| **Total (/9)** | | | | | |

Source code needed? (Y/N): ____   Chips read as "untranslated code"? (Y/N): ____
PASS / FAIL: ____

**Participant 2 — _______________  Date: __________**

| Workflow | Q1 Purpose | Q2 Control flow | Q3 Data/Graph | WF subtotal (/3) | Notes |
| -------- | :--------: | :-------------: | :-----------: | :--------------: | ----- |
| W1 IngestInvoices |  |  |  |  |  |
| W2 ValidateAndRoute |  |  |  |  |  |
| W3 ReconcilePayments |  |  |  |  |  |
| **Total (/9)** | | | | | |

Source code needed? (Y/N): ____   Chips read as "untranslated code"? (Y/N): ____
PASS / FAIL: ____

---

## What a confusion becomes

Capture every confusion **verbatim** in the Notes column (the participant's own
words — "I thought the Excel block was a separate file", "I couldn't tell if
ReconcileBank ran or not"). Each verbatim confusion becomes a **`legibility`
issue**: a concrete, reproducible statement of what the canvas failed to convey.
The loop is **confusion → file a `legibility` issue → fix the rendering → retest
on a *fresh* participant** (never the same person, who is now primed). A fix is
only validated when a new participant reads the same spot cleanly. Confusions are
signal about the *classifier and renderer*, not about the participant.
