@echo off
setlocal enabledelayedexpansion

rem ============================================================================
rem  TakApp - Web worker preview deployment
rem
rem  Builds the Next.js/OpenNext worker and deploys it to `takapp-web-preview`
rem  (Stellar testnet). Also applies Drizzle migrations to the preview D1.
rem  See DEPLOYMENT.md for the manual steps.
rem
rem  Usage:
rem    deploy-web-preview.bat               build + migrate + deploy web
rem    deploy-web-preview.bat --generate    also regenerate Drizzle migrations
rem ============================================================================

set "ROOT=%~dp0"
set "GENERATE=0"

for %%A in (%*) do (
    if /I "%%~A"=="--generate" set "GENERATE=1"
)

cd /d "%ROOT%" || goto :fail

where pnpm >nul 2>nul
if errorlevel 1 (
    echo [ERROR] pnpm not found on PATH. Install pnpm 10 and retry.
    goto :fail
)

echo.
echo ============================================================
echo  TakApp web worker preview deployment
echo ============================================================

rem --- 1. Build ----------------------------------------------------------------
echo.
echo [1/3] Building (pnpm build)...
call pnpm build
if errorlevel 1 goto :fail

rem --- 2. Drizzle migrations ---------------------------------------------------
if "%GENERATE%"=="1" (
    echo.
    echo [2/3] Generating Drizzle migrations (schema changed)...
    call pnpm --filter @takapp/web db:generate
    if errorlevel 1 goto :fail
) else (
    echo.
    echo [2/3] Skipping db:generate (use --generate if the schema changed).
)

echo.
echo       Applying migrations to takapp-d1-preview (remote)...
pushd "%ROOT%apps\web"
call pnpm exec wrangler d1 migrations apply takapp-d1-preview --env preview --remote
set "MIGRATE_ERR=!errorlevel!"
popd
if not "!MIGRATE_ERR!"=="0" goto :fail

rem --- 3. Deploy web worker ----------------------------------------------------
echo.
echo [3/3] Deploying web worker (takapp-web-preview)...
pushd "%ROOT%apps\web"
call pnpm exec wrangler deploy --env preview
set "WEB_ERR=!errorlevel!"
popd
if not "!WEB_ERR!"=="0" goto :fail

echo.
echo ============================================================
echo  Web worker deployed.
echo    https://takapp-web-preview.<account>.workers.dev/
echo ============================================================
exit /b 0

:fail
echo.
echo [ERROR] Web deployment aborted. Fix the failing step above and retry.
exit /b 1
