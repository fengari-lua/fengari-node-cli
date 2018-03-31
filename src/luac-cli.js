#!/usr/bin/env node
"use strict";

const {
    FENGARI_COPYRIGHT,
    to_jsstring,
    to_luastring,
    lua: {
        LUA_OK,
        LUA_SIGNATURE,
        lua_checkstack,
        lua_close,
        lua_dump,
        lua_load,
        lua_pcall,
        lua_pushcfunction,
        lua_pushinteger,
        lua_pushlightuserdata,
        lua_tointeger,
        lua_tojsstring,
        lua_topointer,
        lua_touserdata
    },
    lauxlib: {
        luaL_loadfile,
        luaL_newstate
    }
} = require('fengari');

/* We need some fengari internals */
let fengariPath = require.resolve('fengari');
fengariPath = fengariPath.substr(0, fengariPath.lastIndexOf('/'));
const {
    constant_types: {
        LUA_TBOOLEAN,
        LUA_TLNGSTR,
        LUA_TNIL,
        LUA_TNUMFLT,
        LUA_TNUMINT,
        LUA_TSHRSTR
    }
} = require(`${fengariPath}/defs.js`);
const {
    INDEXK,
    ISK,
    OpArgK,
    OpArgN,
    OpArgU,
    OpCodes,
    OpCodesI: {
        OP_ADD,
        OP_BAND,
        OP_BOR,
        OP_BXOR,
        OP_CLOSURE,
        OP_DIV,
        OP_EQ,
        OP_EXTRAARG,
        OP_FORLOOP,
        OP_FORPREP,
        OP_GETTABLE,
        OP_GETTABUP,
        OP_GETUPVAL,
        OP_IDIV,
        OP_JMP,
        OP_LE,
        OP_LOADK,
        OP_LT,
        OP_MUL,
        OP_POW,
        OP_SELF,
        OP_SETLIST,
        OP_SETTABLE,
        OP_SETTABUP,
        OP_SETUPVAL,
        OP_SHL,
        OP_SHR,
        OP_SUB,
        OP_TFORLOOP
    },
    getBMode,
    getCMode,
    getOpMode,
    iABC,
    iABx,
    iAsBx,
    iAx
} = require(`${fengariPath}/lopcodes.js`);
const {
    LUA_INTEGER_FMT,
    LUA_NUMBER_FMT
} = require(`${fengariPath}/luaconf.js`);

const fs       = require("fs");
const sprintf  = require("sprintf-js").sprintf;

const PROGNAME = "fengaric";      /* default program name */
const OUTPUT   =  PROGNAME + ".out";  /* default output file */

let listing = false;   /* list bytecodes? */
let dumping = true;   /* dump bytecodes? */
let stripping = false; /* strip debug information? */
let output = OUTPUT;  /* actual output file name */
let progname = PROGNAME;  /* actual program name */

const print = function(message) {
    process.stdout.write(Array.isArray(message) ? Buffer.from(message) : message);
};

const fatal = function(message) {
    process.stderr.write(Buffer.from((`${progname}: ${message}\n`)));
    process.exit(1);
};

const usage = function(message) {
    if (message[0] === "-")
        process.stderr.write(Buffer.from((`${progname}: unrecognized option '${message}'\n`)));
    else
        process.stderr.write(Buffer.from((`${progname}: ${message}\n`)));

    process.stderr.write(Buffer.from((
        `usage: ${progname} [options] [filename]\n`
        + `Available options are:\n`
        + `  -l       list (use -l -l for full listing)\n`
        + `  -o name  output to file 'name' (default is "${OUTPUT}")\n`
        + `  -p       parse only\n`
        + `  -s       strip debug information\n`
        + `  -v       show version information\n`
        + `  --       stop handling options\n`
        + `  -        stop handling options and process stdin\n`
    )));

    process.exit(1);
};

const doargs = function() {
    let version = 0;
    let i;
    for (i = 2; i < process.argv.length; i++) {
        let arg = process.argv[i];

        if (arg[0] !== "-")  /* end of options; keep it */
            break;
        else if (arg === "--") {  /* end of options; skip it */
            ++i;
            if (version) ++version;
            break;
        } else if (arg === "-")   /* end of options; use stdin */
            break;
        else if (arg === "-l")  /* list */
            ++listing;
        else if (arg === "-o") {  /* output file */
            output = process.argv[++i];
            if (!output || (output[0] == "-" && output.length > 1))
                usage("'-o' needs argument");
            if (arg === "-") output = null;
        } else if (arg === "-p")  /* parse only */
            dumping = false;
        else if (arg === "s")  /* strip debug information */
            stripping = true;
        else if (arg === "-v")  /* show version */
            ++version;
        else  /* unknown option */
            usage(arg);
    }

    if (i === process.argv.length && (listing || !dumping)) {
        dumping = false;
        process.argv[--i] = OUTPUT;
    }

    if (version) {
        print(FENGARI_COPYRIGHT + "\n");
        if (version === process.argv.length - 2) process.exit(0);
    }
    return i;
};

const FUNCTION = to_luastring("(function()end)();");

