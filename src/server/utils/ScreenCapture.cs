using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Windows.Forms;
using System.Runtime.InteropServices;

public class ScreenCapture {
    [DllImport("user32.dll")]
    public static extern bool SetProcessDPIAware();

    [DllImport("user32.dll")]
    public static extern int GetSystemMetrics(int nIndex);

    public static void Main(string[] args) {
        if (args.Length < 1) {
            Console.WriteLine("Usage: ScreenCapture.exe <output_path>");
            return;
        }

        try {
            SetProcessDPIAware();
            int width = GetSystemMetrics(0);  // SM_CXSCREEN
            int height = GetSystemMetrics(1); // SM_CYSCREEN

            using (Bitmap bitmap = new Bitmap(width, height, PixelFormat.Format32bppArgb)) {
                using (Graphics graphics = Graphics.FromImage(bitmap)) {
                    graphics.CopyFromScreen(0, 0, 0, 0, new Size(width, height), CopyPixelOperation.SourceCopy);
                    bitmap.Save(args[0], ImageFormat.Png);
                }
            }
            Console.WriteLine("saved|width:" + width + "|height:" + height);
        } catch (Exception ex) {
            Console.WriteLine("error:" + ex.Message);
        }
    }
}
