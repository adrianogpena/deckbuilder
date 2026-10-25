# Kedalion shell integration for zsh: forwards __DB_FILE__ to the user's ZDOTDIR.
__db_ours=$ZDOTDIR
ZDOTDIR=${KEDALION_USER_ZDOTDIR:-$HOME}
[[ -r $ZDOTDIR/__DB_FILE__ ]] && source $ZDOTDIR/__DB_FILE__
KEDALION_USER_ZDOTDIR=$ZDOTDIR
[[ __DB_FILE__ != .zlogin ]] && ZDOTDIR=$__db_ours
unset __db_ours
