# Tier-2 golden fixtures

Data-driven fixtures for the tier-2 transpiler golden harness
(`tests/model/codedWorkflow/tier2Golden.test.ts`): ONE directory per shipped
rule id, discovered at test time.

```
tier2/
  <ruleId>/
    golden-01.cs       single-statement C# snippet
    golden-01.txt      pins the rendered card as `${title} | ${text}`
    golden-02.cs       (>= 2 golden pairs required per rule)
    golden-02.txt
    nearmiss-01.cs     snippet the rule must NOT match (>= 1 required)
    nearmiss-01.expect optional expected classification (see below)
```

Conventions:

- Snippets are SINGLE statements. The harness wraps each in the canonical
  scaffold `class W : CodedWorkflow { [Workflow] public void Execute() {
  <snippet> } }` and runs the REAL classification pipeline (real `buildModel`,
  real `TIER2_RULES` — no injection).
- Every `golden-NN.cs` requires a matching `golden-NN.txt` (two-digit `NN`).
  The `.txt` comparison is byte-exact after CRLF→LF normalization and
  trimming at most ONE trailing newline.
- A near-miss without an `.expect` file defaults to `tier3` (the statement
  must render as a raw chip). `.expect` may instead contain `tier1` (must be
  an activity card) or another rule id (must be that OTHER rule's
  pseudo-step). In every case the directory's own rule must not match.
- The structural guards (`tests/model/codedWorkflow/tier2Cap.test.ts`)
  require >= 2 golden pairs and >= 1 near-miss per shipped rule, and reject
  orphan directories whose id is not in `TIER2_RULES`.
- The directory set must EXACTLY equal the shipped rule-id set; this README
  is the only non-directory entry allowed at this level.
