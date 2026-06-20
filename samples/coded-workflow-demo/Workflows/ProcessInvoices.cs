// Demo coded workflow for the UiPath Artifact Designer canvas (M1 webinar demo).
// Illustrates: tier-1 cards (Log, system.*, workflows.*), a using-resource
// container (excel.UseExcelFile), foreach + try/catch containers, plain C#
// statements that render as tier-3 chips, and a RunWorkflow call.
using System;
using System.IO;
using System.Linq;
using UiPath.CodedWorkflows;

namespace InvoiceDemo
{
    public class ProcessInvoices : CodedWorkflow
    {
        [Workflow]
        public void Execute(string invoiceFolder)
        {
            Log($"Processing invoices in {invoiceFolder}");

            var apiKey = system.GetAsset("InvoiceApiKey");
            var reportPath = system.GetAsset("ReportOutputPath");

            var files = Directory.GetFiles(invoiceFolder, "*.xlsx");

            if (files.Length == 0)
            {
                Log("No invoice files found — aborting run");
                return;
            }

            var processedCount = 0;
            var failedIds = new System.Collections.Generic.List<string>();

            foreach (var filePath in files)
            {
                var invoiceId = Path.GetFileNameWithoutExtension(filePath);

                try
                {
                    double invoiceTotal;

                    using (var wb = excel.UseExcelFile(filePath, new ExcelFileOptions() { SaveChanges = false, ReadOnly = true }))
                    {
                        var range = wb.Sheet["Data"].ReadRange();
                        invoiceTotal = range
                            .Skip(1)
                            .Sum(row => double.TryParse(row["Amount"]?.ToString(), out var v) ? v : 0.0);

                        wb.Save();
                    }

                    var isValid = workflows.ValidateInvoice(invoiceId, invoiceTotal);

                    if (isValid)
                    {
                        var summary = $"{invoiceId}: {invoiceTotal:C}";
                        system.AddQueueItem("ApprovedInvoices", new { Id = invoiceId, Total = invoiceTotal });
                        processedCount++;
                        Log($"Invoice {invoiceId} approved — total {invoiceTotal:C}");
                    }
                    else
                    {
                        failedIds.Add(invoiceId);
                        Log($"Invoice {invoiceId} failed validation");
                    }
                }
                catch (IOException ex)
                {
                    Log($"IO error reading {invoiceId}: {ex.Message}");
                    failedIds.Add(invoiceId);
                }
                catch (Exception ex)
                {
                    Log($"Unexpected error for {invoiceId}: {ex.Message}");
                    failedIds.Add(invoiceId);
                }
            }

            var failureSummary = failedIds.Count > 0
                ? string.Join(", ", failedIds)
                : "none";

            Log($"Run complete — processed {processedCount}/{files.Length}, failures: {failureSummary}");

            RunWorkflow("Legacy/Archive.xaml", new { Folder = invoiceFolder, ProcessedCount = processedCount });
        }
    }
}
