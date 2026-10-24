!include "nsDialogs.nsh"
!include "LogicLib.nsh"

; Include this file from build/installer.nsh, then add:
; Page custom SCManagerConsentPage SCManagerConsentLeave
; immediately after the generated catalog page and before MUI_PAGE_INSTFILES.
!define SC_MANAGER_CONSENT_VERSION "1"
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
  ${If} $SCMConsentExisting == "${SC_MANAGER_CONSENT_VERSION}"
    Abort
  ${EndIf}

  nsDialogs::Create 1018
  Pop $SCMConsentDialog
  ${If} $SCMConsentDialog == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 30u "Before installing, please read and confirm these important details."
  Pop $0
  nsDialogs::CreateControl "EDIT" "${WS_CHILD}|${WS_VISIBLE}|${WS_VSCROLL}|${ES_MULTILINE}|${ES_READONLY}|${ES_AUTOVSCROLL}|${WS_BORDER}" "${WS_EX_CLIENTEDGE}" 0 34u 100% 202u ""
  Pop $SCMConsentText
  ${NSD_SetText} $SCMConsentText "ABOUT THIS APP$$
Soundcloud Desktop is an independent app and is not endorsed by SoundCloud.$$
$$
YOUR MUSIC AND COPYRIGHT$$
Before you upload, you confirm that you own or have permission and licenses for the content you choose to send. You remain responsible for your content and for responding appropriately to copyright or other claims. This app does not provide legal advice or legal protection.$$
$$
SOUNDCLOUD AND OTHER SERVICES$$
Your SoundCloud account, authorization, and API use are governed by SoundCloud's terms. When you choose SoundCloud or GitHub features, this app connects to those services. Sign-in opens your default browser. Review SoundCloud's Terms of Use and API Terms below.$$
$$
YOUR DATA AND WINDOWS COMPONENTS$$
Your workspace and account credentials are stored locally in your Windows user profile; credentials are protected with Windows DPAPI. Consent is also saved locally in this Windows account and is not sent to SoundCloud or the app publisher. Optional support export is user initiated.$$
$$
The setup contains Soundcloud Desktop and its bundled third-party Electron, Chromium, and Node.js runtime; these components install with the app and do not launch separate installers. It does not separately install .NET, WebView2, Visual C++, or other runtime packages. Windows provides system services such as credential protection, networking, and file dialogs."

  ${NSD_CreateButton} 0 242u 174u 20u "Open SoundCloud Terms of Use"
  Pop $0
  ${NSD_OnClick} $0 SCManagerOpenTerms
  ${NSD_CreateButton} 180u 242u 174u 20u "Open SoundCloud API Terms"
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
  IntFmt $SCMConsentPartHour "%02u" $SCMConsentPartHour
  IntFmt $SCMConsentPartMinute "%02u" $SCMConsentPartMinute
  IntFmt $SCMConsentPartSecond "%02u" $SCMConsentPartSecond
  StrCpy $SCMConsentStamp "$SCMConsentPartYear-$SCMConsentPartMonth-$SCMConsentPartDay $SCMConsentPartHour:$SCMConsentPartMinute:$SCMConsentPartSecond local time"

  WriteRegStr HKCU "${SC_MANAGER_CONSENT_KEY}" "Version" "${SC_MANAGER_CONSENT_VERSION}"
  WriteRegStr HKCU "${SC_MANAGER_CONSENT_KEY}" "AcceptedAtLocal" "$SCMConsentStamp"
  WriteRegStr HKCU "${SC_MANAGER_CONSENT_KEY}" "Categories" "copyright-rights,legal-privacy,soundcloud-third-party-services,windows-runtime,service-network-use"
  ReadRegStr $SCMConsentExisting HKCU "${SC_MANAGER_CONSENT_KEY}" "Version"
  ReadRegStr $SCMConsentVerifyTimestamp HKCU "${SC_MANAGER_CONSENT_KEY}" "AcceptedAtLocal"
  ReadRegStr $SCMConsentVerifyCategories HKCU "${SC_MANAGER_CONSENT_KEY}" "Categories"
  ${If} $SCMConsentExisting != "${SC_MANAGER_CONSENT_VERSION}"
  ${OrIf} $SCMConsentVerifyTimestamp != $SCMConsentStamp
  ${OrIf} $SCMConsentVerifyCategories != "copyright-rights,legal-privacy,soundcloud-third-party-services,windows-runtime,service-network-use"
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
