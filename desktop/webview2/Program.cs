using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

[assembly: System.Runtime.Versioning.TargetFramework(".NETFramework,Version=v4.7")]

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        try { Application.Run(new ShellWindow(args)); }
        catch (Exception error) { MessageBox.Show(error.Message, "Rai Community", MessageBoxButtons.OK, MessageBoxIcon.Error); }
    }
}

internal sealed class ShellWindow : Form
{
    private const string AppUrl = "https://rai-community.local/index.html";
    private const string NetworkSeed = "Rai Community-0.4.x";
    private readonly string assets = AppDomain.CurrentDomain.BaseDirectory;
    private readonly string profileRoot;
    private readonly string[] originalArgs;
    private readonly string seed;
    private readonly bool test;
    private readonly JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = 16 * 1024 * 1024 };
    private string profileName;
    private string profile;
    private Process runtime;
    private StreamWriter runtimeInput;
    private FileStream profileLock;
    private WebView2 webView;
    private string launchData;
    private bool restart;
    private Icon windowIcon;

    internal ShellWindow(string[] args)
    {
        originalArgs = args;
        var overrideRoot = Environment.GetEnvironmentVariable("RAI_RUNTIME_DATA");
        test = !String.IsNullOrEmpty(overrideRoot) && Environment.GetEnvironmentVariable("RAI_HIDDEN_TEST") == "1";
        profileRoot = !String.IsNullOrEmpty(overrideRoot) ? Path.GetFullPath(overrideRoot) :
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "org.raicommunity.next");
        var active = Path.Combine(profileRoot, "rai-active-profile.txt");
        profileName = Option("--profile") ?? (File.Exists(active) ? File.ReadAllText(active).Trim() : "default");
        seed = test ? Option("--network-seed") ?? NetworkSeed : NetworkSeed;
        SetProfile(profileName);
        Text = "Rai Community";
        AutoScaleDimensions = new SizeF(96, 96);
        AutoScaleMode = AutoScaleMode.Dpi;
        ClientSize = new Size(1120, 780);
        MinimumSize = new Size(360, 460);
        StartPosition = FormStartPosition.CenterScreen;
        AddMenu();
        ShowInTaskbar = false;
        Opacity = 0;
        Shown += async (_, __) => await ShowPassword();
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        UpdateWindowIcon();
    }

    protected override void OnDpiChanged(DpiChangedEventArgs e)
    {
        base.OnDpiChanged(e);
        UpdateWindowIcon();
    }

    private void UpdateWindowIcon()
    {
        var iconPath = Path.Combine(assets, "rai-community-hidpi.ico");
        int size = LogicalToDeviceUnits(32);
        var previous = windowIcon;
        windowIcon = File.Exists(iconPath) ? new Icon(iconPath, size, size) : Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        Icon = windowIcon;
        if (previous != null) previous.Dispose();
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        if (disposing && windowIcon != null) { windowIcon.Dispose(); windowIcon = null; }
    }

    private string Option(string option)
    {
        int i = Array.IndexOf(originalArgs, option);
        return i >= 0 && i + 1 < originalArgs.Length ? originalArgs[i + 1] : null;
    }

    private void SetProfile(string name)
    {
        if (!Regex.IsMatch(name, @"\A[A-Za-z0-9_-]{1,64}\z")) throw new InvalidOperationException("Invalid profile name.");
        profileName = name;
        profile = Path.Combine(profileRoot, "0.4.x", name);
    }

    private async Task ShowPassword()
    {
        try { CoreWebView2Environment.GetAvailableBrowserVersionString(); }
        catch (WebView2RuntimeNotFoundException)
        {
            if (MessageBox.Show(this, "Microsoft Edge WebView2 Runtime is required. Open Microsoft's download page? / WebView2 gerekiyor. Microsoft indirme sayfası açılsın mı?", Text, MessageBoxButtons.YesNo) == DialogResult.Yes)
                OpenExternal("https://developer.microsoft.com/microsoft-edge/webview2/");
            Close();
            return;
        }
        while (!IsDisposed)
        {
            bool setup = !File.Exists(Path.Combine(profile, "data", "keystore", "lair-keystore-config.yaml"));
            try
            {
                var startupDebug = test ? Environment.GetEnvironmentVariable("RAI_STARTUP_DEVTOOLS_PORT") : null;
                if (test && String.IsNullOrEmpty(startupDebug))
                    await Unlock(Environment.GetEnvironmentVariable("RAI_TEST_PASSWORD"), setup);
                else using (var dialog = new PasswordWindow(assets, profileRoot, setup, startupDebug, password => Unlock(password, setup)))
                {
                    var answer = dialog.ShowDialog(this);
                    if (dialog.StartupError != null) throw dialog.StartupError;
                    if (answer == DialogResult.Retry)
                    {
                        SetProfile("recovery-" + Guid.NewGuid().ToString("N"));
                        continue;
                    }
                    if (answer != DialogResult.OK) { Close(); return; }
                }
                if (!test) ShowInTaskbar = true;
                await OpenWebView();
                if (!test) { Opacity = 1; Activate(); }
                return;
            }
            catch (Exception error)
            {
                if (webView != null) { Controls.Remove(webView); webView.Dispose(); webView = null; }
                StopRuntime();
                if (test)
                {
                    File.WriteAllText(Path.Combine(profileRoot, "webview-test-error.txt"), error.ToString());
                    Environment.ExitCode = 1;
                    Close();
                    return;
                }
                MessageBox.Show(this, error.Message, "Rai Community", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }
    }

    private async Task Unlock(string password, bool setup)
    {
        try
        {
            if (!test && !setup && Process.GetProcessesByName("org.raicommunity.next").Length != 0)
                throw new InvalidOperationException("Close the 0.4.0 desktop app first. / Önce 0.4.0 masaüstü uygulamasını kapat.");
            Directory.CreateDirectory(profile);
            profileLock = new FileStream(Path.Combine(profile, "rai-webview2.lock"), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
            launchData = await StartRuntime(password, setup);
            if (profileName.StartsWith("recovery-", StringComparison.Ordinal) && Option("--profile") == null)
                File.WriteAllText(Path.Combine(profileRoot, "rai-active-profile.txt"), profileName);
        }
        catch { StopRuntime(); throw; }
    }

    private async Task<string> StartRuntime(string password, bool setup)
    {
        var info = new ProcessStartInfo(Path.Combine(assets, "node.exe"),
            "--max-semi-space-size=1 --optimize-for-size \"" + Path.Combine(assets, "runtime.mjs") + "\" \"" + profile + "\" \"" + seed + "\"") {
            UseShellExecute = false, CreateNoWindow = true, RedirectStandardInput = true,
            RedirectStandardOutput = true, RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8,
        };
        foreach (string key in new[] { "NODE_OPTIONS", "NODE_PATH", "ELECTRON_RUN_AS_NODE" }) info.EnvironmentVariables.Remove(key);
        runtime = Process.Start(info);
        runtime.ErrorDataReceived += (_, e) => {
            if (e.Data != null) try { File.AppendAllText(Path.Combine(profile, "logs", "webview-shell.log"), e.Data + Environment.NewLine); } catch (IOException) { }
        };
        runtime.BeginErrorReadLine();
        runtimeInput = new StreamWriter(runtime.StandardInput.BaseStream, new UTF8Encoding(false)) { AutoFlush = true };
        await runtimeInput.WriteLineAsync(json.Serialize(new { id = 0, method = "startup", value = new { password, setup } }));
        var start = await runtime.StandardOutput.ReadLineAsync();
        if (start == null) throw new InvalidOperationException("The local runtime stopped. / Yerel çalışma ortamı durdu.");
        var reply = json.Deserialize<Dictionary<string, object>>(start);
        if (reply.ContainsKey("error")) throw new InvalidOperationException((string)reply["error"]);
        return json.Serialize(reply["value"]);
    }

    private async Task OpenWebView()
    {
        webView = new WebView2 { Dock = DockStyle.Fill };
        Controls.Add(webView);
        webView.BringToFront();
        var options = new CoreWebView2EnvironmentOptions();
        var debug = Environment.GetEnvironmentVariable("RAI_DEVTOOLS_PORT") ?? "";
        if (test && Regex.IsMatch(debug, @"\A[0-9]{4,5}\z"))
            options.AdditionalBrowserArguments = "--remote-debugging-port=" + debug;
        var environment = await CoreWebView2Environment.CreateAsync(null, Path.Combine(profile, "webview2"), options);
        await webView.EnsureCoreWebView2Async(environment);
        var core = webView.CoreWebView2;
        SetMemoryTarget();
        core.Settings.AreHostObjectsAllowed = false;
        core.Settings.AreDevToolsEnabled = test;
        core.Settings.AreDefaultContextMenusEnabled = false;
        core.Settings.IsStatusBarEnabled = false;
        core.SetVirtualHostNameToFolderMapping("rai-community.local", Path.Combine(assets, "ui"), CoreWebView2HostResourceAccessKind.Deny);
        core.NavigationStarting += (_, e) => {
            if (e.Uri == AppUrl) return;
            e.Cancel = true;
            if (e.IsUserInitiated) OpenExternal(e.Uri);
        };
        core.FrameNavigationStarting += (_, e) => e.Cancel = true;
        core.NewWindowRequested += (_, e) => { e.Handled = true; if (e.IsUserInitiated) OpenExternal(e.Uri); };
        core.PermissionRequested += (_, e) => {
            if (e.PermissionKind != CoreWebView2PermissionKind.ClipboardRead || e.Uri != AppUrl || !e.IsUserInitiated)
                e.State = CoreWebView2PermissionState.Deny;
            else e.State = CoreWebView2PermissionState.Allow;
        };
        core.WebMessageReceived += (_, e) => {
            if (e.Source != AppUrl || core.Source != AppUrl) return;
            try
            {
                var message = e.TryGetWebMessageAsString();
                if (message.Length > 1024 * 1024) return;
                var request = json.Deserialize<Dictionary<string, object>>(message);
                if (request.ContainsKey("method") && (string)request["method"] == "restart") { restart = true; Close(); return; }
                if (runtime != null && !runtime.HasExited) runtimeInput.WriteLine(message);
            }
            catch (ArgumentException) { }
            catch (IOException) { }
            catch (InvalidOperationException) { }
        };
        await core.AddScriptToExecuteOnDocumentCreatedAsync("if (window.top === window && location.href === " + json.Serialize(AppUrl) + ") {\n" +
            "window.__RAI_LAUNCH__ = " + launchData + ";\n" + File.ReadAllText(Path.Combine(assets, "bridge.js")) + "\n}");
        core.Navigate(AppUrl);
        PumpReplies(runtime, core);
    }

    private void SetMemoryTarget()
    {
        if (webView == null || webView.CoreWebView2 == null) return;
        var foreground = !test && ContainsFocus && WindowState != FormWindowState.Minimized;
        try { webView.CoreWebView2.MemoryUsageTargetLevel = foreground ? CoreWebView2MemoryUsageTargetLevel.Normal : CoreWebView2MemoryUsageTargetLevel.Low; }
        catch (NotImplementedException) { }
    }

    private void AddMenu()
    {
        var menu = new MenuStrip();
        var application = new ToolStripMenuItem("Rai Community");
        application.DropDownItems.Add("Restart / Yeniden başlat", null, (_, __) => { restart = true; Close(); });
        application.DropDownItems.Add("Quit / Çık", null, (_, __) => Close());
        var help = new ToolStripMenuItem("Help / Yardım");
        help.DropDownItems.Add("Open logs / Günlükleri aç", null, (_, __) => Logs(false));
        help.DropDownItems.Add("Export logs / Günlükleri dışa aktar", null, (_, __) => Logs(true));
        menu.Items.Add(application);
        menu.Items.Add(help);
        Controls.Add(menu);
        MainMenuStrip = menu;
        Activated += (_, __) => SetMemoryTarget();
        Deactivate += (_, __) => SetMemoryTarget();
        Resize += (_, __) => SetMemoryTarget();
    }

    private void Logs(bool export)
    {
        var folder = Path.Combine(profile, "logs");
        try
        {
            Directory.CreateDirectory(folder);
            if (!export) { Process.Start(new ProcessStartInfo(folder) { UseShellExecute = true }); return; }
            using (var dialog = new SaveFileDialog { FileName = "Rai-Community-logs.zip", Filter = "ZIP (*.zip)|*.zip" })
            {
                if (dialog.ShowDialog(this) != DialogResult.OK) return;
                using (var output = new FileStream(dialog.FileName, FileMode.Create, FileAccess.Write))
                using (var archive = new ZipArchive(output, ZipArchiveMode.Create))
                    foreach (string file in Directory.GetFiles(folder, "*.log"))
                        using (var input = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
                        using (var entry = archive.CreateEntry(Path.GetFileName(file)).Open()) input.CopyTo(entry);
            }
        }
        catch (Exception error) { MessageBox.Show(this, error.Message, Text, MessageBoxButtons.OK, MessageBoxIcon.Error); }
    }

    private async void PumpReplies(Process worker, CoreWebView2 core)
    {
        try
        {
            string reply;
            while ((reply = await worker.StandardOutput.ReadLineAsync()) != null)
                if (!IsDisposed && core.Source == AppUrl) core.PostWebMessageAsJson(reply);
        }
        catch (InvalidOperationException) { }
        catch (IOException) { }
    }

    private static void OpenExternal(string value)
    {
        Uri uri;
        if (!Uri.TryCreate(value, UriKind.Absolute, out uri) || uri.Scheme != "https") return;
        try { Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true }); }
        catch (System.ComponentModel.Win32Exception) { }
    }

    private void StopRuntime()
    {
        if (runtime != null)
        {
            try { if (runtimeInput != null) runtimeInput.Dispose(); if (!runtime.WaitForExit(4000)) runtime.Kill(); }
            catch (InvalidOperationException) { }
            catch (IOException) { }
            runtime.Dispose();
            runtime = null;
            runtimeInput = null;
        }
        if (profileLock != null) { profileLock.Dispose(); profileLock = null; }
    }

    protected override void OnFormClosed(FormClosedEventArgs e)
    {
        if (webView != null) webView.Dispose();
        StopRuntime();
        base.OnFormClosed(e);
        if (restart)
        {
            var args = "--profile " + profileName;
            if (test) args += " --network-seed \"" + seed + "\"";
            Process.Start(new ProcessStartInfo(Application.ExecutablePath, args) { UseShellExecute = false });
        }
    }
}

internal sealed class PasswordWindow : Form
{
    private const string StartupUrl = "https://rai-start.local/index.html";
    private readonly JavaScriptSerializer json = new JavaScriptSerializer();
    private bool busy;
    internal Exception StartupError { get; private set; }

    internal PasswordWindow(string assets, string profileRoot, bool setup, string debugPort, Func<string, Task> unlock)
    {
        Text = "Rai Community";
        AutoScaleDimensions = new SizeF(96, 96);
        AutoScaleMode = AutoScaleMode.Dpi;
        StartPosition = FormStartPosition.CenterParent;
        FormBorderStyle = FormBorderStyle.None;
        ClientSize = new Size(800, 450);
        ShowInTaskbar = false;
        var view = new WebView2 { Dock = DockStyle.Fill };
        Controls.Add(view);
        var debug = Regex.IsMatch(debugPort ?? "", @"\A[0-9]{4,5}\z");
        if (debug) Opacity = 0;
        Shown += async (sender, shown) => {
            try
            {
                var available = Screen.FromHandle(Handle).WorkingArea.Size;
                ClientSize = new Size(Math.Min(LogicalToDeviceUnits(800), available.Width), Math.Min(LogicalToDeviceUnits(450), available.Height));
                CenterToScreen();
                var options = new CoreWebView2EnvironmentOptions();
                if (debug) options.AdditionalBrowserArguments = "--remote-debugging-port=" + debugPort;
                var environment = await CoreWebView2Environment.CreateAsync(null, Path.Combine(profileRoot, "webview2-startup"), options);
                await view.EnsureCoreWebView2Async(environment);
                var core = view.CoreWebView2;
                core.Settings.AreHostObjectsAllowed = false;
                core.Settings.AreDevToolsEnabled = debug;
                core.Settings.AreDefaultContextMenusEnabled = false;
                core.Settings.IsStatusBarEnabled = false;
                core.Settings.IsPasswordAutosaveEnabled = false;
                core.Settings.IsGeneralAutofillEnabled = false;
                core.SetVirtualHostNameToFolderMapping("rai-start.local", Path.Combine(assets, "startup"), CoreWebView2HostResourceAccessKind.Deny);
                core.NavigationStarting += (_, e) => e.Cancel = e.Uri != StartupUrl;
                core.FrameNavigationStarting += (_, e) => e.Cancel = true;
                core.NewWindowRequested += (_, e) => e.Handled = true;
                core.PermissionRequested += (_, e) => e.State = CoreWebView2PermissionState.Deny;
                core.WebMessageReceived += async (_, e) => {
                    if (e.Source != StartupUrl || busy) return;
                    var message = json.Deserialize<Dictionary<string, object>>(e.WebMessageAsJson);
                    object action;
                    if (message == null || !message.TryGetValue("action", out action)) return;
                    if (Equals(action, "ready")) { core.PostWebMessageAsJson(json.Serialize(new { setup })); return; }
                    if (Equals(action, "close")) { Close(); return; }
                    if (Equals(action, "recover") && !setup)
                    {
                        if (MessageBox.Show(this, "Your old profile will be kept. To resume your membership, you need its recovery code. / Eski profil korunur. Üyeliğe devam etmek için kurtarma kodu gerekir.", Text, MessageBoxButtons.OKCancel) == DialogResult.OK)
                            DialogResult = DialogResult.Retry;
                        return;
                    }
                    object secret;
                    if (!Equals(action, "unlock") || !message.TryGetValue("password", out secret)) return;
                    var password = secret as string;
                    object acknowledged;
                    if (String.IsNullOrEmpty(password) || (setup && (password.Length < 8 || !message.TryGetValue("acknowledged", out acknowledged) || !Equals(acknowledged, true)))) return;
                    busy = true;
                    try { await unlock(password); busy = false; DialogResult = DialogResult.OK; }
                    catch (Exception error) { busy = false; core.PostWebMessageAsJson(json.Serialize(new { error = error.Message })); }
                };
                core.Navigate(StartupUrl);
            }
            catch (Exception error) { StartupError = error; Close(); }
        };
        FormClosing += (_, e) => e.Cancel = busy;
    }
}
