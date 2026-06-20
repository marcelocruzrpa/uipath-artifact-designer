// Secondary coded workflow — invoked by ProcessInvoices.
// Gives the future M2 call-graph an edge target.
using System;
using UiPath.CodedWorkflows;

namespace InvoiceDemo
{
    public class ValidateInvoice : CodedWorkflow
    {
        [Workflow]
        public bool Execute(string invoiceId, double amount)
        {
            Log($"Validating invoice {invoiceId} — amount {amount:C}");

            var threshold = system.GetAsset("ValidationThreshold");
            var limit = double.Parse(threshold);

            if (amount <= 0)
            {
                Log($"Invoice {invoiceId} rejected: non-positive amount");
                return false;
            }

            if (amount > limit)
            {
                system.AddQueueItem("ManualReview", new { InvoiceId = invoiceId, Amount = amount });
                Log($"Invoice {invoiceId} queued for manual review (amount exceeds {limit:C})");
                return false;
            }

            Log($"Invoice {invoiceId} passed validation");
            return true;
        }
    }
}
