// Fixture: a straight-line workflow of tier-1 service calls — every leaf in
// Execute classifies as a CwActivityCard (bare base calls, cataloged system
// calls, a wildcard workflows call, and a return-statement call).
using System;
using UiPath.CodedWorkflows;

namespace Acme.Sequence
{
    public class SequenceFlow : CodedWorkflow
    {
        [Workflow]
        public string Execute()
        {
            Log("starting run");
            var endpoint = system.GetAsset("ApiEndpoint");
            var creds = system.GetCredential("ServiceUser");
            system.AddQueueItem("Invoices", endpoint);
            workflows.ProcessInvoice(endpoint, 3);
            RunWorkflow(@"Shared\Notify.xaml", input);
            Log($"done with {endpoint}");
            return system.GetAsset("ReportName");
        }
    }
}
