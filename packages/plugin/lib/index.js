var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var __commonJS = (cb, mod) => function __require2() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// ../../node_modules/.pnpm/graceful-fs@4.2.11/node_modules/graceful-fs/polyfills.js
var require_polyfills = __commonJS({
  "../../node_modules/.pnpm/graceful-fs@4.2.11/node_modules/graceful-fs/polyfills.js"(exports, module) {
    var constants = __require("constants");
    var origCwd = process.cwd;
    var cwd = null;
    var platform = process.env.GRACEFUL_FS_PLATFORM || process.platform;
    process.cwd = function() {
      if (!cwd)
        cwd = origCwd.call(process);
      return cwd;
    };
    try {
      process.cwd();
    } catch (er) {
    }
    if (typeof process.chdir === "function") {
      chdir = process.chdir;
      process.chdir = function(d) {
        cwd = null;
        chdir.call(process, d);
      };
      if (Object.setPrototypeOf) Object.setPrototypeOf(process.chdir, chdir);
    }
    var chdir;
    module.exports = patch;
    function patch(fs) {
      if (constants.hasOwnProperty("O_SYMLINK") && process.version.match(/^v0\.6\.[0-2]|^v0\.5\./)) {
        patchLchmod(fs);
      }
      if (!fs.lutimes) {
        patchLutimes(fs);
      }
      fs.chown = chownFix(fs.chown);
      fs.fchown = chownFix(fs.fchown);
      fs.lchown = chownFix(fs.lchown);
      fs.chmod = chmodFix(fs.chmod);
      fs.fchmod = chmodFix(fs.fchmod);
      fs.lchmod = chmodFix(fs.lchmod);
      fs.chownSync = chownFixSync(fs.chownSync);
      fs.fchownSync = chownFixSync(fs.fchownSync);
      fs.lchownSync = chownFixSync(fs.lchownSync);
      fs.chmodSync = chmodFixSync(fs.chmodSync);
      fs.fchmodSync = chmodFixSync(fs.fchmodSync);
      fs.lchmodSync = chmodFixSync(fs.lchmodSync);
      fs.stat = statFix(fs.stat);
      fs.fstat = statFix(fs.fstat);
      fs.lstat = statFix(fs.lstat);
      fs.statSync = statFixSync(fs.statSync);
      fs.fstatSync = statFixSync(fs.fstatSync);
      fs.lstatSync = statFixSync(fs.lstatSync);
      if (fs.chmod && !fs.lchmod) {
        fs.lchmod = function(path, mode, cb) {
          if (cb) process.nextTick(cb);
        };
        fs.lchmodSync = function() {
        };
      }
      if (fs.chown && !fs.lchown) {
        fs.lchown = function(path, uid, gid, cb) {
          if (cb) process.nextTick(cb);
        };
        fs.lchownSync = function() {
        };
      }
      if (platform === "win32") {
        fs.rename = typeof fs.rename !== "function" ? fs.rename : function(fs$rename) {
          function rename(from, to, cb) {
            var start = Date.now();
            var backoff = 0;
            fs$rename(from, to, function CB(er) {
              if (er && (er.code === "EACCES" || er.code === "EPERM" || er.code === "EBUSY") && Date.now() - start < 6e4) {
                setTimeout(function() {
                  fs.stat(to, function(stater, st) {
                    if (stater && stater.code === "ENOENT")
                      fs$rename(from, to, CB);
                    else
                      cb(er);
                  });
                }, backoff);
                if (backoff < 100)
                  backoff += 10;
                return;
              }
              if (cb) cb(er);
            });
          }
          if (Object.setPrototypeOf) Object.setPrototypeOf(rename, fs$rename);
          return rename;
        }(fs.rename);
      }
      fs.read = typeof fs.read !== "function" ? fs.read : function(fs$read) {
        function read(fd, buffer, offset, length, position, callback_) {
          var callback;
          if (callback_ && typeof callback_ === "function") {
            var eagCounter = 0;
            callback = function(er, _, __) {
              if (er && er.code === "EAGAIN" && eagCounter < 10) {
                eagCounter++;
                return fs$read.call(fs, fd, buffer, offset, length, position, callback);
              }
              callback_.apply(this, arguments);
            };
          }
          return fs$read.call(fs, fd, buffer, offset, length, position, callback);
        }
        if (Object.setPrototypeOf) Object.setPrototypeOf(read, fs$read);
        return read;
      }(fs.read);
      fs.readSync = typeof fs.readSync !== "function" ? fs.readSync : /* @__PURE__ */ function(fs$readSync) {
        return function(fd, buffer, offset, length, position) {
          var eagCounter = 0;
          while (true) {
            try {
              return fs$readSync.call(fs, fd, buffer, offset, length, position);
            } catch (er) {
              if (er.code === "EAGAIN" && eagCounter < 10) {
                eagCounter++;
                continue;
              }
              throw er;
            }
          }
        };
      }(fs.readSync);
      function patchLchmod(fs2) {
        fs2.lchmod = function(path, mode, callback) {
          fs2.open(
            path,
            constants.O_WRONLY | constants.O_SYMLINK,
            mode,
            function(err, fd) {
              if (err) {
                if (callback) callback(err);
                return;
              }
              fs2.fchmod(fd, mode, function(err2) {
                fs2.close(fd, function(err22) {
                  if (callback) callback(err2 || err22);
                });
              });
            }
          );
        };
        fs2.lchmodSync = function(path, mode) {
          var fd = fs2.openSync(path, constants.O_WRONLY | constants.O_SYMLINK, mode);
          var threw = true;
          var ret;
          try {
            ret = fs2.fchmodSync(fd, mode);
            threw = false;
          } finally {
            if (threw) {
              try {
                fs2.closeSync(fd);
              } catch (er) {
              }
            } else {
              fs2.closeSync(fd);
            }
          }
          return ret;
        };
      }
      function patchLutimes(fs2) {
        if (constants.hasOwnProperty("O_SYMLINK") && fs2.futimes) {
          fs2.lutimes = function(path, at, mt, cb) {
            fs2.open(path, constants.O_SYMLINK, function(er, fd) {
              if (er) {
                if (cb) cb(er);
                return;
              }
              fs2.futimes(fd, at, mt, function(er2) {
                fs2.close(fd, function(er22) {
                  if (cb) cb(er2 || er22);
                });
              });
            });
          };
          fs2.lutimesSync = function(path, at, mt) {
            var fd = fs2.openSync(path, constants.O_SYMLINK);
            var ret;
            var threw = true;
            try {
              ret = fs2.futimesSync(fd, at, mt);
              threw = false;
            } finally {
              if (threw) {
                try {
                  fs2.closeSync(fd);
                } catch (er) {
                }
              } else {
                fs2.closeSync(fd);
              }
            }
            return ret;
          };
        } else if (fs2.futimes) {
          fs2.lutimes = function(_a, _b, _c, cb) {
            if (cb) process.nextTick(cb);
          };
          fs2.lutimesSync = function() {
          };
        }
      }
      function chmodFix(orig) {
        if (!orig) return orig;
        return function(target, mode, cb) {
          return orig.call(fs, target, mode, function(er) {
            if (chownErOk(er)) er = null;
            if (cb) cb.apply(this, arguments);
          });
        };
      }
      function chmodFixSync(orig) {
        if (!orig) return orig;
        return function(target, mode) {
          try {
            return orig.call(fs, target, mode);
          } catch (er) {
            if (!chownErOk(er)) throw er;
          }
        };
      }
      function chownFix(orig) {
        if (!orig) return orig;
        return function(target, uid, gid, cb) {
          return orig.call(fs, target, uid, gid, function(er) {
            if (chownErOk(er)) er = null;
            if (cb) cb.apply(this, arguments);
          });
        };
      }
      function chownFixSync(orig) {
        if (!orig) return orig;
        return function(target, uid, gid) {
          try {
            return orig.call(fs, target, uid, gid);
          } catch (er) {
            if (!chownErOk(er)) throw er;
          }
        };
      }
      function statFix(orig) {
        if (!orig) return orig;
        return function(target, options, cb) {
          if (typeof options === "function") {
            cb = options;
            options = null;
          }
          function callback(er, stats) {
            if (stats) {
              if (stats.uid < 0) stats.uid += 4294967296;
              if (stats.gid < 0) stats.gid += 4294967296;
            }
            if (cb) cb.apply(this, arguments);
          }
          return options ? orig.call(fs, target, options, callback) : orig.call(fs, target, callback);
        };
      }
      function statFixSync(orig) {
        if (!orig) return orig;
        return function(target, options) {
          var stats = options ? orig.call(fs, target, options) : orig.call(fs, target);
          if (stats) {
            if (stats.uid < 0) stats.uid += 4294967296;
            if (stats.gid < 0) stats.gid += 4294967296;
          }
          return stats;
        };
      }
      function chownErOk(er) {
        if (!er)
          return true;
        if (er.code === "ENOSYS")
          return true;
        var nonroot = !process.getuid || process.getuid() !== 0;
        if (nonroot) {
          if (er.code === "EINVAL" || er.code === "EPERM")
            return true;
        }
        return false;
      }
    }
  }
});

// ../../node_modules/.pnpm/graceful-fs@4.2.11/node_modules/graceful-fs/legacy-streams.js
var require_legacy_streams = __commonJS({
  "../../node_modules/.pnpm/graceful-fs@4.2.11/node_modules/graceful-fs/legacy-streams.js"(exports, module) {
    var Stream = __require("stream").Stream;
    module.exports = legacy;
    function legacy(fs) {
      return {
        ReadStream,
        WriteStream
      };
      function ReadStream(path, options) {
        if (!(this instanceof ReadStream)) return new ReadStream(path, options);
        Stream.call(this);
        var self = this;
        this.path = path;
        this.fd = null;
        this.readable = true;
        this.paused = false;
        this.flags = "r";
        this.mode = 438;
        this.bufferSize = 64 * 1024;
        options = options || {};
        var keys = Object.keys(options);
        for (var index = 0, length = keys.length; index < length; index++) {
          var key = keys[index];
          this[key] = options[key];
        }
        if (this.encoding) this.setEncoding(this.encoding);
        if (this.start !== void 0) {
          if ("number" !== typeof this.start) {
            throw TypeError("start must be a Number");
          }
          if (this.end === void 0) {
            this.end = Infinity;
          } else if ("number" !== typeof this.end) {
            throw TypeError("end must be a Number");
          }
          if (this.start > this.end) {
            throw new Error("start must be <= end");
          }
          this.pos = this.start;
        }
        if (this.fd !== null) {
          process.nextTick(function() {
            self._read();
          });
          return;
        }
        fs.open(this.path, this.flags, this.mode, function(err, fd) {
          if (err) {
            self.emit("error", err);
            self.readable = false;
            return;
          }
          self.fd = fd;
          self.emit("open", fd);
          self._read();
        });
      }
      function WriteStream(path, options) {
        if (!(this instanceof WriteStream)) return new WriteStream(path, options);
        Stream.call(this);
        this.path = path;
        this.fd = null;
        this.writable = true;
        this.flags = "w";
        this.encoding = "binary";
        this.mode = 438;
        this.bytesWritten = 0;
        options = options || {};
        var keys = Object.keys(options);
        for (var index = 0, length = keys.length; index < length; index++) {
          var key = keys[index];
          this[key] = options[key];
        }
        if (this.start !== void 0) {
          if ("number" !== typeof this.start) {
            throw TypeError("start must be a Number");
          }
          if (this.start < 0) {
            throw new Error("start must be >= zero");
          }
          this.pos = this.start;
        }
        this.busy = false;
        this._queue = [];
        if (this.fd === null) {
          this._open = fs.open;
          this._queue.push([this._open, this.path, this.flags, this.mode, void 0]);
          this.flush();
        }
      }
    }
  }
});

