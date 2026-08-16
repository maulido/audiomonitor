@echo off
color 0B
echo ==========================================
echo  SERVER PUSAT - AUDIO MONITORING
echo ==========================================
echo.
echo Menyiapkan server...
call npm install
echo.
echo Menjalankan Server Pusat...
echo Dashboard dapat diakses di: http://localhost:4000
echo.
call npm run start:server
pause
