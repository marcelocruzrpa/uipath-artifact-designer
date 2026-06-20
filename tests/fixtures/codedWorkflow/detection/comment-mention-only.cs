// Fixture where CodedWorkflow appears ONLY in comments and using directives
// (no colon before the marker anywhere) — must not detect as workflow source.
using System;
using UiPath.CodedWorkflows;

namespace Acme.Detection
{
    // This helper is shared by every CodedWorkflow in the project.
    public class SharedConfig
    {
        public string Environment = "production";
    }
}
