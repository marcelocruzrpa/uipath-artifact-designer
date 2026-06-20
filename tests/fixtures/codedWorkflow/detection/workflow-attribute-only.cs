// Fixture: partial workflow class — the CodedWorkflow base list lives in
// another file; only the [Workflow] attribute marks this one.
using System;

namespace Acme.Detection
{
    public partial class PartialFlow
    {
        [Workflow]
        public void Execute()
        {
            Log("from the partial side");
        }
    }
}
