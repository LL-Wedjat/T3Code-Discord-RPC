!include nsDialogs.nsh
!include LogicLib.nsh

!ifndef BUILD_UNINSTALLER
Var StartupDialog
Var StartupCheckbox
Var StartupChecked

Function StartupPageCreate
  nsDialogs::Create 1018
  Pop $StartupDialog
  ${If} $StartupDialog == error
    Abort
  ${EndIf}

  ${NSD_CreateCheckbox} 0 0 100% 12u "Start T3 Code Discord RPC with Windows"
  Pop $StartupCheckbox
  ${NSD_SetState} $StartupCheckbox ${BST_CHECKED}

  nsDialogs::Show
FunctionEnd

Function StartupPageLeave
  ${NSD_GetState} $StartupCheckbox $StartupChecked
FunctionEnd

  Page custom StartupPageCreate StartupPageLeave
!endif

!macro customInstall
  ${If} $StartupChecked == ${BST_CHECKED}
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "T3CodeDiscordRpc" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --hidden'
  ${EndIf}
!macroend

!macro customUnInstall
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "T3CodeDiscordRpc"
!macroend
