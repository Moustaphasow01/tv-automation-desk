#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";

const args = process.argv.slice(2);
const renderOnly = args.includes("--render-only");
const positional = args.filter((value) => !value.startsWith("--"));
const sourcePath = positional[0] || "/mnt/c/Users/CES/Desktop/TV_Automation/.env";
const host = positional[1] || "Administrator@145.239.73.250";
const keyPath = positional[2] || "/home/u01i003/.ssh/tv-desk-ovh-2026";
const values = parseEnv(await readFile(sourcePath, "utf8"));
const required = [
  "TELEGRAM_ADMIN_BOT_TOKEN",
  "TELEGRAM_ADMIN_CHAT_ID",
  "TELEGRAM_ALERT_BOT_TOKEN",
  "TELEGRAM_ALERT_CHAT_ID",
];
for (const key of required) {
  if (!values[key]) throw new Error(`telegram_source_secret_missing:${key}`);
}
if (values.TELEGRAM_ADMIN_BOT_TOKEN === values.TELEGRAM_ALERT_BOT_TOKEN) {
  throw new Error("telegram_profiles_must_use_distinct_bots");
}

const encoded = Object.fromEntries(required.map((key) => [
  key,
  Buffer.from(values[key], "utf8").toString("base64"),
]));
const updates = {
  ...encoded,
  DESK_TELEGRAM_ENABLED: Buffer.from("false", "utf8").toString("base64"),
  DESK_TELEGRAM_COMMANDS_ENABLED: Buffer.from("true", "utf8").toString("base64"),
  DESK_TELEGRAM_POLL_MS: Buffer.from("5000", "utf8").toString("base64"),
  TELEGRAM_LEGACY_FALLBACK: Buffer.from("false", "utf8").toString("base64"),
};
const script = [
  "$ErrorActionPreference = 'Stop'",
  "$envFile = 'C:\\ProgramData\\DeskFutures\\config\\desk.env'",
  ...Object.entries(updates).map(([key, value]) => [
    `$Name = '${key}'; $Value = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${value}')); $content = Get-Content -LiteralPath $envFile -Raw; `,
    `$pattern = '(?m)^' + [regex]::Escape($Name) + '=.*$'; `,
    `if ($content -match $pattern) { $content = [regex]::Replace($content, $pattern, ($Name + '=' + $Value)) } else { $content = $content.TrimEnd() + "\`r\`n" + $Name + '=' + $Value + "\`r\`n" }; `,
    `[IO.File]::WriteAllText($envFile, $content, [Text.UTF8Encoding]::new($false))`,
  ].join("")),
  "& icacls.exe $envFile /inheritance:r /grant:r 'SYSTEM:(F)' 'Administrators:(F)' | Out-Null",
  "if ($LASTEXITCODE -ne 0) { throw 'telegram_env_acl_failed' }",
  "Write-Output 'telegram_secrets_transferred=4'",
  "Write-Output 'telegram_initial_state=disabled'",
].join("\r\n") + "\r\n";

if (renderOnly) {
  await new Promise((resolve, reject) => {
    process.stdout.write(script, (error) => error ? reject(error) : resolve());
  });
  process.exit(0);
}

const child = spawn("ssh", [
  "-i", keyPath,
  "-o", "BatchMode=yes",
  "-o", "StrictHostKeyChecking=yes",
  host,
  "powershell.exe -NoLogo -NoProfile -NonInteractive -Command -",
], { stdio: ["pipe", "pipe", "pipe"] });
child.stdin.end(script);
const stdout = [];
const stderr = [];
child.stdout.on("data", (chunk) => stdout.push(chunk));
child.stderr.on("data", (chunk) => stderr.push(chunk));
const exitCode = await new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("close", resolve);
});
if (exitCode !== 0) {
  throw new Error(`telegram_secret_transfer_failed:${Buffer.concat(stderr).toString("utf8").trim() || exitCode}`);
}
process.stdout.write(Buffer.concat(stdout));

function parseEnv(content) {
  const result = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}
