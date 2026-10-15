# DeckBuilder shell integration for zsh: forwards __DB_FILE__ to the user's ZDOTDIR.
__db_ours=$ZDOTDIR
ZDOTDIR=${DECKBUILDER_USER_ZDOTDIR:-$HOME}
[[ -r $ZDOTDIR/__DB_FILE__ ]] && source $ZDOTDIR/__DB_FILE__
DECKBUILDER_USER_ZDOTDIR=$ZDOTDIR
[[ __DB_FILE__ != .zlogin ]] && ZDOTDIR=$__db_ours
unset __db_ours
