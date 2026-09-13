$ErrorActionPreference = 'Stop'
$nativeRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $nativeRoot
$framework = 'C:\Windows\Microsoft.NET\Framework\v4.0.30319'
$wpf = Join-Path $framework 'WPF'
& "$framework\csc.exe" /nologo /target:winexe /platform:x64 /optimize+ "/out:$nativeRoot\out\Soundcloud Desktop.exe" "/win32icon:$projectRoot\assets\icon.ico" "/win32manifest:$nativeRoot\app.manifest" "/resource:$nativeRoot\App.xaml,App.xaml" /reference:System.dll /reference:System.Core.dll /reference:System.Security.dll /reference:System.Web.dll /reference:System.Web.Extensions.dll "/reference:$wpf\WindowsBase.dll" "/reference:$wpf\PresentationCore.dll" "/reference:$wpf\PresentationFramework.dll" /reference:System.Xaml.dll "$nativeRoot\Main.cs"
if ($LASTEXITCODE -ne 0) { throw 'Native compilation failed' }
Copy-Item -LiteralPath "$nativeRoot\App.config" -Destination "$nativeRoot\out\Soundcloud Desktop.exe.config"
Copy-Item -LiteralPath "$projectRoot\assets\icon.ico" -Destination "$nativeRoot\out\icon.ico"
