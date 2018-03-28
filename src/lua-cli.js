#!/usr/bin/env node
"use strict";

const {
    FENGARI_COPYRIGHT,
    to_jsstring,
    to_luastring,
    lua: {
        LUA_ERRSYNTAX,
        LUA_MULTRET,
        LUA_OK,
        LUA_REGISTRYINDEX,
        LUA_TSTRING,
        LUA_TTABLE,
        lua_createtable,
        lua_getglobal,
        lua_gettop,
        lua_insert,
        lua_pcall,
        lua_pop,
        lua_pushboolean,
        lua_pushcfunction,
        lua_pushliteral,
        lua_pushstring,
        lua_rawgeti,
        lua_remove,
        lua_setfield,
        lua_setglobal,
        lua_seti,
        lua_settop,
        lua_tojsstring,
        lua_tostring,
        lua_type
    },
    lauxlib: {
        luaL_callmeta,
        luaL_checkstack,
        luaL_error,
        luaL_len,
        luaL_loadbuffer,
        luaL_loadfile,
        luaL_newstate,
        luaL_traceback,
        luaL_typename,
        lua_writestringerror
    },
    lualib: {
        LUA_VERSUFFIX,
        luaL_openlibs
    }
} = require('fengari');

const readlineSync = require('readline-sync');

const stdin = to_luastring("=stdin");
const _PROMPT = to_luastring("_PROMPT");
const _PROMPT2 = to_luastring("_PROMPT2");

const LUA_INIT_VAR = "LUA_INIT";
const LUA_INITVARVERSION = LUA_INIT_VAR + LUA_VERSUFFIX;

const report = function(L, status) {
    if (status !== LUA_OK) {
        lua_writestringerror(`${lua_tojsstring(L, -1)}\n`);
        lua_pop(L, 1);
    }
    return status;
};

const msghandler = function(L) {
    let msg = lua_tostring(L, 1);
    if (msg === null) {  /* is error object not a string? */
        if (luaL_callmeta(L, 1, to_luastring("__tostring")) &&  /* does it have a metamethod */
          lua_type(L, -1) == LUA_TSTRING)  /* that produces a string? */
            return 1;  /* that is the message */
        else
            msg = lua_pushstring(L, to_luastring(`(error object is a ${to_jsstring(luaL_typename(L, 1))} value)`));
    }
    luaL_traceback(L, L, msg, 1);  /* append a standard traceback */
    return 1;  /* return the traceback */
};

const docall = function(L, narg, nres) {
    let base = lua_gettop(L) - narg;
    lua_pushcfunction(L, msghandler);
    lua_insert(L, base);
    let status = lua_pcall(L, narg, nres, base);
    lua_remove(L, base);
    return status;
};

const dochunk = function(L, status) {
    if (status === LUA_OK) {
        status = docall(L, 0, 0);
    }
    return report(L, status);
};

const dofile = function(L, name) {
    return dochunk(L, luaL_loadfile(L, name?to_luastring(name):null));
};

const dostring = function(L, s, name) {
    let buffer = to_luastring(s);
    return dochunk(L, luaL_loadbuffer(L, buffer, buffer.length, to_luastring(name)));
};

const dolibrary = function(L, name) {
    lua_getglobal(L, to_luastring("require"));
    lua_pushliteral(L, name);
    let status = docall(L, 1, 1);  /* call 'require(name)' */
    if (status === LUA_OK)
        lua_setglobal(L, to_luastring(name));  /* global[name] = require return */
    return report(L, status);
};

let progname = process.argv[1];

const print_usage = function(badoption) {
    lua_writestringerror(`${progname}: `);
    if (badoption[1] === "e" || badoption[1] === "l")
        lua_writestringerror(`'${badoption}' needs argument\n`);
    else
        lua_writestringerror(`'unrecognized option '${badoption}'\n`);
    lua_writestringerror(
        `usage: ${progname} [options] [script [args]]\n` +
        "Available options are:\n" +
        "  -e stat  execute string 'stat'\n" +
        "  -i       enter interactive mode after executing 'script'\n" +
        "  -l name  require library 'name'\n" +
        "  -v       show version information\n" +
        "  -E       ignore environment variables\n" +
        "  --       stop handling options\n" +
        "  -        stop handling options and execute stdin\n"
    );
};

const L = luaL_newstate();

let script = 2; // Where to start args from
let has_E = false;
let has_i = false;
let has_v = false;
let has_e = false;

(function() {
    let i;
    for (i = 2; i<process.argv.length; i++) {
        script = i;
        if (process.argv[i][0] != "-") {
            return;
        }
        switch(process.argv[i][1]) {
            case '-':
                if (process.argv[i][2]) {
                    print_usage(process.argv[script]);
                    return process.exit(1);
                }
                script = i + 1;
                return;
            case void 0: /* script name is '-' */
                return;
            case 'E':
                has_E = true;
                break;
            case 'i':
                has_i = true;
                /* (-i implies -v) */
                /* falls through */
            case 'v':
                if (process.argv[i].length > 2) {
                    /* invalid option */
                    print_usage(process.argv[script]);
                    return process.exit(1);
                }
                has_v = true;
                break;
            case 'e':
                has_e = true;
                /* falls through */
            case 'l':  /* both options need an argument */
                if (process.argv[i].length < 3) {  /* no concatenated argument? */
                    i++;  /* try next 'process.argv' */
                    if (process.argv.length <= i || process.argv[i][0] === '-') {
                        /* no next argument or it is another option */
                        print_usage(process.argv[script]);
                        return process.exit(1);
                    }
                }
                break;
            default:  /* invalid option */
                print_usage(process.argv[script]);
                return process.exit(1);
        }
    }
    script = i;
})();

