// First of two classes declaring a public method `Shared` — makes
// workflows.Shared(...) from Main ambiguous (dashed edge to BOTH).
using UiPath.CodedWorkflows;

namespace SampleProject
{
    public class Ambig1 : CodedWorkflow
    {
        [Workflow]
        public void Execute()
        {
            Log("Ambig1 running");
        }

        public void Shared(double value)
        {
            Log($"Ambig1.Shared({value})");
        }
    }
}
