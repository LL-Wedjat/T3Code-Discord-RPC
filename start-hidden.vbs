' Launch the T3 Code Discord RPC bridge without a console window.
' Requires node on PATH.
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = root
script = fso.BuildPath(root, "src\index.js")
sh.Run "node """ & script & """", 0, False
