@echo off
:: Deadcord Uninstaller — double-click to uninstall
title Deadcord — Desinstallation
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deadcord-uninstall.ps1"
if %errorlevel% neq 0 pause