// ../../node_modules/.pnpm/graceful-fs@4.2.11/node_modules/graceful-fs/clone.js
var require_clone = __commonJS({
  "../../node_modules/.pnpm/graceful-fs@4.2.11/node_modules/graceful-fs/clone.js"(exports, module) {
    "use strict";
    module.exports = clone;
    var getPrototypeOf = Object.getPrototypeOf || function(obj) {
      return obj.__proto__;
    };
    function clone(obj) {
      if (obj === null || typeof obj !== "object")
        return obj;
      if (obj instanceof Object)
        var copy = { __proto__: getPrototypeOf(obj) };
      else
        var copy = /* @__PURE__ */ Object.create(null);
      Object.getOwnPropertyNames(obj).forEach(function(key) {
        Object.defineProperty(copy, key, Object.getOwnPropertyDescriptor(obj, key));
      });
      return copy;
    }
  }
});

// ../../node_modules/.pnpm/graceful-fs@4.2.11/node_modules/graceful-fs/graceful-fs.js
var require_graceful_fs = __commonJS({
  "../../node_modules/.pnpm/graceful-fs@4.2.11/node_modules/graceful-fs/graceful-fs.js"(exports, module) {
    var fs = __require("fs");
    var polyfills = require_polyfills();
    var legacy = require_legacy_streams();
    var clone = require_clone();
    var util = __require("util");
    var gracefulQueue;
    var previousSymbol;
    if (typeof Symbol === "function" && typeof Symbol.for === "function") {
      gracefulQueue = Symbol.for("graceful-fs.queue");
      previousSymbol = Symbol.for("graceful-fs.previous");
    } else {
      gracefulQueue = "___graceful-fs.queue";
      previousSymbol = "___graceful-fs.previous";
    }
    function noop() {
    }
    function publishQueue(context, queue2) {
      Object.defineProperty(context, gracefulQueue, {
        get: function() {
          return queue2;
        }
      });
    }
    var debug = noop;
    if (util.debuglog)
      debug = util.debuglog("gfs4");
    else if (/\bgfs4\b/i.test(process.env.NODE_DEBUG || ""))
      debug = function() {
        var m = util.format.apply(util, arguments);
        m = "GFS4: " + m.split(/\n/).join("\nGFS4: ");
        console.error(m);
      };
    if (!fs[gracefulQueue]) {
      queue = global[gracefulQueue] || [];
      publishQueue(fs, queue);
      fs.close = function(fs$close) {
        function close(fd, cb) {
          return fs$close.call(fs, fd, function(err) {
            if (!err) {
              resetQueue();
            }
            if (typeof cb === "function")
              cb.apply(this, arguments);
          });
        }
        Object.defineProperty(close, previousSymbol, {
          value: fs$close
        });
        return close;
      }(fs.close);
      fs.closeSync = function(fs$closeSync) {
        function closeSync(fd) {
          fs$closeSync.apply(fs, arguments);
          resetQueue();
        }
        Object.defineProperty(closeSync, previousSymbol, {
          value: fs$closeSync
        });
        return closeSync;
      }(fs.closeSync);
      if (/\bgfs4\b/i.test(process.env.NODE_DEBUG || "")) {
        process.on("exit", function() {
          debug(fs[gracefulQueue]);
          __require("assert").equal(fs[gracefulQueue].length, 0);
        });
      }
    }
    var queue;
    if (!global[gracefulQueue]) {
      publishQueue(global, fs[gracefulQueue]);
    }
    module.exports = patch(clone(fs));
    if (process.env.TEST_GRACEFUL_FS_GLOBAL_PATCH && !fs.__patched) {
      module.exports = patch(fs);
      fs.__patched = true;
    }
    function patch(fs2) {
      polyfills(fs2);
      fs2.gracefulify = patch;
      fs2.createReadStream = createReadStream;
      fs2.createWriteStream = createWriteStream;
      var fs$readFile = fs2.readFile;
      fs2.readFile = readFile;
      function readFile(path, options, cb) {
        if (typeof options === "function")
          cb = options, options = null;
        return go$readFile(path, options, cb);
        function go$readFile(path2, options2, cb2, startTime) {
          return fs$readFile(path2, options2, function(err) {
            if (err && (err.code === "EMFILE" || err.code === "ENFILE"))
              enqueue([go$readFile, [path2, options2, cb2], err, startTime || Date.now(), Date.now()]);
            else {
              if (typeof cb2 === "function")
                cb2.apply(this, arguments);
            }
          });
        }
      }
      var fs$writeFile = fs2.writeFile;
      fs2.writeFile = writeFile;
      function writeFile(path, data, options, cb) {
        if (typeof options === "function")
          cb = options, options = null;
        return go$writeFile(path, data, options, cb);
        function go$writeFile(path2, data2, options2, cb2, startTime) {
          return fs$writeFile(path2, data2, options2, function(err) {
            if (err && (err.code === "EMFILE" || err.code === "ENFILE"))
              enqueue([go$writeFile, [path2, data2, options2, cb2], err, startTime || Date.now(), Date.now()]);
            else {
              if (typeof cb2 === "function")
                cb2.apply(this, arguments);
            }
          });
        }
      }
      var fs$appendFile = fs2.appendFile;
      if (fs$appendFile)
        fs2.appendFile = appendFile;
      function appendFile(path, data, options, cb) {
        if (typeof options === "function")
          cb = options, options = null;
        return go$appendFile(path, data, options, cb);
        function go$appendFile(path2, data2, options2, cb2, startTime) {
          return fs$appendFile(path2, data2, options2, function(err) {
            if (err && (err.code === "EMFILE" || err.code === "ENFILE"))
              enqueue([go$appendFile, [path2, data2, options2, cb2], err, startTime || Date.now(), Date.now()]);
            else {
              if (typeof cb2 === "function")
                cb2.apply(this, arguments);
            }
          });
        }
      }
      var fs$copyFile = fs2.copyFile;
      if (fs$copyFile)
        fs2.copyFile = copyFile;
      function copyFile(src, dest, flags, cb) {
        if (typeof flags === "function") {
          cb = flags;
          flags = 0;
        }
        return go$copyFile(src, dest, flags, cb);
        function go$copyFile(src2, dest2, flags2, cb2, startTime) {
          return fs$copyFile(src2, dest2, flags2, function(err) {
            if (err && (err.code === "EMFILE" || err.code === "ENFILE"))
              enqueue([go$copyFile, [src2, dest2, flags2, cb2], err, startTime || Date.now(), Date.now()]);
            else {
              if (typeof cb2 === "function")
                cb2.apply(this, arguments);
            }
          });
        }
      }
      var fs$readdir = fs2.readdir;
      fs2.readdir = readdir;
      var noReaddirOptionVersions = /^v[0-5]\./;
      function readdir(path, options, cb) {
        if (typeof options === "function")
          cb = options, options = null;
        var go$readdir = noReaddirOptionVersions.test(process.version) ? function go$readdir2(path2, options2, cb2, startTime) {
          return fs$readdir(path2, fs$readdirCallback(
            path2,
            options2,
            cb2,
            startTime
          ));
        } : function go$readdir2(path2, options2, cb2, startTime) {
          return fs$readdir(path2, options2, fs$readdirCallback(
            path2,
            options2,
            cb2,
            startTime
          ));
        };
        return go$readdir(path, options, cb);
        function fs$readdirCallback(path2, options2, cb2, startTime) {
          return function(err, files) {
            if (err && (err.code === "EMFILE" || err.code === "ENFILE"))
              enqueue([
                go$readdir,
                [path2, options2, cb2],
                err,
                startTime || Date.now(),
                Date.now()
              ]);
            else {
              if (files && files.sort)
                files.sort();
              if (typeof cb2 === "function")
                cb2.call(this, err, files);
            }
          };
        }
      }
      if (process.version.substr(0, 4) === "v0.8") {
        var legStreams = legacy(fs2);
        ReadStream = legStreams.ReadStream;
        WriteStream = legStreams.WriteStream;
      }
      var fs$ReadStream = fs2.ReadStream;
      if (fs$ReadStream) {
        ReadStream.prototype = Object.create(fs$ReadStream.prototype);
        ReadStream.prototype.open = ReadStream$open;
      }
      var fs$WriteStream = fs2.WriteStream;
      if (fs$WriteStream) {
        WriteStream.prototype = Object.create(fs$WriteStream.prototype);
        WriteStream.prototype.open = WriteStream$open;
      }
      Object.defineProperty(fs2, "ReadStream", {
        get: function() {
          return ReadStream;
        },
        set: function(val) {
          ReadStream = val;
        },
        enumerable: true,
        configurable: true
      });
      Object.defineProperty(fs2, "WriteStream", {
        get: function() {
          return WriteStream;
        },
        set: function(val) {
          WriteStream = val;
        },
        enumerable: true,
        configurable: true
      });
      var FileReadStream = ReadStream;
      Object.defineProperty(fs2, "FileReadStream", {
        get: function() {
          return FileReadStream;
        },
        set: function(val) {
          FileReadStream = val;
        },
        enumerable: true,
        configurable: true
      });
      var FileWriteStream = WriteStream;
      Object.defineProperty(fs2, "FileWriteStream", {
        get: function() {
          return FileWriteStream;
        },
        set: function(val) {
          FileWriteStream = val;
        },
        enumerable: true,
        configurable: true
      });
      function ReadStream(path, options) {
        if (this instanceof ReadStream)
          return fs$ReadStream.apply(this, arguments), this;
        else
          return ReadStream.apply(Object.create(ReadStream.prototype), arguments);
      }
      function ReadStream$open() {
        var that = this;
        open(that.path, that.flags, that.mode, function(err, fd) {
          if (err) {
            if (that.autoClose)
              that.destroy();
            that.emit("error", err);
          } else {
            that.fd = fd;
            that.emit("open", fd);
            that.read();
          }
        });
      }
      function WriteStream(path, options) {
        if (this instanceof WriteStream)
          return fs$WriteStream.apply(this, arguments), this;
        else
          return WriteStream.apply(Object.create(WriteStream.prototype), arguments);
      }
      function WriteStream$open() {
        var that = this;
        open(that.path, that.flags, that.mode, function(err, fd) {
          if (err) {
            that.destroy();
            that.emit("error", err);
          } else {
            that.fd = fd;
            that.emit("open", fd);
          }
        });
      }
      function createReadStream(path, options) {
        return new fs2.ReadStream(path, options);
      }
      function createWriteStream(path, options) {
        return new fs2.WriteStream(path, options);
      }
      var fs$open = fs2.open;
      fs2.open = open;
      function open(path, flags, mode, cb) {
        if (typeof mode === "function")
          cb = mode, mode = null;
        return go$open(path, flags, mode, cb);
        function go$open(path2, flags2, mode2, cb2, startTime) {
          return fs$open(path2, flags2, mode2, function(err, fd) {
            if (err && (err.code === "EMFILE" || err.code === "ENFILE"))
              enqueue([go$open, [path2, flags2, mode2, cb2], err, startTime || Date.now(), Date.now()]);
            else {
              if (typeof cb2 === "function")
                cb2.apply(this, arguments);
            }
          });
        }
      }
      return fs2;
    }
    function enqueue(elem) {
      debug("ENQUEUE", elem[0].name, elem[1]);
      fs[gracefulQueue].push(elem);
      retry();
    }
    var retryTimer;
    function resetQueue() {
      var now = Date.now();
      for (var i = 0; i < fs[gracefulQueue].length; ++i) {
        if (fs[gracefulQueue][i].length > 2) {
          fs[gracefulQueue][i][3] = now;
          fs[gracefulQueue][i][4] = now;
        }
      }
      retry();
    }
    function retry() {
      clearTimeout(retryTimer);
      retryTimer = void 0;
      if (fs[gracefulQueue].length === 0)
        return;
      var elem = fs[gracefulQueue].shift();
      var fn = elem[0];
      var args = elem[1];
      var err = elem[2];
      var startTime = elem[3];
      var lastTime = elem[4];
      if (startTime === void 0) {
        debug("RETRY", fn.name, args);
        fn.apply(null, args);
      } else if (Date.now() - startTime >= 6e4) {
        debug("TIMEOUT", fn.name, args);
        var cb = args.pop();
        if (typeof cb === "function")
          cb.call(null, err);
      } else {
        var sinceAttempt = Date.now() - lastTime;
        var sinceStart = Math.max(lastTime - startTime, 1);
        var desiredDelay = Math.min(sinceStart * 1.2, 100);
        if (sinceAttempt >= desiredDelay) {
          debug("RETRY", fn.name, args);
          fn.apply(null, args.concat([startTime]));
        } else {
          fs[gracefulQueue].push(elem);
        }
      }
      if (retryTimer === void 0) {
        retryTimer = setTimeout(retry, 0);
      }
    }
  }
});

