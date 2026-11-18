@echo off
rem Abre a demonstracao da Etapa 1 do Uso LicitaHub no navegador.
rem Nao precisa de Supabase nem de chave da IA. Nada e gravado.
cd /d "%~dp0"
if not exist node_modules (
  echo Instalando as dependencias pela primeira vez, aguarde...
  call npm install --no-fund --no-audit
)
echo.
echo Iniciando a demonstracao do Uso LicitaHub...
echo O navegador vai abrir sozinho. Para encerrar, feche esta janela.
echo.
node --env-file-if-exists=.env scripts\demo.js
pause
