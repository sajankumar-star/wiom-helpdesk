/**
 * WIOM IT Helpdesk — Laptop Auto-Fix Agent v1.0.0
 * Runs on employee Windows laptops. Polls server every 30s for fix jobs.
 *
 * Setup: Run setup.bat once, then this starts automatically on Windows login.
 */

const https  = require('https');
const http   = require('http');
const { exec } = require('child_process');
const fs     = require('fs');
const path   = require('path');

// ── Load config ───────────────────────────────────────────────────────────────
const CONFIG_PATH = path.join(__dirname, 'config.json');
let config = {};
try {
  config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
} catch {
  console.error('❌ config.json not found! Run setup.bat first.');
  process.exit(1);
}

const { SERVER_URL, AGENT_SECRET, LAPTOP_SN, EMP_ID } = config;
const AGENT_VERSION  = '1.0.0';
const POLL_INTERVAL  = 30000; // 30 seconds
let isProcessing     = false;

// ── HTTP helper ───────────────────────────────────────────────────────────────
const apiRequest = (method, urlPath, body = null) => {
  return new Promise((resolve, reject) => {
    try {
      const url     = new URL(SERVER_URL + urlPath);
      const lib     = url.protocol === 'https:' ? https : http;
      const options = {
        hostname: url.hostname,
        port    : url.port || (url.protocol === 'https:' ? 443 : 80),
        path    : url.pathname + url.search,
        method,
        headers : {
          'x-agent-key'  : AGENT_SECRET,
          'Content-Type' : 'application/json'
        },
        timeout: 15000
      };

      const req = lib.request(options, res => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch { resolve({ raw: data }); }
        });
      });

      req.on('error',   reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });

      if (body) req.write(JSON.stringify(body));
      req.end();
    } catch (err) {
      reject(err);
    }
  });
};