// ../../node_modules/.pnpm/retry@0.12.0/node_modules/retry/lib/retry_operation.js
var require_retry_operation = __commonJS({
  "../../node_modules/.pnpm/retry@0.12.0/node_modules/retry/lib/retry_operation.js"(exports, module) {
    function RetryOperation(timeouts, options) {
      if (typeof options === "boolean") {
        options = { forever: options };
      }
      this._originalTimeouts = JSON.parse(JSON.stringify(timeouts));
      this._timeouts = timeouts;
      this._options = options || {};
      this._maxRetryTime = options && options.maxRetryTime || Infinity;
      this._fn = null;
      this._errors = [];
      this._attempts = 1;
      this._operationTimeout = null;
      this._operationTimeoutCb = null;
      this._timeout = null;
      this._operationStart = null;
      if (this._options.forever) {
        this._cachedTimeouts = this._timeouts.slice(0);
      }
    }
    module.exports = RetryOperation;
    RetryOperation.prototype.reset = function() {
      this._attempts = 1;
      this._timeouts = this._originalTimeouts;
    };
    RetryOperation.prototype.stop = function() {
      if (this._timeout) {
        clearTimeout(this._timeout);
      }
      this._timeouts = [];
      this._cachedTimeouts = null;
    };
    RetryOperation.prototype.retry = function(err) {
      if (this._timeout) {
        clearTimeout(this._timeout);
      }
      if (!err) {
        return false;
      }
      var currentTime = (/* @__PURE__ */ new Date()).getTime();
      if (err && currentTime - this._operationStart >= this._maxRetryTime) {
        this._errors.unshift(new Error("RetryOperation timeout occurred"));
        return false;
      }
      this._errors.push(err);
      var timeout = this._timeouts.shift();
      if (timeout === void 0) {
        if (this._cachedTimeouts) {
          this._errors.splice(this._errors.length - 1, this._errors.length);
          this._timeouts = this._cachedTimeouts.slice(0);
          timeout = this._timeouts.shift();
        } else {
          return false;
        }
      }
      var self = this;
      var timer = setTimeout(function() {
        self._attempts++;
        if (self._operationTimeoutCb) {
          self._timeout = setTimeout(function() {
            self._operationTimeoutCb(self._attempts);
          }, self._operationTimeout);
          if (self._options.unref) {
            self._timeout.unref();
          }
        }
        self._fn(self._attempts);
      }, timeout);
      if (this._options.unref) {
        timer.unref();
      }
      return true;
    };
    RetryOperation.prototype.attempt = function(fn, timeoutOps) {
      this._fn = fn;
      if (timeoutOps) {
        if (timeoutOps.timeout) {
          this._operationTimeout = timeoutOps.timeout;
        }
        if (timeoutOps.cb) {
          this._operationTimeoutCb = timeoutOps.cb;
        }
      }
      var self = this;
      if (this._operationTimeoutCb) {
        this._timeout = setTimeout(function() {
          self._operationTimeoutCb();
        }, self._operationTimeout);
      }
      this._operationStart = (/* @__PURE__ */ new Date()).getTime();
      this._fn(this._attempts);
    };
    RetryOperation.prototype.try = function(fn) {
      console.log("Using RetryOperation.try() is deprecated");
      this.attempt(fn);
    };
    RetryOperation.prototype.start = function(fn) {
      console.log("Using RetryOperation.start() is deprecated");
      this.attempt(fn);
    };
    RetryOperation.prototype.start = RetryOperation.prototype.try;
    RetryOperation.prototype.errors = function() {
      return this._errors;
    };
    RetryOperation.prototype.attempts = function() {
      return this._attempts;
    };
    RetryOperation.prototype.mainError = function() {
      if (this._errors.length === 0) {
        return null;
      }
      var counts = {};
      var mainError = null;
      var mainErrorCount = 0;
      for (var i = 0; i < this._errors.length; i++) {
        var error = this._errors[i];
        var message = error.message;
        var count = (counts[message] || 0) + 1;
        counts[message] = count;
        if (count >= mainErrorCount) {
          mainError = error;
          mainErrorCount = count;
        }
      }
      return mainError;
    };
  }
});

// ../../node_modules/.pnpm/retry@0.12.0/node_modules/retry/lib/retry.js
var require_retry = __commonJS({
  "../../node_modules/.pnpm/retry@0.12.0/node_modules/retry/lib/retry.js"(exports) {
    var RetryOperation = require_retry_operation();
    exports.operation = function(options) {
      var timeouts = exports.timeouts(options);
      return new RetryOperation(timeouts, {
        forever: options && options.forever,
        unref: options && options.unref,
        maxRetryTime: options && options.maxRetryTime
      });
    };
    exports.timeouts = function(options) {
      if (options instanceof Array) {
        return [].concat(options);
      }
      var opts = {
        retries: 10,
        factor: 2,
        minTimeout: 1 * 1e3,
        maxTimeout: Infinity,
        randomize: false
      };
      for (var key in options) {
        opts[key] = options[key];
      }
      if (opts.minTimeout > opts.maxTimeout) {
        throw new Error("minTimeout is greater than maxTimeout");
      }
      var timeouts = [];
      for (var i = 0; i < opts.retries; i++) {
        timeouts.push(this.createTimeout(i, opts));
      }
      if (options && options.forever && !timeouts.length) {
        timeouts.push(this.createTimeout(i, opts));
      }
      timeouts.sort(function(a, b) {
        return a - b;
      });
      return timeouts;
    };
    exports.createTimeout = function(attempt, opts) {
      var random = opts.randomize ? Math.random() + 1 : 1;
      var timeout = Math.round(random * opts.minTimeout * Math.pow(opts.factor, attempt));
      timeout = Math.min(timeout, opts.maxTimeout);
      return timeout;
    };
    exports.wrap = function(obj, options, methods) {
      if (options instanceof Array) {
        methods = options;
        options = null;
      }
      if (!methods) {
        methods = [];
        for (var key in obj) {
          if (typeof obj[key] === "function") {
            methods.push(key);
          }
        }
      }
      for (var i = 0; i < methods.length; i++) {
        var method = methods[i];
        var original = obj[method];
        obj[method] = function retryWrapper(original2) {
          var op = exports.operation(options);
          var args = Array.prototype.slice.call(arguments, 1);
          var callback = args.pop();
          args.push(function(err) {
            if (op.retry(err)) {
              return;
            }
            if (err) {
              arguments[0] = op.mainError();
            }
            callback.apply(this, arguments);
          });
          op.attempt(function() {
            original2.apply(obj, args);
          });
        }.bind(obj, original);
        obj[method].options = options;
      }
    };
  }
});

// ../../node_modules/.pnpm/retry@0.12.0/node_modules/retry/index.js
var require_retry2 = __commonJS({
  "../../node_modules/.pnpm/retry@0.12.0/node_modules/retry/index.js"(exports, module) {
    module.exports = require_retry();
  }
});

// ../../node_modules/.pnpm/signal-exit@3.0.7/node_modules/signal-exit/signals.js
var require_signals = __commonJS({
  "../../node_modules/.pnpm/signal-exit@3.0.7/node_modules/signal-exit/signals.js"(exports, module) {
    module.exports = [
      "SIGABRT",
      "SIGALRM",
      "SIGHUP",
      "SIGINT",
      "SIGTERM"
    ];
    if (process.platform !== "win32") {
      module.exports.push(
        "SIGVTALRM",
        "SIGXCPU",
        "SIGXFSZ",
        "SIGUSR2",
        "SIGTRAP",
        "SIGSYS",
        "SIGQUIT",
        "SIGIOT"
        // should detect profiler and enable/disable accordingly.
        // see #21
        // 'SIGPROF'
      );
    }
    if (process.platform === "linux") {
      module.exports.push(
        "SIGIO",
        "SIGPOLL",
        "SIGPWR",
        "SIGSTKFLT",
        "SIGUNUSED"
      );
    }
  }
});

// ../../node_modules/.pnpm/signal-exit@3.0.7/node_modules/signal-exit/index.js
var require_signal_exit = __commonJS({
  "../../node_modules/.pnpm/signal-exit@3.0.7/node_modules/signal-exit/index.js"(exports, module) {
    var process2 = global.process;
    var processOk = function(process3) {
      return process3 && typeof process3 === "object" && typeof process3.removeListener === "function" && typeof process3.emit === "function" && typeof process3.reallyExit === "function" && typeof process3.listeners === "function" && typeof process3.kill === "function" && typeof process3.pid === "number" && typeof process3.on === "function";
    };
    if (!processOk(process2)) {
      module.exports = function() {
        return function() {
        };
      };
    } else {
      assert = __require("assert");
      signals = require_signals();
      isWin = /^win/i.test(process2.platform);
      EE = __require("events");
      if (typeof EE !== "function") {
        EE = EE.EventEmitter;
      }
      if (process2.__signal_exit_emitter__) {
        emitter = process2.__signal_exit_emitter__;
      } else {
        emitter = process2.__signal_exit_emitter__ = new EE();
        emitter.count = 0;
        emitter.emitted = {};
      }
      if (!emitter.infinite) {
        emitter.setMaxListeners(Infinity);
        emitter.infinite = true;
      }
      module.exports = function(cb, opts) {
        if (!processOk(global.process)) {
          return function() {
          };
        }
        assert.equal(typeof cb, "function", "a callback must be provided for exit handler");
        if (loaded === false) {
          load();
        }
        var ev = "exit";
        if (opts && opts.alwaysLast) {
          ev = "afterexit";
        }
        var remove = function() {
          emitter.removeListener(ev, cb);
          if (emitter.listeners("exit").length === 0 && emitter.listeners("afterexit").length === 0) {
            unload();
          }
        };
        emitter.on(ev, cb);
        return remove;
      };
      unload = function unload2() {
        if (!loaded || !processOk(global.process)) {
          return;
        }
        loaded = false;
        signals.forEach(function(sig) {
          try {
            process2.removeListener(sig, sigListeners[sig]);
          } catch (er) {
          }
        });
        process2.emit = originalProcessEmit;
        process2.reallyExit = originalProcessReallyExit;
        emitter.count -= 1;
      };
      module.exports.unload = unload;
      emit = function emit2(event, code, signal) {
        if (emitter.emitted[event]) {
          return;
        }
        emitter.emitted[event] = true;
        emitter.emit(event, code, signal);
      };
      sigListeners = {};
      signals.forEach(function(sig) {
        sigListeners[sig] = function listener() {
          if (!processOk(global.process)) {
            return;
          }
          var listeners = process2.listeners(sig);
          if (listeners.length === emitter.count) {
            unload();
            emit("exit", null, sig);
            emit("afterexit", null, sig);
            if (isWin && sig === "SIGHUP") {
              sig = "SIGINT";
            }
            process2.kill(process2.pid, sig);
          }
        };
      });
      module.exports.signals = function() {
        return signals;
      };
      loaded = false;
      load = function load2() {
        if (loaded || !processOk(global.process)) {
          return;
        }
        loaded = true;
        emitter.count += 1;
        signals = signals.filter(function(sig) {
          try {
            process2.on(sig, sigListeners[sig]);
            return true;
          } catch (er) {
            return false;
          }
        });
        process2.emit = processEmit;
        process2.reallyExit = processReallyExit;
      };
      module.exports.load = load;
      originalProcessReallyExit = process2.reallyExit;
      processReallyExit = function processReallyExit2(code) {
        if (!processOk(global.process)) {
          return;
        }
        process2.exitCode = code || /* istanbul ignore next */
        0;
        emit("exit", process2.exitCode, null);
        emit("afterexit", process2.exitCode, null);
        originalProcessReallyExit.call(process2, process2.exitCode);
      };
      originalProcessEmit = process2.emit;
      processEmit = function processEmit2(ev, arg) {
        if (ev === "exit" && processOk(global.process)) {
          if (arg !== void 0) {
            process2.exitCode = arg;
          }
          var ret = originalProcessEmit.apply(this, arguments);
          emit("exit", process2.exitCode, null);
          emit("afterexit", process2.exitCode, null);
          return ret;
        } else {
          return originalProcessEmit.apply(this, arguments);
        }
      };
    }
    var assert;
    var signals;
    var isWin;
    var EE;
    var emitter;
    var unload;
    var emit;
    var sigListeners;
    var loaded;
    var load;
    var originalProcessReallyExit;
    var processReallyExit;
    var originalProcessEmit;
    var processEmit;
  }
});

