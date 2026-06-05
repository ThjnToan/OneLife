' ============================================
' OneLife - Silent Startup Launcher
' ============================================
' Runs start.bat in a hidden window so there's
' no console flash when the user logs in.
' ============================================

Dim shell, fso
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

' Get the path to the directory containing this .vbs file
Dim scriptDir
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)

' Run start.bat hidden (0 = hidden window)
shell.Run """" & scriptDir & "\start.bat""", 0, False

Set fso = Nothing
Set shell = Nothing
