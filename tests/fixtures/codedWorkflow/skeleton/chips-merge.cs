// Fixture: adjacent tier-3 chip merging — comment/blank-line interleave kept
// verbatim in the re-sliced code, runs broken by cards and containers, and a
// 50-statement method exercising the 40-line chip code cap. Leaves are bare
// void method calls (no tier-1 service call, no assignment) so they stay raw
// chips across all classifier stages and merge into runs.
using System;
using UiPath.CodedWorkflows;

namespace Acme.Chips
{
    public class ChipsFlow : CodedWorkflow
    {
        [Workflow]
        public void Execute(int total)
        {
            StepA(total);
            StepB(); // trailing comment stays inside the merged slice

            // a standalone comment between chips is re-sliced verbatim
            StepC();
            Log("midpoint");
            StepD();
            StepE();
            if (total > 0)
            {
                StepInner();
            }
            StepF();
        }

        [Workflow]
        public void Big()
        {
            Tick();
            Tick();
            Tick();
            Tick();
            Tick();
            Tick();
            Tick();
            Tick();
            Tick();
            Tick();
            Tick();
            Tick();
            Tick();
            Tick();
            Tick();
            Tick();
            Tick();
            Tick();
            Tick();
            Tick();
            Tick();
            Tick();
            Tick();
            Tick();
            Tick();
            Tick();
            Tick();
            Tick();
            Tick();
            Tick();
            Tick();
            Tick();
            Tick();
            Tick();
            Tick();
            Tick();
            Tick();
            Tick();
            Tick();
            Tick();
            Tick();
            Tick();
            Tick();
            Tick();
            Tick();
            Tick();
            Tick();
            Tick();
            Tick();
            Tick();
        }
    }
}
