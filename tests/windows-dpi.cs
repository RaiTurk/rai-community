using System;
using System.Drawing;
using System.Runtime.InteropServices;

public static class WindowDpiProbe
{
    public static void Main(string[] args)
    {
        var window = FindWindow(Int32.Parse(args[0]));
        if (!AreDpiAwarenessContextsEqual(GetWindowDpiAwarenessContext(window), new IntPtr(-4)))
            throw new InvalidOperationException("The desktop window is not Per-Monitor V2 DPI aware.");
        var dpi = GetDpiForWindow(window);
        VerifyWindowIcon(window, args[1], (int)Math.Round(32 * dpi / 96.0));
        Console.WriteLine(dpi);
    }

    private delegate bool WindowCallback(IntPtr window, IntPtr data);
    [DllImport("user32.dll")] private static extern bool EnumWindows(WindowCallback callback, IntPtr data);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out int processId);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] private static extern IntPtr GetWindowDpiAwarenessContext(IntPtr window);
    [DllImport("user32.dll")] private static extern bool AreDpiAwarenessContextsEqual(IntPtr first, IntPtr second);
    [DllImport("user32.dll")] private static extern uint GetDpiForWindow(IntPtr window);
    [DllImport("user32.dll")] private static extern IntPtr SendMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);

    private static IntPtr FindWindow(int targetProcess)
    {
        IntPtr result = IntPtr.Zero;
        EnumWindows((window, data) => {
            int owner;
            GetWindowThreadProcessId(window, out owner);
            if (owner != targetProcess || !IsWindowVisible(window)) return true;
            result = window;
            return false;
        }, IntPtr.Zero);
        if (result == IntPtr.Zero) throw new InvalidOperationException("The desktop window was not found.");
        return result;
    }

    private static void VerifyWindowIcon(IntPtr window, string iconPath, int size)
    {
        const uint getIcon = 0x007F; // WM_GETICON
        var handle = SendMessage(window, getIcon, new IntPtr(1), IntPtr.Zero); // ICON_BIG
        if (handle == IntPtr.Zero) throw new InvalidOperationException("The desktop window has no assigned icon.");
        using (var actual = Icon.FromHandle(handle))
        using (var expected = new Icon(iconPath, actual.Width, actual.Height))
        using (var expectedNative = Icon.FromHandle(expected.Handle))
        using (var actualBitmap = actual.ToBitmap())
        using (var expectedBitmap = expectedNative.ToBitmap())
        {
            if (actual.Width != size || actual.Height != size)
                throw new InvalidOperationException(String.Format("The live window uses a {0} x {1} icon, expected {2} x {2}.", actual.Width, actual.Height, size));
            int matches = 0;
            int opaque = 0;
            for (int y = 0; y < expectedBitmap.Height; y++)
                for (int x = 0; x < expectedBitmap.Width; x++)
                {
                    var pixel = expectedBitmap.GetPixel(x, y);
                    if (pixel.A != 255) continue;
                    opaque++;
                    if (pixel.ToArgb() == actualBitmap.GetPixel(x, y).ToArgb()) matches++;
                }
            if (opaque == 0 || matches != opaque)
                throw new InvalidOperationException(String.Format("The live window icon differs from the installed artwork ({0} of {1} opaque pixels match at {2} x {3}).", matches, opaque, actual.Width, actual.Height));
        }
    }
}
