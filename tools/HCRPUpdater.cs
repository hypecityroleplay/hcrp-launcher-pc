using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Reflection;
using System.Threading;
using System.Windows.Forms;

namespace HCRPLauncherUpdater
{
    internal static class Program
    {
        [STAThread]
        private static void Main(string[] args)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new UpdaterForm(args));
        }
    }

    public sealed class UpdaterForm : Form
    {
        private readonly string _installerPath;
        private readonly string _targetPath;
        private readonly string _version;
        private readonly int _parentPid;

        private readonly Label _headline;
        private readonly Label _status;
        private readonly Label _detail;
        private readonly Label _versionLabel;
        private readonly Label _percent;
        private readonly Panel _progressTrack;
        private readonly Panel _progressBar;
        private readonly Panel _stageInstall;
        private readonly Panel _stageOpen;
        private readonly Label _stageInstallTitle;
        private readonly Label _stageInstallSub;
        private readonly Label _stageOpenTitle;
        private readonly Label _stageOpenSub;
        private readonly System.Windows.Forms.Timer _animationTimer;

        private int _animationValue = 0;
        private int _animationDirection = 1;
        private bool _completed;

        protected override CreateParams CreateParams
        {
            get
            {
                const int CS_DROPSHADOW = 0x00020000;
                CreateParams cp = base.CreateParams;
                cp.ClassStyle |= CS_DROPSHADOW;
                return cp;
            }
        }

        public UpdaterForm(string[] args)
        {
            _installerPath = GetArg(args, "--installer=");
            _targetPath = GetArg(args, "--target=");
            _version = GetArg(args, "--version=");
            int.TryParse(GetArg(args, "--parent="), out _parentPid);

            Width = 660;
            Height = 430;
            StartPosition = FormStartPosition.CenterScreen;
            FormBorderStyle = FormBorderStyle.None;
            MaximizeBox = false;
            MinimizeBox = false;
            ShowInTaskbar = true;
            TopMost = true;
            BackColor = Color.FromArgb(5, 10, 14);
            ForeColor = Color.White;

            try
            {
                Icon exeIcon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
                if (exeIcon != null)
                {
                    Icon = exeIcon;
                }
            }
            catch
            {
            }

            Panel shell = new Panel
            {
                Dock = DockStyle.Fill,
                BackColor = Color.FromArgb(16, 93, 112),
                Padding = new Padding(1)
            };
            Controls.Add(shell);
            RoundControl(shell, 18);
            shell.SizeChanged += delegate { RoundControl(shell, 18); };

            Panel body = new Panel
            {
                Dock = DockStyle.Fill,
                BackColor = Color.FromArgb(7, 14, 20)
            };
            shell.Controls.Add(body);
            RoundControl(body, 17);
            body.SizeChanged += delegate { RoundControl(body, 17); };

            Panel topGlow = new Panel
            {
                Left = 0,
                Top = 0,
                Width = 660,
                Height = 0,
                BackColor = Color.FromArgb(0, 229, 255)
            };
            body.Controls.Add(topGlow);

            Panel header = new Panel
            {
                Left = 0,
                Top = 0,
                Width = 658,
                Height = 92,
                BackColor = Color.FromArgb(8, 17, 24)
            };
            body.Controls.Add(header);

            Image logoImage = LoadEmbeddedLogo();
            Panel logoCard = new Panel
            {
                Left = 27,
                Top = 20,
                Width = 52,
                Height = 52,
                BackColor = Color.FromArgb(10, 34, 42)
            };
            header.Controls.Add(logoCard);
            RoundControl(logoCard, 13);

            if (logoImage != null)
            {
                PictureBox logo = new PictureBox
                {
                    Left = 5,
                    Top = 5,
                    Width = 42,
                    Height = 42,
                    Image = logoImage,
                    SizeMode = PictureBoxSizeMode.Zoom,
                    BackColor = Color.Transparent,
                    TabStop = false
                };
                logoCard.Controls.Add(logo);
            }
            else
            {
                Label logoFallback = new Label
                {
                    Dock = DockStyle.Fill,
                    Text = "HCRP",
                    TextAlign = ContentAlignment.MiddleCenter,
                    Font = new Font("Segoe UI Semibold", 10.0f, FontStyle.Bold),
                    ForeColor = Color.FromArgb(0, 229, 255),
                    BackColor = Color.Transparent
                };
                logoCard.Controls.Add(logoFallback);
            }

            Label brand = new Label
            {
                Left = 94,
                Top = 24,
                Width = 310,
                Height = 22,
                Text = "HYPE CITY ROLEPLAY",
                Font = new Font("Segoe UI Semibold", 10.5f, FontStyle.Bold),
                ForeColor = Color.FromArgb(248, 250, 252),
                BackColor = Color.Transparent
            };
            header.Controls.Add(brand);

            Label updaterCaption = new Label
            {
                Left = 94,
                Top = 47,
                Width = 310,
                Height = 18,
                Text = "Atualizador oficial do HCRP Launcher",
                Font = new Font("Segoe UI", 8.1f, FontStyle.Regular),
                ForeColor = Color.FromArgb(129, 145, 154),
                BackColor = Color.Transparent
            };
            header.Controls.Add(updaterCaption);

            Panel versionCard = new Panel
            {
                Left = 505,
                Top = 20,
                Width = 125,
                Height = 52,
                BackColor = Color.FromArgb(9, 31, 40)
            };
            header.Controls.Add(versionCard);
            RoundControl(versionCard, 12);

            Label versionCaption = new Label
            {
                Left = 11,
                Top = 8,
                Width = 103,
                Height = 15,
                Text = "NOVA VERSÃO",
                TextAlign = ContentAlignment.TopRight,
                Font = new Font("Segoe UI", 7.0f, FontStyle.Bold),
                ForeColor = Color.FromArgb(111, 149, 160),
                BackColor = Color.Transparent
            };
            versionCard.Controls.Add(versionCaption);

            _versionLabel = new Label
            {
                Left = 9,
                Top = 25,
                Width = 105,
                Height = 20,
                Text = "v" + (_version.Length > 0 ? FormatDisplayVersion(_version) : "nova"),
                TextAlign = ContentAlignment.TopRight,
                Font = new Font("Segoe UI Semibold", 9.5f, FontStyle.Bold),
                ForeColor = Color.FromArgb(0, 229, 255),
                BackColor = Color.Transparent
            };
            versionCard.Controls.Add(_versionLabel);

            Label eyebrow = new Label
            {
                Left = 30,
                Top = 119,
                Width = 350,
                Height = 17,
                Text = "ATUALIZAÇÃO DO LAUNCHER",
                Font = new Font("Segoe UI", 7.4f, FontStyle.Bold),
                ForeColor = Color.FromArgb(0, 229, 255),
                BackColor = Color.Transparent
            };
            body.Controls.Add(eyebrow);

            _headline = new Label
            {
                Left = 28,
                Top = 141,
                Width = 595,
                Height = 38,
                Text = "INSTALANDO ATUALIZAÇÃO",
                Font = new Font("Segoe UI Semibold", 21.0f, FontStyle.Bold),
                ForeColor = Color.FromArgb(248, 250, 252),
                BackColor = Color.Transparent
            };
            body.Controls.Add(_headline);

            _detail = new Label
            {
                Left = 30,
                Top = 181,
                Width = 590,
                Height = 36,
                Text = "Preparando a nova versão do HCRP Launcher. Isso deve levar apenas alguns instantes.",
                Font = new Font("Segoe UI", 8.4f, FontStyle.Regular),
                ForeColor = Color.FromArgb(132, 146, 156),
                BackColor = Color.Transparent
            };
            body.Controls.Add(_detail);

            Panel stageDownload = CreateStagePanel(30, 224, 190, 58, Color.FromArgb(12, 50, 48));
            body.Controls.Add(stageDownload);
            Label stageDownloadTitle = CreateStageTitle("✓  DOWNLOAD CONCLUÍDO", Color.FromArgb(92, 255, 183));
            Label stageDownloadSub = CreateStageSub("Arquivos recebidos", Color.FromArgb(120, 172, 158));
            stageDownload.Controls.Add(stageDownloadTitle);
            stageDownload.Controls.Add(stageDownloadSub);

            _stageInstall = CreateStagePanel(234, 224, 190, 58, Color.FromArgb(8, 53, 66));
            body.Controls.Add(_stageInstall);
            _stageInstallTitle = CreateStageTitle("2  INSTALANDO", Color.FromArgb(125, 211, 252));
            _stageInstallSub = CreateStageSub("Aplicando nova versão", Color.FromArgb(118, 156, 167));
            _stageInstall.Controls.Add(_stageInstallTitle);
            _stageInstall.Controls.Add(_stageInstallSub);

            _stageOpen = CreateStagePanel(438, 224, 190, 58, Color.FromArgb(11, 21, 29));
            body.Controls.Add(_stageOpen);
            _stageOpenTitle = CreateStageTitle("3  ABRIR LAUNCHER", Color.FromArgb(133, 153, 164));
            _stageOpenSub = CreateStageSub("Aguardando instalação", Color.FromArgb(89, 108, 118));
            _stageOpen.Controls.Add(_stageOpenTitle);
            _stageOpen.Controls.Add(_stageOpenSub);

            Panel footer = new Panel
            {
                Left = 20,
                Top = 300,
                Width = 618,
                Height = 108,
                BackColor = Color.FromArgb(7, 16, 23)
            };
            body.Controls.Add(footer);
            RoundControl(footer, 13);

            _status = new Label
            {
                Left = 18,
                Top = 16,
                Width = 455,
                Height = 19,
                Text = "Aguardando o launcher fechar...",
                Font = new Font("Segoe UI Semibold", 8.7f, FontStyle.Bold),
                ForeColor = Color.FromArgb(230, 236, 239),
                BackColor = Color.Transparent
            };
            footer.Controls.Add(_status);

            _percent = new Label
            {
                Left = 510,
                Top = 15,
                Width = 82,
                Height = 20,
                Text = "...",
                TextAlign = ContentAlignment.TopRight,
                Font = new Font("Segoe UI Semibold", 9.0f, FontStyle.Bold),
                ForeColor = Color.FromArgb(0, 229, 255),
                BackColor = Color.Transparent
            };
            footer.Controls.Add(_percent);

            _progressTrack = new Panel
            {
                Left = 18,
                Top = 45,
                Width = 574,
                Height = 10,
                BackColor = Color.FromArgb(26, 42, 49)
            };
            footer.Controls.Add(_progressTrack);
            RoundControl(_progressTrack, 5);

            _progressBar = new Panel
            {
                Left = 0,
                Top = 0,
                Width = 160,
                Height = 10,
                BackColor = Color.FromArgb(0, 229, 255)
            };
            _progressTrack.Controls.Add(_progressBar);
            RoundControl(_progressBar, 5);

            Label hint = new Label
            {
                Left = 18,
                Top = 68,
                Width = 574,
                Height = 18,
                Text = "O launcher será aberto automaticamente assim que a atualização terminar.",
                Font = new Font("Segoe UI", 7.3f, FontStyle.Regular),
                ForeColor = Color.FromArgb(118, 135, 144),
                BackColor = Color.Transparent
            };
            footer.Controls.Add(hint);

            Label security = new Label
            {
                Left = 18,
                Top = 86,
                Width = 574,
                Height = 14,
                Text = "●  Atualização segura • Não desligue o computador durante a instalação",
                Font = new Font("Segoe UI", 6.9f, FontStyle.Regular),
                ForeColor = Color.FromArgb(85, 112, 122),
                BackColor = Color.Transparent
            };
            footer.Controls.Add(security);

            _animationTimer = new System.Windows.Forms.Timer();
            _animationTimer.Interval = 28;
            _animationTimer.Tick += AnimationTick;
            _animationTimer.Start();

            Shown += delegate
            {
                ApplyFormRegion();
                Thread thread = new Thread(RunUpdate);
                thread.IsBackground = true;
                thread.Start();
            };

            Resize += delegate { ApplyFormRegion(); };

            FormClosing += delegate(object sender, FormClosingEventArgs e)
            {
                if (!_completed && e.CloseReason == CloseReason.UserClosing)
                {
                    e.Cancel = true;
                }
            };
        }

        private static Panel CreateStagePanel(int left, int top, int width, int height, Color background)
        {
            Panel panel = new Panel
            {
                Left = left,
                Top = top,
                Width = width,
                Height = height,
                BackColor = background
            };
            RoundControl(panel, 11);
            panel.SizeChanged += delegate { RoundControl(panel, 11); };
            return panel;
        }

        private static Label CreateStageTitle(string text, Color color)
        {
            return new Label
            {
                Left = 14,
                Top = 11,
                Width = 162,
                Height = 18,
                Text = text,
                Font = new Font("Segoe UI Semibold", 7.6f, FontStyle.Bold),
                ForeColor = color,
                BackColor = Color.Transparent
            };
        }

        private static Label CreateStageSub(string text, Color color)
        {
            return new Label
            {
                Left = 14,
                Top = 31,
                Width = 162,
                Height = 16,
                Text = text,
                Font = new Font("Segoe UI", 7.0f, FontStyle.Regular),
                ForeColor = color,
                BackColor = Color.Transparent
            };
        }

        private void ApplyFormRegion()
        {
            try
            {
                Region oldRegion = Region;
                using (GraphicsPath path = CreateRoundedPath(new Rectangle(0, 0, Width, Height), 18))
                {
                    Region = new Region(path);
                }
                if (oldRegion != null)
                {
                    oldRegion.Dispose();
                }
            }
            catch
            {
            }
        }

        private static void RoundControl(Control control, int radius)
        {
            if (control == null || control.Width <= 0 || control.Height <= 0)
            {
                return;
            }

            try
            {
                Region oldRegion = control.Region;
                using (GraphicsPath path = CreateRoundedPath(new Rectangle(0, 0, control.Width, control.Height), radius))
                {
                    control.Region = new Region(path);
                }
                if (oldRegion != null)
                {
                    oldRegion.Dispose();
                }
            }
            catch
            {
            }
        }

        private static GraphicsPath CreateRoundedPath(Rectangle bounds, int radius)
        {
            int diameter = radius * 2;
            GraphicsPath path = new GraphicsPath();
            Rectangle arc = new Rectangle(bounds.X, bounds.Y, diameter, diameter);

            path.AddArc(arc, 180, 90);
            arc.X = bounds.Right - diameter;
            path.AddArc(arc, 270, 90);
            arc.Y = bounds.Bottom - diameter;
            path.AddArc(arc, 0, 90);
            arc.X = bounds.Left;
            path.AddArc(arc, 90, 90);
            path.CloseFigure();
            return path;
        }

        private static Image LoadEmbeddedLogo()
        {
            try
            {
                Assembly assembly = Assembly.GetExecutingAssembly();

                using (Stream pngStream = assembly.GetManifestResourceStream("HCRPLogo.png"))
                {
                    if (pngStream != null)
                    {
                        using (MemoryStream copy = new MemoryStream())
                        {
                            pngStream.CopyTo(copy);
                            copy.Position = 0;
                            using (Image image = Image.FromStream(copy, true, true))
                            {
                                return new Bitmap(image);
                            }
                        }
                    }
                }

                using (Stream icoStream = assembly.GetManifestResourceStream("HCRPLogo.ico"))
                {
                    if (icoStream != null)
                    {
                        using (Icon source = new Icon(icoStream, 64, 64))
                        {
                            return source.ToBitmap();
                        }
                    }
                }
            }
            catch
            {
            }

            try
            {
                string fallbackPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "assets", "icons", "logo.png");
                if (File.Exists(fallbackPath))
                {
                    using (Image image = Image.FromFile(fallbackPath))
                    {
                        return new Bitmap(image);
                    }
                }
            }
            catch
            {
            }

            return null;
        }

        private void AnimationTick(object sender, EventArgs e)
        {
            if (_completed)
            {
                _progressBar.Left = 0;
                _progressBar.Width = _progressTrack.Width;
                return;
            }

            int maxLeft = Math.Max(0, _progressTrack.Width - _progressBar.Width);
            _animationValue += 8 * _animationDirection;

            if (_animationValue >= maxLeft)
            {
                _animationValue = maxLeft;
                _animationDirection = -1;
            }
            else if (_animationValue <= 0)
            {
                _animationValue = 0;
                _animationDirection = 1;
            }

            _progressBar.Left = _animationValue;
        }

        private void RunUpdate()
        {
            try
            {
                if (string.IsNullOrWhiteSpace(_installerPath) || !File.Exists(_installerPath))
                {
                    throw new FileNotFoundException("O instalador baixado não foi encontrado.");
                }

                if (string.IsNullOrWhiteSpace(_targetPath))
                {
                    throw new InvalidOperationException("O caminho do HCRP Launcher não foi informado.");
                }

                SetStatus("Fechando a versão anterior...", "Aguardando o HCRP Launcher liberar os arquivos para atualização.");
                WaitForParent();

                SetStatus("Instalando a nova versão...", "Aplicando os arquivos da atualização com segurança.");

                WriteLog("Iniciando instalador silencioso com --force-run.");
                Process process = StartInstaller(false);

                if (process == null)
                {
                    throw new InvalidOperationException("Não foi possível iniciar o instalador da atualização.");
                }

                process.WaitForExit();
                WriteLog("Instalador finalizado com código " + process.ExitCode + ".");

                if (process.ExitCode != 0)
                {
                    throw new InvalidOperationException("O instalador terminou com o código " + process.ExitCode + ".");
                }

                CompleteAndLaunch();
            }
            catch (Win32Exception ex)
            {
                if (ex.NativeErrorCode == 740 || ex.NativeErrorCode == 5)
                {
                    try
                    {
                        SetStatus("Aguardando permissão do Windows...", "Confirme a janela de segurança para concluir a atualização.");
                        Process elevated = StartInstaller(true);

                        if (elevated == null)
                        {
                            throw new InvalidOperationException("Não foi possível iniciar o instalador com permissão.");
                        }

                        elevated.WaitForExit();

                        if (elevated.ExitCode != 0)
                        {
                            throw new InvalidOperationException("O instalador terminou com o código " + elevated.ExitCode + ".");
                        }

                        CompleteAndLaunch();
                        return;
                    }
                    catch (Exception elevationError)
                    {
                        ShowError(elevationError.Message);
                        return;
                    }
                }

                ShowError(ex.Message);
            }
            catch (Exception ex)
            {
                ShowError(ex.Message);
            }
        }

        private Process StartInstaller(bool elevated)
        {
            ProcessStartInfo startInfo = new ProcessStartInfo
            {
                FileName = _installerPath,
                Arguments = "--updated /S --force-run",
                WorkingDirectory = Path.GetDirectoryName(_installerPath) ?? Environment.CurrentDirectory,
                UseShellExecute = elevated,
                CreateNoWindow = !elevated,
                WindowStyle = ProcessWindowStyle.Hidden
            };

            if (elevated)
            {
                startInfo.Verb = "runas";
                startInfo.WindowStyle = ProcessWindowStyle.Normal;
            }

            return Process.Start(startInfo);
        }

        private void WaitForParent()
        {
            if (_parentPid <= 0)
            {
                Thread.Sleep(450);
                return;
            }

            try
            {
                Process parent = Process.GetProcessById(_parentPid);

                if (!parent.HasExited)
                {
                    parent.WaitForExit(60000);
                }
            }
            catch
            {
            }

            Thread.Sleep(250);
        }

        private void WriteLog(string message)
        {
            try
            {
                string dir = Path.Combine(Path.GetTempPath(), "HCRPLauncherUpdater");
                Directory.CreateDirectory(dir);
                string file = Path.Combine(dir, "HCRP-helper.log");
                File.AppendAllText(file, "[" + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "] " + message + Environment.NewLine);
            }
            catch
            {
            }
        }

        private bool IsLauncherRunning()
        {
            Process[] processes = null;

            try
            {
                string processName = Path.GetFileNameWithoutExtension(_targetPath);
                if (string.IsNullOrWhiteSpace(processName))
                {
                    return false;
                }

                processes = Process.GetProcessesByName(processName);
                return processes.Length > 0;
            }
            catch
            {
                return false;
            }
            finally
            {
                if (processes != null)
                {
                    foreach (Process process in processes)
                    {
                        try { process.Dispose(); } catch { }
                    }
                }
            }
        }

        private bool IsLauncherWindowVisible()
        {
            Process[] processes = null;

            try
            {
                string processName = Path.GetFileNameWithoutExtension(_targetPath);
                if (string.IsNullOrWhiteSpace(processName))
                {
                    return false;
                }

                processes = Process.GetProcessesByName(processName);

                foreach (Process process in processes)
                {
                    try
                    {
                        process.Refresh();

                        if (!process.HasExited && process.MainWindowHandle != IntPtr.Zero)
                        {
                            return true;
                        }
                    }
                    catch
                    {
                    }
                }
            }
            catch
            {
            }
            finally
            {
                if (processes != null)
                {
                    foreach (Process process in processes)
                    {
                        try { process.Dispose(); } catch { }
                    }
                }
            }

            return false;
        }

        private void CompleteAndLaunch()
        {
            SetFinalizingStatus(
                "Finalizando instalação...",
                "Nova versão instalada. Preparando a abertura do HCRP Launcher atualizado."
            );

            bool launcherReady = EnsureLauncherStarted();

            if (!launcherReady)
            {
                ShowError("A atualização foi instalada, mas o HCRP Launcher não abriu corretamente.");
                return;
            }

            SetSuccessStatus(
                "HCRP Launcher iniciado com sucesso.",
                "Atualização concluída. Fechando o atualizador..."
            );

            WriteLog("Janela principal do launcher detectada. Fechando atualizador.");
            Thread.Sleep(220);

            ScheduleSelfDelete();

            BeginInvoke((MethodInvoker)delegate
            {
                _completed = true;
                Close();
            });
        }

        private bool EnsureLauncherStarted()
        {
            WriteLog("Finalizando atualização. Destino: " + _targetPath);

            if (!File.Exists(_targetPath))
            {
                WriteLog("Executável atualizado não encontrado no caminho esperado.");
                return false;
            }

            string[][] statuses = new string[][]
            {
                new string[] { "Finalizando instalação...", "Concluindo os últimos arquivos da atualização." },
                new string[] { "Preparando o HCRP Launcher...", "Carregando os componentes da nova versão." },
                new string[] { "Aguardando o launcher abrir...", "A instalação terminou. Esta tela fechará automaticamente quando a janela principal aparecer." }
            };

            bool directStartAttempted = false;
            bool fallbackStartAttempted = false;
            int statusIndex = -1;

            for (int i = 0; i < 150; i++)
            {
                if (IsLauncherWindowVisible())
                {
                    WriteLog("Janela visível do launcher detectada.");
                    return true;
                }

                int nextStatusIndex;
                if (i < 8)
                {
                    nextStatusIndex = 0;
                }
                else if (i < 16)
                {
                    nextStatusIndex = 1;
                }
                else
                {
                    nextStatusIndex = 2;
                }

                if (nextStatusIndex != statusIndex)
                {
                    statusIndex = nextStatusIndex;
                    string[] current = statuses[statusIndex];
                    SetFinalizingStatus(current[0], current[1]);
                }

                if (!directStartAttempted && i >= 4 && !IsLauncherRunning())
                {
                    directStartAttempted = true;

                    try
                    {
                        WriteLog("Tentando iniciar o launcher diretamente.");
                        Process.Start(new ProcessStartInfo
                        {
                            FileName = _targetPath,
                            Arguments = "--updated",
                            WorkingDirectory = Path.GetDirectoryName(_targetPath) ?? Environment.CurrentDirectory,
                            UseShellExecute = true
                        });
                    }
                    catch (Exception ex)
                    {
                        WriteLog("Falha ao iniciar diretamente: " + ex.Message);
                    }
                }

                if (!fallbackStartAttempted && i >= 25 && !IsLauncherRunning())
                {
                    fallbackStartAttempted = true;

                    try
                    {
                        WriteLog("Usando inicialização alternativa pelo Windows.");
                        string command = "/C start \"\" \"" + _targetPath + "\" --updated";
                        Process.Start(new ProcessStartInfo
                        {
                            FileName = "cmd.exe",
                            Arguments = command,
                            WorkingDirectory = Path.GetDirectoryName(_targetPath) ?? Environment.CurrentDirectory,
                            WindowStyle = ProcessWindowStyle.Hidden,
                            CreateNoWindow = true,
                            UseShellExecute = false
                        });
                    }
                    catch (Exception ex)
                    {
                        WriteLog("Falha na inicialização alternativa: " + ex.Message);
                    }
                }

                Thread.Sleep(400);
            }

            WriteLog("Tempo limite aguardando a janela principal do launcher.");
            return false;
        }

        private void SetStatus(string status, string detail)
        {
            if (InvokeRequired)
            {
                Invoke((MethodInvoker)delegate { SetStatus(status, detail); });
                return;
            }

            _headline.Text = "INSTALANDO ATUALIZAÇÃO";
            _status.Text = status;
            _detail.Text = detail;
            _percent.Text = "...";
            _percent.ForeColor = Color.FromArgb(0, 229, 255);
            Refresh();
        }

        private void SetFinalizingStatus(string status, string detail)
        {
            if (InvokeRequired)
            {
                Invoke((MethodInvoker)delegate { SetFinalizingStatus(status, detail); });
                return;
            }

            _animationTimer.Stop();
            _progressBar.Left = 0;
            _progressBar.Width = _progressTrack.Width;
            _progressBar.BackColor = Color.FromArgb(0, 229, 255);
            RoundControl(_progressBar, 5);
            _status.Text = status;
            _percent.Text = "100%";
            _percent.ForeColor = Color.FromArgb(92, 255, 183);
            _detail.Text = detail;
            _headline.Text = "FINALIZANDO ATUALIZAÇÃO";

            _stageInstall.BackColor = Color.FromArgb(12, 50, 48);
            _stageInstallTitle.Text = "✓  INSTALAÇÃO CONCLUÍDA";
            _stageInstallTitle.ForeColor = Color.FromArgb(92, 255, 183);
            _stageInstallSub.Text = "Nova versão aplicada";
            _stageInstallSub.ForeColor = Color.FromArgb(120, 172, 158);

            _stageOpen.BackColor = Color.FromArgb(8, 53, 66);
            _stageOpenTitle.Text = "3  ABRINDO LAUNCHER";
            _stageOpenTitle.ForeColor = Color.FromArgb(125, 211, 252);
            _stageOpenSub.Text = "Aguardando janela principal";
            _stageOpenSub.ForeColor = Color.FromArgb(118, 156, 167);
            Refresh();
        }

        private void SetSuccessStatus(string status, string detail)
        {
            if (InvokeRequired)
            {
                Invoke((MethodInvoker)delegate { SetSuccessStatus(status, detail); });
                return;
            }

            _status.Text = status;
            _detail.Text = detail;
            _headline.Text = "ATUALIZAÇÃO CONCLUÍDA";
            _percent.Text = "100%";
            _percent.ForeColor = Color.FromArgb(92, 255, 183);

            _stageOpen.BackColor = Color.FromArgb(12, 50, 48);
            _stageOpenTitle.Text = "✓  LAUNCHER ABERTO";
            _stageOpenTitle.ForeColor = Color.FromArgb(92, 255, 183);
            _stageOpenSub.Text = "Nova versão iniciada";
            _stageOpenSub.ForeColor = Color.FromArgb(120, 172, 158);
            Refresh();
        }

        private void ShowError(string message)
        {
            if (InvokeRequired)
            {
                Invoke((MethodInvoker)delegate { ShowError(message); });
                return;
            }

            _animationTimer.Stop();
            _progressBar.Left = 0;
            _progressBar.Width = _progressTrack.Width;
            _progressBar.BackColor = Color.FromArgb(239, 68, 68);
            RoundControl(_progressBar, 5);
            _headline.Text = "FALHA NA ATUALIZAÇÃO";
            _status.Text = "Não foi possível concluir a instalação.";
            _percent.Text = "ERRO";
            _percent.ForeColor = Color.FromArgb(251, 113, 133);
            _detail.Text = message + Environment.NewLine + "Abra o HCRP Launcher novamente para tentar outra vez.";

            _stageInstall.BackColor = Color.FromArgb(54, 20, 27);
            _stageInstallTitle.Text = "!  INSTALAÇÃO INTERROMPIDA";
            _stageInstallTitle.ForeColor = Color.FromArgb(251, 113, 133);
            _stageInstallSub.Text = "Não foi possível concluir";
            _stageInstallSub.ForeColor = Color.FromArgb(159, 95, 108);

            _completed = true;
            Refresh();

            System.Windows.Forms.Timer closeTimer = new System.Windows.Forms.Timer();
            closeTimer.Interval = 6500;
            closeTimer.Tick += delegate
            {
                closeTimer.Stop();
                Close();
            };
            closeTimer.Start();
        }

        private void ScheduleSelfDelete()
        {
            try
            {
                string self = Application.ExecutablePath;
                string command = "/C ping 127.0.0.1 -n 3 > nul & del /f /q \"" + self + "\"";
                Process.Start(new ProcessStartInfo
                {
                    FileName = "cmd.exe",
                    Arguments = command,
                    WindowStyle = ProcessWindowStyle.Hidden,
                    CreateNoWindow = true,
                    UseShellExecute = false
                });
            }
            catch
            {
            }
        }

        private static string FormatDisplayVersion(string value)
        {
            string clean = (value ?? string.Empty).Trim();
            if (clean.StartsWith("v", StringComparison.OrdinalIgnoreCase))
                clean = clean.Substring(1);

            if (clean.Length == 0)
                return string.Empty;

            string[] parts = clean.Split('.');
            int length = parts.Length;
            while (length > 2 && parts[length - 1] == "0")
                length--;

            return string.Join(".", parts, 0, length);
        }

        private static string GetArg(string[] args, string prefix)
        {
            foreach (string arg in args)
            {
                if (arg.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
                {
                    return arg.Substring(prefix.Length).Trim('"');
                }
            }

            return string.Empty;
        }
    }
}
