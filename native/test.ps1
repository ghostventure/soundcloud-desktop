$ErrorActionPreference = 'Stop'
$nativeRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$framework = 'C:\Windows\Microsoft.NET\Framework\v4.0.30319'; $wpf = "$framework\WPF"
& "$framework\csc.exe" /nologo /target:winexe /platform:x64 "/out:$nativeRoot\out\NativeTests.exe" "/reference:$nativeRoot\out\Soundcloud Desktop.exe" /reference:System.dll /reference:System.Core.dll /reference:System.Xaml.dll "/reference:$wpf\WindowsBase.dll" "/reference:$wpf\PresentationCore.dll" "/reference:$wpf\PresentationFramework.dll" "$nativeRoot\Tests.cs"
if ($LASTEXITCODE -ne 0) { throw 'Test compilation failed' }
foreach ($testArgs in @('--self-test','--verify-transport')) { $p=Start-Process "$nativeRoot\out\Soundcloud Desktop.exe" -ArgumentList $testArgs -PassThru -WindowStyle Hidden; $p.WaitForExit(); if ($p.ExitCode -ne 0) { throw "$testArgs failed" } }
$p=Start-Process "$nativeRoot\out\NativeTests.exe" -PassThru -WindowStyle Hidden; $p.WaitForExit(); Get-Content "$nativeRoot\out\ui-test-result.txt"; if ($p.ExitCode -ne 0) { throw 'Native UI tests failed' }
