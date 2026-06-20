// Fixture: ordinary coded workflow — base list names CodedWorkflow.
using System;
using UiPath.CodedWorkflows;

namespace Acme.Detection
{
    public class BasicFlow : CodedWorkflow
    {
        [Workflow]
        public void Execute()
        {
            Log("hello");
        }
    }
}
