!include "nsDialogs.nsh"
!include "LogicLib.nsh"
!ifndef BUILD_UNINSTALLER

; Include this file from build/installer.nsh, then add:
; Page custom SCManagerConsentPage SCManagerConsentLeave
; immediately after the generated catalog page and before MUI_PAGE_INSTFILES.
!define SC_MANAGER_CONSENT_VERSION "1.0.0"
!define SC_MANAGER_CONSENT_KEY "Software\SC-DS\InstallationManager\Consent"

Var SCMConsentDialog
Var SCMConsentText
Var SCMConsentCheck
Var SCMConsentExisting
Var SCMConsentVerifyTimestamp
Var SCMConsentVerifyCategories
Var SCMConsentState
Var SCMConsentStamp
Var SCMConsentParts
Var SCMConsentPartYear
Var SCMConsentPartMonth
Var SCMConsentPartDay
Var SCMConsentPartHour
Var SCMConsentPartMinute
Var SCMConsentPartSecond
Var SCMConsentPartDayOfWeek
Var SCMConsentMillis

Function SCManagerConsentPage
  ReadRegStr $SCMConsentExisting HKCU "${SC_MANAGER_CONSENT_KEY}" "Version"
  ReadRegStr $SCMConsentVerifyTimestamp HKCU "${SC_MANAGER_CONSENT_KEY}" "AcceptedAtLocal"
  ReadRegStr $SCMConsentVerifyCategories HKCU "${SC_MANAGER_CONSENT_KEY}" "Categories"
  ${If} $SCMConsentExisting == "${SC_MANAGER_CONSENT_VERSION}"
  ${AndIf} $SCMConsentVerifyTimestamp != ""
  ${AndIf} $SCMConsentVerifyCategories == "copyright-rights,legal-privacy,soundcloud-third-party-services,windows-runtime,service-network-use,soundcloud-supported-functions"
    Abort
  ${EndIf}

  nsDialogs::Create 1018
  Pop $SCMConsentDialog
  ${If} $SCMConsentDialog == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 14u "Read these details, check the box to confirm, then select Install."
  Pop $0
  ; Keep the confirmation control near the top of the page so it stays clear
  ; of the wizard footer at high DPI and smaller display resolutions.
  ${NSD_CreateCheckbox} 0 18u 100% 32u "I have read and understand these notices, agree to continue, and may use content I upload."
  Pop $SCMConsentCheck
  ${NSD_OnClick} $SCMConsentCheck SCManagerConsentToggle

  nsDialogs::CreateControl "EDIT" "${WS_CHILD}|${WS_VISIBLE}|${WS_VSCROLL}|${ES_MULTILINE}|${ES_READONLY}|${ES_AUTOVSCROLL}" "${WS_EX_CLIENTEDGE}" 0 53u 100% 42u ""
  Pop $SCMConsentText
  StrCpy $0 "INDEPENDENT APP$\r$\nBlack Lion Studios supports SoundCloud. SC-DS is an independent product, currently not affiliated with or endorsed by SoundCloud; status may change.$\r$\n$\r$\nDMCA / COPYRIGHT$\r$\nUpload only content you own or may use. You are responsible for copyright/DMCA notices. No legal advice or protection.$\r$\n$\r$\n"
  StrCpy $0 "$0SOUNDCLOUD SERVICES$\r$\nAPI features: feed, comments, followed-artist tracks, catalog sync, uploads, metrics. Team inbox and processing status unavailable. SoundCloud terms apply. Sign-in opens browser; GitHub checks/downloads updates when requested.$\r$\n$\r$\n"
  StrCpy $0 "$0PRIVACY / COMPONENTS$\r$\nWorkspace and account snapshots stay local. Credentials use Electron safeStorage/Windows DPAPI; consent stays local. Optional support bundle: app version, health, sanitized events; excludes content, credentials, account IDs, paths, raw errors. Full privacy/license notice bundled and in Settings.$\r$\nElectron/Chromium/Node.js included. Windows provides networking/file dialogs; no .NET, WebView2, or Visual C++ runtime needed."
  ${NSD_SetText} $SCMConsentText $0

  ${NSD_CreateButton} 0 97u 174u 13u "SoundCloud terms"
  Pop $0
  ${NSD_OnClick} $0 SCManagerOpenTerms
  ${NSD_CreateButton} 180u 97u 174u 13u "API terms"
  Pop $0
  ${NSD_OnClick} $0 SCManagerOpenApiTerms

  ; Make the final action explicit. This is the last review page before the
  ; installer copies files, so the standard wizard Next button must say what it does.
  GetDlgItem $0 $HWNDPARENT 1
  SendMessage $0 0x000C 0 "STR:Install"
  EnableWindow $0 0
  nsDialogs::Show
