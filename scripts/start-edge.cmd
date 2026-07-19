@echo off
set EDGE="C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
set PROFILE="D:\claude项目\matrix-share-saas\edge-profile"
set PORT=9222

echo 检查是否已有 Edge 运行在端口 %PORT% ...
netstat -ano | findstr ":%PORT% " >nul 2>&1
if %errorlevel% equ 0 (
    echo Edge 已经在运行。
    goto :done
)

echo 启动 Edge (调试端口 %PORT%) ...
start "" %EDGE% ^
    --no-sandbox ^
    --disable-blink-features=AutomationControlled ^
    --remote-debugging-port=%PORT% ^
    --user-data-dir=%PROFILE% ^
    --no-first-run ^
    --disable-extensions ^
    --disable-default-apps ^
    --disable-sync ^
    --no-default-browser-check ^
    --window-size=1,1

echo 等待 Edge 就绪...
:wait
timeout /t 2 /nobreak >nul
netstat -ano | findstr ":%PORT% " >nul 2>&1
if %errorlevel% neq 0 goto wait

:done
echo Edge 已就绪，端口 %PORT%
