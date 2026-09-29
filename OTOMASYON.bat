@echo off
chcp 65001 >nul
setlocal

rem ============================================================================
rem  Gunluk otomasyonu Windows Gorev Zamanlayici'ya kaydeder.
rem  Sunucu her zaman acik degilse bu yontem kullanilir: bilgisayar acildiginda
rem  gorev tetiklenir, arac bir kez calisir ve kapanir.
rem ============================================================================

set PROJECT_DIR=%~dp0
set TASK_NAME=Etsy SEO Gunluk Denetim

echo.
echo  Windows Gorev Zamanlayici'ya kaydediliyor...
echo  Proje: %PROJECT_DIR%
echo.

schtasks /Create /TN "%TASK_NAME%" /TR "cmd /c cd /d ""%PROJECT_DIR%"" ^&^& npm run once" /SC DAILY /ST 04:00 /F

if errorlevel 1 (
  echo.
  echo  [HATA] Gorev olusturulamadi. Yonetici olarak calistirmayi dene.
  pause
  exit /b 1
)

echo.
echo  [OK] "%TASK_NAME%" olusturuldu. Her gun 04:00'te bir kez calisir.
echo.
echo  Kontrol:  schtasks /Query /TN "%TASK_NAME%"
echo  Kaldir:   schtasks /Delete /TN "%TASK_NAME%" /F
echo.
pause