FunctionEnd

Function SCManagerConsentToggle
  ${NSD_GetState} $SCMConsentCheck $SCMConsentState
  GetDlgItem $0 $HWNDPARENT 1
  ${If} $SCMConsentState == ${BST_CHECKED}
    EnableWindow $0 1
  ${Else}
    EnableWindow $0 0
  ${EndIf}
FunctionEnd

Function SCManagerConsentLeave
  ${NSD_GetState} $SCMConsentCheck $SCMConsentState
  ${If} $SCMConsentState != ${BST_CHECKED}
    MessageBox MB_ICONINFORMATION|MB_OK "Select the confirmation box to continue, or choose Cancel to leave setup without installing."
    Abort
  ${EndIf}

  ; Store the acceptance time using Windows. This is saved in HKCU and is never transmitted.
  System::Alloc 16
  Pop $SCMConsentParts
  System::Call 'kernel32::GetLocalTime(p rSCMConsentParts)'
  System::Call '*$SCMConsentParts(&i2 .rSCMConsentPartYear, &i2 .rSCMConsentPartMonth, &i2 .rSCMConsentPartDayOfWeek, &i2 .rSCMConsentPartDay, &i2 .rSCMConsentPartHour, &i2 .rSCMConsentPartMinute, &i2 .rSCMConsentPartSecond, &i2 .rSCMConsentMillis)'
  System::Free $SCMConsentParts
  IntFmt $SCMConsentPartYear "%04u" $SCMConsentPartYear
  IntFmt $SCMConsentPartMonth "%02u" $SCMConsentPartMonth
  IntFmt $SCMConsentPartDay "%02u" $SCMConsentPartDay
  IntFmt $SCMConsentPartDayOfWeek "%u" $SCMConsentPartDayOfWeek
  IntFmt $SCMConsentMillis "%03u" $SCMConsentMillis
  IntFmt $SCMConsentPartHour "%02u" $SCMConsentPartHour
  IntFmt $SCMConsentPartMinute "%02u" $SCMConsentPartMinute
  IntFmt $SCMConsentPartSecond "%02u" $SCMConsentPartSecond
  StrCpy $SCMConsentStamp "$SCMConsentPartYear-$SCMConsentPartMonth-$SCMConsentPartDay $SCMConsentPartHour:$SCMConsentPartMinute:$SCMConsentPartSecond local time"

  WriteRegStr HKCU "${SC_MANAGER_CONSENT_KEY}" "Version" "${SC_MANAGER_CONSENT_VERSION}"
  WriteRegStr HKCU "${SC_MANAGER_CONSENT_KEY}" "AcceptedAtLocal" "$SCMConsentStamp"
  WriteRegStr HKCU "${SC_MANAGER_CONSENT_KEY}" "Categories" "copyright-rights,legal-privacy,soundcloud-third-party-services,windows-runtime,service-network-use,soundcloud-supported-functions"
  ReadRegStr $SCMConsentExisting HKCU "${SC_MANAGER_CONSENT_KEY}" "Version"
  ReadRegStr $SCMConsentVerifyTimestamp HKCU "${SC_MANAGER_CONSENT_KEY}" "AcceptedAtLocal"
  ReadRegStr $SCMConsentVerifyCategories HKCU "${SC_MANAGER_CONSENT_KEY}" "Categories"
  ${If} $SCMConsentExisting != "${SC_MANAGER_CONSENT_VERSION}"
  ${OrIf} $SCMConsentVerifyTimestamp != $SCMConsentStamp
  ${OrIf} $SCMConsentVerifyCategories != "copyright-rights,legal-privacy,soundcloud-third-party-services,windows-runtime,service-network-use,soundcloud-supported-functions"
    DeleteRegValue HKCU "${SC_MANAGER_CONSENT_KEY}" "Version"
    MessageBox MB_ICONSTOP "Setup could not save your consent on this Windows account. No app files have been installed."
    Abort
  ${EndIf}

FunctionEnd

Function SCManagerOpenTerms
  ExecShell "open" "https://soundcloud.com/terms-of-use"
FunctionEnd

Function SCManagerOpenApiTerms
  ExecShell "open" "https://developers.soundcloud.com/docs/api/terms-of-use"
FunctionEnd
!endif