// ../../node_modules/.pnpm/proper-lockfile@4.1.2/node_modules/proper-lockfile/lib/mtime-precision.js
var require_mtime_precision = __commonJS({
  "../../node_modules/.pnpm/proper-lockfile@4.1.2/node_modules/proper-lockfile/lib/mtime-precision.js"(exports, module) {
    "use strict";
    var cacheSymbol = Symbol();
    function probe(file, fs, callback) {
      const cachedPrecision = fs[cacheSymbol];
      if (cachedPrecision) {
        return fs.stat(file, (err, stat) => {
          if (err) {
            return callback(err);
          }
          callback(null, stat.mtime, cachedPrecision);
        });
      }
      const mtime = new Date(Math.ceil(Date.now() / 1e3) * 1e3 + 5);
      fs.utimes(file, mtime, mtime, (err) => {
        if (err) {
          return callback(err);
        }
        fs.stat(file, (err2, stat) => {
          if (err2) {
            return callback(err2);
          }
          const precision = stat.mtime.getTime() % 1e3 === 0 ? "s" : "ms";
          Object.defineProperty(fs, cacheSymbol, { value: precision });
          callback(null, stat.mtime, precision);
        });
      });
    }
    function getMtime(precision) {
      let now = Date.now();
      if (precision === "s") {
        now = Math.ceil(now / 1e3) * 1e3;
      }
      return new Date(now);
    }
    module.exports.probe = probe;
    module.exports.getMtime = getMtime;
  }
});

// ../../node_modules/.pnpm/proper-lockfile@4.1.2/node_modules/proper-lockfile/lib/lockfile.js
var require_lockfile = __commonJS({
  "../../node_modules/.pnpm/proper-lockfile@4.1.2/node_modules/proper-lockfile/lib/lockfile.js"(exports, module) {
    "use strict";
    var path = __require("path");
    var fs = require_graceful_fs();
    var retry = require_retry2();
    var onExit = require_signal_exit();
    var mtimePrecision = require_mtime_precision();
    var locks = {};
    function getLockFile(file, options) {
      return options.lockfilePath || `${file}.lock`;
    }
    function resolveCanonicalPath(file, options, callback) {
      if (!options.realpath) {
        return callback(null, path.resolve(file));
      }
      options.fs.realpath(file, callback);
    }
    function acquireLock(file, options, callback) {
      const lockfilePath = getLockFile(file, options);
      options.fs.mkdir(lockfilePath, (err) => {
        if (!err) {
          return mtimePrecision.probe(lockfilePath, options.fs, (err2, mtime, mtimePrecision2) => {
            if (err2) {
              options.fs.rmdir(lockfilePath, () => {
              });
              return callback(err2);
            }
            callback(null, mtime, mtimePrecision2);
          });
        }
        if (err.code !== "EEXIST") {
          return callback(err);
        }
        if (options.stale <= 0) {
          return callback(Object.assign(new Error("Lock file is already being held"), { code: "ELOCKED", file }));
        }
        options.fs.stat(lockfilePath, (err2, stat) => {
          if (err2) {
            if (err2.code === "ENOENT") {
              return acquireLock(file, { ...options, stale: 0 }, callback);
            }
            return callback(err2);
          }
          if (!isLockStale(stat, options)) {
            return callback(Object.assign(new Error("Lock file is already being held"), { code: "ELOCKED", file }));
          }
          removeLock(file, options, (err3) => {
            if (err3) {
              return callback(err3);
            }
            acquireLock(file, { ...options, stale: 0 }, callback);
          });
        });
      });
    }
    function isLockStale(stat, options) {
      return stat.mtime.getTime() < Date.now() - options.stale;
    }
    function removeLock(file, options, callback) {
      options.fs.rmdir(getLockFile(file, options), (err) => {
        if (err && err.code !== "ENOENT") {
          return callback(err);
        }
        callback();
      });
    }
    function updateLock(file, options) {
      const lock2 = locks[file];
      if (lock2.updateTimeout) {
        return;
      }
      lock2.updateDelay = lock2.updateDelay || options.update;
      lock2.updateTimeout = setTimeout(() => {
        lock2.updateTimeout = null;
        options.fs.stat(lock2.lockfilePath, (err, stat) => {
          const isOverThreshold = lock2.lastUpdate + options.stale < Date.now();
          if (err) {
            if (err.code === "ENOENT" || isOverThreshold) {
              return setLockAsCompromised(file, lock2, Object.assign(err, { code: "ECOMPROMISED" }));
            }
            lock2.updateDelay = 1e3;
            return updateLock(file, options);
          }
          const isMtimeOurs = lock2.mtime.getTime() === stat.mtime.getTime();
          if (!isMtimeOurs) {
            return setLockAsCompromised(
              file,
              lock2,
              Object.assign(
                new Error("Unable to update lock within the stale threshold"),
                { code: "ECOMPROMISED" }
              )
            );
          }
          const mtime = mtimePrecision.getMtime(lock2.mtimePrecision);
          options.fs.utimes(lock2.lockfilePath, mtime, mtime, (err2) => {
            const isOverThreshold2 = lock2.lastUpdate + options.stale < Date.now();
            if (lock2.released) {
              return;
            }
            if (err2) {
              if (err2.code === "ENOENT" || isOverThreshold2) {
                return setLockAsCompromised(file, lock2, Object.assign(err2, { code: "ECOMPROMISED" }));
              }
              lock2.updateDelay = 1e3;
              return updateLock(file, options);
            }
            lock2.mtime = mtime;
            lock2.lastUpdate = Date.now();
            lock2.updateDelay = null;
            updateLock(file, options);
          });
        });
      }, lock2.updateDelay);
      if (lock2.updateTimeout.unref) {
        lock2.updateTimeout.unref();
      }
    }
    function setLockAsCompromised(file, lock2, err) {
      lock2.released = true;
      if (lock2.updateTimeout) {
        clearTimeout(lock2.updateTimeout);
      }
      if (locks[file] === lock2) {
        delete locks[file];
      }
      lock2.options.onCompromised(err);
    }
    function lock(file, options, callback) {
      options = {
        stale: 1e4,
        update: null,
        realpath: true,
        retries: 0,
        fs,
        onCompromised: (err) => {
          throw err;
        },
        ...options
      };
      options.retries = options.retries || 0;
      options.retries = typeof options.retries === "number" ? { retries: options.retries } : options.retries;
      options.stale = Math.max(options.stale || 0, 2e3);
      options.update = options.update == null ? options.stale / 2 : options.update || 0;
      options.update = Math.max(Math.min(options.update, options.stale / 2), 1e3);
      resolveCanonicalPath(file, options, (err, file2) => {
        if (err) {
          return callback(err);
        }
        const operation = retry.operation(options.retries);
        operation.attempt(() => {
          acquireLock(file2, options, (err2, mtime, mtimePrecision2) => {
            if (operation.retry(err2)) {
              return;
            }
            if (err2) {
              return callback(operation.mainError());
            }
            const lock2 = locks[file2] = {
              lockfilePath: getLockFile(file2, options),
              mtime,
              mtimePrecision: mtimePrecision2,
              options,
              lastUpdate: Date.now()
            };
            updateLock(file2, options);
            callback(null, (releasedCallback) => {
              if (lock2.released) {
                return releasedCallback && releasedCallback(Object.assign(new Error("Lock is already released"), { code: "ERELEASED" }));
              }
              unlock(file2, { ...options, realpath: false }, releasedCallback);
            });
          });
        });
      });
    }
    function unlock(file, options, callback) {
      options = {
        fs,
        realpath: true,
        ...options
      };
      resolveCanonicalPath(file, options, (err, file2) => {
        if (err) {
          return callback(err);
        }
        const lock2 = locks[file2];
        if (!lock2) {
          return callback(Object.assign(new Error("Lock is not acquired/owned by you"), { code: "ENOTACQUIRED" }));
        }
        lock2.updateTimeout && clearTimeout(lock2.updateTimeout);
        lock2.released = true;
        delete locks[file2];
        removeLock(file2, options, callback);
      });
    }
    function check(file, options, callback) {
      options = {
        stale: 1e4,
        realpath: true,
        fs,
        ...options
      };
      options.stale = Math.max(options.stale || 0, 2e3);
      resolveCanonicalPath(file, options, (err, file2) => {
        if (err) {
          return callback(err);
        }
        options.fs.stat(getLockFile(file2, options), (err2, stat) => {
          if (err2) {
            return err2.code === "ENOENT" ? callback(null, false) : callback(err2);
          }
          return callback(null, !isLockStale(stat, options));
        });
      });
    }
    function getLocks() {
      return locks;
    }
    onExit(() => {
      for (const file in locks) {
        const options = locks[file].options;
        try {
          options.fs.rmdirSync(getLockFile(file, options));
        } catch (e) {
        }
      }
    });
    module.exports.lock = lock;
    module.exports.unlock = unlock;
    module.exports.check = check;
    module.exports.getLocks = getLocks;
  }
});

// ../../node_modules/.pnpm/proper-lockfile@4.1.2/node_modules/proper-lockfile/lib/adapter.js
var require_adapter = __commonJS({
  "../../node_modules/.pnpm/proper-lockfile@4.1.2/node_modules/proper-lockfile/lib/adapter.js"(exports, module) {
    "use strict";
    var fs = require_graceful_fs();
    function createSyncFs(fs2) {
      const methods = ["mkdir", "realpath", "stat", "rmdir", "utimes"];
      const newFs = { ...fs2 };
      methods.forEach((method) => {
        newFs[method] = (...args) => {
          const callback = args.pop();
          let ret;
          try {
            ret = fs2[`${method}Sync`](...args);
          } catch (err) {
            return callback(err);
          }
          callback(null, ret);
        };
      });
      return newFs;
    }
    function toPromise(method) {
      return (...args) => new Promise((resolve, reject) => {
        args.push((err, result) => {
          if (err) {
            reject(err);
          } else {
            resolve(result);
          }
        });
        method(...args);
      });
    }
    function toSync(method) {
      return (...args) => {
        let err;
        let result;
        args.push((_err, _result) => {
          err = _err;
          result = _result;
        });
        method(...args);
        if (err) {
          throw err;
        }
        return result;
      };
    }
    function toSyncOptions(options) {
      options = { ...options };
      options.fs = createSyncFs(options.fs || fs);
      if (typeof options.retries === "number" && options.retries > 0 || options.retries && typeof options.retries.retries === "number" && options.retries.retries > 0) {
        throw Object.assign(new Error("Cannot use retries with the sync api"), { code: "ESYNC" });
      }
      return options;
    }
    module.exports = {
      toPromise,
      toSync,
      toSyncOptions
    };
  }
});

