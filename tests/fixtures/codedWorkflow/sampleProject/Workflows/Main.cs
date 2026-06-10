// Call-graph fixture entry point. Exercises every edge shape the assembler
// must handle: a unique workflows.* match, a literal and a dynamic
// RunWorkflow, a static helper instantiation, a no-match workflows.* call,
// and an ambiguous workflows.* call (Shared lives in Ambig1 AND Ambig2).
using System;
using UiPath.CodedWorkflows;

namespace SampleProject
{
    public class Main : CodedWorkflow
    {
        [Workflow]
        public void Execute(string folder)
        {
            var ok = workflows.SubFlow(folder);

            RunWorkflow("Legacy/Old.xaml", new { Folder = folder });

            var dynamicVar = folder + "/Other.xaml";
            RunWorkflow(dynamicVar);

            var total = new MathHelper().Calc(2, 3);

            workflows.Missing(folder);

            workflows.Shared(total);
        }
    }
}
