// W3 — Reconcile-payments workflow: nested error handling + sub-invocations.
//
// The end-of-day reconciliation step. It tries to reconcile each settled
// payment against the ledger, retrying transient failures, archiving each
// processed invoice through a legacy XAML workflow, and posting the day's
// totals to the ledger sub-workflow. A bank-reconciliation sub-process is
// invoked even though it has not been migrated yet (its target is unresolved),
// and a dynamically chosen month-end workflow is launched at the close.
using System;
using System.Collections.Generic;
using UiPath.CodedWorkflows;

namespace InvoiceProcessing.Workflows
{
    public class ReconcilePayments : CodedWorkflow
    {
        [Workflow]
        public void Execute(List<Payment> payments, string monthEndWorkflow)
        {
            Log("Starting end-of-day payment reconciliation");

            var total = 0m;
            var rates = system.GetAsset("FxRates");

            try
            {
                foreach (var payment in payments)
                {
                    if (payment.IsSettled)
                    {
                        Log("Reconciling settled payment");

                        // Tier-3 chip #1: compound-assign with element access on both
                        // sides — no tier-2 rule matches a `+=` of an indexed product.
                        total += payment.Amounts[payment.Index] * payment.Rates[payment.Index];

                        RunWorkflow("Legacy/ArchiveInvoice.xaml", payment);
                    }
                }

                var summary = workflows.PostToLedger(total);
                workflows.ReconcileBank(total);
            }
            catch (TimeoutException ex)
            {
                Log("Transient timeout — scheduling a retry");
                var backoff = RetryPolicy.NextDelay(3);
                system.AddQueueItem("ReconciliationRetries", ex);
            }
            catch (Exception ex)
            {
                Log("Reconciliation failed");

                // Tier-3 chip #2: element-access initializer — reading the first
                // failed payment by index is plain C#, not a recognized activity.
                var firstFailure = payments[0];

                system.SetAsset("LastReconciliationError", firstFailure);
            }
            finally
            {
                RunWorkflow(monthEndWorkflow);
                Log("Reconciliation run finished");
            }
        }
    }
}
