Add-Type -AssemblyName System.Drawing
$ico = [System.Drawing.Icon]::new('g:\WorkBuddy\MemBook\membook-backup\src-tauri\icons\icon.ico', [System.Drawing.Size]::new(256, 256))
$bmp = $ico.ToBitmap()
$out = 'g:\WorkBuddy\MemBook\membook-backup\src-tauri\icons\_icon256.png'
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
Write-Host ("icon.ico 256x256 -> {0}" -f $out)
$bmp.Dispose()
$ico.Dispose()

# 顺手再提取 64x64 看一下
$ico2 = [System.Drawing.Icon]::new('g:\WorkBuddy\MemBook\membook-backup\src-tauri\icons\icon.ico', [System.Drawing.Size]::new(64, 64))
$bmp2 = $ico2.ToBitmap()
$bmp2.Save('g:\WorkBuddy\MemBook\membook-backup\src-tauri\icons\_icon64.png', [System.Drawing.Imaging.ImageFormat]::Png)
Write-Host 'icon.ico 64x64 -> _icon64.png'
$bmp2.Dispose()
$ico2.Dispose()
