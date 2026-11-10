// PautaFlow Intelligence — inicializador para Windows.
// Clique duplo: instala na primeira vez (se preciso), inicia o servidor local em segundo plano
// (com supervisor que reinicia em falhas) e abre o painel no navegador.
//   PautaFlow.exe           inicia/abre
//   PautaFlow.exe --parar   encerra o servidor e o supervisor
// Compilado por scripts\build-launcher.ps1 com o csc.exe do .NET Framework (já presente no Windows).
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;

[assembly: System.Reflection.AssemblyTitle("PautaFlow Intelligence")]
[assembly: System.Reflection.AssemblyProduct("PautaFlow Intelligence")]
[assembly: System.Reflection.AssemblyDescription("Inicializador do PautaFlow Intelligence")]

static class Program
{
    const string Title = "PautaFlow Intelligence";

    [STAThread]
    static int Main(string[] args)
    {
        Application.EnableVisualStyles();
        string root = FindRoot(AppDomain.CurrentDomain.BaseDirectory);
        if (root == null)
        {
            Fail("Não encontrei a pasta do PautaFlow. Mantenha o PautaFlow.exe dentro da pasta do projeto (onde está o package.json).");
            return 1;
        }
        int port = ReadPort(root);
        string url = "http://localhost:" + port;

        foreach (string a in args)
        {
            string s = a.ToLowerInvariant();
            if (s == "--parar" || s == "--stop" || s == "/parar")
            {
                RunPowerShell(root, "scripts\\stop.ps1", true, true);
                MessageBox.Show("O PautaFlow foi encerrado.", Title, MessageBoxButtons.OK, MessageBoxIcon.Information);
                return 0;
            }
        }

        // Já está rodando? Só abre o navegador.
        if (Healthy(port)) { Open(url); return 0; }

        if (!NodeAvailable())
        {
            if (MessageBox.Show("O Node.js (versão 22 ou superior) não foi encontrado.\n\nDeseja abrir a página de download (nodejs.org)? Depois de instalar, abra o PautaFlow novamente.",
                Title, MessageBoxButtons.YesNo, MessageBoxIcon.Warning) == DialogResult.Yes)
                Open("https://nodejs.org/pt/download");
            return 1;
        }

        // Primeira execução: instala dependências e compila a interface (janela visível)
        bool needsInstall = !File.Exists(Path.Combine(root, "node_modules\\tsx\\dist\\cli.mjs"));
        bool needsBuild = !File.Exists(Path.Combine(root, "apps\\web\\dist\\index.html"));
        if (needsInstall || needsBuild)
        {
            MessageBox.Show("Primeira execução: o PautaFlow vai instalar as dependências e preparar a interface. Isso leva alguns minutos e acontece só uma vez.",
                Title, MessageBoxButtons.OK, MessageBoxIcon.Information);
            int code = RunPowerShell(root, "scripts\\install.ps1", false, true);
            if (code != 0) { Fail("A instalação não foi concluída. Veja a janela do PowerShell para detalhes."); return 1; }
        }

        RunPowerShell(root, "scripts\\start-background.ps1", true, false);

        bool ok = false;
        using (Splash splash = new Splash())
        {
            Thread t = new Thread(delegate ()
            {
                for (int i = 0; i < 120 && !ok; i++)
                {
                    if (Healthy(port)) { ok = true; break; }
                    Thread.Sleep(750);
                }
                try { splash.BeginInvoke(new MethodInvoker(splash.Close)); } catch { }
            });
            t.IsBackground = true;
            splash.Shown += delegate { t.Start(); };
            Application.Run(splash);
        }

        if (!ok)
        {
            Fail("O servidor não respondeu a tempo. Consulte os arquivos em \"logs\" (server.err.log e supervisor.log) na pasta do PautaFlow.");
            return 1;
        }
        Open(url);
        return 0;
    }

    static string FindRoot(string start)
    {
        DirectoryInfo dir = new DirectoryInfo(start);
        while (dir != null)
        {
            string pkg = Path.Combine(dir.FullName, "package.json");
            if (File.Exists(pkg) && File.ReadAllText(pkg).Contains("pautaflow-intelligence")) return dir.FullName;
            dir = dir.Parent;
        }
        return null;
    }

    static int ReadPort(string root)
    {
        try
        {
            string env = Path.Combine(root, ".env");
            if (File.Exists(env))
            {
                Match m = Regex.Match(File.ReadAllText(env), @"(?m)^\s*PAUTAFLOW_PORT\s*=\s*(\d+)");
                if (m.Success) return int.Parse(m.Groups[1].Value);
            }
        }
        catch { }
        return 3000;
    }

    static bool Healthy(int port)
    {
        try
        {
            HttpWebRequest req = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + port + "/api/health");
            req.Timeout = 1500;
            req.Proxy = null;
            using (HttpWebResponse res = (HttpWebResponse)req.GetResponse()) return res.StatusCode == HttpStatusCode.OK;
        }
        catch { return false; }
    }

    static bool NodeAvailable()
    {
        try
        {
            ProcessStartInfo psi = new ProcessStartInfo("node", "-v");
            psi.UseShellExecute = false; psi.CreateNoWindow = true; psi.RedirectStandardOutput = true;
            using (Process p = Process.Start(psi))
            {
                string v = p.StandardOutput.ReadToEnd().Trim().TrimStart('v');
                p.WaitForExit(5000);
                int major;
                return int.TryParse(v.Split('.')[0], out major) && major >= 22;
            }
        }
        catch { return false; }
    }

    static int RunPowerShell(string root, string script, bool hidden, bool wait)
    {
        ProcessStartInfo psi = new ProcessStartInfo("powershell.exe",
            "-NoProfile -ExecutionPolicy Bypass " + (hidden ? "-WindowStyle Hidden " : "") + "-File \"" + Path.Combine(root, script) + "\"");
        psi.WorkingDirectory = root;
        psi.UseShellExecute = false;
        psi.CreateNoWindow = hidden;
        Process p = Process.Start(psi);
        if (!wait) return 0;
        p.WaitForExit();
        return p.ExitCode;
    }

    static void Open(string url)
    {
        try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); } catch { }
    }

    static void Fail(string msg)
    {
        MessageBox.Show(msg, Title, MessageBoxButtons.OK, MessageBoxIcon.Error);
    }
}

/// Janela discreta exibida enquanto o servidor inicia.
class Splash : Form
{
    public Splash()
    {
        Text = "PautaFlow Intelligence";
        FormBorderStyle = FormBorderStyle.None;
        StartPosition = FormStartPosition.CenterScreen;
        Size = new Size(380, 130);
        BackColor = Color.FromArgb(14, 18, 32);
        TopMost = true;
        ShowInTaskbar = true;
        try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }

        Label title = new Label();
        title.Text = "PautaFlow Intelligence";
        title.ForeColor = Color.White;
        title.Font = new Font("Segoe UI Semibold", 13f);
        title.AutoSize = true;
        title.Location = new Point(24, 22);

        Label sub = new Label();
        sub.Text = "Iniciando o serviço local…";
        sub.ForeColor = Color.FromArgb(163, 173, 194);
        sub.Font = new Font("Segoe UI", 9.5f);
        sub.AutoSize = true;
        sub.Location = new Point(25, 54);

        ProgressBar bar = new ProgressBar();
        bar.Style = ProgressBarStyle.Marquee;
        bar.MarqueeAnimationSpeed = 25;
        bar.Location = new Point(26, 88);
        bar.Size = new Size(328, 6);

        Controls.Add(title);
        Controls.Add(sub);
        Controls.Add(bar);
    }
}
