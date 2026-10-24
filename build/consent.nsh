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

  ${NSD_CreateLabel} 0 0 100% 30u "Before installing, please read and confirm these important details."
  Pop $0
  nsDialogs::CreateControl "EDIT" "${WS_CHILD}|${WS_VISIBLE}|${WS_VSCROLL}|${ES_MULTILINE}|${ES_READONLY}|${ES_AUTOVSCROLL}" "${WS_EX_CLIENTEDGE}" 0 34u 100% 202u ""
  Pop $SCMConsentText
  ${NSD_SetText} $SCMConsentText "INDEPENDENT APP$\r$\nBlack Lion Studios supports SoundCloud. SC-DS is currently an independent product and is not affiliated with SoundCloud. This relationship status may change. SoundCloud remains its own platform and service.$\r$\n$\r$\nDMCA AND COPYRIGHT$\r$\nUpload only content you own or have permission and licenses to use. You are responsible for your content and for responding to DMCA/copyright notices or claims. This app gives no legal advice or protection.$\r$\n$\r$\nSOUNDCLOUD AND OTHER SERVICES$\r$\nSupported features use public API data: activity, selected-track comments, followed-artist tracks, catalog sync, uploads, and saved metrics. Team messages and remote processing status are unavailable in SoundCloud's public API. SoundCloud terms govern authorization and API use. GitHub provides update checks; sign-in opens your default browser. Review the SoundCloud terms using the buttons below.$\r$\n$\r$\nPRIVACY AND COMPONENTS$\r$\nWorkspace data and an Electron safeStorage-encrypted credential file stay in your Windows profile; Windows DPAPI protects the file. Consent is saved locally and not transmitted. Support export is optional and user initiated. Setup bundles Electron, Chromium, and Node.js. Windows supplies networking and file dialogs. No separate .NET, WebView2, or Visual C++ installer is needed."

  ${NSD_CreateButton} 0 242u 112u 20u "Privacy & licenses"
  Pop $0
  ${NSD_OnClick} $0 SCManagerOpenPrivacy
  ${NSD_CreateButton} 120u 242u 112u 20u "SoundCloud terms"
  Pop $0
  ${NSD_OnClick} $0 SCManagerOpenTerms
  ${NSD_CreateButton} 240u 242u 112u 20u "API terms"
  Pop $0
  ${NSD_OnClick} $0 SCManagerOpenApiTerms

  ${NSD_CreateCheckbox} 0 270u 100% 28u "I have read this information, understand it, and agree to continue. I confirm I have rights or permission for content I upload."
  Pop $SCMConsentCheck
  nsDialogs::Show
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

Function SCManagerOpenPrivacy
  ExecShell "open" "https://github.com/ghostventure/soundcloud-desktop/blob/main/docs/PRIVACY-AND-LICENSES.md"
FunctionEnd

Function SCManagerOpenApiTerms
  ExecShell "open" "https://developers.soundcloud.com/docs/api/terms-of-use"
FunctionEnd
!endif