const reader = function(L, ud) {
    if (ud--)
        return FUNCTION;
    else
        return null;
};

const toproto = function(L, i) {
    return lua_topointer(L, i).p;
};

const combine = function(L, n) {
    if (n === 1)
        return toproto(L, -1);
    else {
        let i = n;
        if (lua_load(L, reader, i, to_luastring(`=(${PROGNAME})`), null) !== LUA_OK)
            fatal(lua_tojsstring(L, -1));

        let f = toproto(L, -1);
        for (i = 0; i < n; i++) {
            f.p[i] = lua_topointer(L, i - n - 1).p;
            if (f.p[i].upvalues.length > 0)
                f.p[i].upvalues[0].instack = false;
        }
        f.lineinfo.length = 0;
        return f;
    }
};

const writer = function(L, p, size, u) {
    return fs.writeSync(u, Buffer.from(p), 0, size) > 0 ? 0 : 1;
};

const pmain = function(L) {
    let argc = lua_tointeger(L,1);
    let argv = lua_touserdata(L,2);

    let i;
    if (!lua_checkstack(L,argc))
        fatal("too many input files");

    for (i = 0; i < argc; i++) {
        let filename = argv[i] === "-" ? null : to_luastring(argv[i]);
        if (luaL_loadfile(L, filename) !== LUA_OK)
            fatal(lua_tojsstring(L,-1));
    }

    let f = combine(L, argc);
    if (listing)
        PrintFunction(f, listing > 1);

    if (dumping) {
        try {
            let D = (output === null) ? process.stdout.fd : fs.openSync(output, 'w');

            lua_dump(L, writer, D, stripping);
        } catch (e) {
            fatal(e.message);
        }
    }
    return 0;
};

const main = function() {
    let i = doargs();

    if (process.argv.length - i <= 0)
        usage("no input files given");

    let L = luaL_newstate();

    lua_pushcfunction(L, pmain);
    lua_pushinteger(L, process.argv.length - i);
    lua_pushlightuserdata(L, process.argv.slice(i));

    if (lua_pcall(L,2,0,0) !== LUA_OK)
        fatal(lua_tojsstring(L,-1));

    lua_close(L);
    process.exit(0);
};

const isprint = function(c) {
    return /^[\x20-\x7E]$/.test(String.fromCharCode(c));
};

const PrintString = function(ts) {
    print("\"");

    let str = ts.value.getstr();
    for (let i = 0; i < ts.value.tsslen(); i++) {
        let c = str[i];
        switch (String.fromCharCode(c)) {
            case '"':  print("\\\""); break;
            case '\\': print("\\\\"); break;
            case '\b': print("\\b"); break;
            case '\f': print("\\f"); break;
            case '\n': print("\\n"); break;
            case '\r': print("\\r"); break;
            case '\t': print("\\t"); break;
            case '\v': print("\\v"); break;
            default:
                if (isprint(c))
                    print(String.fromCharCode(c));
                else
                    print(`\\${sprintf("%03d", c)}`);
        }
    }

    print("\"");
};

const PrintConstant = function(f, i) {
    let o = f.k[i];
    switch (o.ttype()) {
        case LUA_TNIL:
            print("nil");
            break;
        case LUA_TBOOLEAN:
            print(o.value ? "true" : "false");
            break;
        case LUA_TNUMFLT: {
            let fltstr = sprintf(LUA_NUMBER_FMT, o.value);
            if (/^\d*$/.test(fltstr)) // Add .0 if no decimal part in string
                fltstr = `${fltstr}.0`;
            print(fltstr);
            break;
        }
        case LUA_TNUMINT:
            print(sprintf(LUA_INTEGER_FMT, o.value));
            break;
        case LUA_TSHRSTR: case LUA_TLNGSTR:
            PrintString(o);
            break;
        default:
            print(`? type=${o.ttype()}`);
            break;
    }
};

const UPVALNAME = function(f, x) {
    return f.upvalues[x].name ? to_jsstring(f.upvalues[x].name.getstr()) : "-";
};

const MYK = function(x) {
    return -1-x;
};

