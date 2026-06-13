// Fixture: adjacent tier-3 chip merging — comment/blank-line interleave kept
// verbatim in the re-sliced code, runs broken by cards and containers, and a
// 50-statement method exercising the 40-line chip code cap.
using System;
using UiPath.CodedWorkflows;

namespace Acme.Chips
{
    public class ChipsFlow : CodedWorkflow
    {
        [Workflow]
        public void Execute(int total)
        {
            var a = total + 1;
            var b = a + 2; // trailing comment stays inside the merged slice

            // a standalone comment between chips is re-sliced verbatim
            var c = a + b;
            Log("midpoint");
            var d = c * 2;
            var e = d - 1;
            if (total > 0)
            {
                total = total - 1;
            }
            var f = e + total;
        }

        [Workflow]
        public void Big()
        {
            big = big + 1;
            big = big + 2;
            big = big + 3;
            big = big + 4;
            big = big + 5;
            big = big + 6;
            big = big + 7;
            big = big + 8;
            big = big + 9;
            big = big + 10;
            big = big + 11;
            big = big + 12;
            big = big + 13;
            big = big + 14;
            big = big + 15;
            big = big + 16;
            big = big + 17;
            big = big + 18;
            big = big + 19;
            big = big + 20;
            big = big + 21;
            big = big + 22;
            big = big + 23;
            big = big + 24;
            big = big + 25;
            big = big + 26;
            big = big + 27;
            big = big + 28;
            big = big + 29;
            big = big + 30;
            big = big + 31;
            big = big + 32;
            big = big + 33;
            big = big + 34;
            big = big + 35;
            big = big + 36;
            big = big + 37;
            big = big + 38;
            big = big + 39;
            big = big + 40;
            big = big + 41;
            big = big + 42;
            big = big + 43;
            big = big + 44;
            big = big + 45;
            big = big + 46;
            big = big + 47;
            big = big + 48;
            big = big + 49;
            big = big + 50;
        }
    }
}