// ── PowerShell runner ─────────────────────────────────────────────────────────
const runPS = (command, timeoutMs = 60000) => {
  return new Promise(resolve => {
    // Escape the command for cmd /c
    const escaped  = command.replace(/"/g, '\\"');
    const fullCmd  = `powershell -NonInteractive -NoProfile -Command "${escaped}"`;
    exec(fullCmd, { timeout: timeoutMs, shell: 'cmd.exe', windowsHide: true }, (err, stdout, stderr) => {
      resolve({
        ok    : !err,
        output: (stdout || '').trim(),
        error : (stderr || err?.message || '').trim()
      });
    });
  });
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Fix Implementations ───────────────────────────────────────────────────────
const fixes = {

  // Kill heavy CPU processes + clear basic temp
  kill_heavy: async () => {
    const killResult = await runPS(
      `$safe = 'svchost','System','Idle','Registry','smss','csrss','wininit','services','lsass','winlogon','dwm','explorer','SearchHost','ShellExperienceHost','StartMenuExperienceHost','RuntimeBroker';` +
      `$killed = 0; $names = '';` +
      `Get-Process | Where-Object {$_.Name -notin $safe -and $_.CPU -gt 5} | Sort-Object CPU -Descending | Select-Object -First 5 | ForEach-Object {` +
      `  try { $names += $_.Name + ', '; Stop-Process -Id $_.Id -Force -ErrorAction Stop; $killed++ } catch {}` +
      `};` +
      `Write-Output "$killed processes closed: $($names.TrimEnd(', '))"`
    );
    await runPS(`Remove-Item "$env:TEMP\\*" -Recurse -Force -ErrorAction SilentlyContinue`);
    const output = killResult.output || 'Heavy processes closed';
    return {
      ok    : true,
      result: `${output}. Temp files cleared! ✅`,
      summary: 'Killed heavy processes, cleared temp files'
    };
  },

  // Deep temp + recycle bin cleanup
  clean_temp: async () => {
    await runPS(`Remove-Item "$env:TEMP\\*" -Recurse -Force -ErrorAction SilentlyContinue`);
    await runPS(`Remove-Item "C:\\Windows\\Temp\\*" -Recurse -Force -ErrorAction SilentlyContinue`);
    await runPS(`Clear-RecycleBin -Force -ErrorAction SilentlyContinue`);
    const diskResult = await runPS(`[math]::Round((Get-PSDrive C).Free/1GB, 2)`);
    const freeGB = diskResult.output || '?';
    return {
      ok    : true,
      result: `Temp files + Recycle Bin cleared! C: drive free space: *${freeGB} GB* ✅`,
      summary: `Freed space, C: now has ${freeGB}GB free`
    };
  },

  // Reset WiFi adapter (disable → enable)
  fix_wifi: async () => {
    const adapterResult = await runPS(
      `(Get-NetAdapter | Where-Object {$_.InterfaceDescription -match 'Wi-Fi|Wireless|WLAN|802.11'} | Select-Object -First 1).Name`
    );
    const adapterName = adapterResult.output || 'Wi-Fi';
    await runPS(`Disable-NetAdapter -Name "${adapterName}" -Confirm:$false -ErrorAction SilentlyContinue`);
    await sleep(3000);
    await runPS(`Enable-NetAdapter -Name "${adapterName}" -Confirm:$false -ErrorAction SilentlyContinue`);
    await sleep(2000);
    // Check if connected
    const pingResult = await runPS(`Test-Connection 8.8.8.8 -Count 1 -Quiet`);
    const connected  = pingResult.output?.toLowerCase() === 'true';
    return {
      ok    : true,
      result: connected
        ? `WiFi adapter "*${adapterName}*" reset ho gaya! Internet connected ✅`
        : `WiFi adapter "*${adapterName}*" reset ho gaya! ✅ Ab apna WiFi network select karo aur reconnect karo.`,
      summary: `WiFi adapter ${adapterName} reset`
    };
  },

  // Clear Teams cache
  fix_teams: async () => {
    await runPS(`Stop-Process -Name 'Teams' -Force -ErrorAction SilentlyContinue`);
    await sleep(2000);
    const cacheResult = await runPS(
      `$base = "$env:APPDATA\\Microsoft\\Teams";` +
      `@('Cache','blob_storage','databases','GPUCache','IndexedDB','Local Storage','tmp') | ForEach-Object {` +
      `  $p = "$base\\$_"; if(Test-Path $p){Remove-Item "$p\\*" -Recurse -Force -ErrorAction SilentlyContinue}` +
      `};` +
      `Write-Output 'Teams cache cleared'`
    );
    return {
      ok    : true,
      result: `Teams cache clear ho gaya! ✅ Dobara Teams open karo — fresh start milega, calls/messages normal honge.`,
      summary: 'Killed Teams, cleared cache'
    };
  },

  // Restart Outlook in safe mode
  fix_outlook: async () => {
    await runPS(`Stop-Process -Name 'OUTLOOK' -Force -ErrorAction SilentlyContinue`);
    await sleep(2000);
    await runPS(`Start-Process -FilePath 'outlook.exe' -ArgumentList '/safe' -ErrorAction SilentlyContinue`);
    return {
      ok    : true,
      result: `Outlook restart ho gaya Safe Mode mein! ✅ Agar email aa rahe hain toh close karke normally dobara kholo.`,
      summary: 'Restarted Outlook in safe mode'
    };
  },

  // Restart clipboard (copy-paste fix)
  fix_clipboard: async () => {
    await runPS(`Stop-Process -Name 'rdpclip' -Force -ErrorAction SilentlyContinue`);
    await sleep(1000);
    await runPS(`Start-Process -FilePath 'rdpclip.exe' -ErrorAction SilentlyContinue`);
    return {
      ok    : true,
      result: `Clipboard service restart ho gaya! ✅ Ab Ctrl+C → Ctrl+V try karo — kaam karna chahiye.`,
      summary: 'Restarted rdpclip (clipboard service)'
    };
  },

  // Restart Windows Audio service
  fix_sound: async () => {
    await runPS(`Restart-Service -Name 'AudioSrv' -Force -ErrorAction SilentlyContinue`);
    await sleep(1000);
    await runPS(`Restart-Service -Name 'AudioEndpointBuilder' -Force -ErrorAction SilentlyContinue`);
    return {
      ok    : true,
      result: `Audio service restart ho gaya! ✅ Sound aana chahiye ab. Agar nahi aaya toh volume check karo.`,
      summary: 'Restarted Windows Audio services'
    };
  },

  // Sync Windows time
  fix_datetime: async () => {
    await runPS(`w32tm /resync /force`);
    const timeResult = await runPS(`Get-Date -Format 'dd MMM yyyy, HH:mm'`);
    return {
      ok    : true,
      result: `Date/Time sync ho gaya! ✅ Current time: *${timeResult.output || 'synced'}* (IST)`,
      summary: 'Windows time synced via w32tm'
    };
  },

  // Open Lenovo Vantage diagnostics
  run_lenovo_diag: async () => {
    const paths = [
      'C:\\Program Files\\Lenovo\\VantageService\\LenovoVantage.exe',
      'C:\\Program Files (x86)\\Lenovo\\VantageService\\LenovoVantage.exe',
      'C:\\Program Files\\WindowsApps\\E046963F.LenovoCompanion_10.2404.5.0_x64__k1h2ywk1493x8\\App\\LenovoVantage.exe'
    ];
    let opened = false;
    for (const p of paths) {
      const check = await runPS(`Test-Path '${p.replace(/'/g, "''")}'`);
      if (check.output?.trim().toLowerCase() === 'true') {
        await runPS(`Start-Process '${p.replace(/'/g, "''")}'`);
        opened = true;
        break;
      }
    }
    if (!opened) {
      const uriResult = await runPS(`Start-Process 'lenovovantage:' -ErrorAction SilentlyContinue; Write-Output 'ok'`);
      opened = !!uriResult.ok;
    }
    const sn = await runPS(`(Get-CimInstance Win32_BIOS).SerialNumber`);
    return {
      ok     : true,
      result : opened
        ? `✅ Lenovo Vantage khul gaya! *Hardware Settings → Diagnostics → Run All* click karo. Serial: \`${sn.output || 'N/A'}\``
        : `⚠️ Lenovo Vantage install nahi hai. Microsoft Store se install karo. Serial: \`${sn.output || 'N/A'}\``,
      summary: 'Opened Lenovo Vantage diagnostics'
    };
  },

  // Open HP diagnostics
  run_hp_diag: async () => {
    const paths = [
      'C:\\Program Files (x86)\\HP\\HP PC Hardware Diagnostics Windows\\HPDiagnosticsWindows.exe',
      'C:\\Program Files\\HP\\HP PC Hardware Diagnostics Windows\\HPDiagnosticsWindows.exe',
      'C:\\Program Files (x86)\\HP\\HP Support Framework\\HPSF.exe',
      'C:\\Program Files\\HP\\HP Support Framework\\HPSF.exe'
    ];
    let opened = false;
    for (const p of paths) {
      const check = await runPS(`Test-Path '${p.replace(/'/g, "''")}'`);
      if (check.output?.trim().toLowerCase() === 'true') {
        await runPS(`Start-Process '${p.replace(/'/g, "''")}'`);
        opened = true;
        break;
      }
    }
    if (!opened) {
      await runPS(`Start-Process 'https://support.hp.com/us-en/checkwarranty'`);
    }
    const sn = await runPS(`(Get-CimInstance Win32_BIOS).SerialNumber`);
    return {
      ok     : true,
      result : opened
        ? `✅ HP Diagnostics tool khul gaya! *Run All Tests* select karo. Serial: \`${sn.output || 'N/A'}\``
        : `⚠️ HP Diagnostics app nahi mili — HP warranty page browser mein khula. Serial: \`${sn.output || 'N/A'}\``,
      summary: 'Opened HP Hardware Diagnostics'
    };
  },

  // Open Dell SupportAssist diagnostics
  run_dell_diag: async () => {
    const paths = [
      'C:\\Program Files\\Dell\\SupportAssistAgent\\bin\\SupportAssist.exe',
      'C:\\Program Files (x86)\\Dell\\SupportAssistAgent\\bin\\SupportAssist.exe',
      'C:\\Program Files\\Dell\\SupportAssist\\pcdrstarter.exe'
    ];
    let opened = false;
    for (const p of paths) {
      const check = await runPS(`Test-Path '${p.replace(/'/g, "''")}'`);
      if (check.output?.trim().toLowerCase() === 'true') {
        await runPS(`Start-Process '${p.replace(/'/g, "''")}'`);
        opened = true;
        break;
      }
    }
    if (!opened) {
      const sn = await runPS(`(Get-CimInstance Win32_BIOS).SerialNumber`);
      await runPS(`Start-Process 'https://www.dell.com/support/home/?s=BSD&ServiceTag=${(sn.output||'').trim()}'`);
    }
    const sn = await runPS(`(Get-CimInstance Win32_BIOS).SerialNumber`);
    return {
      ok     : true,
      result : opened
        ? `✅ Dell SupportAssist khul gaya! *Run Hardware Test* click karo. Service Tag: \`${sn.output || 'N/A'}\``
        : `⚠️ Dell SupportAssist nahi mila — Dell support page browser mein khula. Service Tag: \`${sn.output || 'N/A'}\``,
      summary: 'Opened Dell SupportAssist diagnostics'
    };
  },

  // Disk cleanup
  clean_disk: async () => {
    // Set cleanup flags for drive C
    await runPS(
      `$key = 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\VolumeCaches';` +
      `@('Temporary Files','Recycle Bin','Temporary Internet Files','Thumbnails') | ForEach-Object {` +
      `  $p = "$key\\$_"; if(Test-Path $p){ Set-ItemProperty -Path $p -Name StateFlags0001 -Value 2 -Type DWord -ErrorAction SilentlyContinue }` +
      `}`
    );
    // Run cleanmgr in quiet mode
    await runPS(`Start-Process -FilePath cleanmgr.exe -ArgumentList '/sagerun:1' -Wait -ErrorAction SilentlyContinue`, 120000);
    await runPS(`Remove-Item "$env:TEMP\\*" -Recurse -Force -ErrorAction SilentlyContinue`);
    await runPS(`Clear-RecycleBin -Force -ErrorAction SilentlyContinue`);
    const diskResult = await runPS(`[math]::Round((Get-PSDrive C).Free/1GB, 2)`);
    return {
      ok    : true,
      result: `Disk cleanup complete! ✅ C: drive free space: *${diskResult.output || '?'} GB*`,
      summary: `Disk cleaned, C: has ${diskResult.output}GB free`
    };
  }

};

// ── Process a single job ──────────────────────────────────────────────────────
const processJob = async (job) => {
  console.log(`\n🔧 Job received: ${job._id}`);
  console.log(`   Fix types: ${job.fixType.join(', ')}`);
  console.log(`   Label: ${job.fixLabel}`);

  let combinedResult = '';
  let allOk = true;
  let combinedSummary = [];

  for (const fixType of job.fixType) {
    const fixFn = fixes[fixType];
    if (!fixFn) {
      console.warn(`   ⚠️  Unknown fix type: ${fixType}`);
      continue;
    }
    try {
      console.log(`   Running: ${fixType}...`);
      const { ok, result, summary } = await fixFn();
      combinedResult  += result + '\n';
      combinedSummary.push(summary || fixType);
      if (!ok) allOk = false;
      console.log(`   ✅ ${fixType}: ${result.substring(0, 60)}`);
    } catch (err) {
      console.error(`   ❌ ${fixType} error:`, err.message);
      combinedResult += `${fixType}: ${err.message}\n`;
      allOk = false;
    }
  }

  const finalResult  = combinedResult.trim() || (allOk ? 'Fix complete!' : 'Fix mein issue aaya');
  const finalSummary = combinedSummary.join(' | ');

  try {
    await apiRequest('POST', '/api/agent/result', {
      jobId  : job._id,
      status : allOk ? 'success' : 'failed',
      result : finalResult,
      details: { summary: finalSummary }
    });
    console.log(`\n✅ Job ${job._id} reported → ${allOk ? 'success' : 'failed'}`);
  } catch (err) {
    console.error('❌ Could not report result:', err.message);
  }
};

// ── Poll loop ─────────────────────────────────────────────────────────────────
const poll = async () => {
  if (isProcessing) return; // skip if already running a fix
  try {
    const data = await apiRequest('GET', `/api/agent/poll?sn=${encodeURIComponent(LAPTOP_SN)}`);
    if (data.job) {
      isProcessing = true;
      await processJob(data.job);
      isProcessing = false;
    }
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Poll error:`, err.message);
  }
};

// ── Start ─────────────────────────────────────────────────────────────────────
const start = async () => {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║   WIOM IT Helpdesk — Auto-Fix Agent      ║');
  console.log(`║   v${AGENT_VERSION}                                 ║`);
  console.log('╚══════════════════════════════════════════╝');
  console.log(`\n📋 Laptop SN : ${LAPTOP_SN}`);
  console.log(`📋 Employee  : ${EMP_ID}`);
  console.log(`📋 Server    : ${SERVER_URL}`);
  console.log(`📋 Poll every: ${POLL_INTERVAL / 1000}s\n`);

  // Register with server
  try {
    const reg = await apiRequest('POST', '/api/agent/register', {
      laptopSN: LAPTOP_SN,
      empId   : EMP_ID,
      agentVersion: AGENT_VERSION
    });
    if (reg.ok) console.log('✅ Registered with IT Helpdesk server\n');
    else        console.warn('⚠️  Registration response:', reg);
  } catch (err) {
    console.error('❌ Registration failed:', err.message);
    console.log('   Will retry on next poll...\n');
  }

  // Start polling
  console.log('🔄 Polling for fix jobs...\n');
  setInterval(poll, POLL_INTERVAL);
  poll(); // immediate first poll
};

start();
