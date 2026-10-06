Option Explicit
Dim shell, fileSystem, projectRoot, executablePath
Set shell = CreateObject("WScript.Shell")
Set fileSystem = CreateObject("Scripting.FileSystemObject")
projectRoot = fileSystem.GetParentFolderName(WScript.ScriptFullName)
executablePath = fileSystem.BuildPath(projectRoot, "out\mybills-win32-x64\mybills.exe")

If Not fileSystem.FileExists(executablePath) Then
  MsgBox "O aplicativo MyBills ainda não foi compilado.", 16, "MyBills"
  WScript.Quit 1
End If

shell.Run Chr(34) & executablePath & Chr(34), 1, False
