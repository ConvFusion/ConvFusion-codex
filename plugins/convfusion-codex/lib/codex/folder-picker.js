import { execFile } from 'node:child_process';
import { join as joinPickerPath } from 'node:path';
import { promisify } from 'node:util';
const run = promisify(execFile);
const macPicker = `
ObjC.import('AppKit')
function run() {
  const app = $.NSApplication.sharedApplication
  app.setActivationPolicy(Number($.NSApplicationActivationPolicyAccessory))
  const panel = $.NSOpenPanel.openPanel
  panel.title = 'ConvFusion'
  panel.canChooseFiles = false
  panel.canChooseDirectories = true
  panel.canCreateDirectories = true
  app.activateIgnoringOtherApps(true)
  return Number(panel.runModal) === Number($.NSModalResponseOK) ? ObjC.unwrap(panel.URL.path) : ''
}
`;
const windowsPicker = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
try {
  $dialog.Description = 'ConvFusion'
  if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
    [Console]::WriteLine($dialog.SelectedPath)
  }
} finally {
  $dialog.Dispose()
}
`;
export async function pickDownloadFolder() {
    const choose = async (exe, args, cancelCode) => {
        try {
            const { stdout } = await run(exe, args, { timeout: 120_000, maxBuffer: 32_768, windowsHide: true });
            return stdout.replace(/\r?\n$/, '') || null;
        }
        catch (error) {
            if (cancelCode !== undefined && error.code === cancelCode)
                return null;
            throw error;
        }
    };
    if (process.platform === 'darwin')
        return choose('/usr/bin/osascript', ['-l', 'JavaScript', '-e', macPicker]);
    if (process.platform === 'win32') {
        const exe = joinPickerPath(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
        return choose(exe, ['-NoProfile', '-NonInteractive', '-STA', '-Command', windowsPicker]);
    }
    if (process.platform === 'linux' && (process.env.DISPLAY || process.env.WAYLAND_DISPLAY)) {
        try {
            return await choose('zenity', ['--file-selection', '--directory', '--title=ConvFusion'], 1);
        }
        catch (error) {
            if (error.code !== 'ENOENT')
                throw error;
            return choose('kdialog', ['--title', 'ConvFusion', '--getexistingdirectory'], 1);
        }
    }
    throw new Error('No local desktop folder picker is available');
}
//# sourceMappingURL=folder-picker.js.map