param(
  [int]$Port = 8321,
  [string]$Root = $PSScriptRoot
)
# 하루두잉 로컬 서버 (Node/Python 필요 없음)
# 실행: 이 파일을 우클릭 → "PowerShell에서 실행"  또는  powershell -ExecutionPolicy Bypass -File serve.ps1
$mime = @{
  '.html' = 'text/html; charset=utf-8'
  '.js' = 'text/javascript; charset=utf-8'
  '.css' = 'text/css; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.webmanifest' = 'application/manifest+json; charset=utf-8'
  '.png' = 'image/png'
  '.svg' = 'image/svg+xml'
  '.ico' = 'image/x-icon'
  '.woff2' = 'font/woff2'
}
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
$rootFull = (Resolve-Path $Root).Path
Write-Host "하루두잉 실행 중: http://localhost:$Port/  (중지: Ctrl+C)"
try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    try {
      $path = [System.Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath)
      if ($path -eq '/') { $path = '/index.html' }
      $file = Join-Path $rootFull ($path -replace '/', '\').TrimStart('\')
      $ok = (Test-Path $file -PathType Leaf)
      if ($ok) { $ok = (Resolve-Path $file).Path.StartsWith($rootFull) }
      if ($ok) {
        $bytes = [System.IO.File]::ReadAllBytes($file)
        $ext = [System.IO.Path]::GetExtension($file).ToLower()
        if ($mime.ContainsKey($ext)) { $ctx.Response.ContentType = $mime[$ext] }
        else { $ctx.Response.ContentType = 'application/octet-stream' }
        $ctx.Response.Headers.Add('Cache-Control', 'no-cache')
        $ctx.Response.ContentLength64 = $bytes.Length
        $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
      } else {
        $ctx.Response.StatusCode = 404
        $b = [System.Text.Encoding]::UTF8.GetBytes('404 Not Found')
        $ctx.Response.OutputStream.Write($b, 0, $b.Length)
      }
    } catch {} finally {
      try { $ctx.Response.Close() } catch {}
    }
  }
} finally {
  $listener.Stop()
}
