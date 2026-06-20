// W2 — Validate-and-route workflow: branch + loop + Integration Service.
//
// Pulls the pending invoices from the queue and walks each one. High-value
// invoices (over the approval threshold) are routed to a manager via a Slack
// Integration Service message; everything else is auto-approved. Each decision
// is logged so the run is auditable.
using System;
using System.Collections.Generic;
using UiPath.CodedWorkflows;

namespace InvoiceProcessing.Workflows
{
    public class ValidateAndRoute : CodedWorkflow
    {
        [Workflow]
        public void Execute(List<Invoice> invoices, double approvalThreshold)
        {
            Log("Validating and routing the pending invoice batch");

            var approvedCount = 0;

            foreach (var invoice in invoices)
            {
                var vendorName = invoice.Vendor.Trim();

                if (invoice.Amount > approvalThreshold)
                {
                    Log("High-value invoice routed for manager approval");
                    var ticket = connections.Slack.SendMessage("finance-approvals", vendorName);
                    system.AddQueueItem("ManagerApprovals", invoice);
                }
                else
                {
                    Log("Invoice auto-approved under threshold");
                    connections.QuickBooks.CreateBill("AccountsPayable", invoice);
                }
            }

            Log("Routing complete");
        }
    }
}
