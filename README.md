[![Build Status](https://travis-ci.org/fengari-lua/fengari-node-cli.svg?branch=master)](https://travis-ci.org/fengari-lua/fengari-node-cli)
[![npm](https://img.shields.io/npm/v/fengari-node-cli.svg)](https://npmjs.com/package/fengari-node-cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![#fengari on libera.chat](https://img.shields.io/badge/chat-%23fengari-brightgreen)](https://web.libera.chat/?channels=#fengari)


# fengari-node-cli

The Lua command line application, but using [fengari](https://fengari.io/) under [node.js](https://nodejs.org/)

This project consists of `fengari` and `fengaric` command line applications that provide functionality equivalent to the [`lua`](http://www.lua.org/manual/5.3/manual.html#7) and [`luac`](https://www.lua.org/manual/5.3/luac.html) programs.

## Installation

Use `npm` or [`yarn`](http://yarnpkg.com/):

```bash
npm install -g fengari-node-cli
```


## Usage

```
usage: fengari [options] [script [args]]
Available options are:
  -e stat  execute string 'stat'
  -i       enter interactive mode after executing 'script'
  -l name  require library 'name'
  -v       show version information
  -E       ignore environment variables
  --       stop handling options
  -        stop handling options and execute stdin
```

```
usage: fengaric [options] [filename]
Available options are:
  -l       list (use -l -l for full listing)
  -o name  output to file 'name' (default is "fengaric.out")
  -p       parse only
  -s       strip debug information
  -v       show version information
  --       stop handling options
  -        stop handling options and process stdin
```
