# DeckBuilder shell integration for bash (and Git Bash), loaded with --rcfile.
# Sources the startup files a login shell would, then wraps the prompt with OSC 133 marks and OSC 7.
if [ -z "${__db_si:-}" ]; then
  __db_si=1
  if [ -r /etc/profile ]; then . /etc/profile; fi
  if [ -r ~/.bash_profile ]; then . ~/.bash_profile
  elif [ -r ~/.bash_login ]; then . ~/.bash_login
  elif [ -r ~/.profile ]; then . ~/.profile
  elif [ -r ~/.bashrc ]; then . ~/.bashrc
  fi

  __db_first=1
  __db_ec=0
  __db_precmd() {
    __db_ec=$?
    # A prompt that already emits its own marks (e.g. Windows Terminal's snippet) sends D itself.
    if [ -z "$__db_first" ] && [ -z "${__db_own_marks:-}" ]; then printf '\033]133;D;%s\007' "$__db_ec"; fi
    __db_first=
    local p="$PWD" w
    if [ -n "${MSYSTEM:-}" ] && w=$(pwd -W 2>/dev/null); then p="/$w"; fi
    printf '\033]7;file://%s%s\007' "${HOSTNAME:-localhost}" "${p//%/%25}"
    return $__db_ec
  }
  __db_ps1() {
    case "$PS1" in
      *'133;D'*) __db_own_marks=1 ;;
      *) __db_own_marks= ;;
    esac
    case "$PS1" in
      *'133;B'*) ;;
      *) PS1='\[\e]133;A\a\]'"$PS1"'\[\e]133;B\a\]' ;;
    esac
    # Checked every prompt: a PROMPT_COMMAND may reset PS0.
    if [ -n "${__db_ps0:-}" ]; then
      case "${PS0:-}" in
        *'133;C'*) ;;
        *) PS0="${PS0:-}"$'\e]133;C\a' ;;
      esac
    fi
    return $__db_ec
  }
  if [[ "$(declare -p PROMPT_COMMAND 2>/dev/null)" == "declare -a"* ]]; then
    PROMPT_COMMAND=(__db_precmd "${PROMPT_COMMAND[@]}" __db_ps1)
  else
    PROMPT_COMMAND=$'__db_precmd\n'"${PROMPT_COMMAND:-}"$'\n__db_ps1'
  fi

  if (( BASH_VERSINFO[0] > 4 || (BASH_VERSINFO[0] == 4 && BASH_VERSINFO[1] >= 4) )); then
    __db_ps0=1
  elif [ -z "$(trap -p DEBUG)" ]; then
    __db_at_prompt=
    __db_preexec() {
      [ -n "${COMP_LINE:-}" ] && return
      [ -z "$__db_at_prompt" ] && return
      __db_at_prompt=
      [ "$BASH_COMMAND" = __db_precmd ] && return
      printf '\033]133;C\007'
    }
    trap '__db_preexec' DEBUG
    PROMPT_COMMAND="$PROMPT_COMMAND"$'\n__db_at_prompt=1'
  fi
fi
