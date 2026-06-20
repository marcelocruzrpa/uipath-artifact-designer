// Plain helper class — no CodedWorkflow base, no [Workflow] attribute.
// `new MathHelper().Calc(...)` from Main produces a helper-class node.
using System;

namespace SampleProject.Helpers
{
    public class MathHelper
    {
        public double Calc(double a, double b)
        {
            return a + b;
        }
    }
}
