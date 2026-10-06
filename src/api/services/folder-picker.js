// The native "choose a folder" dialog, per OS. Resolves '' where there is none or the user
// cancelled: the caller falls back to a typed path, so a missing picker never blocks an export.
import { execFile } from 'node:child_process';

/** @param {string} prompt already-translated dialog text @returns {Promise<string>} */
export function pickFolder(prompt) {
  return new Promise((resolve) => {
    const done = (err, out) => resolve(err ? '' : String(out).trim());
    // Translated text lands inside a script: a quote in the catalogue would end the string early.
    if (process.platform === 'darwin') {
      execFile('osascript', ['-e', 'POSIX path of (choose folder with prompt "' + prompt.replace(/["\\]/g, '\\$&') + '")'], done);
    } else if (process.platform === 'win32') {
      execFile('powershell', ['-NoProfile', '-STA', '-Command',
        'Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.FolderBrowserDialog;'
        + ' $d.Description = "' + prompt.replace(/[`$"]/g, '`$&') + '"; if ($d.ShowDialog() -eq "OK") { $d.SelectedPath }'], done);
    } else {
      execFile('zenity', ['--file-selection', '--directory', '--title=' + prompt], done);
    }
  });
}
