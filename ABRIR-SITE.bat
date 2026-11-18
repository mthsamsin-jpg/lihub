@echo off
rem Liga o Uso LicitaHub (site + API) e abre o navegador em http://localhost:8787
rem O site ja vem ligado ao banco (Supabase), a IA e ao pagamento (Stripe).
rem Para desligar, feche esta janela.
rem (So a demonstracao, sem servidor: abra site\index.html direto.)
cd /d "%~dp0"
if not exist node_modules (
  echo Instalando as dependencias pela primeira vez, aguarde...
  call npm install --no-fund --no-audit
)
echo.
echo Ligando o Uso LicitaHub... o navegador abre em alguns segundos.
echo Para desligar, feche esta janela.
echo.
start "" cmd /c "timeout /t 4 /nobreak >nul & start http://localhost:8787"
node --env-file=.env src\servidor.js
pause
