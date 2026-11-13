Unicode true
!include "MUI2.nsh"
Name "Rai Community ${VERSION}"
VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "Rai Community"
VIAddVersionKey "FileDescription" "Rai Community Windows Installer"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "Rai Community contributors"
OutFile "${INSTALLER}"
InstallDir "$LOCALAPPDATA\Programs\Rai Community WebView2"
RequestExecutionLevel user
SetCompressor /SOLID lzma
!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\RaiCommunityWebView2"
!define MUI_ICON "${APP_ICON}"
!define MUI_ABORTWARNING
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"
!insertmacro MUI_LANGUAGE "Turkish"

!macro RefreshShellIcon ITEM_PATH
  ; SHCNE_UPDATEITEM with a Unicode path and asynchronous shell delivery.
  System::Call 'shell32::SHChangeNotify(i 0x2000, i 0x2005, w "${ITEM_PATH}", p 0)'
!macroend

Section "Rai Community"
  SetShellVarContext current
  SetOutPath "$INSTDIR\app"
  File /r "${APP_FILES}\*"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  Delete "$SMPROGRAMS\Rai Community (WebView2).lnk"
  ; Use a new icon path so Explorer requests the new sizes on upgrade.
  CreateShortcut "$SMPROGRAMS\Rai Community.lnk" "$INSTDIR\app\RaiCommunity.exe" "" "$INSTDIR\app\rai-community-hidpi.ico" 0
  CreateShortcut "$DESKTOP\Rai Community.lnk" "$INSTDIR\app\RaiCommunity.exe" "" "$INSTDIR\app\rai-community-hidpi.ico" 0
  !insertmacro RefreshShellIcon "$SMPROGRAMS\Rai Community.lnk"
  !insertmacro RefreshShellIcon "$DESKTOP\Rai Community.lnk"
  !insertmacro RefreshShellIcon "$INSTDIR\app\RaiCommunity.exe"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayName" "Rai Community"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayIcon" "$INSTDIR\app\rai-community-hidpi.ico,0"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoRepair" 1
SectionEnd

Section "Uninstall"
  SetShellVarContext current
  Delete "$SMPROGRAMS\Rai Community (WebView2).lnk"
  Delete "$SMPROGRAMS\Rai Community.lnk"
  Delete "$DESKTOP\Rai Community.lnk"
  RMDir /r "$INSTDIR\app"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
  DeleteRegKey HKCU "${UNINSTALL_KEY}"
SectionEnd
