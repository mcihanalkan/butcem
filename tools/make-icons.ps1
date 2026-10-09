# Uygulama ikonlarını üretir: koyu zemin üzerinde sade cüzdan işareti (sitedeki logo ile aynı).
# Kullanım: powershell -ExecutionPolicy Bypass -File tools/make-icons.ps1
Add-Type -AssemblyName System.Drawing
$dir = Join-Path $PSScriptRoot '..\icons'
New-Item -ItemType Directory -Force $dir | Out-Null

function RoundRect([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $p.AddArc($x, $y, 2*$r, 2*$r, 180, 90)
  $p.AddArc($x + $w - 2*$r, $y, 2*$r, 2*$r, 270, 90)
  $p.AddArc($x + $w - 2*$r, $y + $h - 2*$r, 2*$r, 2*$r, 0, 90)
  $p.AddArc($x, $y + $h - 2*$r, 2*$r, 2*$r, 90, 90)
  $p.CloseFigure()
  return $p
}

function Make-Icon([int]$size, [string]$file, [bool]$rounded) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.Clear([System.Drawing.Color]::Transparent)
  $bg = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 18, 18, 17))
  if ($rounded) { $g.FillPath($bg, (RoundRect 0 0 $size $size ($size * 0.23))) } else { $g.FillRectangle($bg, 0, 0, $size, $size) }

  # İşaret: içi boş yuvarlak dikdörtgen, sol kenarı kalın (cüzdan / kart)
  $scale = if ($rounded) { 0.50 } else { 0.40 }
  $w = $size * $scale; $h = $w * 0.72
  $x = ($size - $w) / 2; $y = ($size - $h) / 2
  $stroke = $size * 0.055
  $white = [System.Drawing.Color]::FromArgb(255, 255, 255, 255)
  $pen = New-Object System.Drawing.Pen $white, $stroke
  $g.DrawPath($pen, (RoundRect $x $y $w $h ($size * 0.06)))
  $brush = New-Object System.Drawing.SolidBrush $white
  $g.FillPath($brush, (RoundRect ($x - $stroke/2) ($y - $stroke/2) ($w * 0.30) ($h + $stroke) ($size * 0.05)))
  # Yeşil nokta (vurgu rengi)
  $green = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 60, 214, 156))
  $d = $size * 0.075
  $g.FillEllipse($green, ($x + $w * 0.68 - $d/2), ($y + $h/2 - $d/2), $d, $d)

  $bmp.Save((Join-Path $dir $file), [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
}

Make-Icon 192 'icon-192.png' $true
Make-Icon 512 'icon-512.png' $true
Make-Icon 512 'icon-maskable-512.png' $false
