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

  ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "T3CodeDiscordRpc"
  ${If} $0 != ""
    StrCpy $StartupChecked ${BST_CHECKED}
  ${EndIf}

  ${If} $StartupChecked == ""
    StrCpy $StartupChecked ${BST_UNCHECKED}
  ${EndIf}

  ${NSD_CreateCheckbox} 0 0 100% 12u "Start T3 Code Discord RPC with Windows"
  Pop $StartupCheckbox
  ${NSD_SetState} $StartupCheckbox $StartupChecked

  nsDialogs::Show
FunctionEnd

Function StartupPageLeave
  ${NSD_GetState} $StartupCheckbox $StartupChecked
FunctionEnd

!macro customPageAfterChangeDir
  Page custom StartupPageCreate StartupPageLeave
!macroend
!endif

!macro customInstall
  ${If} $StartupChecked == ${BST_CHECKED}
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "T3CodeDiscordRpc" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --hidden'
  ${Else}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "T3CodeDiscordRpc"
  ${EndIf}
!macroend

!macro customUnInstall
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "T3CodeDiscordRpc"
!macroend
