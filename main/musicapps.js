'use strict';
// «Музыка для всех» → «Из программы»: список окон программ, включая свёрнутые.
// Список демонстрации (desktopCapturer) свёрнутые окна не видит, а браузер с музыкой во время игры или
// показа экрана обычно свёрнут. Поэтому окна перечисляем сами (EnumWindows) и сразу отдаём PID программы.
const { execFile } = require('child_process');

const SCRIPT = String.raw`
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -TypeDefinition @"
using System; using System.Collections.Generic; using System.Runtime.InteropServices; using System.Text;
public static class SkhMusicWin {
  delegate bool EP(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EP f, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint c);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int a, out int v, int s);
  public static List<string> List() {
    var r = new List<string>();
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h) || GetWindow(h, 4) != IntPtr.Zero) return true;   // невидимые и подчинённые окна
      if ((GetWindowLong(h, -20) & 0x80) != 0) return true;                     // WS_EX_TOOLWINDOW
      int c; if (DwmGetWindowAttribute(h, 14, out c, 4) == 0 && c != 0) return true; // скрытые системой (фоновые UWP)
      var sb = new StringBuilder(512); GetWindowText(h, sb, 512); if (sb.Length == 0) return true;
      uint p; GetWindowThreadProcessId(h, out p);
      r.Add(p + "\t" + (IsIconic(h) ? "1" : "0") + "\t" + sb.ToString().Replace("\t", " "));
      return true;
    }, IntPtr.Zero);
    return r;
  }
}
"@
$out = foreach ($l in [SkhMusicWin]::List()) {
  $a = $l -split "\t", 3
  $pr = Get-Process -Id ([int]$a[0]) -ErrorAction SilentlyContinue
  [pscustomobject]@{ pid = [int]$a[0]; min = ($a[1] -eq '1'); title = $a[2]; name = $(if ($pr) { $pr.ProcessName } else { '' }); path = $(if ($pr) { $pr.Path } else { '' }) }
}
[Console]::Out.Write((ConvertTo-Json -Compress -InputObject @($out)))
`;

const SKIP = /^(Program Manager|Интерфейс ввода Windows|Windows Input Experience)$/i;

module.exports = function setupMusicApps({ ipcMain, app, log }) {
  const icons = new Map(); // путь программы → значок (data:)
  const iconOf = async (p) => {
    if (!p) return null;
    if (icons.has(p)) return icons.get(p);
    let url = null;
    try { const img = await app.getFileIcon(p, { size: 'small' }); if (img && !img.isEmpty()) url = img.toDataURL(); } catch (_) { /* без значка */ }
    icons.set(p, url);
    return url;
  };

  ipcMain.handle('music:apps', async () => {
    if (process.platform !== 'win32') return { ok: false, reason: 'только в Windows' };
    const encoded = Buffer.from(SCRIPT, 'utf16le').toString('base64');
    const raw = await new Promise((resolve) => {
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
        { windowsHide: true, timeout: 15000, maxBuffer: 4 * 1024 * 1024 }, (err, out) => resolve(err ? { err } : { out: String(out || '') }));
    });
    if (raw.err) { log('warn', 'music', `Список окон для музыки не получен: ${raw.err.message.split('\n')[0]}`); return { ok: false, reason: 'не удалось получить список окон' }; }
    let list = [];
    try { list = JSON.parse(raw.out.trim() || '[]'); } catch (e) { log('warn', 'music', `Список окон для музыки не разобран: ${e.message}`); return { ok: false, reason: 'не удалось получить список окон' }; }
    if (!Array.isArray(list)) list = [list];
    const apps = [];
    for (const w of list) {
      if (!w || !w.pid || w.pid === process.pid || !w.title || SKIP.test(w.title) || /^skhodka$/i.test(w.name || '')) continue;
      apps.push({ pid: w.pid, name: String(w.title), proc: String(w.name || ''), min: !!w.min, icon: await iconOf(w.path) });
    }
    return { ok: true, apps };
  });
};
