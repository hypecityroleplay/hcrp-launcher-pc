!include "LogicLib.nsh"

!macro preInit
  SetRegView 64
  ReadRegStr $0 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation

  SetRegView 32
  ReadRegStr $1 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation

  ${If} $0 != ""
    StrCpy $2 $0
  ${ElseIf} $1 != ""
    StrCpy $2 $1
  ${Else}
    StrCpy $2 "$LOCALAPPDATA\HCRP Launcher"
  ${EndIf}

  StrCpy $3 $2 13 -13
  ${If} $3 == "\HCRP-Launcher"
    StrCpy $2 $2 -13
  ${EndIf}

  SetRegView 64
  WriteRegExpandStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "$2"

  SetRegView 32
  WriteRegExpandStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "$2"
!macroend

!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "Instalação do HCRP Launcher"
  !define MUI_WELCOMEPAGE_TEXT "Este assistente instalará o HCRP Launcher.$\r$\n$\r$\nNa próxima etapa você poderá escolher exatamente a pasta onde deseja instalar o launcher."
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro customPageAfterChangeDir
  !define MUI_DIRECTORYPAGE_TEXT_TOP "Escolha a pasta onde os arquivos do HCRP Launcher serão instalados. O instalador usará exatamente a pasta mostrada abaixo, sem criar outra pasta HCRP-Launcher dentro dela."
  !define MUI_DIRECTORYPAGE_TEXT_DESTINATION "Pasta de Destino"
  !insertmacro MUI_PAGE_DIRECTORY
!macroend
