// Fixture: deliberately broken source (R8 error tolerance) — a clean run of
// statements, an unparseable region, and recoverable statements after it.
using System;
using UiPath.CodedWorkflows;

namespace Acme.Broken
{
    public class BrokenFlow : CodedWorkflow
    {
        [Workflow]
        public void Execute()
        {
            Log("before the damage");
            var asset = system.GetAsset("Key");
            count = = 1;
            count = count + 1;
        }

        [Workflow]
        public void Healthy()
        {
            Log("untouched by the damage");
        }
    }
}
