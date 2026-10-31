Unicode true
!include "MUI2.nsh"
!include "x64.nsh"
Name "SoundHub"
OutFile "..\dist\SoundHub-Setup-0.1.9.exe"
InstallDir "$LOCALAPPDATA\Programs\SoundHub"
RequestExecutionLevel user
CRCCheck force
SetCompressor /SOLID lzma
!define MUI_ICON "..\assets\icon.ico"
!define MUI_UNICON "..\assets\icon.ico"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN "$INSTDIR\SoundHub.exe"
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"
Function .onInit
 ${IfNot} ${RunningX64}
  MessageBox MB_ICONSTOP "This build requires 64-bit Windows."
  Abort
 ${EndIf}
 SetRegView 64
 ReadRegDWORD $0 HKLM "SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full" "Install"
 ${If} $0 != 1
  MessageBox MB_ICONSTOP "Install Microsoft .NET Framework 4 Full or later before installing. Vista SP2 supports up to .NET Framework 4.6. See the included compatibility guide."
  Abort
 ${EndIf}
 IfFileExists "$SYSDIR\ucrtbase.dll" ready
 MessageBox MB_ICONSTOP "Microsoft Universal CRT is required. Install the official Universal CRT update for this Windows version, then run Setup again."
 Abort
 ready:
FunctionEnd
Section "SoundHub"
 SetOutPath "$INSTDIR"
 File "out\SoundHub.exe"
 File "out\SoundHub.exe.config"
 File "out\curl.exe"
 File "out\curl-ca-bundle.crt"
 File "out\icon.ico"
 File "out\START-HERE.txt"
 File /r "out\licenses"
 WriteUninstaller "$INSTDIR\Uninstall.exe"
 CreateDirectory "$SMPROGRAMS\SoundHub"
 CreateShortcut "$SMPROGRAMS\SoundHub\SoundHub.lnk" "$INSTDIR\SoundHub.exe"
 CreateShortcut "$DESKTOP\SoundHub.lnk" "$INSTDIR\SoundHub.exe"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\SoundcloudDesktop" "DisplayName" "SoundHub"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\SoundcloudDesktop" "DisplayVersion" "0.1.9"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\SoundcloudDesktop" "UninstallString" '"$INSTDIR\Uninstall.exe"'
SectionEnd
Section "Uninstall"
 Delete "$INSTDIR\SoundHub.exe"
 Delete "$INSTDIR\SoundHub.exe.config"
 Delete "$INSTDIR\curl.exe"
 Delete "$INSTDIR\curl-ca-bundle.crt"
 Delete "$INSTDIR\icon.ico"
 Delete "$INSTDIR\START-HERE.txt"
 RMDir /r "$INSTDIR\licenses"
 Delete "$INSTDIR\Uninstall.exe"
 RMDir "$INSTDIR"
 Delete "$DESKTOP\SoundHub.lnk"
 Delete "$SMPROGRAMS\SoundHub\SoundHub.lnk"
 RMDir "$SMPROGRAMS\SoundHub"
 DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\SoundcloudDesktop"
SectionEnd
