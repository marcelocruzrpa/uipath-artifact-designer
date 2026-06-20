// Unique workflows.SubFlow(...) target — exactly one coded-workflow class
// answers to the name "SubFlow", so the edge from Main is solid.
using UiPath.CodedWorkflows;

namespace SampleProject
{
    public class SubFlow : CodedWorkflow
    {
        [Workflow]
        public bool Execute(string folder)
        {
            Log($"SubFlow processing {folder}");
            return true;
        }
    }
}
