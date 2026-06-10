// Fixture: excel service handles — a using-resource card with objectProps
// args, handle method calls (element access walked through), the L3
// `as`-expression unwrap, and a handle re-bound from a fresh service call.
using System;
using UiPath.CodedWorkflows;

namespace Acme.Excel
{
    public class ExcelFlow : CodedWorkflow
    {
        [Workflow]
        public void Execute(string sheet)
        {
            using (var wb = excel.UseExcelFile("invoices.xlsx", new ExcelFileOptions() { SaveChanges = true, ReadOnly = false }))
            {
                var range = wb.Sheet["Data"].ReadRange();
                var cellValue = wb.ReadCell(sheet, "B7", true) as string;
                wb.Save();
            }
            var report = excel.UseExcelFile("report.xlsx");
            report.AppendRange(range);
        }
    }
}
