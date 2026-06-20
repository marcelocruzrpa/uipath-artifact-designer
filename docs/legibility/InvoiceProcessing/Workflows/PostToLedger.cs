// Sub-workflow invoked by ReconcilePayments via workflows.PostToLedger(total).
// Exactly one coded-workflow class answers to the name "PostToLedger", so the
// call-graph edge from ReconcilePayments resolves to a solid invoke-workflow.
using UiPath.CodedWorkflows;

namespace InvoiceProcessing.Workflows
{
    public class PostToLedger : CodedWorkflow
    {
        [Workflow]
        public string Execute(decimal total)
        {
            Log("Posting reconciled total to the general ledger");
            var ledgerAccount = system.GetAsset("LedgerAccountId");
            system.AddQueueItem("LedgerPostings", total);
            return system.GetAsset("LastLedgerBatchId");
        }
    }
}
