// Second of two classes declaring a public method `Shared` — makes
// workflows.Shared(...) from Main ambiguous (dashed edge to BOTH).
using UiPath.CodedWorkflows;

namespace SampleProject
{
    public class Ambig2 : CodedWorkflow
    {
        [Workflow]
        public void Execute()
        {
            Log("Ambig2 running");
        }

        public void Shared(double value)
        {
            Log($"Ambig2.Shared({value})");
        }
    }
}
