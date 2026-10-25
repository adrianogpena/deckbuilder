# Kedalion shell integration for fish, run with --init-command after the user's config.
if not set -q __db_si
    set -g __db_si 1
    function __db_prompt --on-event fish_prompt
        printf '\e]7;file://%s%s\a' $hostname (string replace -a % %25 -- $PWD)
    end
    function __db_preexec --on-event fish_preexec
        printf '\e]133;C\a'
    end
    function __db_postexec --on-event fish_postexec
        printf '\e]133;D;%s\a' $status
    end
    if functions -q fish_prompt
        functions -c fish_prompt __db_user_prompt
        function fish_prompt
            printf '\e]133;A\a'
            __db_user_prompt
            printf '\e]133;B\a'
        end
    end
end
