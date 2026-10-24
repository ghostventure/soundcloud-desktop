!include "x64.nsh"
!include "LogicLib.nsh"
!include "WinVer.nsh"
!include "nsDialogs.nsh"
!ifndef BUILD_UNINSTALLER
!include "${__FILEDIR__}\consent.nsh"
!endif

!define MUI_WELCOMEPAGE_TITLE "SC-DS Installation Manager"
!define MUI_WELCOMEPAGE_TEXT "Installs SC-DS 1.0.0. Setup contains the app and its runtime; no extra component choices are needed."

!ifndef BUILD_UNINSTALLER
Var CatalogDialog
Var CatalogText
Var CatalogContent
Var CatalogStatus
Var UpdateWindowsButton
Var SCMCheckVersion
Var SCMCheckTimestamp
Var SCMCheckCategories

!macro customInit
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "This installer needs a 64-bit Windows PC. You cannot continue on this computer."
    SetErrorLevel 5
    Abort
  ${EndIf}
  IfSilent SCMConsentSilentCheck SCMConsentInteractive
SCMConsentSilentCheck:
  ReadRegStr $SCMCheckVersion HKCU "Software\SC-DS\InstallationManager\Consent" "Version"
  ReadRegStr $SCMCheckTimestamp HKCU "Software\SC-DS\InstallationManager\Consent" "AcceptedAtLocal"
  ReadRegStr $SCMCheckCategories HKCU "Software\SC-DS\InstallationManager\Consent" "Categories"
  StrCmp $SCMCheckVersion "1.0.0" 0 SCMConsentSilentDenied
  StrCmp $SCMCheckTimestamp "" SCMConsentSilentDenied 0
  StrCmp $SCMCheckCategories "copyright-rights,legal-privacy,soundcloud-third-party-services,windows-runtime,service-network-use,soundcloud-supported-functions" 0 SCMConsentSilentDenied
  Goto SCMConsentSilentComplete
SCMConsentSilentDenied:
  SetErrorLevel 5
  MessageBox MB_ICONSTOP|MB_OK "Interactive confirmation is required before setup. Run this installer normally; no files were installed."
  Abort
SCMConsentSilentComplete:
SCMConsentInteractive:
!macroend

!macro customPageAfterChangeDir
  Page custom SCManagerCatalogPage SCManagerCatalogLeave
  Page custom SCManagerConsentPage SCManagerConsentLeave
!macroend

Function SCManagerCatalogPage
  nsDialogs::Create 1018
  Pop $CatalogDialog
  ${If} $CatalogDialog == error
    Abort
  ${EndIf}
  ${NSD_CreateLabel} 0 0 100% 30u "Review what is included. The desktop app installs automatically."
  Pop $CatalogStatus
  nsDialogs::CreateControl "EDIT" "${WS_CHILD}|${WS_VISIBLE}|${WS_VSCROLL}|${ES_MULTILINE}|${ES_READONLY}|${ES_AUTOVSCROLL}" "${WS_EX_CLIENTEDGE}" 0 34u 100% 242u ""
  Pop $CatalogText
  StrCpy $CatalogContent ""
  StrCpy $CatalogContent "$CatalogContent$\r$\nSOUNDCLOUD FEATURES INCLUDED"
  StrCpy $CatalogContent "$CatalogContent$\r$\nActivity feed: On-demand and read-only."
  StrCpy $CatalogContent "$CatalogContent$\r$\nComments review: Loads comments only for a track you select."
  StrCpy $CatalogContent "$CatalogContent$\r$\nFollowed artists' tracks: On-demand snapshot."
  StrCpy $CatalogContent "$CatalogContent$\r$\nCatalog sync/uploads: Uses your SoundCloud app credentials."
  StrCpy $CatalogContent "$CatalogContent$\r$\nMetrics, milestones, CSV: Saved snapshots, not live analytics."
  StrCpy $CatalogContent "$CatalogContent$\r$\nNOT AVAILABLE THROUGH SOUNDCLOUD'S PUBLIC API"
  StrCpy $CatalogContent "$CatalogContent$\r$\nTeam inbox/messages: No public API inbox resource."
  StrCpy $CatalogContent "$CatalogContent$\r$\nProcessing status: Public Track schema has no state field."
  StrCpy $CatalogContent "$CatalogContent$\r$\nAPP AND WINDOWS REQUIREMENTS"
  StrCpy $CatalogContent "$CatalogContent$\r$\nElectron 44.3.0: Chromium and Node.js bundled."
  StrCpy $CatalogContent "$CatalogContent$\r$\nWindows services: DPAPI, network, notifications, dialogs; no .NET, WebView2, or VC++ runtime."
  StrCpy $CatalogContent "$CatalogContent$\r$\nWindows 10/11 x64: Required. Older PCs get Windows Update and retry guidance."
  StrCpy $CatalogContent "$CatalogContent$\r$\nInternet and default browser: For online features and sign-in; not needed to install or open the app."
  ${NSD_SetText} $CatalogText $CatalogContent
  ${NSD_CreateButton} 0 282u 150u 18u "Open Windows Update"
  Pop $UpdateWindowsButton
  ${NSD_OnClick} $UpdateWindowsButton SCManagerOpenWindowsUpdate
  ${If} ${AtLeastWin10}
    ShowWindow $UpdateWindowsButton ${SW_HIDE}
  ${Else}
    ${NSD_SetText} $CatalogStatus "This PC needs Windows 10 or 11. Open Windows Update, update Windows, then return and retry setup."
  ${EndIf}
  nsDialogs::Show
FunctionEnd

Function SCManagerCatalogLeave
  ${IfNot} ${AtLeastWin10}
    MessageBox MB_ICONEXCLAMATION|MB_OK "Setup is paused because this PC does not meet the Windows requirement. Update to Windows 10 or 11 and retry setup."
    Abort
  ${EndIf}
FunctionEnd

Function SCManagerOpenWindowsUpdate
  ClearErrors
  ExecShell "open" "ms-settings:windowsupdate"
  IfErrors 0 +2
  ExecShell "open" "https://www.microsoft.com/software-download/windows10"
FunctionEnd
!endif