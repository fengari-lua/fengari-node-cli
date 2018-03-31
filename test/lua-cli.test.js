const fengari = require("fengari");
const child_process = require("child_process");

const lua_path = require.resolve("../src/lua-cli.js");

test('Ignores env var when using -E', () => new Promise((resolve) => {
    const child = child_process.fork(lua_path, ["-E"], {
        env: { LUA_INIT: 'print("failed")' },
        silent: true
    });
    let output = ''
    child.stdout.on('data', (data) => {
        output += data;
    });
    child.on('close', (code) => {
        expect(code).toBe(0);
        expect(output).toBe('');
        resolve();
    });
}));

test('Has correct -v output', () => new Promise((resolve) => {
    const child = child_process.fork(lua_path, ["-E", "-v"], {
        silent: true
    });
    let output = '';
    child.stdout.on('data', (data) => {
        output += data;
    });
    child.on('close', (code) => {
        expect(code).toBe(0);
        expect(output).toBe(fengari.FENGARI_COPYRIGHT + "\n");
        resolve();
    });
}));

test('Runs empty script', () => new Promise((resolve) => {
    const child = child_process.fork(lua_path, ["-E", "-e", ""], {
        silent: true
    });
    let output = ''
    child.stdout.on('data', (data) => {
        output += data;
    });
    child.on('close', (code) => {
        expect(code).toBe(0);
        expect(output).toBe('');
        resolve();
    });
}));

test('Runs LUA_INIT when -E is not present', () => new Promise((resolve) => {
    const child = child_process.fork(lua_path, ["-e", ""], {
        env: { LUA_INIT: 'print("success")' },
        silent: true
    });
    let output = ''
    child.stdout.on('data', (data) => {
        output += data;
    });
    child.on('close', (code) => {
        expect(code).toBe(0);
        expect(output).toBe('success\n');
        resolve();
    });
}));
