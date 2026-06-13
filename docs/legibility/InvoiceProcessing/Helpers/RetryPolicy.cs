// Plain helper class — no CodedWorkflow base, no [Workflow] attribute.
// `RetryPolicy.NextDelay(3)` from ReconcilePayments produces a helper-class
// node in the call graph (it is a TARGET, never an edge source).
using System;

namespace InvoiceProcessing.Helpers
{
    public static class RetryPolicy
    {
        public static TimeSpan NextDelay(int attempt)
        {
            return TimeSpan.FromSeconds(Math.Pow(2, attempt));
        }
    }
}
