// Fixture: M0 levers — the lowercase powerpoint receiver (L1), java/python
// scope families (L1), the tracked-handle indexer read (L2), and an unknown
// member of a known family rendering as a generic humanized card.
using System;
using UiPath.CodedWorkflows;

namespace Acme.Generic
{
    public class GenericFlow : CodedWorkflow
    {
        [Workflow]
        public void Execute()
        {
            using (var pow = powerpoint.UsePowerPointPresentation("deck.pptx"))
            {
                pow.AddNewSlide(1);
            }
            var js = java.UseJavaScope(new JavaScopeOptions() { JavaPath = @"C:\jdk" });
            var py = python.UsePythonScope(new PythonScopeOptions() { Path = @"C:\py" });
            var address = testing.GetTestDataRow("Addresses");
            string country = address["Country"];
            var compact = string.Join(",", parts);
        }
    }
}
