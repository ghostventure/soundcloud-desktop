Unicode true
!include "MUI2.nsh"
!include "x64.nsh"
Name "Soundcloud Desktop"
OutFile "..\dist\Soundcloud-Desktop-Setup-0.1.4.exe"
InstallDir "$LOCALAPPDATA\Programs\Soundcloud Desktop"
RequestExecutionLevel user
CRCCheck force
SetCompressor /SOLID lzma
!define MUI_ICON "..\assets\icon.ico"
!define MUI_UNICON "..\assets\icon.ico"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN "$INSTDIR\Soundcloud Desktop.exe"
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
Section "Soundcloud Desktop"
 SetOutPath "$INSTDIR"
 File "out\Soundcloud Desktop.exe"
 File "out\Soundcloud Desktop.exe.config"
 File "out\curl.exe"
 File "out\curl-ca-bundle.crt"
 File "out\icon.ico"
 File "out\START-HERE.txt"
 File /r "out\licenses"
 WriteUninstaller "$INSTDIR\Uninstall.exe"
 CreateDirectory "$SMPROGRAMS\Soundcloud Desktop"
 CreateShortcut "$SMPROGRAMS\Soundcloud Desktop\Soundcloud Desktop.lnk" "$INSTDIR\Soundcloud Desktop.exe"
 CreateShortcut "$DESKTOP\Soundcloud Desktop.lnk" "$INSTDIR\Soundcloud Desktop.exe"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\SoundcloudDesktop" "DisplayName" "Soundcloud Desktop"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\SoundcloudDesktop" "DisplayVersion" "0.1.4"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\SoundcloudDesktop" "UninstallString" '"$INSTDIR\Uninstall.exe"'
SectionEnd
Section "Uninstall"
 Delete "$INSTDIR\Soundcloud Desktop.exe"
 Delete "$INSTDIR\Soundcloud Desktop.exe.config"
 Delete "$INSTDIR\curl.exe"
 Delete "$INSTDIR\curl-ca-bundle.crt"
 Delete "$INSTDIR\icon.ico"
 Delete "$INSTDIR\START-HERE.txt"
 RMDir /r "$INSTDIR\licenses"
 Delete "$INSTDIR\Uninstall.exe"
 RMDir "$INSTDIR"
 Delete "$DESKTOP\Soundcloud Desktop.lnk"
 Delete "$SMPROGRAMS\Soundcloud Desktop\Soundcloud Desktop.lnk"
 RMDir "$SMPROGRAMS\Soundcloud Desktop"
 DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\SoundcloudDesktop"
SectionEnd
