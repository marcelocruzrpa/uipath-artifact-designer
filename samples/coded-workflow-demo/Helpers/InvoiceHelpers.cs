// Plain static helper — no CodedWorkflow base, no [Workflow] attribute.
// Opening this in the canvas shows the "Not a coded workflow" fallback screen.
using System;
using System.IO;
using System.Linq;

namespace InvoiceDemo.Helpers
{
    public static class InvoiceHelpers
    {
        /// <summary>Returns the base file name without extension, title-cased.</summary>
        public static string NormalizeInvoiceName(string filePath)
        {
            var name = Path.GetFileNameWithoutExtension(filePath);
            if (string.IsNullOrWhiteSpace(name))
                return string.Empty;

            return string.Concat(
                name.Split('_', '-', ' ')
                    .Select(w => w.Length == 0
                        ? w
                        : char.ToUpperInvariant(w[0]) + w.Substring(1).ToLowerInvariant())
            );
        }

        /// <summary>Extracts a numeric invoice ID from a file name like "INV-00042.xlsx".</summary>
        public static int? ParseInvoiceId(string filePath)
        {
            var stem = Path.GetFileNameWithoutExtension(filePath);
            var digits = new string(stem.Where(char.IsDigit).ToArray());
            return digits.Length > 0 ? (int?)int.Parse(digits) : null;
        }

        /// <summary>Returns true when the file extension is an Excel workbook.</summary>
        public static bool IsExcelFile(string filePath)
        {
            var ext = Path.GetExtension(filePath).ToLowerInvariant();
            return ext == ".xlsx" || ext == ".xls" || ext == ".xlsm";
        }
    }
}
