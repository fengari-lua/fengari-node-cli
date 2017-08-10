#!/usr/bin/env node
"use strict";

global.WEB = false;

// We need some fengari internals
let fengariPath = require.resolve("fengari");
fengariPath = fengariPath.substr(0, fengariPath.lastIndexOf("/"));

const lua      = require(`${fengariPath}/lua.js`);
const CT       = require(`${fengariPath}/defs.js`).CT;
const lauxlib  = require(`${fengariPath}/lauxlib.js`);
const luaconf  = require(`${fengariPath}/luaconf.js`);
const lopcodes = require(`${fengariPath}/lopcodes.js`);
const ops      = lopcodes.OpCodesI;

const fs       = require("fs");
const sprintf  = require("sprintf-js").sprintf;

const PROGNAME = "luac";      /* default program name */
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
        + `  -o name  output to file 'name' (default is \"%{OUTPUT}\")\n`
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
        print(lua.LUA_COPYRIGHT);
        if (version === process.argv.length - 2) process.exit(0);
    }
    return i;
};

const FUNCTION = "(function()end)();";

const reader = function(L, ud) {
    if (ud--)
        return lua.to_luastring(FUNCTION);
    else
        return null;
};

const combine = function(L, n) {
    if (n === 1)
        return lua.lua_topointer(L, -1).p;
    else {
        let i = n;
        if (lua.lua_load(L, reader, i, lua.to_luastring(`=(${PROGNAME})`), null) !== lua.LUA_OK)
            fatal(lua.lua_tojsstring(L, -1));

        let f = lua.lua_topointer(L, -1).p;
        for (i = 0; i < n; i++) {
            f.p[i] = lua.lua_topointer(L, i - n - 1).p;
            if (f.p[i].upvalues.length > 0)
                f.p[i].upvalues[0].instack = false;
        }
        f.lineinfo.length = 0;
        return f;
    }
};

const writer = function(L, p, size, u) {
    return fs.writeSync(u, new Buffer(p), 0, size) > 0 ? 0 : 1;
};

const pmain = function(L) {
    let argc = lua.lua_tointeger(L,1);
    let argv = lua.lua_touserdata(L,2);

    let i;
    if (!lua.lua_checkstack(L,argc))
        fatal("too many input files");

    for (i = 0; i < argc; i++) {
        let filename = argv[i] === "-" ? null : argv[i];
        if (lauxlib.luaL_loadfile(L, lua.to_luastring(filename)) !== lua.LUA_OK)
            fatal(lua.to_jstring(lua.lua_tostring(L,-1)));
    }

    let f = combine(L, argc);
    if (listing)
        PrintFunction(f, listing > 1);

    if (dumping) {
        try {
            let D = (output === null) ? process.stdout.fd : fs.openSync(output, 'w');

            lua.lua_dump(L, writer, D, stripping);
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

    let L = lauxlib.luaL_newstate();

    lua.lua_pushcfunction(L, pmain);
    lua.lua_pushinteger(L, process.argv.length - i);
    lua.lua_pushlightuserdata(L, process.argv.slice(i));

    if (lua.lua_pcall(L,2,0,0) !== lua.LUA_OK)
        fatal(lua.lua_tostring(L,-1));

    lua.lua_close(L);
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
                    print(`0x${c.toString(16)}`);
        }
    }

    print("\"");
};

const PrintConstant = function(f, i) {
    let o = f.k[i];
    switch (o.ttype()) {
        case CT.LUA_TNIL:
            print("nil");
            break;
        case CT.LUA_TBOOLEAN:
            print(o.value ? "true" : "false");
            break;
        case CT.LUA_TNUMFLT: {
            let fltstr = sprintf(luaconf.LUA_NUMBER_FMT, o.value);
            if (/^\d*$/.test(fltstr)) // Add .0 if no decimal part in string
                fltstr = `${fltstr}.0`;
            print(fltstr);
            break;
        }
        case CT.LUA_TNUMINT:
            print(sprintf("%d", o.value));
            break;
        case CT.LUA_TSHRSTR: case CT.LUA_TLNGSTR:
            PrintString(o);
            break;
        default:
            print(`? type=${o.ttype()}`);
            break;
    }
};

