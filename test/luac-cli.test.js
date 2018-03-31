const fengari = require("fengari");
const child_process = require("child_process");

const luac_path = require.resolve("../src/luac-cli.js");


test('Has correct -v output', () => new Promise((resolve) => {
    const child = child_process.fork(luac_path, ["-v"], {
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
