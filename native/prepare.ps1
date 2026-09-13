$ErrorActionPreference = 'Stop'
$nativeRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
New-Item -ItemType Directory "$nativeRoot\vendor", "$nativeRoot\out", "$nativeRoot\out\licenses" -Force | Out-Null
$archive = "$nativeRoot\vendor\curl.zip"
if (!(Test-Path -LiteralPath $archive)) { Invoke-WebRequest 'https://curl.se/windows/dl-8.22.0_1/curl-8.22.0_1-win64-mingw.zip' -OutFile $archive }
if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne '7F23B039F6EA4197362D4468E1A0E71428201222E1BEF3B680D5EF7B2AEFB714') { throw 'curl archive checksum mismatch' }
Expand-Archive -LiteralPath $archive -DestinationPath "$nativeRoot\vendor\curl" -Force
$bundle = "$nativeRoot\vendor\curl\curl-8.22.0_1-win64-mingw"
Copy-Item "$bundle\bin\curl.exe", "$bundle\bin\curl-ca-bundle.crt" -Destination "$nativeRoot\out"
Copy-Item "$bundle\COPYING.txt" -Destination "$nativeRoot\out\licenses\curl-COPYING.txt"
Copy-Item "$bundle\dep" -Destination "$nativeRoot\out\licenses\dependencies" -Recurse -Force
Copy-Item "$nativeRoot\START-HERE.txt" -Destination "$nativeRoot\out\START-HERE.txt"
& "$nativeRoot\build.ps1"