const PrintCode = function(f) {
    let code = f.code;
    for (let pc = 0; pc < code.length; pc++) {
        let i = code[pc];
        let o = i.opcode;
        let a = i.A;
        let b = i.B;
        let c = i.C;
        let ax = i.Ax;
        let bx = i.Bx;
        let sbx = i.sBx;

        let line = f.lineinfo[pc] ? f.lineinfo[pc] : -1;
        print(`\t${pc + 1}\t`);
        if (line > 0) print(`[${line}]\t`);
        else print("[-]\t");

        let opcode = OpCodes[o].substr(0,9);
        let tabfill = 9 - opcode.length;

        print(`${opcode}${" ".repeat(tabfill)}\t`);

        switch(getOpMode(o)) {
            case iABC: {
                print(`${a}`);
                if (getBMode(o) != OpArgN)
                    print(` ${ISK(b) ? MYK(INDEXK(b)) : b}`);
                if (getCMode(o) != OpArgN)
                    print(` ${ISK(c) ? MYK(INDEXK(c)) : c}`);
                break;
            }
            case iABx: {
                print(`${a}`);
                if (getBMode(o) == OpArgK) print(` ${MYK(bx)}`);
                if (getBMode(o) == OpArgU) print(` ${bx}`);
                break;
            }
            case iAsBx: {
                print(`${a} ${sbx}`);
                break;
            }
            case iAx: {
                print(`${MYK(ax)}`);
                break;
            }
        }

        switch(o) {
            case OP_LOADK: {
                print("\t; ");
                PrintConstant(f, bx);
                break;
            }
            case OP_GETUPVAL:
            case OP_SETUPVAL: {
                print(`\t; ${UPVALNAME(f, b)}`);
                break;
            }
            case OP_GETTABUP: {
                print(`\t; ${UPVALNAME(f, b)}`);
                if (ISK(c)) {
                    print(" ");
                    PrintConstant(f, INDEXK(c));
                }
                break;
            }
            case OP_SETTABUP: {
                print(`\t; ${UPVALNAME(f, a)}`);
                if (ISK(b)) {
                    print(" ");
                    PrintConstant(f, INDEXK(b));
                }
                if (ISK(c)) {
                    print(" ");
                    PrintConstant(f, INDEXK(c));
                }
                break;
            }
            case OP_GETTABLE:
            case OP_SELF: {
                if (ISK(c)) {
                    print("\t; ");
                    PrintConstant(f, INDEXK(c));
                }
                break;
            }
            case OP_SETTABLE:
            case OP_ADD:
            case OP_SUB:
            case OP_MUL:
            case OP_POW:
            case OP_DIV:
            case OP_IDIV:
            case OP_BAND:
            case OP_BOR:
            case OP_BXOR:
            case OP_SHL:
            case OP_SHR:
            case OP_EQ:
            case OP_LT:
            case OP_LE: {
                if (ISK(b) || ISK(c)) {
                    print("\t; ");
                    if (ISK(b)) PrintConstant(f, INDEXK(b));
                    else print("-");
                    print(" ");
                    if (ISK(c)) PrintConstant(f, INDEXK(c));
                    else print("-");
                }
                break;
            }
            case OP_JMP:
            case OP_FORLOOP:
            case OP_FORPREP:
            case OP_TFORLOOP: {
                print(`\t; to ${sbx + pc + 2}`);
                break;
            }
            case OP_CLOSURE: {
                print(`\t; 0x${f.p[bx].id.toString(16)}`); // TODO: %p
                break;
            }
            case OP_SETLIST: {
                if (c === 0) print(`\t; ${code[++pc]}`);
                else print(`\t; ${c}`);
                break;
            }
            case OP_EXTRAARG: {
                print("\t; ");
                PrintConstant(f, ax);
                break;
            }
            default:
                break;
        }

        print("\n");
    }
};

const SS = function(n) {
    return n === 1 ? "" : "s";
};

const PrintHeader = function(f) {
    let s = f.source ? f.source.getstr() : to_luastring("=?");
    if (s[0] === "@".charCodeAt(0) || s[0] === "=".charCodeAt(0))
        s = s.slice(1);
    else if (s[0] === LUA_SIGNATURE.charCodeAt(0))
        s = to_luastring("(bstring)");
    else
        s = to_luastring("(string)");

    print(`\n${f.linedefined === 0 ? "main" : "function"} <${to_jsstring(s)}:${f.linedefined},${f.lastlinedefined}> (${f.code.length} instruction${SS(f.code.length)} at 0x${f.id.toString(16)})\n`);
    print(`${f.numparams}${f.is_vararg ? "+" : ""} param${SS(f.numparams)}, ${f.maxstacksize} slot${SS(f.maxstacksize)}, ${f.upvalues.length} upvalue${SS(f.upvalues.length)}, `);
    print(`${f.locvars.length} local${SS(f.locvars.length)}, ${f.k.length} constant${SS(f.k.length)}, ${f.p.length} function${SS(f.p.length)}\n`);
};

const PrintDebug = function(f) {
    let n = f.k.length;
    print(`constants (${n}) for 0x${f.id.toString(16)}:\n`);
    for (let i = 0; i < n; i++) {
        print(`\t${i + 1}\t`);
        PrintConstant(f, i);
        print("\n");
    }

    n = f.locvars.length;
    print(`locals (${n}) for 0x${f.id.toString(16)}:\n`);
    for (let i = 0; i < n; i++) {
        let locvar = f.locvars[i];
        print(`\t${i}\t${to_jsstring(locvar.varname.getstr())}\t${locvar.startpc + 1}\t${locvar.endpc + 1}\n`);
    }

    n = f.upvalues.length;
    print(`upvalues (${n}) for 0x${f.id.toString(16)}:\n`);
    for (let i = 0; i < n; i++) {
        print(`\t${i}\t${UPVALNAME(f, i)}\t${f.upvalues[i].instack ? 1 : 0}\t${f.upvalues[i].idx}\n`);
    }
};

const PrintFunction = function(f, full) {
    let n = f.p.length;
    PrintHeader(f);
    PrintCode(f);
    if (full) PrintDebug(f);
    for (let i = 0; i < n; i++)
        PrintFunction(f.p[i], full);
};

main();
