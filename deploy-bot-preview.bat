@echo off
setlocal enabledelayedexpansion

rem ============================================================================
rem  TakApp - Bot worker preview deployment
rem
rem  Deploys the Telegram bot (grammY) to `takapp-bot-preview` (Stellar testnet).
rem  The bot deploys straight from source; no build step. Optionally registers
rem  the Telegram webhook against the deployed worker.
rem  See DEPLOYMENT.md for the manual steps.
rem
rem  Usage:
rem    deploy-bot-preview.bat              deploy bot only
rem    deploy-bot-preview.bat --webhook    also (re)register the Telegram webhook
rem
rem  Webhook step requires BOT_TOKEN and WORKERS_SUBDOMAIN to be set below.
rem ============================================================================

set "ROOT=%~dp0"
set "WEBHOOK=0"

rem --- Optional webhook settings (leave BOT_TOKEN empty to skip) -------------
rem The bot token is a Cloudflare secret; set it here only to register webhooks.
set "BOT_TOKEN="
rem e.g. "takapp-bot-preview.myaccount" -> full URL becomes
rem      https://takapp-bot-preview.myaccount.workers.dev/
set "WORKERS_SUBDOMAIN="

for %%A in (%*) do (
    if /I "%%~A"=="--webhook" set "WEBHOOK=1"
)

cd /d "%ROOT%" || goto :fail

where pnpm >nul 2>nul
if errorlevel 1 (
    echo [ERROR] pnpm not found on PATH. Install pnpm 10 and retry.
    goto :fail
)

echo.
echo ============================================================
echo  TakApp bot worker preview deployment
echo ============================================================

rem --- 1. Deploy bot worker ----------------------------------------------------
echo.
echo [1/2] Deploying bot worker (takapp-bot-preview)...
pushd "%ROOT%apps\bot"
call pnpm exec wrangler deploy --env preview
set "BOT_ERR=!errorlevel!"
popd
if not "!BOT_ERR!"=="0" goto :fail

rem --- 2. Optional webhook -----------------------------------------------------
if "%WEBHOOK%"=="1" (
    if not "%BOT_TOKEN%"=="" (
        if not "%WORKERS_SUBDOMAIN%"=="" (
            echo.
            echo [2/2] Registering Telegram webhook...
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
echo  Bot worker deployed.
echo    https://takapp-bot-preview.<account>.workers.dev/
echo ============================================================
exit /b 0

:fail
echo.
echo [ERROR] Bot deployment aborted. Fix the failing step above and retry.
exit /b 1
