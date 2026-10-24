const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const manifestPath = path.join(root, 'installer', 'components.json');
const outputPath = path.join(root, 'build', 'installer.nsh');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const allowedCategories = new Set([
  'soundcloud-supported',
  'soundcloud-unavailable',
  'app-bundled',
  'os-required',
  'service-required',
  'future',
]);
const items = [...manifest.items, ...manifest.futureItems];
const ids = new Set();

for (const item of items) {
  if (!item || typeof item.id !== 'string' || !/^[a-z0-9-]{3,80}$/.test(item.id)) throw Error('Invalid installer catalog ID.');
  if (ids.has(item.id)) throw Error(`Duplicate installer catalog ID: ${item.id}`);
  ids.add(item.id);
  if (!allowedCategories.has(item.category)) throw Error(`Invalid installer catalog category for ${item.id}.`);
  for (const key of ['name', 'details']) if (typeof item[key] !== 'string' || item[key].length > 180) throw Error(`Invalid installer catalog ${key} for ${item.id}.`);
  if (item.label !== undefined && (typeof item.label !== 'string' || item.label.length > 90)) throw Error(`Invalid installer catalog label for ${item.id}.`);
  if (item.summary !== undefined && (typeof item.summary !== 'string' || item.summary.length > 140)) throw Error(`Invalid installer catalog summary for ${item.id}.`);
  if (categoryUnavailable(item) && Object.hasOwn(item, 'installAction') && item.installAction !== null) {
    throw Error(`Unsupported SoundCloud feature ${item.id} cannot declare an install action.`);
  }
  if (item.category === 'future' && !/^https:\/\/(developers\.soundcloud\.com|github\.com)\//.test(item.source || '')) {
    throw Error(`Future SoundCloud catalog entry ${item.id} needs an official source URL.`);
  }
}

function categoryUnavailable(item) {
  return item.category === 'soundcloud-unavailable';
}

const headings = new Map([
  ['soundcloud-supported', 'SOUNDCLOUD FEATURES INCLUDED'],
  ['soundcloud-unavailable', 'NOT AVAILABLE THROUGH SOUNDCLOUD\'S PUBLIC API'],
  ['app-bundled', 'APP AND WINDOWS REQUIREMENTS'],
  ['os-required', ''],
  ['service-required', ''],
  ['future', 'FUTURE OFFICIAL RELEASES'],
]);
const tags = new Map([
  ['soundcloud-supported', '[Included]'],
  ['soundcloud-unavailable', '[Not available]'],
  ['app-bundled', '[Bundled/available]'],
  ['os-required', '[Required]'],
  ['service-required', '[Used when needed]'],
  ['future', '[Officially released]'],
]);
const lines = [];
for (const [category, heading] of headings) {
  const group = items.filter(item => item.category === category);
  if (!group.length) continue;
  if (heading) lines.push(heading);
  for (const item of group) {
    lines.push(`${item.label || item.name}: ${item.summary || item.details}`);
  }
}

