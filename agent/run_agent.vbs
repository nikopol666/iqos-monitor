' Starts the IQOS agent tray app from source with the signed pythonw.exe
' (no console window). Use this on Windows 11 with Smart App Control, which
' blocks unsigned PyInstaller executables.
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = here
shell.Run "pyw -3 -m iqos_agent", 0, False
