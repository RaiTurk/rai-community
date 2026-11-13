@echo off
rem Rai Community 0.4.0 Windows paketini uretir: yeni DNA (0.4 agi, 0.3.x ile konusmaz), arayuz ve kurulum dosyasi.
rem Sistemde Node.js yoksa Kangaroo'nun Electron'u Node modunda kullanilir.
setlocal EnableDelayedExpansion
cd /d "%~dp0"
set "LOG=%~dp0build-0.4.0.log"
echo [start] %date% %time% > "%LOG%"
set "SHIM=%~dp0tools\electron-node-shim.cjs"
set "SHIM=%SHIM:\=/%"
set "NODE=node"
where node >> "%LOG%" 2>&1 || (
  set "NODE=%~dp0..\..\2026-11-clerkship-feedback\code\.tooling\kangaroo\node_modules\electron\dist\electron.exe"
  set "ELECTRON_RUN_AS_NODE=1"
  set "ELECTRON_NO_ASAR=1"
  set "NODE_OPTIONS=--require "!SHIM!""
  echo [info] node yok, Electron node modunda kullaniliyor >> "%LOG%"
)
"%NODE%" -v >> "%LOG%" 2>&1 || goto fail
echo [step] wasm, dna, happ, typescript, ui, webhapp >> "%LOG%"
"%NODE%" tools\build.mjs >> "%LOG%" 2>&1 || goto fail
certutil -hashfile workdir\rai-community.happ SHA256 >> "%LOG%" 2>&1
echo [step] unit tests >> "%LOG%"
"%NODE%" --test tests\core.test.mjs tests\hosting-clock.test.mjs tests\x-account.test.mjs tests\v030.test.mjs tests\community-settings.test.mjs tests\v040.test.mjs >> "%LOG%" 2>&1 || goto fail
echo [step] windows installer >> "%LOG%"
"%NODE%" tools\package-windows.mjs >> "%LOG%" 2>&1 || goto fail
echo [done] %date% %time% >> "%LOG%"
echo.
echo Rai Community 0.4.0 kurulum dosyasi hazir: dist\org.raicommunity.next-0.4.0-setup.exe
pause
exit /b 0
:fail
echo [fail] %date% %time% >> "%LOG%"
echo.
echo Derleme durdu. Ayrinti: build-0.4.0.log
pause
exit /b 1