if (has_v)
    console.log(FENGARI_COPYRIGHT);

if (has_E) {
    /* signal for libraries to ignore env. vars. */
    lua_pushboolean(L, 1);
    lua_setfield(L, LUA_REGISTRYINDEX, to_luastring("LUA_NOENV"));
}

/* open standard libraries */
luaL_openlibs(L);

/* create table 'arg' */
lua_createtable(L, process.argv.length - (script + 1), script + 1);
for (let i = 0; i < process.argv.length; i++) {
    lua_pushliteral(L, process.argv[i]);
    lua_seti(L, -2, i - script); /* TODO: rawseti */
}
lua_setglobal(L, to_luastring("arg"));

if (!has_E) {
    /* run LUA_INIT */
    let name = LUA_INITVARVERSION;
    let init = process.env[name];
    if (!init) {
        name = LUA_INIT_VAR;
        init = process.env[name];
    }
    if (init) {
        let status;
        if (init[0] === '@') {
            status = dofile(L, init.substring(1));
        } else {
            status = dostring(L, init, name);
        }
        if (status !== LUA_OK) {
            return process.exit(1);
        }
    }
}

/* execute arguments -e and -l */
for (let i = 1; i < script; i++) {
    let option = process.argv[i][1];
    if (option == 'e' || option == 'l') {
        let extra = process.argv[i].substring(2); /* both options need an argument */
        if (extra.length === 0)
            extra = process.argv[++i];
        let status;
        if (option == 'e') {
            status = dostring(L, extra, "=(command line)");
        } else {
            status = dolibrary(L, extra);
        }
        if (status !== LUA_OK) {
            return process.exit(1);
        }
    }
}

const pushargs = function(L) {
    if (lua_getglobal(L, to_luastring("arg")) !== LUA_TTABLE)
        luaL_error(L, to_luastring("'arg' is not a table"));
    let n = luaL_len(L, -1);
    luaL_checkstack(L, n+3, to_luastring("too many arguments to script"));
    let i;
    for (i=1; i<=n; i++)
        lua_rawgeti(L, -i, i);
    lua_remove(L, -i);
    return n;
};

const handle_script = function(L, argv) {
    let fname = argv[0];
    let status;
    if (fname === "-" && argv[-1] !== "--")
        fname = null;  /* stdin */
    else
        fname = to_luastring(fname);
    status = luaL_loadfile(L, fname);
    if (status === LUA_OK) {
        let n = pushargs(L); /* push arguments to script */
        status = docall(L, n, LUA_MULTRET);
    }
    return report(L, status);
};

const doREPL = function(L) {
    for (;;) {
        lua_getglobal(L, _PROMPT);
        let input = readlineSync.prompt({
            prompt: lua_tojsstring(L, -1) || '> '
        });
        lua_pop(L, 1);

        if (input.length === 0)
            continue;

        let status;
        {
            let buffer = to_luastring("return " + input);
            status = luaL_loadbuffer(L, buffer, buffer.length, stdin);
        }
        if (status !== LUA_OK) {
            lua_pop(L, 1);
            let buffer = to_luastring(input);
            if (luaL_loadbuffer(L, buffer, buffer.length, stdin) === LUA_OK) {
                status = LUA_OK;
            }
        }
        while (status === LUA_ERRSYNTAX && lua_tojsstring(L, -1).endsWith("<eof>")) {
            /* continuation */
            lua_pop(L, 1);
            lua_getglobal(L, _PROMPT2);
            input += "\n" + readlineSync.prompt({
                prompt: lua_tojsstring(L, -1) || '>> '
            });
            lua_pop(L, 1);
            let buffer = to_luastring(input);
            status = luaL_loadbuffer(L, buffer, buffer.length, stdin);
        }
        if (status === LUA_OK) {
            status = docall(L, 0, LUA_MULTRET);
        }
        if (status === LUA_OK) {
            let n = lua_gettop(L);
            if (n > 0) {  /* any result to be printed? */
                lua_getglobal(L, to_luastring("print"));
                lua_insert(L, 1);
                if (lua_pcall(L, n, 0, 0) != LUA_OK) {
                    lua_writestringerror(`error calling 'print' (${lua_tojsstring(L, -1)})\n`);
                }
            }
        } else {
            report(L, status);
        }
        lua_settop(L, 0);  /* remove eventual returns */
    }
};

if (script < process.argv.length &&  /* execute main script (if there is one) */
    handle_script(L, process.argv.slice(script)) !== LUA_OK) {
    /* success */
} else if (has_i) {
    doREPL(L);
} else if (script == process.argv.length && !has_e && !has_v) {  /* no arguments? */
    if (process.stdin.isTTY) {  /* running in interactive mode? */
        console.log(FENGARI_COPYRIGHT);
        doREPL(L);  /* do read-eval-print loop */
    } else {
        dofile(L, null);
    }
}
