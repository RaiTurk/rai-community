param([Parameter(Mandatory=$true)][ValidateSet('prepare','join','recover','offer','withdraw','status','run')][string]$Command,[Parameter(ValueFromRemainingArguments=$true)][string[]]$NodeArguments)
$ErrorActionPreference = 'Stop'
$nodeExecutable = Get-Command node -ErrorAction Stop
if ([int]((& $nodeExecutable.Source --version).TrimStart('v').Split('.')[0]) -lt 24) { throw 'Node.js 24 or later is required.' }
$env:RAI_HC_BIN = Join-Path $PSScriptRoot 'bins/hc.exe'
$env:RAI_HOLOCHAIN_BIN = Join-Path $PSScriptRoot 'bins/holochain.exe'
$env:RAI_HAPP_PATH = Join-Path $PSScriptRoot 'rai-community.happ'
if (-not $env:RAI_NODE_DIR) { $env:RAI_NODE_DIR = Join-Path $PSScriptRoot 'runtime' }
$passwordWasSet = Test-Path Env:RAI_NODE_PASSWORD
$passwordPointer = [IntPtr]::Zero
try {
  if ($Command -ne 'prepare' -and -not $passwordWasSet) {
    $securePassword = Read-Host 'Private LOCAL node password, at least 12 characters (not the recovery code)' -AsSecureString
    $passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
    $env:RAI_NODE_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
  }
  & $nodeExecutable.Source (Join-Path $PSScriptRoot 'tools/rai-node.mjs') $Command @NodeArguments
  if ($LASTEXITCODE -ne 0) { throw 'Node command failed. Read the message above.' }
} finally {
  if (-not $passwordWasSet) { Remove-Item Env:RAI_NODE_PASSWORD -ErrorAction SilentlyContinue }
  if ($passwordPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer) }
}
