// Fixture: every CwContainerKind plus >=4-level nesting, for containers.test.ts.
// Leaf statements deliberately avoid tier-1 service calls (no Log/system/etc.)
// so they stay raw chips across all classifier stages, and no two chips are
// adjacent in any slot so chip merging never changes this fixture's shape.
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
            var seed = 0;
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
                seed = 10;
            }
            else if (mode == 2)
            {
                seed = 20;
            }
            else
            {
                seed = 30;
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
                failures = 0;
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
            if (mode > 9) seed = 99;
            if (name.Contains("alpha") && name.Contains("bravo") && name.Contains("charlie") && name.Contains("delta"))
            {
                seed = 2;
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