// ../../node_modules/.pnpm/proper-lockfile@4.1.2/node_modules/proper-lockfile/index.js
var require_proper_lockfile = __commonJS({
  "../../node_modules/.pnpm/proper-lockfile@4.1.2/node_modules/proper-lockfile/index.js"(exports, module) {
    "use strict";
    var lockfile = require_lockfile();
    var { toPromise, toSync, toSyncOptions } = require_adapter();
    async function lock(file, options) {
      const release = await toPromise(lockfile.lock)(file, options);
      return toPromise(release);
    }
    function lockSync2(file, options) {
      const release = toSync(lockfile.lock)(file, toSyncOptions(options));
      return toSync(release);
    }
    function unlock(file, options) {
      return toPromise(lockfile.unlock)(file, options);
    }
    function unlockSync(file, options) {
      return toSync(lockfile.unlock)(file, toSyncOptions(options));
    }
    function check(file, options) {
      return toPromise(lockfile.check)(file, options);
    }
    function checkSync(file, options) {
      return toSync(lockfile.check)(file, toSyncOptions(options));
    }
    module.exports = lock;
    module.exports.lock = lock;
    module.exports.unlock = unlock;
    module.exports.lockSync = lockSync2;
    module.exports.unlockSync = unlockSync;
    module.exports.check = check;
    module.exports.checkSync = checkSync;
  }
});

// src/store.ts
var import_proper_lockfile = __toESM(require_proper_lockfile(), 1);
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { randomBytes as randomBytes2 } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// src/device.ts
import { randomBytes } from "node:crypto";
var ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function base32(bytes, groups) {
  let bits = 0;
  let value = 0;
  let out = "";
  const size = groups[0] + groups[1];
  for (const byte of bytes) {
    value = value << 8 | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += ALPHABET[value >>> bits & 31];
    }
  }
  return out.slice(0, size);
}
function generateDeviceId() {
  const raw = base32(randomBytes(8), [4, 4]);
  return `WHALE-${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
}
function generatePassword() {
  return randomBytes(9).toString("base64url").slice(0, 12);
}
function generateTemporaryPassword() {
  const raw = base32(randomBytes(8), [4, 4]);
  return `WMT-${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
}

// src/store.ts
var EMPTY_TEMPORARY_PASSWORD = {
  password: "",
  expiresAt: 0,
  generation: 0,
  state: "none"
};
function resolveDataDir(options) {
  if (options.dataDir) return options.dataDir;
  if (!options.profileBaseUrl) {
    throw new Error("WhaleMaid \u8EAB\u4EFD\u7F3A\u5C11 profileBaseUrl\uFF1A\u62D2\u7EDD\u56DE\u9000\u5230\u5171\u4EAB DSH_HOME\uFF1B\u8BF7\u7531 DSH loader \u63D0\u4F9B ctx.baseUrl \u6216\u663E\u5F0F\u914D\u7F6E dataDir");
  }
  const profileUrl = options.profileBaseUrl instanceof URL ? options.profileBaseUrl : new URL(options.profileBaseUrl);
  if (profileUrl.protocol !== "file:") {
    throw new Error(`WhaleMaid profileBaseUrl \u5FC5\u987B\u662F file: URL\uFF0C\u6536\u5230 ${profileUrl.protocol}`);
  }
  return join(fileURLToPath(profileUrl), "whalemaid");
}
var processLeases = /* @__PURE__ */ new Map();
var LOCK_STALE_MS = 3e4;
var LOCK_UPDATE_MS = 1e4;
function claimProfile(stateFile) {
  const active = processLeases.get(stateFile);
  if (active) {
    active.refs += 1;
  } else {
    let release;
    try {
      release = (0, import_proper_lockfile.lockSync)(stateFile, {
        realpath: false,
        stale: LOCK_STALE_MS,
        update: LOCK_UPDATE_MS,
        onCompromised: (cause) => {
          throw new Error(`WhaleMaid profile owner \u9501\u5DF2\u635F\u574F\uFF1A${stateFile}`, { cause });
        }
      });
    } catch (cause) {
      throw new Error(`WhaleMaid profile \u5DF2\u7531\u53E6\u4E00\u4E2A DSH \u8FDB\u7A0B\u63A7\u5236\uFF0C\u62D2\u7EDD\u8BA9\u540C\u4E00\u8BBE\u5907\u8EAB\u4EFD\u8DEF\u7531\u5230\u591A\u4E2A\u5BBF\u4E3B\uFF1A${stateFile}`, { cause });
    }
    processLeases.set(stateFile, { refs: 1, release });
  }
  let closed = false;
  return () => {
    if (closed) return;
    closed = true;
    const lease = processLeases.get(stateFile);
    if (!lease) return;
    lease.refs -= 1;
    if (lease.refs === 0) {
      processLeases.delete(stateFile);
      lease.release();
    }
  };
}
var Store = class {
  state;
  path;
  releaseProfile;
  constructor(options) {
    const requestedBase = resolveDataDir(options);
    mkdirSync(requestedBase, { recursive: true });
    const base = realpathSync(requestedBase);
    this.path = join(base, "store.json");
    this.releaseProfile = claimProfile(this.path);
    try {
      this.state = existsSync(this.path) ? JSON.parse(readFileSync(this.path, "utf8")) : {
        longPassword: generatePassword(),
        deviceId: generateDeviceId(),
        relayCredential: "",
        adminToken: randomBytes2(16).toString("hex"),
        temporaryPassword: { ...EMPTY_TEMPORARY_PASSWORD }
      };
      this.state.relayCredential ??= "";
      this.state.adminToken ??= randomBytes2(16).toString("hex");
      this.state.deviceId ??= generateDeviceId();
      this.state.longPassword ??= generatePassword();
      this.state.temporaryPassword ??= { ...EMPTY_TEMPORARY_PASSWORD };
      this.persist();
    } catch (cause) {
      this.releaseProfile();
      throw cause;
    }
  }
  persist() {
    writeFileSync(this.path, JSON.stringify(this.state, null, 2), { mode: 384 });
  }
  get longPassword() {
    return this.state.longPassword;
  }
  get file() {
    return this.path;
  }
  /** UX-002：受控端设备编号（受控端 UI 展示；主控端凭此+密码连接） */
  get deviceId() {
    return this.state.deviceId;
  }
  get relayCredential() {
    return this.state.relayCredential;
  }
  get adminToken() {
    return this.state.adminToken;
  }
  setRelayCredential(value) {
    this.state.relayCredential = value;
    this.persist();
  }
  get temporaryPassword() {
    return { ...this.state.temporaryPassword };
  }
  setTemporaryPassword(value) {
    this.state.temporaryPassword = { ...value };
    this.persist();
  }
  /** 心跳可能晚于 refresh 返回；旧 generation 不得清除新密码。 */
  syncTemporaryPasswordStatus(status) {
    const current = this.state.temporaryPassword;
    if (status.generation < current.generation) return;
    const keepPassword = status.state === "active" && status.generation === current.generation;
    this.state.temporaryPassword = {
      password: keepPassword ? current.password : "",
      ...status
    };
    this.persist();
  }
  /** DSH plugin disposal：最后一个同进程 HMR owner 释放跨进程 profile 锁。 */
  close() {
    this.releaseProfile();
  }
  /** REQ-002：重新生成长期密码 = 清凭据触发重新注册（旧密码哈希随注册更新即失效） */
  rotatePassword() {
    this.state.longPassword = generatePassword();
    this.state.relayCredential = "";
    this.persist();
    return this.state.longPassword;
  }
};

// src/relay.ts
import { spawn } from "node:child_process";
import { mkdirSync as mkdirSync2, writeFileSync as writeFileSync2 } from "node:fs";
import { join as join2 } from "node:path";
import { randomBytes as randomBytes3, scryptSync, createHash } from "node:crypto";
import https from "node:https";
function phcScrypt(password, salt = randomBytes3(16)) {
  const hash = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  const b64 = (b) => b.toString("base64").replace(/=+$/, "");
  return `$scrypt$ln=14,r=8,p=1$${b64(salt)}$${b64(hash)}`;
}
var RelayHttpError = class extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
    this.name = "RelayHttpError";
  }
};
var CREDENTIAL_REJECTED = [401, 403, 404];
function pinnedRequest(url, options) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: options.method, headers: options.headers, rejectUnauthorized: false }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve({
          status: res.statusCode ?? 0,
          json: async () => JSON.parse(text),
          text: async () => text
        });
      });
    });
    req.on("socket", (socket) => {
      socket.on("secureConnect", () => {
        const tlsSocket = socket;
        const cert = tlsSocket.getPeerCertificate(true);
        const fp = createHash("sha256").update(cert.raw ?? Buffer.alloc(0)).digest("hex");
        if (options.fingerprint && fp !== options.fingerprint.replace(/[^0-9a-f]/gi, "")) {
          req.destroy(new Error(`\u8BC1\u4E66\u6307\u7EB9\u4E0D\u5339\u914D\uFF08\u9884\u671F ${options.fingerprint.slice(0, 16)}\u2026 \u5B9E\u9645 ${fp.slice(0, 16)}\u2026\uFF09\uFF0C\u62D2\u7EDD\u8FDE\u63A5\uFF08SEC-001 \u9632\u4E2D\u95F4\u4EBA\uFF09`));
        }
      });
    });
    req.on("error", reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}