function escapeNsis(value) {
  return value.replace(/\$/g, '$$$$').replace(/"/g, '$\\"');
}

const catalogInitialization = [
  '  StrCpy $CatalogContent ""',
  ...lines.map(line => `  StrCpy $CatalogContent "$CatalogContent$\\r$\\n${escapeNsis(line)}"`),
].join('\r\n');

const script = [
  '!include "x64.nsh"',
  '!include "LogicLib.nsh"',
  '!include "WinVer.nsh"',
  '!include "nsDialogs.nsh"',
  '!ifndef BUILD_UNINSTALLER',
  '!include "${__FILEDIR__}\\consent.nsh"',
  '!endif',
  '',
  `!define MUI_WELCOMEPAGE_TITLE "${escapeNsis(manifest.managerName)}"`,
  `!define MUI_WELCOMEPAGE_TEXT "Installs ${escapeNsis(manifest.desktopApp)} ${escapeNsis(manifest.desktopVersion)}. Setup contains the app and its runtime; no extra component choices are needed."`,
  '',
  '!ifndef BUILD_UNINSTALLER',
  'Var CatalogDialog',
  'Var CatalogText',
  'Var CatalogContent',
  'Var CatalogStatus',
  'Var UpdateWindowsButton',
  'Var SCMCheckVersion',
  'Var SCMCheckTimestamp',
  'Var SCMCheckCategories',
  '',
  '!macro customInit',
  '  ${IfNot} ${RunningX64}',
  '    MessageBox MB_ICONSTOP "This installer needs a 64-bit Windows PC. You cannot continue on this computer."',
  '    SetErrorLevel 5',
  '    Abort',
  '  ${EndIf}',
  '  IfSilent SCMConsentSilentCheck SCMConsentInteractive',
  'SCMConsentSilentCheck:',
  '  ReadRegStr $SCMCheckVersion HKCU "Software\\SC-DS\\InstallationManager\\Consent" "Version"',
  '  ReadRegStr $SCMCheckTimestamp HKCU "Software\\SC-DS\\InstallationManager\\Consent" "AcceptedAtLocal"',
  '  ReadRegStr $SCMCheckCategories HKCU "Software\\SC-DS\\InstallationManager\\Consent" "Categories"',
  '  StrCmp $SCMCheckVersion "1.0.0" 0 SCMConsentSilentDenied',
  '  StrCmp $SCMCheckTimestamp "" SCMConsentSilentDenied 0',
  '  StrCmp $SCMCheckCategories "copyright-rights,legal-privacy,soundcloud-third-party-services,windows-runtime,service-network-use,soundcloud-supported-functions" 0 SCMConsentSilentDenied',
  '  Goto SCMConsentSilentComplete',
  'SCMConsentSilentDenied:',
  '  SetErrorLevel 5',
  '  MessageBox MB_ICONSTOP|MB_OK "Interactive confirmation is required before setup. Run this installer normally; no files were installed."',
  '  Abort',
  'SCMConsentSilentComplete:',
  'SCMConsentInteractive:',
  '!macroend',
  '',
  '!macro customPageAfterChangeDir',
  '  Page custom SCManagerCatalogPage SCManagerCatalogLeave',
  '  Page custom SCManagerConsentPage SCManagerConsentLeave',
  '!macroend',
  '',
  'Function SCManagerCatalogPage',
  '  nsDialogs::Create 1018',
  '  Pop $CatalogDialog',
  '  ${If} $CatalogDialog == error',
  '    Abort',
  '  ${EndIf}',
  '  ${NSD_CreateLabel} 0 0 100% 30u "Review what is included. The desktop app installs automatically."',
  '  Pop $CatalogStatus',
  '  nsDialogs::CreateControl "EDIT" "${WS_CHILD}|${WS_VISIBLE}|${WS_VSCROLL}|${ES_MULTILINE}|${ES_READONLY}|${ES_AUTOVSCROLL}" "${WS_EX_CLIENTEDGE}" 0 34u 100% 242u ""',
  '  Pop $CatalogText',
  catalogInitialization,
  '  ${NSD_SetText} $CatalogText $CatalogContent',
  '  ${NSD_CreateButton} 0 282u 150u 18u "Open Windows Update"',
  '  Pop $UpdateWindowsButton',
  '  ${NSD_OnClick} $UpdateWindowsButton SCManagerOpenWindowsUpdate',
  '  ${If} ${AtLeastWin10}',
  '    ShowWindow $UpdateWindowsButton ${SW_HIDE}',
  '  ${Else}',
  '    ${NSD_SetText} $CatalogStatus "This PC needs Windows 10 or 11. Open Windows Update, update Windows, then return and retry setup."',
  '  ${EndIf}',
  '  nsDialogs::Show',
  'FunctionEnd',
  '',
  'Function SCManagerCatalogLeave',
  '  ${IfNot} ${AtLeastWin10}',
  '    MessageBox MB_ICONEXCLAMATION|MB_OK "Setup is paused because this PC does not meet the Windows requirement. Update to Windows 10 or 11 and retry setup."',
  '    Abort',
  '  ${EndIf}',
  'FunctionEnd',
  '',
  'Function SCManagerOpenWindowsUpdate',
  '  ClearErrors',
  '  ExecShell "open" "ms-settings:windowsupdate"',
  '  IfErrors 0 +2',
  '  ExecShell "open" "https://www.microsoft.com/software-download/windows10"',
  'FunctionEnd',
  '!endif',
].join('\r\n');

const catalogTextLength = lines.join('\n').length;
if (catalogTextLength > 950) throw Error(`Installer catalog display text is too long (${catalogTextLength}/950 characters).`);
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, script, 'utf8');
process.stdout.write(`Generated ${manifest.managerName} catalog UI from installer/components.json (${items.length} entries).\n`);
