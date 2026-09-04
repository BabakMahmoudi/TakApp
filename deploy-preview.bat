@echo off
setlocal enabledelayedexpansion

rem ============================================================================
rem  TakApp - Preview (staging) deployment
rem
rem  Deploys the web worker, bot worker, and D1 migrations to the `preview`
rem  environment (Stellar testnet). See DEPLOYMENT.md for the manual steps.
rem
rem  Usage:
rem    deploy-preview.bat                 build + migrate + deploy web & bot
rem    deploy-preview.bat --generate      also regenerate Drizzle migrations
rem    deploy-preview.bat --webhook       also (re)register the Telegram webhook
rem
rem  Webhook step requires BOT_TOKEN and WORKERS_SUBDOMAIN to be set below.
rem ============================================================================

set "ROOT=%~dp0"
set "GENERATE=0"
set "WEBHOOK=0"

rem --- Optional webhook settings (leave BOT_TOKEN empty to skip) -------------
rem The bot token is a Cloudflare secret; set it here only to register webhooks.
set "BOT_TOKEN="
rem e.g. "takapp-bot-preview.myaccount" -> full URL becomes
rem      https://takapp-bot-preview.myaccount.workers.dev/
set "WORKERS_SUBDOMAIN="

rem --- Parse arguments --------------------------------------------------------
for %%A in (%*) do (
    if /I "%%~A"=="--generate" set "GENERATE=1"
    if /I "%%~A"=="--webhook"  set "WEBHOOK=1"
)

cd /d "%ROOT%" || goto :fail

where pnpm >nul 2>nul
if errorlevel 1 (
    echo [ERROR] pnpm not found on PATH. Install pnpm 10 and retry.
    goto :fail
)

echo.
echo ============================================================
echo  TakApp preview deployment
echo  root: %ROOT%
echo ============================================================

rem --- 1. Build ----------------------------------------------------------------
echo.
echo [1/4] Building (pnpm build)...
call pnpm build
if errorlevel 1 goto :fail

rem --- 2. Drizzle migrations ---------------------------------------------------
if "%GENERATE%"=="1" (
    echo.
    echo [2/4] Generating Drizzle migrations (schema changed)...
    call pnpm --filter @takapp/web db:generate
    if errorlevel 1 goto :fail
) else (
    echo.
    echo [2/4] Skipping db:generate (use --generate if the schema changed).
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
echo [3/4] Deploying web worker (takapp-web-preview)...
pushd "%ROOT%apps\web"
call pnpm exec wrangler deploy --env preview
set "WEB_ERR=!errorlevel!"
popd
if not "!WEB_ERR!"=="0" goto :fail

rem --- 4. Deploy bot worker ----------------------------------------------------
echo.
echo [4/4] Deploying bot worker (takapp-bot-preview)...
pushd "%ROOT%apps\bot"
call pnpm exec wrangler deploy --env preview
set "BOT_ERR=!errorlevel!"
popd
if not "!BOT_ERR!"=="0" goto :fail

rem --- 5. Optional webhook -----------------------------------------------------
if "%WEBHOOK%"=="1" (
    if not "%BOT_TOKEN%"=="" (
        if not "%WORKERS_SUBDOMAIN%"=="" (
            echo.
            echo [5/5] Registering Telegram webhook...
            curl -s -F "url=https://%WORKERS_SUBDOMAIN%.workers.dev/" ^
                 "https://api.telegram.org/bot%BOT_TOKEN%/setWebhook"
            echo.
            if errorlevel 1 goto :fail
        ) else (
            echo.
            echo [WARN] --webhook passed but WORKERS_SUBDOMAIN is empty; skipping.
        )
    ) else (
        echo.
        echo [WARN] --webhook passed but BOT_TOKEN is empty; skipping.
    )
)

echo.
echo ============================================================
echo  Preview deployment complete.
echo    Web:  https://takapp-web-preview.<account>.workers.dev/
echo    Bot:  https://takapp-bot-preview.<account>.workers.dev/
echo ============================================================
exit /b 0

:fail
echo.
echo [ERROR] Deployment aborted. Fix the failing step above and retry.
exit /b 1
