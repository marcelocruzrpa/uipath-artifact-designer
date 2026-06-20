// Fixture: every CwContainerKind plus >=4-level nesting, for containers.test.ts.
// Leaf statements are bare void method calls (no Log/system/etc. tier-1 service
// calls, and no assignments) so they stay raw chips across ALL classifier
// stages — tier-1 (no service handle), tier-2 (not an assign/console/collection
// pattern, including the generic assign rule), and tier-3. No two chips are
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
            Begin();
            if (name.Length > 0)
            {
                Touch();
                foreach (var c in name)
                {
                    while (mode > 0)
                    {
                        if (c == 'x')
                        {
                            DoDeep();
                        }
                        AfterInner();
                    }
                }
            }
            else if (mode == 1)
            {
                Handle1();
            }
            else if (mode == 2)
            {
                Handle2();
            }
            else
            {
                Handle3();
            }
            for (var i = 0; i < mode; i++)
            {
                Iterate();
            }
            do
            {
                Loop();
            } while (mode < 0);
            try
            {
                Process();
            }
            catch (IOException ex)
            {
                Fail1();
            }
            catch
            {
                Fail2();
            }
            finally
            {
                Cleanup();
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
                Use();
            }
            if (mode > 9) Spike();
            if (name.Contains("alpha") && name.Contains("bravo") && name.Contains("charlie") && name.Contains("delta"))
            {
                Final();
            }
            int Local(int v)
            {
                return v + 1;
            }
        }

        private void Process()
        {
            Record();
        }

        private object OpenFile(string name)
        {
            return null;
        }
    }
}
