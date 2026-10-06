Option Explicit
Dim shell, base, command, result
Set shell = CreateObject("WScript.Shell")
base = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
command = "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & base & "\watchdog.ps1"""
result = shell.Run(command, 0, True)
WScript.Quit result