var RelayClient = class {
  constructor(cfg, log, req = pinnedRequest) {
    this.cfg = cfg;
    this.log = log;
    this.req = req;
  }
  child = null;
  timer;
  updateCredential(credential) {
    this.cfg.savedCredential = credential;
    this.cfg.onCredential(credential);
  }
  requireCredential() {
    if (!this.cfg.savedCredential) throw new Error("\u8BBE\u5907\u5C1A\u65E0\u4E2D\u7EE7\u51ED\u636E\uFF0C\u4E0D\u80FD\u7BA1\u7406\u4E34\u65F6\u5BC6\u7801\uFF1B\u8BF7\u7B49\u5F85\u9996\u6B21\u6CE8\u518C\u6210\u529F");
    return this.cfg.savedCredential;
  }
  async issueTemporaryPassword(password, ttlSec) {
    const credential = this.requireCredential();
    const base = this.cfg.relayUrl.replace(/\/$/, "");
    const res = await this.req(`${base}/_whalemaid/devices/${this.cfg.deviceId}/temporary-password`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${credential}` },
      body: JSON.stringify({ passwordDigest: phcScrypt(password), ttlSec }),
      fingerprint: this.cfg.relayFingerprint
    });
    if (res.status >= 300) throw new RelayHttpError(res.status, `\u4E34\u65F6\u5BC6\u7801\u7B7E\u53D1\u5931\u8D25: ${res.status} ${await res.text()}`);
    return await res.json();
  }
  async revokeTemporaryPassword() {
    const credential = this.requireCredential();
    const base = this.cfg.relayUrl.replace(/\/$/, "");
    const res = await this.req(`${base}/_whalemaid/devices/${this.cfg.deviceId}/temporary-password`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${credential}` },
      fingerprint: this.cfg.relayFingerprint
    });
    if (res.status >= 300) throw new RelayHttpError(res.status, `\u4E34\u65F6\u5BC6\u7801\u64A4\u9500\u5931\u8D25: ${res.status} ${await res.text()}`);
  }
  /** 密码轮换（审计三轮#3）：凭据鉴权调 /password 端点原子替换 PHC——旧密码立即失效，凭据不丢、隧道不断；
   *  端点不可用（旧版中继）时退回：自吊销 + 重新注册（旧密码随之失效） */
  async rotatePassword(newPassword) {
    const base = this.cfg.relayUrl.replace(/\/$/, "");
    if (!this.cfg.savedCredential) {
      this.log("[whalemaid] \u65E0\u4E2D\u7EE7\u51ED\u636E\uFF0C\u8DF3\u8FC7\u5728\u7EBF\u8F6E\u6362\uFF08\u4E0B\u6B21\u6CE8\u518C\u7528\u65B0\u5BC6\u7801\uFF09");
      return;
    }
    const res = await this.req(`${base}/_whalemaid/devices/${this.cfg.deviceId}/password`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.cfg.savedCredential}` },
      body: JSON.stringify({ passwordDigest: phcScrypt(newPassword) }),
      fingerprint: this.cfg.relayFingerprint
    });
    if (res.status < 300) {
      this.log("[whalemaid] \u957F\u671F\u5BC6\u7801\u5DF2\u8F6E\u6362\uFF08\u670D\u52A1\u7AEF PHC \u539F\u5B50\u66FF\u6362\uFF0C\u65E7\u5BC6\u7801\u7ACB\u5373\u5931\u6548\uFF09");
      return;
    }
    this.log(`[whalemaid] /password \u7AEF\u70B9\u4E0D\u53EF\u7528\uFF08${res.status}\uFF09\uFF0C\u9000\u56DE\u81EA\u540A\u9500+\u91CD\u6CE8\u518C`);
    await this.req(`${base}/_whalemaid/devices/${this.cfg.deviceId}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${this.cfg.savedCredential}` },
      fingerprint: this.cfg.relayFingerprint
    }).catch(() => void 0);
    this.updateCredential("");
  }
  async start() {
    const base = this.cfg.relayUrl.replace(/\/$/, "");
    let credential = this.cfg.savedCredential;
    if (credential) {
      try {
        const binding2 = await this.establishTunnel(base, credential);
        this.startHeartbeat(base, credential);
        return binding2;
      } catch (e) {
        if (e instanceof RelayHttpError && CREDENTIAL_REJECTED.includes(e.status)) {
          this.log(`[whalemaid] \u51ED\u636E\u5931\u6548\uFF08${e.message}\uFF09\uFF0C\u91CD\u65B0\u6CE8\u518C`);
          this.updateCredential("");
          credential = "";
        } else {
          this.log(`[whalemaid] \u96A7\u9053\u5EFA\u7ACB\u6682\u5931\u8D25\uFF08${e instanceof Error ? e.message.slice(0, 80) : String(e)}\uFF09\uFF0C\u4FDD\u7559\u51ED\u636E\u9000\u907F\u91CD\u8BD5`);
          throw e;
        }
      }
    }
    const res = await this.req(`${base}/_whalemaid/devices`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-install-code": this.cfg.relayInstallCode
      },
      body: JSON.stringify({
        deviceId: this.cfg.deviceId,
        passwordDigest: phcScrypt(this.cfg.longPassword),
        hostAuthority: `127.0.0.1:${this.cfg.pluginPort}`
      }),
      fingerprint: this.cfg.relayFingerprint
    });
    if (res.status >= 300) {
      const text = await res.text();
      if (res.status === 409 && text.includes("device-already-registered")) {
        throw new Error(`\u6CE8\u518C\u88AB\u62D2 409 device-already-registered\uFF1A\u8BE5\u8BBE\u5907\u7F16\u53F7\u5DF2\u5728\u4E2D\u7EE7\u767B\u8BB0\uFF0C\u4F46\u672C\u673A\u5DF2\u4FDD\u5B58\u51ED\u636E\u4E22\u5931\u2014\u2014\u9700\u670D\u52A1\u7AEF\u7BA1\u7406\u5458\u540A\u9500\u65E7\u8BBE\u5907\u8BB0\u5F55\uFF08DELETE /_whalemaid/devices/${this.cfg.deviceId} + Bearer \u7BA1\u7406\u5458\u4EE4\u724C\uFF09\u540E\u672C\u63D2\u4EF6\u4F1A\u81EA\u52A8\u91CD\u8BD5\u6210\u529F\uFF0C\u65E0\u9700\u91CD\u542F\u5BBF\u4E3B\uFF08docs/deploy-server.md\uFF09`);
      }
      if (res.status === 401) {
        throw new Error("\u6CE8\u518C\u5931\u8D25 401\uFF1A\u5B89\u88C5\u7801\u65E0\u6548\u6216\u5DF2\u88AB\u6D88\u8017\uFF08\u5355\u6B21\u4EE4\u724C\uFF09\u2014\u2014\u9700\u7BA1\u7406\u5458\u91CD\u53D1\u5B89\u88C5\u7801\u5E76\u66F4\u65B0\u5BBF\u4E3B\u914D\u7F6E relayInstallCode \u540E\u91CD\u542F\u5BBF\u4E3B\uFF08docs/deploy-server.md\uFF09");
      }
      throw new RelayHttpError(res.status, `\u6CE8\u518C\u5931\u8D25: ${res.status} ${text}`);
    }
    const reg = await res.json();
    credential = reg.credential;
    this.updateCredential(credential);
    const binding = await this.establishTunnel(base, credential);
    this.startHeartbeat(base, credential);
    return binding;
  }
  startHeartbeat(base, credential) {
    this.timer = setInterval(() => {
      this.req(`${base}/_whalemaid/devices/${this.cfg.deviceId}/heartbeat`, {
        method: "POST",
        headers: { authorization: `Bearer ${credential}` },
        fingerprint: this.cfg.relayFingerprint
      }).then(async (res) => {
        if (res.status === 200) {
          try {
            const body = await res.json();
            if (body.connectEvents && body.connectEvents > 0) {
              this.log(`[whalemaid] \u4E3B\u63A7\u7AEF\u5DF2\u8FDE\u63A5\uFF08\u6700\u8FD1 20s \u5185 ${body.connectEvents} \u6B21\u6388\u6743\uFF09\u2014\u2014\u6709\u4EBA\u6B63\u5728\u8FDC\u7A0B\u63A7\u5236\u672C\u673A`);
            }
            if (body.temporaryPassword) this.cfg.onTemporaryStatus(body.temporaryPassword);
          } catch {
          }
        }
      }).catch(() => void 0);
    }, 2e4);
    this.timer.unref();
  }
  async establishTunnel(base, credential) {
    const res = await this.req(`${base}/_whalemaid/devices/${this.cfg.deviceId}/tunnel`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${credential}` },
      body: JSON.stringify({ hostAuthority: `127.0.0.1:${this.cfg.pluginPort}` }),
      fingerprint: this.cfg.relayFingerprint
    });
    if (res.status >= 300) throw new RelayHttpError(res.status, `\u96A7\u9053\u7B7E\u53D1\u5931\u8D25: ${res.status} ${await res.text()}`);
    const binding = await res.json();
    if (!binding.serverPublicKey) {
      throw new Error("\u670D\u52A1\u7AEF\u672A\u8FD4\u56DE rathole noise \u516C\u94A5\uFF08serverPublicKey\uFF09\uFF0C\u62D2\u7EDD\u5EFA\u7ACB\u96A7\u9053\uFF08SEC-001/003\uFF09");
    }
    const host = new URL(base).hostname;
    const cfgText = [
      "[client]",
      `remote_addr = "${host}:${this.cfg.relayPort}"`,
      "",
      "[client.transport]",
      'type = "noise"',
      "[client.transport.noise]",
      // NK 模式：固定服务端公钥（与中继持久化静态密钥对配套，防中间人；rathole 默认 transport 是 TCP 明文，必须显式 noise）
      `remote_public_key = "${binding.serverPublicKey}"`,
      "",
      `[client.services.${binding.service}]`,
      `token = "${binding.tunnelToken}"`,
      `local_addr = "127.0.0.1:${this.cfg.pluginPort}"`,
      ""
    ].join("\n");
    const dir = join2(this.cfg.dataDir, "relay");
    mkdirSync2(dir, { recursive: true });
    const cfgFile = join2(dir, "rathole-client.toml");
    writeFileSync2(cfgFile, cfgText, { mode: 384 });
    let backoffMs = 1e3;
    const spawnClient = () => {
      this.child = spawn(this.cfg.ratholeBin, [cfgFile], { stdio: "ignore" });
      this.child.on("exit", (code) => {
        this.log(`[whalemaid] rathole \u5BA2\u6237\u7AEF\u9000\u51FA code=${code}\uFF0C${backoffMs}ms \u540E\u91CD\u8FDE\uFF08UX-012\uFF09`);
        if (!this.stopped) {
          setTimeout(spawnClient, backoffMs).unref();
          backoffMs = Math.min(backoffMs * 2, 3e4);
        }
      });
      setTimeout(() => {
        backoffMs = 1e3;
      }, 6e4).unref();
    };
    spawnClient();
    return binding;
  }
  stopped = false;
  stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.child?.kill();
    this.child = null;
  }
};

// src/temporary.ts
var TemporaryPasswordManager = class {
  constructor(store, relay) {
    this.store = store;
    this.relay = relay;
  }
  snapshot(now = Math.floor(Date.now() / 1e3)) {
    const current = this.store.temporaryPassword;
    if (current.state === "active" && now > current.expiresAt) {
      this.store.syncTemporaryPasswordStatus({
        state: "expired",
        expiresAt: current.expiresAt,
        generation: current.generation
      });
    }
    return this.store.temporaryPassword;
  }
  async issue(ttlSec) {
    if (!Number.isInteger(ttlSec) || ttlSec < 60 || ttlSec > 86400) {
      throw new Error("ttlSec \u5FC5\u987B\u662F 60 \u5230 86400 \u4E4B\u95F4\u7684\u6574\u6570");
    }
    const password = generateTemporaryPassword();
    const issued = await this.relay.issueTemporaryPassword(password, ttlSec);
    if (issued.state !== "active") throw new Error(`\u4E2D\u7EE7\u8FD4\u56DE\u4E86\u65E0\u6548\u4E34\u65F6\u5BC6\u7801\u72B6\u6001: ${issued.state}`);
    const record = { password, ...issued };
    this.store.setTemporaryPassword(record);
    return record;
  }
  async revoke() {
    await this.relay.revokeTemporaryPassword();
    const current = this.store.temporaryPassword;
    this.store.syncTemporaryPasswordStatus({
      state: "revoked",
      expiresAt: current.expiresAt,
      generation: current.generation
    });
  }
};

// src/temporary-routes.ts
var CLIENT_HEADER = "x-whalemaid-client";
var BadRequestError = class extends Error {
};
function respond(res, status, value) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(value));
}
function authorized(req) {
  return req.headers[CLIENT_HEADER] === "1";
}
function readJson(req) {
  return new Promise((resolve, reject) => {
    const contentType = req.headers["content-type"];
    if (typeof contentType !== "string" || !contentType.toLowerCase().startsWith("application/json")) {
      reject(new BadRequestError("content-type \u5FC5\u987B\u662F application/json"));
      return;
    }
    const chunks = [];
    let size = 0;
    req.on?.("data", (chunk) => {
      const value = Buffer.from(chunk);
      size += value.length;
      if (size <= 4096) chunks.push(value);
    });
    req.on?.("end", () => {
      if (size > 4096) {
        reject(new BadRequestError("\u8BF7\u6C42\u4F53\u8FC7\u5927"));
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new BadRequestError("JSON \u65E0\u6548"));
      }
    });
    req.on?.("error", reject);
  });
}
function registerTemporaryPasswordRoutes(server, manager, deviceId) {
  const disposeDevice = server.register({
    kind: "exact",
    path: "/api/whalemaid/device",
    handler: (req, res) => {
      if (!authorized(req)) {
        respond(res, 403, { error: "forbidden" });
        return;
      }
      if (req.method !== "GET") {
        respond(res, 405, { error: "method not allowed" });
        return;
      }
      respond(res, 200, { deviceId, temporaryPassword: manager.snapshot() });
    }
  });
  const disposeTemporary = server.register({
    kind: "exact",
    path: "/api/whalemaid/temporary-password",
    handler: (req, res) => {
      if (!authorized(req)) {
        respond(res, 403, { error: "forbidden" });
        return;
      }
      if (req.method === "DELETE") {
        void manager.revoke().then(() => {
          respond(res, 200, { deviceId, temporaryPassword: manager.snapshot() });
        }).catch((error) => {
          respond(res, 502, { error: error instanceof Error ? error.message : String(error) });
        });
        return;
      }
      if (req.method !== "POST") {
        respond(res, 405, { error: "method not allowed" });
        return;
      }
      void readJson(req).then((body) => {
        const ttlSec = Number(body.ttlSec);
        if (!Number.isInteger(ttlSec) || ttlSec < 60 || ttlSec > 86400) {
          throw new BadRequestError("ttlSec \u5FC5\u987B\u662F 60 \u5230 86400 \u4E4B\u95F4\u7684\u6574\u6570");
        }
        return manager.issue(ttlSec);
      }).then((temporaryPassword) => {
        respond(res, 200, { deviceId, temporaryPassword });
      }).catch((error) => {
        const status = error instanceof BadRequestError ? 400 : 502;
        respond(res, status, { error: error instanceof Error ? error.message : String(error) });
      });
    }
  });
  return () => {
    disposeTemporary();
    disposeDevice();
  };
}

