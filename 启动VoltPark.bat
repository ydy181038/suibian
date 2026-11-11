@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
title VoltPark - 电动车智能停放系统

rem 如果本地服务已经在运行，直接打开网页，避免端口冲突。
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 'http://127.0.0.1:8777/api/health'; if ($r.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1
if not errorlevel 1 (
  echo.
  echo  VoltPark 已经在运行，正在打开浏览器...
  start "" "http://127.0.0.1:8777"
  timeout /t 2 >nul
  exit /b 0
)

set "PYTHON="
set "BUNDLED=%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe"
if exist "%BUNDLED%" set "PYTHON=%BUNDLED%"
if defined PYTHON goto run

python -c "import sys" >nul 2>&1
if not errorlevel 1 set "PYTHON=python"
if defined PYTHON goto run

py -3 -c "import sys" >nul 2>&1
if not errorlevel 1 set "PYTHON=py -3"
if defined PYTHON goto run

echo.
echo  未找到可用的 Python 3，请先安装 Python 3.10 或更高版本。
echo  下载地址：https://www.python.org/downloads/
echo.
pause
exit /b 1

:run
echo.
echo  VoltPark 正在启动...
echo  访问地址： http://127.0.0.1:8777
echo  演示账号： demo@evpark.cn  /  Demo1234
echo  管理账号： admin@evpark.cn /  Admin1234
echo  按 Ctrl+C 可停止服务。
echo.
start "" /b powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process 'http://127.0.0.1:8777'"
if "%PYTHON%"=="py -3" (
  py -3 server.py
) else (
  "%PYTHON%" server.py
)

if errorlevel 1 (
  echo.
  echo  服务未能正常启动。若端口被占用，可先关闭已有的 VoltPark 窗口，
  echo  或执行： set VOLTPARK_PORT=8779 ^&^& 启动VoltPark.bat
  echo.
)
pause
