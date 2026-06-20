// W1 — Linear invoice-intake workflow.
//
// A straight-line "read the daily invoice batch and queue it" process: it logs
// start, pulls configuration assets and a service credential, opens the Excel
// batch workbook, reads three ranges from it, enqueues the batch for the
// performer robot, and returns the run id. Every leaf is a first-class UiPath
// activity card; the only non-card step is one friendly assign.
using System;
using UiPath.CodedWorkflows;

namespace InvoiceProcessing.Workflows
{
    public class IngestInvoices : CodedWorkflow
    {
        [Workflow]
        public string Execute()
        {
            Log("Starting daily invoice ingestion run");

            var sharePointUrl = system.GetAsset("InvoiceLibraryUrl");
            var batchFolder = system.GetAsset("DailyBatchFolder");
            var financeApiCredential = system.GetCredential("FinanceApiUser");

            var runLabel = "INV-" + batchFolder;

            using (var workbook = excel.UseExcelFile("invoices.xlsx", new ExcelFileOptions() { ReadOnly = true }))
            {
                var header = workbook.ReadRange("Summary");
                var invoiceRows = workbook.ReadRange("Invoices");
                var controlTotals = workbook.ReadRange("Controls");
            }

            system.AddQueueItem("InvoicesToValidate", batchFolder);

            Log("Invoice batch queued for validation");

            return system.GetAsset("CurrentRunId");
        }
    }
}
