// Fixture: every CwContainerKind plus >=4-level nesting, for containers.test.ts.
// Leaf statements deliberately avoid tier-1 service calls (no Log/system/etc.)
// AND single-literal assigns (no `seed = 0;`) so they stay raw chips across all
// classifier stages — including tier-2 (assign-literal would card a lone
// literal). No two chips are adjacent in any slot so chip merging never changes
// this fixture's shape.
using System;
using System.IO;
using UiPath.CodedWorkflows;

namespace Acme.Containers
{
    public class ContainerFlow : CodedWorkflow
    {
        [Workflow]
        public void Execute(int mode, string name)
        {
            var seed = mode;
            if (name.Length > 0)
            {
                seed = seed + 1;
                foreach (var c in name)
                {
                    while (mode > 0)
                    {
                        if (c == 'x')
                        {
                            deep = deep + 1;
                        }
                        mode = mode - 1;
                    }
                }
            }
            else if (mode == 1)
            {
                seed = mode + 10;
            }
            else if (mode == 2)
            {
                seed = mode + 20;
            }
            else
            {
                seed = mode + 30;
            }
            for (var i = 0; i < mode; i++)
            {
                seed = seed + i;
            }
            do
            {
                mode = mode + 1;
            } while (mode < 0);
            try
            {
                Process();
            }
            catch (IOException ex)
            {
                failures = failures + 1;
            }
            catch
            {
                failures = failures + 2;
            }
            finally
            {
                failures = mode;
            }
            switch (mode)
            {
                case 1:
                    return;
                case 2:
                case 3:
                    throw new Exception("boom");
                default:
                    return;
            }
            using (var file = OpenFile(name))
            {
                touched = touched + 1;
            }
            if (mode > 9) seed = mode + 99;
            if (name.Contains("alpha") && name.Contains("bravo") && name.Contains("charlie") && name.Contains("delta"))
            {
                seed = mode + 2;
            }
            int Local(int v)
            {
                return v + 1;
            }
        }

        private void Process()
        {
            count = count + 1;
        }

        private object OpenFile(string name)
        {
            return null;
        }
    }
}
