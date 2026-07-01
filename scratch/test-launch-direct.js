import { exec } from "child_process";
import { promisify } from "util";
const execAsync = promisify(exec);

async function run() {
  // Kill notepad first
  try { await execAsync("taskkill /f /im notepad.exe"); } catch {}
  await new Promise(r => setTimeout(r, 500));

  try {
    console.log("Testing launch of notepad via start explorer.exe...");
    const { stdout } = await execAsync('where.exe notepad');
    const notepadPath = stdout.split(/\r?\n/)[0].trim();
    console.log("Resolved notepad path:", notepadPath);

    // Launch via start explorer.exe
    await execAsync(`start explorer.exe "${notepadPath}"`);
    console.log("Start explorer command executed.");

    console.log("Waiting 3 seconds for window to fully initialize...");
    await new Promise(r => setTimeout(r, 3000));
    
    // Check notepad window handle
    const { stdout: checkOut } = await execAsync('powershell -NoProfile -Command "Get-Process notepad -ErrorAction SilentlyContinue | Select-Object Id, SessionId, MainWindowTitle, MainWindowHandle | ConvertTo-Json"');
    console.log("Check result:");
    console.log(checkOut.trim());
  } catch (err) {
    console.error("Test failed:", err);
  }
}

run();