const UPVALNAME = function(f, x) {
    return f.upvalues[x].name ? lua.to_jsstring(f.upvalues[x].name.getstr()) : "-";
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

        print(`${lopcodes.OpCodes[o].substr(0,9)}\t`);

        switch(lopcodes.getOpMode(o)) {
            case lopcodes.iABC: {
                print(`${a}`);
                if (lopcodes.getBMode(o) != lopcodes.OpArgN)
                    print(` ${lopcodes.ISK(b) ? MYK(lopcodes.INDEXK(b)) : b}`);
                if (lopcodes.getCMode(o) != lopcodes.OpArgN)
                    print(` ${lopcodes.ISK(c) ? MYK(lopcodes.INDEXK(c)) : c}`);
                break;
            }
            case lopcodes.iABx: {
                print(`${a}`);
                if (lopcodes.getBMode(o) == lopcodes.OpArgK) print(` ${MYK(bx)}`);
                if (lopcodes.getBMode(o) == lopcodes.OpArgU) print(` bx`);
                break;
            }
            case lopcodes.iAsBx: {
                print(`${a} ${sbx}`);
                break;
            }
            case lopcodes.iAx: {
                print(`${MYK(ax)}`);
                break;
            }
        }

        switch(o) {
            case ops.OP_LOADK: {
                print("\t; ");
                PrintConstant(f, bx);
                break;
            }
            case ops.OP_GETUPVAL:
            case ops.OP_SETUPVAL: {
                print(`\t; ${UPVALNAME(f, b)}`);
                break;
            }
            case ops.OP_GETTABUP: {
                print(`\t; ${UPVALNAME(f, b)}`);
                if (lopcodes.ISK(c)) {
                    print(" ");
                    PrintConstant(f, lopcodes.INDEXK(c));
                }
                break;
            }
            case ops.OP_SETTABUP: {
                print(`\t; ${UPVALNAME(f, a)}`);
                if (lopcodes.ISK(b)) {
                    print(" ");
                    PrintConstant(f, lopcodes.INDEXK(b));
                }
                if (lopcodes.ISK(c)) {
                    print(" ");
                    PrintConstant(f, lopcodes.INDEXK(c));
                }
                break;
            }
            case ops.OP_GETTABLE:
            case ops.OP_SELF: {
                if (lopcodes.ISK(c)) {
                    print("\t; ");
                    PrintConstant(f, lopcodes.INDEXK(c));
                }
                break;
            }
            case ops.OP_SETTABLE:
            case ops.OP_ADD:
            case ops.OP_SUB:
            case ops.OP_MUL:
            case ops.OP_POW:
            case ops.OP_DIV:
            case ops.OP_IDIV:
            case ops.OP_BAND:
            case ops.OP_BOR:
            case ops.OP_BXOR:
            case ops.OP_SHL:
            case ops.OP_SHR:
            case ops.OP_EQ:
            case ops.OP_LT:
            case ops.OP_LE: {
                if (lopcodes.ISK(b) || lopcodes.ISK(c)) {
                    print("\t; ");
                    if (lopcodes.ISK(b)) PrintConstant(f, lopcodes.INDEXK(b));
                    else print("-");
                    if (lopcodes.ISK(c)) PrintConstant(f, lopcodes.INDEXK(c));
                    else print("-");
                }
                break;
            }
            case ops.OP_JMP:
            case ops.OP_FORLOOP:
            case ops.OP_FORPREP:
            case ops.OP_TFORLOOP: {
                print(`\t; to ${sbx + pc + 2}`);
                break;
            }
            case ops.OP_CLOSURE: {
                print(`\t; 0x${f.p[bx].id.toString(16)}`); // TODO: %p
                break;
            }
            case ops.OP_SETLIST: {
                if (c === 0) print(`\t; ${code[++pc]}`);
                else print(`\t; ${c}`);
                break;
            }
            case ops.OP_EXTRAARG: {
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
    return n > 1 ? "s" : "";
};

const PrintHeader = function(f) {
    let s = f.source ? f.source.getstr() : lua.to_luastring("=?");
    if (s[0] === "@".charCodeAt(0) || s[0] === "=".charCodeAt(0))
        s = s.slice(1);
    else if (s[0] === lua.LUA_SIGNATURE.charCodeAt(0))
        s = lua.to_luastring("(bstring");
    else
        s = lua.to_luastring("(string");

    print(`\n${f.linedefined === 0 ? "main" : "function"} <${lua.to_jsstring(s)}:${f.linedefined},${f.lastlinedefined}> (${f.code.length} instruction${SS(f.code.length)} at 0x${f.id.toString(16)})\n`);
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
        print(`\t${i}\t${lua.to_jsstring(locvar.varname.getstr())}\t${locvar.startpc + 1}\t${locvar.endpc + 1}\n`);
    }

    n = f.upvalues.length;
    print(`upvalues (${n}) for 0x${f.id.toString(16)}:\n`);
    for (let i = 0; i < n; i++) {
        print(`\t${i}\t${UPVALNAME(f, i)}\t${f.upvalues[i].instack ? 1 : 0}\t${f.upvalues[i].idx}\n`);
    }
};

const PrintFunction = function(f, full) {
    PrintHeader(f);
    PrintCode(f);
    if (full) PrintDebug(f);
    for (let i = 0; i < f.p.length; i++)
        PrintFunction(f.p[i], full);
};

main();
