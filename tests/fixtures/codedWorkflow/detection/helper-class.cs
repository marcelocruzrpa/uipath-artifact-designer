// Fixture: plain helper file — no base list marker, no entry-point attribute.
using System;

namespace Acme.Detection
{
    public static class StringHelpers
    {
        public static string Shorten(string text)
        {
            return text.Substring(0, 3);
        }
    }
}
