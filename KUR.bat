@echo off
chcp 65001 >nul
setlocal

echo.
echo  ============================================
echo   Etsy SEO araci - tek tikla kurulum
echo  ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo  [HATA] Node.js bulunamadi.
  echo  https://nodejs.org adresinden "LTS" surumunu indir, kur ve tekrar calistir.
  pause
  exit /b 1
)

for /f "tokens=*" %%v in ('node -v') do set NODE_VERSION=%%v
echo  [1/4] Node.js bulundu: %NODE_VERSION%

echo  [2/4] Bagimliliklar kuruluyor...
call npm install --no-audit --no-fund
if errorlevel 1 (
  echo  [HATA] Bagimliliklar kurulamadi.
  pause
  exit /b 1
)

if not exist ".env" (
  copy ".env.example" ".env" >nul
  echo  [3/4] .env dosyasi olusturuldu.
  notepad ".env"
  echo.
  echo  Yukaridaki notepad'da ETSY_API_KEY satirina anahtarini yapistir ve kaydet.
  echo  Anahtari https://www.etsy.com/developers/apps adresinden alabilirsin.
  echo.
  pause
) else (
  echo  [3/4] .env zaten var, dokunulmadi.
)

echo  [4/4] Sunucu baslatiliyor: http://127.0.0.1:4310
echo.
echo  Kapatmak icin bu pencereyi kapat veya Ctrl+C tusuna bas.
echo.

start "" "http://127.0.0.1:4310"
call npm start

endlocal
