<#
  Gera o PautaFlow.exe (inicializador) na raiz do projeto.
  Usa o compilador C# do .NET Framework que já vem no Windows — nada é baixado.
#>
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$src = Join-Path $Root 'launcher\PautaFlow.cs'
$ico = Join-Path $Root 'launcher\pautaflow.ico'
$out = Join-Path $Root 'PautaFlow.exe'
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }
if (-not (Test-Path $csc)) { throw 'Compilador C# do .NET Framework 4 não encontrado.' }

# Ícone: gota de vidro com ondas (desenhado com System.Drawing, gravado como ICO com PNG embutido)
if (-not (Test-Path $ico)) {
  Add-Type -AssemblyName System.Drawing
  $sizes = 256, 48, 32, 16
  $pngs = foreach ($s in $sizes) {
    $bmp = New-Object System.Drawing.Bitmap $s, $s
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = 'AntiAlias'
    $r = [int]($s * 0.28)
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddArc(0, 0, $r, $r, 180, 90); $path.AddArc($s - $r - 1, 0, $r, $r, 270, 90)
    $path.AddArc($s - $r - 1, $s - $r - 1, $r, $r, 0, 90); $path.AddArc(0, $s - $r - 1, $r, $r, 90, 90); $path.CloseFigure()
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush((New-Object System.Drawing.Point 0, 0), (New-Object System.Drawing.Point $s, $s), [System.Drawing.Color]::FromArgb(91, 91, 246), [System.Drawing.Color]::FromArgb(6, 182, 212))
    $g.FillPath($brush, $path)
    $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::White), ([single]([Math]::Max(1.5, $s * 0.08)))
    $pen.StartCap = 'Round'; $pen.EndCap = 'Round'
    $k = $s / 40.0
    $g.DrawBezier($pen, [single](10*$k), [single](25.5*$k), [single](15*$k), [single](17*$k), [single](20*$k), [single](30*$k), [single](30*$k), [single](16.5*$k))
    $pen2 = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(150, 255, 255, 255)), ([single]([Math]::Max(1.2, $s * 0.065)))
    $pen2.StartCap = 'Round'; $pen2.EndCap = 'Round'
    $g.DrawBezier($pen2, [single](10*$k), [single](18*$k), [single](14*$k), [single](10*$k), [single](18*$k), [single](20*$k), [single](22*$k), [single](14*$k))
    $g.Dispose()
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    ,$ms.ToArray()
  }
  $fs = [System.IO.File]::Create($ico)
  $w = New-Object System.IO.BinaryWriter $fs
  $w.Write([UInt16]0); $w.Write([UInt16]1); $w.Write([UInt16]$sizes.Count)
  $offset = 6 + 16 * $sizes.Count
  for ($i = 0; $i -lt $sizes.Count; $i++) {
    $s = $sizes[$i]; $b = if ($s -ge 256) { 0 } else { $s }
    $w.Write([byte]$b); $w.Write([byte]$b); $w.Write([byte]0); $w.Write([byte]0)
    $w.Write([UInt16]1); $w.Write([UInt16]32); $w.Write([UInt32]$pngs[$i].Length); $w.Write([UInt32]$offset)
    $offset += $pngs[$i].Length
  }
  foreach ($p in $pngs) { $w.Write($p) }
  $w.Close()
}

& $csc /nologo /target:winexe /optimize+ /codepage:65001 "/win32icon:$ico" "/out:$out" /r:System.Windows.Forms.dll /r:System.Drawing.dll $src
if ($LASTEXITCODE -ne 0) { throw 'Falha ao compilar o PautaFlow.exe' }
Write-Host "PautaFlow.exe gerado em $out" -ForegroundColor Green
