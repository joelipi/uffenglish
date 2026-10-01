@echo off
chcp 65001 >nul
title Video Batch Processor
echo ===============================
echo    Video Batch Processor
echo ===============================
echo.

echo Installing/updating required packages...
python -m pip install --disable-pip-version-check -q "moviepy>=2,<3" html2image pandas opencv-python pydub modal
if errorlevel 1 (
  echo.
  echo ERROR: pip install failed. See the messages above.
  pause
  exit /b 1
)
echo.

echo Checking packages...
python -c "import pandas, moviepy, html2image, cv2, pydub, modal; print('all packages OK')"
if errorlevel 1 (
  echo.
  echo ERROR: a required package is still missing.
  pause
  exit /b 1
)
echo.

echo Starting video processing...
python video_pipeline.py
pause
