Add-Type -AssemblyName System.Drawing
$dir = Join-Path $PSScriptRoot '..\icons'
New-Item -ItemType Directory -Force $dir | Out-Null

function Make-Icon([int]$size, [string]$file, [bool]$rounded) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.TextRenderingHint = 'AntiAliasGridFit'
  $g.Clear([System.Drawing.Color]::Transparent)
  $rect = New-Object System.Drawing.Rectangle 0, 0, $size, $size
  $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rect, ([System.Drawing.Color]::FromArgb(255,124,108,255)), ([System.Drawing.Color]::FromArgb(255,79,61,214)), 45
  if ($rounded) {
    $r = [int]($size * 0.22)
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddArc(0, 0, 2*$r, 2*$r, 180, 90)
    $path.AddArc($size-2*$r, 0, 2*$r, 2*$r, 270, 90)
    $path.AddArc($size-2*$r, $size-2*$r, 2*$r, 2*$r, 0, 90)
    $path.AddArc(0, $size-2*$r, 2*$r, 2*$r, 90, 90)
    $path.CloseFigure()
    $g.FillPath($brush, $path)
    $fontSize = $size * 0.58
  } else {
    $g.FillRectangle($brush, $rect)
    $fontSize = $size * 0.44   # maskable: içerik güvenli alanda kalsın
  }
  $font = New-Object System.Drawing.Font 'Segoe UI', $fontSize, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
  $fmt = New-Object System.Drawing.StringFormat
  $fmt.Alignment = 'Center'; $fmt.LineAlignment = 'Center'
  $rf = New-Object System.Drawing.RectangleF 0, ($size * 0.02), $size, $size
  $g.DrawString([string][char]0x20BA, $font, [System.Drawing.Brushes]::White, $rf, $fmt)
  $bmp.Save((Join-Path $dir $file), [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
}

Make-Icon 192 'icon-192.png' $true
Make-Icon 512 'icon-512.png' $true
Make-Icon 512 'icon-maskable-512.png' $false