// src/v1/providers.ts
function audioFilename(mimeType) {
  const mime = mimeType.toLowerCase();
  if (mime.includes("mp4") || mime.includes("m4a")) return "audio.m4a";
  if (mime.includes("mpeg")) return "audio.mp3";
  if (mime.includes("ogg")) return "audio.ogg";
  return "audio.webm";
}
function voiceCall(req) {
  const boundary = `----whalemaid-${Math.random().toString(36).slice(2)}`;
  const filename = audioFilename(req.mimeType);
  switch (req.provider) {
    case "openai":
      return {
        url: "https://api.openai.com/v1/audio/transcriptions",
        headers: { authorization: `Bearer ${req.apiKey}`, "content-type": `multipart/form-data; boundary=${boundary}` },
        body: multipartBody([
          ["model", "whisper-1"],
          ["file", req.audio, req.mimeType, filename]
        ], boundary)
      };
    case "groq":
      return {
        url: "https://api.groq.com/openai/v1/audio/transcriptions",
        headers: { authorization: `Bearer ${req.apiKey}`, "content-type": `multipart/form-data; boundary=${boundary}` },
        body: multipartBody([
          ["model", "whisper-large-v3"],
          ["file", req.audio, req.mimeType, filename]
        ], boundary)
      };
    case "dashscope":
      throw new Error("dashscope \u8BED\u97F3\u6587\u4EF6\u8BC6\u522B\u672A\u7ECF\u771F\u5B9E key \u5B9E\u6D4B\uFF0C\u7981\u6B62\u4F7F\u7528\uFF08audit#7\uFF09");
  }
}
function parseVoiceResponse(provider, raw) {
  const data = JSON.parse(raw);
  if (provider === "dashscope") {
    throw new Error("dashscope \u8BED\u97F3\u672A\u7ECF\u5B9E\u6D4B\uFF0C\u7981\u6B62\u4F7F\u7528\uFF08audit#7\uFF09");
  }
  const text = typeof data.text === "string" ? data.text : "";
  if (!text) throw new Error(`\u8BED\u97F3\u8F6C\u5F55\u54CD\u5E94\u7F3A\u5C11 text \u5B57\u6BB5`);
  return { text };
}
function visionCall(req) {
  const base64 = req.image.toString("base64");
  const dataUrl = `data:${req.mimeType};base64,${base64}`;
  switch (req.provider) {
    case "deepseek-ocr":
      return {
        url: "https://api.deepseek.com/chat/completions",
        headers: { authorization: `Bearer ${req.apiKey}`, "content-type": "application/json" },
        body: Buffer.from(JSON.stringify({
          model: "deepseek-chat",
          messages: [{ role: "user", content: [
            { type: "text", text: "\u8BF7\u5BF9\u8FD9\u5F20\u56FE\u7247\u505A\u7B80\u77ED\u63CF\u8FF0\uFF08OCR \u6587\u672C + \u753B\u9762\u8981\u70B9\uFF0C100 \u5B57\u5185\uFF09\uFF0C\u4F9B\u6CA1\u6709\u89C6\u89C9\u80FD\u529B\u7684\u6A21\u578B\u7406\u89E3\u3002" },
            { type: "image_url", image_url: { url: dataUrl } }
          ] }],
          max_tokens: 300
        }))
      };
    case "qwen-vl":
      return {
        url: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
        headers: { authorization: `Bearer ${req.apiKey}`, "content-type": "application/json" },
        body: Buffer.from(JSON.stringify({
          model: "qwen-vl-max",
          messages: [{ role: "user", content: [
            { type: "text", text: "\u8BF7\u5BF9\u8FD9\u5F20\u56FE\u7247\u505A\u7B80\u77ED\u63CF\u8FF0\uFF08OCR \u6587\u672C + \u753B\u9762\u8981\u70B9\uFF0C100 \u5B57\u5185\uFF09\uFF0C\u4F9B\u6CA1\u6709\u89C6\u89C9\u80FD\u529B\u7684\u6A21\u578B\u7406\u89E3\u3002" },
            { type: "image_url", image_url: { url: dataUrl } }
          ] }],
          max_tokens: 300
        }))
      };
    case "openai-vision":
      return {
        url: "https://api.openai.com/v1/chat/completions",
        headers: { authorization: `Bearer ${req.apiKey}`, "content-type": "application/json" },
        body: Buffer.from(JSON.stringify({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: [
            { type: "text", text: "\u8BF7\u5BF9\u8FD9\u5F20\u56FE\u7247\u505A\u7B80\u77ED\u63CF\u8FF0\uFF08OCR \u6587\u672C + \u753B\u9762\u8981\u70B9\uFF0C100 \u5B57\u5185\uFF09\uFF0C\u4F9B\u6CA1\u6709\u89C6\u89C9\u80FD\u529B\u7684\u6A21\u578B\u7406\u89E3\u3002" },
            { type: "image_url", image_url: { url: dataUrl } }
          ] }],
          max_tokens: 300
        }))
      };
    case "grok-vision":
      return {
        url: "https://api.x.ai/v1/chat/completions",
        headers: { authorization: `Bearer ${req.apiKey}`, "content-type": "application/json" },
        body: Buffer.from(JSON.stringify({
          model: "grok-2-vision-latest",
          messages: [{ role: "user", content: [
            { type: "text", text: "\u8BF7\u5BF9\u8FD9\u5F20\u56FE\u7247\u505A\u7B80\u77ED\u63CF\u8FF0\uFF08OCR \u6587\u672C + \u753B\u9762\u8981\u70B9\uFF0C100 \u5B57\u5185\uFF09\uFF0C\u4F9B\u6CA1\u6709\u89C6\u89C9\u80FD\u529B\u7684\u6A21\u578B\u7406\u89E3\u3002" },
            { type: "image_url", image_url: { url: dataUrl } }
          ] }],
          max_tokens: 300
        }))
      };
    case "gemini":
      return {
        url: `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(req.apiKey)}`,
        headers: { "content-type": "application/json" },
        body: Buffer.from(JSON.stringify({
          contents: [{ parts: [
            { text: "\u8BF7\u5BF9\u8FD9\u5F20\u56FE\u7247\u505A\u7B80\u77ED\u63CF\u8FF0\uFF08OCR \u6587\u672C + \u753B\u9762\u8981\u70B9\uFF0C100 \u5B57\u5185\uFF09\uFF0C\u4F9B\u6CA1\u6709\u89C6\u89C9\u80FD\u529B\u7684\u6A21\u578B\u7406\u89E3\u3002" },
            { inline_data: { mime_type: req.mimeType, data: base64 } }
          ] }]
        }))
      };
  }
}
function parseVisionResponse(provider, raw) {
  const data = JSON.parse(raw);
  if (provider === "gemini") {
    const text2 = extractFirstText(data.candidates);
    if (!text2) throw new Error("\u89C6\u89C9\u54CD\u5E94\u7F3A\u5C11\u6587\u672C");
    return { description: text2 };
  }
  const choices = data.choices;
  const content = choices?.[0]?.message?.content;
  const text = typeof content === "string" ? content : content?.find((p) => p.type === "text")?.text ?? "";
  if (!text) throw new Error("\u89C6\u89C9\u54CD\u5E94\u7F3A\u5C11\u6587\u672C");
  return { description: text };
}
function extractFirstText(value) {
  if (Array.isArray(value)) {
    for (const cand of value) {
      const parts = cand?.content?.parts ?? [];
      for (const p of parts) if (typeof p.text === "string" && p.text) return p.text;
    }
  }
  return "";
}
function multipartBody(fields, boundary) {
  const parts = [];
  for (const f of fields) {
    if (typeof f[1] === "string") {
      parts.push(Buffer.from(`--${boundary}\r
content-disposition: form-data; name="${f[0]}"\r
\r
${f[1]}\r
`));
    } else {
      const [, content, mime, filename] = f;
      parts.push(Buffer.from(`--${boundary}\r
content-disposition: form-data; name="${f[0]}"; filename="${filename}"\r
content-type: ${mime}\r
\r
`));
      parts.push(content);
      parts.push(Buffer.from("\r\n"));
    }
  }
  parts.push(Buffer.from(`--${boundary}--\r
`));
  return Buffer.concat(parts);
}
var VOICE_PROVIDERS = ["openai", "groq", "dashscope"];
var VISION_PROVIDERS = ["deepseek-ocr", "qwen-vl", "openai-vision", "grok-vision", "gemini"];

// src/v1/routes.ts
async function resolveKey(ref, deps) {
  if (!deps.credentials) throw new Error("\u5BBF\u4E3B\u65E0 credentials \u670D\u52A1");
  const hit = await deps.credentials.resolve(ref);
  const value = hit?.value;
  if (!value || value.length === 0) throw new Error(`\u51ED\u636E\u5F15\u7528 ${ref} \u672A\u8BBE\u7F6E\uFF08\u5BBF\u4E3B dsh-credentials\uFF09`);
  return value;
}
async function transcribe(body, deps) {
  const provider = deps.cfg.voiceProvider;
  if (!VOICE_PROVIDERS.includes(provider)) throw new Error(`voiceProvider \u672A\u914D\u7F6E\u6216\u672A\u77E5: ${deps.cfg.voiceProvider}`);
  const payload = JSON.parse(body.toString("utf8"));
  if (!payload.audio) throw new Error("audio(base64) \u5FC5\u586B");
  const call = voiceCall({
    provider,
    apiKey: await resolveKey(deps.cfg.voiceCredentialRef, deps),
    audio: Buffer.from(payload.audio, "base64"),
    mimeType: payload.mimeType ?? "audio/webm"
  });
  const fetchImpl = deps.fetchImpl ?? fetch;
  const res = await fetchImpl(call.url, { method: "POST", headers: call.headers, body: call.body });
  const raw = await res.text();
  if (!res.ok) throw new Error(`\u8BED\u97F3\u8F6C\u5F55\u4E0A\u6E38\u5931\u8D25 ${res.status}: ${raw.slice(0, 200)}`);
  return parseVoiceResponse(provider, raw);
}
async function describeImage(body, deps) {
  const provider = deps.cfg.visionProvider;
  if (!VISION_PROVIDERS.includes(provider)) throw new Error(`visionProvider \u672A\u914D\u7F6E\u6216\u672A\u77E5: ${deps.cfg.visionProvider}`);
  const payload = JSON.parse(body.toString("utf8"));
  if (!payload.image) throw new Error("image(base64) \u5FC5\u586B");
  const call = visionCall({
    provider,
    apiKey: await resolveKey(deps.cfg.visionCredentialRef, deps),
    image: Buffer.from(payload.image, "base64"),
    mimeType: payload.mimeType ?? "image/png"
  });
  const fetchImpl = deps.fetchImpl ?? fetch;
  const res = await fetchImpl(call.url, { method: "POST", headers: call.headers, body: call.body });
  const raw = await res.text();
  if (!res.ok) throw new Error(`\u89C6\u89C9\u63CF\u8FF0\u4E0A\u6E38\u5931\u8D25 ${res.status}: ${raw.slice(0, 200)}`);
  return parseVisionResponse(provider, raw);
}

