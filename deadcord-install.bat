@echo off
:: Deadcord Installer — double-click to install
title Deadcord — Installation
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deadcord-install.ps1"
if %errorlevel% neq 0 pause