// src/config.ts
import Schema from "@deepseek-ai/schemastery";
var Config = Schema.object({
  dataDir: Schema.string().default(""),
  relayUrl: Schema.string().default(""),
  relayInstallCode: Schema.string().default(""),
  relayFingerprint: Schema.string().default(""),
  ratholeBin: Schema.string().default("rathole"),
  relayPort: Schema.number().default(2333),
  voiceProvider: Schema.string().default(""),
  voiceCredentialRef: Schema.string().default(""),
  visionProvider: Schema.string().default(""),
  visionCredentialRef: Schema.string().default("")
});

// src/index.ts
var name = "whalemaid";
var inject = ["webServer"];
var DEFAULTS = {
  dataDir: "",
  relayUrl: "",
  relayInstallCode: "",
  relayFingerprint: "",
  ratholeBin: "rathole",
  relayPort: 2333,
  voiceProvider: "",
  voiceCredentialRef: "",
  visionProvider: "",
  visionCredentialRef: ""
};
function apply(ctx, config) {
  const resolved = { ...DEFAULTS, ...config };
  const profileBaseUrl = ctx.baseUrl;
  const store = new Store({ dataDir: resolved.dataDir, profileBaseUrl });
  const hostWeb = ctx.webServer;
  if (resolved.relayUrl && !resolved.relayFingerprint) {
    ctx.logger.error("[whalemaid] \u914D\u7F6E\u4E86 relayUrl \u4F46\u7F3A\u5C11 relayFingerprint\uFF1A\u62D2\u7EDD\u63A5\u5165\u4E2D\u7EE7\uFF08SEC-001\uFF0C\u9632\u4E2D\u95F4\u4EBA\uFF09\u2014\u2014\u6307\u7EB9\u89C1\u670D\u52A1\u7AEF\u542F\u52A8\u65E5\u5FD7");
  }
  const relay = resolved.relayUrl && resolved.relayFingerprint ? new RelayClient(
    {
      relayUrl: resolved.relayUrl,
      relayInstallCode: resolved.relayInstallCode,
      relayFingerprint: resolved.relayFingerprint,
      ratholeBin: resolved.ratholeBin,
      relayPort: resolved.relayPort,
      // 隧道目标 = 宿主原生 web 端口（官方 /api+WS+UI；官方默认 127.0.0.1 安全姿态）
      pluginPort: hostWeb?.port ?? 0,
      dataDir: store.file.replace(/store\.json$/, ""),
      deviceId: store.deviceId,
      longPassword: store.longPassword,
      savedCredential: store.relayCredential,
      onCredential: (c) => store.setRelayCredential(c),
      onTemporaryStatus: (status) => store.syncTemporaryPasswordStatus(status)
    },
    (msg) => ctx.logger.info(msg)
  ) : null;
  let disposed = false;
  ctx.effect(() => () => {
    disposed = true;
    relay?.stop();
    store.close();
  });
  if (!relay) {
    ctx.logger.warn("[whalemaid] \u672A\u914D\u7F6E relayUrl\uFF1A\u63D2\u4EF6\u4E0D\u751F\u6548\uFF08\u8FDC\u7A0B\u63A7\u5236\u53EA\u8D70\u4E2D\u7EE7\uFF0C\u7F16\u53F7+\u5BC6\u7801\u6A21\u578B\uFF09\u2014\u2014\u89C1 docs/deploy-server.md");
    return;
  }
  if (!hostWeb?.port) {
    ctx.logger.error("[whalemaid] \u5BBF\u4E3B\u65E0 web \u670D\u52A1\uFF08webServer.port \u7F3A\u5931\uFF09\uFF1A\u672C\u63D2\u4EF6\u4F9D\u8D56\u5B98\u65B9 web \u8F7D\u4F53\uFF0C\u63D2\u4EF6\u96F6\u76D1\u542C");
    return;
  }
  if (!hostWeb.register) {
    ctx.logger.error("[whalemaid] \u5BBF\u4E3B webServer.register \u7F3A\u5931\uFF1A\u65E0\u6CD5\u6302\u8F7D\u4E34\u65F6\u5BC6\u7801\u7BA1\u7406\u9762\uFF0C\u62D2\u7EDD\u90E8\u5206\u542F\u7528");
    return;
  }
  const temporaryPasswords = new TemporaryPasswordManager(store, relay);
  const registerRoute = hostWeb.register;
  const temporaryRouteServer = {
    register: (route) => registerRoute(route)
  };
  ctx.effect(
    () => registerTemporaryPasswordRoutes(temporaryRouteServer, temporaryPasswords, store.deviceId),
    "whalemaid: temporary password routes"
  );
  ctx.logger.info(`[whalemaid] \u8BBE\u5907\u7F16\u53F7 ${store.deviceId}\uFF08\u957F\u671F\u5BC6\u7801\u89C1 ${store.file}\uFF09\uFF1B\u96A7\u9053\u76EE\u6807 = \u5BBF\u4E3B\u539F\u751F web:${hostWeb.port}\uFF1B\u672C\u5730\u7BA1\u7406 token=${store.adminToken}`);
  ctx.logger.info(`[whalemaid] ==== WhaleMaid \u53D7\u63A7\u7AEF\u8BF4\u660E ====
  \xB7 \u8BBE\u5907\u7F16\u53F7: ${store.deviceId}\uFF08\u4E3B\u63A7\u7AEF\u7528\u300C\u7F16\u53F7+\u957F\u671F\u5BC6\u7801\u300D\u8FDE\u63A5\uFF0C\u5168\u7A0B\u65E0 IP\uFF09
  \xB7 \u957F\u671F\u5BC6\u7801: \u89C1 ${store.file} \u7684 longPassword\uFF1B\u8F6E\u6362: POST /whalemaid/rotate-password + x-whalemaid-token: ${store.adminToken}
  \xB7 \u5B89\u5168: \u6709\u4EBA\u8FDE\u63A5\u672C\u673A = \u5B8C\u6574\u8FDC\u7A0B\u63A7\u5236\uFF0C\u7B49\u540C\u5176\u5750\u5728\u672C\u673A\u524D\uFF1B\u8BF7\u52FF\u6CC4\u9732\u5BC6\u7801\uFF0C\u5931\u7A83\u5373\u8F6E\u6362
  \xB7 \u88AB\u8FDE\u63A5\u63D0\u793A: \u4E3B\u63A7\u7AEF\u8FDE\u63A5\u6210\u529F/\u65AD\u5F00\u4F1A\u6253\u5370\u5728\u4E0B\u65B9\u65E5\u5FD7\uFF08[whalemaid] \u4E3B\u63A7\u7AEF\u5DF2\u8FDE\u63A5/\u5DF2\u65AD\u5F00\uFF09
  ========================================`);
  let attempt = 0;
  const tryStart = async () => {
    if (disposed) return;
    try {
      await relay.start();
      if (disposed) {
        relay.stop();
        return;
      }
      ctx.logger.info(`[whalemaid] \u4E2D\u7EE7\u5DF2\u63A5\u5165 device=${store.deviceId} target=\u5BBF\u4E3B\u539F\u751Fweb:${hostWeb.port}\uFF08\u4E3B\u63A7\u7AEF\u7528\u8BBE\u5907\u7F16\u53F7+\u5BC6\u7801\u8FDE\u63A5\uFF0C\u65E0\u9700 IP\uFF09`);
    } catch (e) {
      if (disposed) return;
      attempt += 1;
      const delay = Math.min(2e3 * 2 ** attempt, 6e4);
      ctx.logger.warn(`[whalemaid] \u4E2D\u7EE7\u63A5\u5165\u5931\u8D25\uFF08\u7B2C ${attempt} \u6B21\uFF09: ${e instanceof Error ? e.message : String(e)}\uFF1B${Math.round(delay / 1e3)}s \u540E\u91CD\u8BD5`);
      setTimeout(tryStart, delay).unref();
    }
  };
  void tryStart();
  try {
    const web = ctx;
    web.webServer?.register?.({
      kind: "exact",
      path: "/whalemaid/rotate-password",
      handler: (_req, res) => {
        const req = _req;
        const token = req.headers["x-whalemaid-token"];
        if (req.method !== "POST" || token !== store.adminToken) {
          res.writeHead(403);
          res.end("forbidden");
          return;
        }
        const next = store.rotatePassword();
        void relay.rotatePassword(next).catch((e) => ctx.logger.warn(`[whalemaid] \u5BC6\u7801\u8F6E\u6362\u5931\u8D25: ${e instanceof Error ? e.message : String(e)}`));
        ctx.logger.info(`[whalemaid] \u957F\u671F\u5BC6\u7801\u5DF2\u91CD\u751F\u6210\uFF08\u65B0\u5BC6\u7801\u89C1 ${store.file}\uFF09`);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, deviceId: store.deviceId }));
      }
    });
  } catch {
    ctx.logger.warn("[whalemaid] \u5BBF\u4E3B web \u8DEF\u7531\u4E0D\u53EF\u7528\uFF0C\u5BC6\u7801\u8F6E\u6362\u5165\u53E3\u8DF3\u8FC7");
  }
  try {
    const v1Cfg = {
      voiceProvider: resolved.voiceProvider,
      voiceCredentialRef: resolved.voiceCredentialRef,
      visionProvider: resolved.visionProvider,
      visionCredentialRef: resolved.visionCredentialRef
    };
    if (v1Cfg.voiceProvider || v1Cfg.visionProvider) {
      const web = ctx;
      const credentials = web.get?.("credentials");
      const deps = {
        cfg: v1Cfg,
        credentials,
        log: (m) => ctx.logger.info(m)
      };
      const readBody = (req) => new Promise((resolve, reject) => {
        const chunks = [];
        req.on?.("data", (c) => chunks.push(Buffer.from(c)));
        req.on?.("end", () => resolve(Buffer.concat(chunks)));
        req.on?.("error", reject);
      });
      const jsonRoute = (path, run) => {
        web.webServer?.register?.({
          kind: "exact",
          path,
          handler: (req, res) => {
            if (req.method !== "POST") {
              res.writeHead(405);
              res.end("method not allowed");
              return;
            }
            void readBody(req).then(async (body) => {
              try {
                const result = await run(body);
                res.writeHead(200, { "content-type": "application/json" });
                res.end(JSON.stringify(result));
              } catch (e) {
                res.writeHead(400, { "content-type": "application/json" });
                res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
              }
            }).catch((e) => {
              res.writeHead(400, { "content-type": "application/json" });
              res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
            });
          }
        });
      };
      if (v1Cfg.voiceProvider) jsonRoute("/api/whalemaid/voice.transcribe", (body) => transcribe(body, deps));
      if (v1Cfg.visionProvider) jsonRoute("/api/whalemaid/vision.describe", (body) => describeImage(body, deps));
      ctx.logger.info(`[whalemaid] V1 \u589E\u5F3A\u9762\u5DF2\u6302\u8F7D: voice=${v1Cfg.voiceProvider || "-"} vision=${v1Cfg.visionProvider || "-"}\uFF08BYOK\uFF0Ckey \u53EA\u5B58\u5BBF\u4E3B\uFF09`);
    }
  } catch (e) {
    ctx.logger.warn(`[whalemaid] V1 \u8DEF\u7531\u6302\u8F7D\u5931\u8D25: ${e instanceof Error ? e.message : String(e)}`);
  }
}
export {
  Config,
  apply,
  inject,
  name
};
