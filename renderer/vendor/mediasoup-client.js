// mediasoup-client 3.25.3 (ISC License, https://github.com/versatica/mediasoup-client), sdp-transform (MIT), h264-profile-level-id (ISC);
// собран для «Сходки» скриптом scripts/mediasoup/build.ts
var __defProp = Object.defineProperty;
var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var __exportCjs = (target, getters, setters) => {
  for (var name in getters)
    __defProp(target, name, {
      get: getters[name],
      set: setters[name],
      enumerable: true,
      configurable: true
    });
};

// ../ms/sdpt/lib/grammar.js
var require_grammar = __commonJS(function(exports, module) {
  var grammar = module.exports = {
    v: [{
      name: "version",
      reg: /^(\d*)$/
    }],
    o: [{
      name: "origin",
      reg: /^(\S*) (\d*) (\d*) (\S*) IP(\d) (\S*)/,
      names: ["username", "sessionId", "sessionVersion", "netType", "ipVer", "address"],
      format: "%s %s %d %s IP%d %s"
    }],
    s: [{ name: "name" }],
    i: [{ name: "description" }],
    u: [{ name: "uri" }],
    e: [{ name: "email" }],
    p: [{ name: "phone" }],
    z: [{ name: "timezones" }],
    r: [{ name: "repeats" }],
    t: [{
      name: "timing",
      reg: /^(\d*) (\d*)/,
      names: ["start", "stop"],
      format: "%d %d"
    }],
    c: [{
      name: "connection",
      reg: /^IN IP(\d) (\S*)/,
      names: ["version", "ip"],
      format: "IN IP%d %s"
    }],
    b: [{
      push: "bandwidth",
      reg: /^(TIAS|AS|CT|RR|RS):(\d*)/,
      names: ["type", "limit"],
      format: "%s:%s"
    }],
    m: [{
      reg: /^(\w*) (\d*) ([\w/]*)(?: (.*))?/,
      names: ["type", "port", "protocol", "payloads"],
      format: "%s %d %s %s"
    }],
    a: [
      {
        push: "rtp",
        reg: /^rtpmap:(\d*) ([\w\-.]*)(?:\s*\/(\d*)(?:\s*\/(\S*))?)?/,
        names: ["payload", "codec", "rate", "encoding"],
        format: function(o) {
          return o.encoding ? "rtpmap:%d %s/%s/%s" : o.rate ? "rtpmap:%d %s/%s" : "rtpmap:%d %s";
        }
      },
      {
        push: "fmtp",
        reg: /^fmtp:(\d*) ([\S| ]*)/,
        names: ["payload", "config"],
        format: "fmtp:%d %s"
      },
      {
        name: "control",
        reg: /^control:(.*)/,
        format: "control:%s"
      },
      {
        name: "rtcp",
        reg: /^rtcp:(\d*)(?: (\S*) IP(\d) (\S*))?/,
        names: ["port", "netType", "ipVer", "address"],
        format: function(o) {
          return o.address != null ? "rtcp:%d %s IP%d %s" : "rtcp:%d";
        }
      },
      {
        push: "rtcpFbTrrInt",
        reg: /^rtcp-fb:(\*|\d*) trr-int (\d*)/,
        names: ["payload", "value"],
        format: "rtcp-fb:%s trr-int %d"
      },
      {
        push: "rtcpFb",
        reg: /^rtcp-fb:(\*|\d*) ([\w-_]*)(?: ([\w-_]*))?/,
        names: ["payload", "type", "subtype"],
        format: function(o) {
          return o.subtype != null ? "rtcp-fb:%s %s %s" : "rtcp-fb:%s %s";
        }
      },
      {
        push: "ext",
        reg: /^extmap:(\d+)(?:\/(\w+))?(?: (urn:ietf:params:rtp-hdrext:encrypt))? (\S*)(?: (\S*))?/,
        names: ["value", "direction", "encrypt-uri", "uri", "config"],
        format: function(o) {
          return "extmap:%d" + (o.direction ? "/%s" : "%v") + (o["encrypt-uri"] ? " %s" : "%v") + " %s" + (o.config ? " %s" : "");
        }
      },
      {
        name: "extmapAllowMixed",
        reg: /^(extmap-allow-mixed)/
      },
      {
        push: "crypto",
        reg: /^crypto:(\d*) ([\w_]*) (\S*)(?: (\S*))?/,
        names: ["id", "suite", "config", "sessionConfig"],
        format: function(o) {
          return o.sessionConfig != null ? "crypto:%d %s %s %s" : "crypto:%d %s %s";
        }
      },
      {
        name: "setup",
        reg: /^setup:(\w*)/,
        format: "setup:%s"
      },
      {
        name: "connectionType",
        reg: /^connection:(new|existing)/,
        format: "connection:%s"
      },
      {
        name: "mid",
        reg: /^mid:([^\s]*)/,
        format: "mid:%s"
      },
      {
        push: "msid",
        reg: /^msid:([\w-]+)(?: ([\w-]+))?/,
        names: ["id", "appdata"],
        format: "msid:%s %s"
      },
      {
        name: "ptime",
        reg: /^ptime:(\d*(?:\.\d*)*)/,
        format: "ptime:%d"
      },
      {
        name: "maxptime",
        reg: /^maxptime:(\d*(?:\.\d*)*)/,
        format: "maxptime:%d"
      },
      {
        name: "direction",
        reg: /^(sendrecv|recvonly|sendonly|inactive)/
      },
      {
        name: "icelite",
        reg: /^(ice-lite)/
      },
      {
        name: "iceUfrag",
        reg: /^ice-ufrag:(\S*)/,
        format: "ice-ufrag:%s"
      },
      {
        name: "icePwd",
        reg: /^ice-pwd:(\S*)/,
        format: "ice-pwd:%s"
      },
      {
        name: "fingerprint",
        reg: /^fingerprint:(\S*) (\S*)/,
        names: ["type", "hash"],
        format: "fingerprint:%s %s"
      },
      {
        push: "candidates",
        reg: /^candidate:(\S*) (\d*) (\S*) (\d*) (\S*) (\d*) typ (\S*)(?: raddr (\S*) rport (\d*))?(?: tcptype (\S*))?(?: generation (\d*))?(?: network-id (\d*))?(?: network-cost (\d*))?/,
        names: ["foundation", "component", "transport", "priority", "ip", "port", "type", "raddr", "rport", "tcptype", "generation", "network-id", "network-cost"],
        format: function(o) {
          var str = "candidate:%s %d %s %d %s %d typ %s";
          str += o.raddr != null ? " raddr %s rport %d" : "%v%v";
          str += o.tcptype != null ? " tcptype %s" : "%v";
          if (o.generation != null) {
            str += " generation %d";
          }
          str += o["network-id"] != null ? " network-id %d" : "%v";
          str += o["network-cost"] != null ? " network-cost %d" : "%v";
          return str;
        }
      },
      {
        name: "endOfCandidates",
        reg: /^(end-of-candidates)/
      },
      {
        name: "remoteCandidates",
        reg: /^remote-candidates:(.*)/,
        format: "remote-candidates:%s"
      },
      {
        name: "iceOptions",
        reg: /^ice-options:(\S*)/,
        format: "ice-options:%s"
      },
      {
        push: "ssrcs",
        reg: /^ssrc:(\d*) ([\w_-]*)(?::(.*))?/,
        names: ["id", "attribute", "value"],
        format: function(o) {
          var str = "ssrc:%d";
          if (o.attribute != null) {
            str += " %s";
            if (o.value != null) {
              str += ":%s";
            }
          }
          return str;
        }
      },
      {
        push: "ssrcGroups",
        reg: /^ssrc-group:([\x21\x23\x24\x25\x26\x27\x2A\x2B\x2D\x2E\w]*) (.*)/,
        names: ["semantics", "ssrcs"],
        format: "ssrc-group:%s %s"
      },
      {
        name: "msidSemantic",
        reg: /^msid-semantic:\s?(\w*) (\S*)/,
        names: ["semantic", "token"],
        format: "msid-semantic: %s %s"
      },
      {
        push: "groups",
        reg: /^group:(\w*) (.*)/,
        names: ["type", "mids"],
        format: "group:%s %s"
      },
      {
        name: "rtcpMux",
        reg: /^(rtcp-mux)/
      },
      {
        name: "rtcpRsize",
        reg: /^(rtcp-rsize)/
      },
      {
        name: "sctpmap",
        reg: /^sctpmap:([\w_/]*) (\S*)(?: (\S*))?/,
        names: ["sctpmapNumber", "app", "maxMessageSize"],
        format: function(o) {
          return o.maxMessageSize != null ? "sctpmap:%s %s %s" : "sctpmap:%s %s";
        }
      },
      {
        name: "xGoogleFlag",
        reg: /^x-google-flag:([^\s]*)/,
        format: "x-google-flag:%s"
      },
      {
        push: "rids",
        reg: /^rid:([\d\w]+) (\w+)(?: ([\S| ]*))?/,
        names: ["id", "direction", "params"],
        format: function(o) {
          return o.params ? "rid:%s %s %s" : "rid:%s %s";
        }
      },
      {
        push: "imageattrs",
        reg: new RegExp("^imageattr:(\\d+|\\*)" + "[\\s\\t]+(send|recv)[\\s\\t]+(\\*|\\[\\S+\\](?:[\\s\\t]+\\[\\S+\\])*)" + "(?:[\\s\\t]+(recv|send)[\\s\\t]+(\\*|\\[\\S+\\](?:[\\s\\t]+\\[\\S+\\])*))?"),
        names: ["pt", "dir1", "attrs1", "dir2", "attrs2"],
        format: function(o) {
          return "imageattr:%s %s %s" + (o.dir2 ? " %s %s" : "");
        }
      },
      {
        name: "simulcast",
        reg: new RegExp("^simulcast:" + "(send|recv) ([a-zA-Z0-9\\-_~;,]+)" + "(?:\\s?(send|recv) ([a-zA-Z0-9\\-_~;,]+))?" + "$"),
        names: ["dir1", "list1", "dir2", "list2"],
        format: function(o) {
          return "simulcast:%s %s" + (o.dir2 ? " %s %s" : "");
        }
      },
      {
        name: "simulcast_03",
        reg: /^simulcast:[\s\t]+([\S+\s\t]+)$/,
        names: ["value"],
        format: "simulcast: %s"
      },
      {
        name: "framerate",
        reg: /^framerate:(\d+(?:$|\.\d+))/,
        format: "framerate:%s"
      },
      {
        name: "sourceFilter",
        reg: /^source-filter: *(excl|incl) (\S*) (IP4|IP6|\*) (\S*) (.*)/,
        names: ["filterMode", "netType", "addressTypes", "destAddress", "srcList"],
        format: "source-filter: %s %s %s %s %s"
      },
      {
        name: "bundleOnly",
        reg: /^(bundle-only)/
      },
      {
        name: "label",
        reg: /^label:(.+)/,
        format: "label:%s"
      },
      {
        name: "sctpPort",
        reg: /^sctp-port:(\d+)$/,
        format: "sctp-port:%s"
      },
      {
        name: "maxMessageSize",
        reg: /^max-message-size:(\d+)$/,
        format: "max-message-size:%s"
      },
      {
        push: "tsRefClocks",
        reg: /^ts-refclk:([^\s=]*)(?:=(\S*))?/,
        names: ["clksrc", "clksrcExt"],
        format: function(o) {
          return "ts-refclk:%s" + (o.clksrcExt != null ? "=%s" : "");
        }
      },
      {
        name: "mediaClk",
        reg: /^mediaclk:(?:id=(\S*))? *([^\s=]*)(?:=(\S*))?(?: *rate=(\d+)\/(\d+))?/,
        names: ["id", "mediaClockName", "mediaClockValue", "rateNumerator", "rateDenominator"],
        format: function(o) {
          var str = "mediaclk:";
          str += o.id != null ? "id=%s %s" : "%v%s";
          str += o.mediaClockValue != null ? "=%s" : "";
          str += o.rateNumerator != null ? " rate=%s" : "";
          str += o.rateDenominator != null ? "/%s" : "";
          return str;
        }
      },
      {
        name: "keywords",
        reg: /^keywds:(.+)$/,
        format: "keywds:%s"
      },
      {
        name: "content",
        reg: /^content:(.+)/,
        format: "content:%s"
      },
      {
        name: "bfcpFloorCtrl",
        reg: /^floorctrl:(c-only|s-only|c-s)/,
        format: "floorctrl:%s"
      },
      {
        name: "bfcpConfId",
        reg: /^confid:(\d+)/,
        format: "confid:%s"
      },
      {
        name: "bfcpUserId",
        reg: /^userid:(\d+)/,
        format: "userid:%s"
      },
      {
        name: "bfcpFloorId",
        reg: /^floorid:(.+) (?:m-stream|mstrm):(.+)/,
        names: ["id", "mStream"],
        format: "floorid:%s mstrm:%s"
      },
      {
        push: "invalid",
        names: ["value"]
      }
    ]
  };
  Object.keys(grammar).forEach(function(key) {
    var objs = grammar[key];
    objs.forEach(function(obj) {
      if (!obj.reg) {
        obj.reg = /(.*)/;
      }
      if (!obj.format) {
        obj.format = "%s";
      }
    });
  });
});

// ../ms/sdpt/lib/parser.js
var require_parser = __commonJS(function(exports) {
  var toIntIfInt = function(v) {
    return String(Number(v)) === v ? Number(v) : v;
  };
  var attachProperties = function(match, location, names, rawName) {
    if (rawName && !names) {
      location[rawName] = toIntIfInt(match[1]);
    } else {
      for (var i = 0;i < names.length; i += 1) {
        if (match[i + 1] != null) {
          location[names[i]] = toIntIfInt(match[i + 1]);
        }
      }
    }
  };
  var parseReg = function(obj, location, content) {
    var needsBlank = obj.name && obj.names;
    if (obj.push && !location[obj.push]) {
      location[obj.push] = [];
    } else if (needsBlank && !location[obj.name]) {
      location[obj.name] = {};
    }
    var keyLocation = obj.push ? {} : needsBlank ? location[obj.name] : location;
    attachProperties(content.match(obj.reg), keyLocation, obj.names, obj.name);
    if (obj.push) {
      location[obj.push].push(keyLocation);
    }
  };
  var grammar = require_grammar();
  var validLine = RegExp.prototype.test.bind(/^([a-z])=(.*)/);
  exports.parse = function(sdp) {
    var session = {}, media = [], location = session;
    sdp.split(/(\r\n|\r|\n)/).filter(validLine).forEach(function(l) {
      var type = l[0];
      var content = l.slice(2);
      if (type === "m") {
        media.push({ rtp: [], fmtp: [] });
        location = media[media.length - 1];
      }
      for (var j = 0;j < (grammar[type] || []).length; j += 1) {
        var obj = grammar[type][j];
        if (obj.reg.test(content)) {
          return parseReg(obj, location, content);
        }
      }
    });
    session.media = media;
    return session;
  };
  var paramReducer = function(acc, expr) {
    var s = expr.split(/=(.+)/, 2);
    if (s.length === 2) {
      acc[s[0]] = toIntIfInt(s[1]);
    } else if (s.length === 1 && expr.length > 1) {
      acc[s[0]] = undefined;
    }
    return acc;
  };
  exports.parseParams = function(str) {
    return str.split(/;\s?/).reduce(paramReducer, {});
  };
  exports.parseFmtpConfig = exports.parseParams;
  exports.parsePayloads = function(str) {
    return str.toString().split(" ").map(Number);
  };
  exports.parseRemoteCandidates = function(str) {
    var candidates = [];
    var parts = str.split(" ").map(toIntIfInt);
    for (var i = 0;i < parts.length; i += 3) {
      candidates.push({
        component: parts[i],
        ip: parts[i + 1],
        port: parts[i + 2]
      });
    }
    return candidates;
  };
  exports.parseImageAttributes = function(str) {
    return str.split(" ").map(function(item) {
      return item.substring(1, item.length - 1).split(",").reduce(paramReducer, {});
    });
  };
  exports.parseSimulcastStreamList = function(str) {
    return str.split(";").map(function(stream) {
      return stream.split(",").map(function(format) {
        var scid, paused = false;
        if (format[0] !== "~") {
          scid = toIntIfInt(format);
        } else {
          scid = toIntIfInt(format.substring(1, format.length));
          paused = true;
        }
        return {
          scid,
          paused
        };
      });
    });
  };
});

// ../ms/sdpt/lib/writer.js
var require_writer = __commonJS(function(exports, module) {
  var grammar = require_grammar();
  var formatRegExp = /%[sdv%]/g;
  var format = function(formatStr) {
    var i = 1;
    var args = arguments;
    var len = args.length;
    return formatStr.replace(formatRegExp, function(x) {
      if (i >= len) {
        return x;
      }
      var arg = args[i];
      i += 1;
      switch (x) {
        case "%%":
          return "%";
        case "%s":
          return String(arg);
        case "%d":
          return Number(arg);
        case "%v":
          return "";
      }
    });
  };
  var makeLine = function(type, obj, location) {
    var str = obj.format instanceof Function ? obj.format(obj.push ? location : location[obj.name]) : obj.format;
    var args = [type + "=" + str];
    if (obj.names) {
      for (var i = 0;i < obj.names.length; i += 1) {
        var n = obj.names[i];
        if (obj.name) {
          args.push(location[obj.name][n]);
        } else {
          args.push(location[obj.names[i]]);
        }
      }
    } else {
      args.push(location[obj.name]);
    }
    return format.apply(null, args);
  };
  var defaultOuterOrder = [
    "v",
    "o",
    "s",
    "i",
    "u",
    "e",
    "p",
    "c",
    "b",
    "t",
    "r",
    "z",
    "a"
  ];
  var defaultInnerOrder = ["i", "c", "b", "a"];
  module.exports = function(session, opts) {
    opts = opts || {};
    if (session.version == null) {
      session.version = 0;
    }
    if (session.name == null) {
      session.name = " ";
    }
    session.media.forEach(function(mLine) {
      if (mLine.payloads == null) {
        mLine.payloads = "";
      }
    });
    var outerOrder = opts.outerOrder || defaultOuterOrder;
    var innerOrder = opts.innerOrder || defaultInnerOrder;
    var sdp = [];
    outerOrder.forEach(function(type) {
      grammar[type].forEach(function(obj) {
        if (obj.name in session && session[obj.name] != null) {
          sdp.push(makeLine(type, obj, session));
        } else if (obj.push in session && session[obj.push] != null) {
          session[obj.push].forEach(function(el) {
            sdp.push(makeLine(type, obj, el));
          });
        }
      });
    });
    session.media.forEach(function(mLine) {
      sdp.push(makeLine("m", grammar.m[0], mLine));
      innerOrder.forEach(function(type) {
        grammar[type].forEach(function(obj) {
          if (obj.name in mLine && mLine[obj.name] != null) {
            sdp.push(makeLine(type, obj, mLine));
          } else if (obj.push in mLine && mLine[obj.push] != null) {
            mLine[obj.push].forEach(function(el) {
              sdp.push(makeLine(type, obj, el));
            });
          }
        });
      });
    });
    return sdp.join(`\r
`) + `\r
`;
  };
});

// scripts/mediasoup/shims/debug.js
function format(args) {
  if (typeof args[0] !== "string")
    return args.map(show).join(" ");
  let i = 1;
  const head = args[0].replace(/%([sdioOj%])/g, (m, c) => {
    if (c === "%")
      return "%";
    if (i >= args.length)
      return m;
    const v = args[i++];
    return c === "d" || c === "i" ? String(Number(v)) : show(v);
  });
  return [head, ...args.slice(i).map(show)].join(" ");
}
function show(v) {
  if (typeof v === "string")
    return v;
  if (v instanceof Error)
    return v.stack || v.message;
  try {
    return JSON.stringify(v);
  } catch (_) {
    return String(v);
  }
}
function createDebug(namespace) {
  const d = function(...args) {
    if (!d.enabled)
      return;
    try {
      d.log(`${namespace} ${format(args)}`);
    } catch (_) {}
  };
  d.namespace = namespace;
  d.enabled = /:(WARN|ERROR)\b/.test(namespace);
  d.log = (line) => console.warn(line);
  d.extend = (sub, delim) => createDebug(namespace + (delim === undefined ? ":" : delim) + sub);
  d.destroy = () => true;
  return d;
}
createDebug.enable = () => {};
createDebug.disable = () => "";
createDebug.enabled = () => false;
createDebug.log = (...a) => console.warn(...a);
createDebug.formatters = {};
var debug_default = createDebug;

// ../ms/msc/src/Logger.ts
var APP_NAME = "mediasoup-client";

class Logger {
  _debug;
  _warn;
  _error;
  constructor(prefix) {
    if (prefix) {
      this._debug = debug_default(`${APP_NAME}:${prefix}`);
      this._warn = debug_default(`${APP_NAME}:WARN:${prefix}`);
      this._error = debug_default(`${APP_NAME}:ERROR:${prefix}`);
    } else {
      this._debug = debug_default(APP_NAME);
      this._warn = debug_default(`${APP_NAME}:WARN`);
      this._error = debug_default(`${APP_NAME}:ERROR`);
    }
    this._debug.log = console.info.bind(console);
    this._warn.log = console.warn.bind(console);
    this._error.log = console.error.bind(console);
  }
  get debug() {
    return this._debug;
  }
  get warn() {
    return this._warn;
  }
  get error() {
    return this._error;
  }
}

// scripts/mediasoup/shims/events.js
class EventEmitter {
  constructor() {
    this._ev = new Map;
    this._max = 10;
  }
  _list(name) {
    let l = this._ev.get(name);
    if (!l) {
      l = [];
      this._ev.set(name, l);
    }
    return l;
  }
  on(name, fn) {
    this._list(name).push({ fn, once: false });
    return this;
  }
  addListener(name, fn) {
    return this.on(name, fn);
  }
  prependListener(name, fn) {
    this._list(name).unshift({ fn, once: false });
    return this;
  }
  once(name, fn) {
    this._list(name).push({ fn, once: true });
    return this;
  }
  prependOnceListener(name, fn) {
    this._list(name).unshift({ fn, once: true });
    return this;
  }
  off(name, fn) {
    const l = this._ev.get(name);
    if (!l)
      return this;
    const i = l.findIndex((x) => x.fn === fn);
    if (i >= 0)
      l.splice(i, 1);
    if (!l.length)
      this._ev.delete(name);
    return this;
  }
  removeListener(name, fn) {
    return this.off(name, fn);
  }
  removeAllListeners(name) {
    if (name === undefined)
      this._ev.clear();
    else
      this._ev.delete(name);
    return this;
  }
  emit(name, ...args) {
    const l = this._ev.get(name);
    if (!l || !l.length) {
      if (name === "error")
        throw args[0] instanceof Error ? args[0] : new Error(String(args[0]));
      return false;
    }
    for (const x of l.slice()) {
      if (x.once)
        this.off(name, x.fn);
      x.fn.apply(this, args);
    }
    return true;
  }
  listenerCount(name) {
    const l = this._ev.get(name);
    return l ? l.length : 0;
  }
  listeners(name) {
    return (this._ev.get(name) || []).map((x) => x.fn);
  }
  rawListeners(name) {
    return this.listeners(name);
  }
  eventNames() {
    return [...this._ev.keys()];
  }
  setMaxListeners(n) {
    this._max = n;
    return this;
  }
  getMaxListeners() {
    return this._max;
  }
}

// ../ms/msc/src/enhancedEvents.ts
var enhancedEventEmitterLogger = new Logger("EnhancedEventEmitter");

class EnhancedEventEmitter extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(Infinity);
  }
  close() {
    super.removeAllListeners();
  }
  emit(eventName, ...args) {
    return super.emit(eventName, ...args);
  }
  safeEmit(eventName, ...args) {
    try {
      return super.emit(eventName, ...args);
    } catch (error) {
      enhancedEventEmitterLogger.error("safeEmit() | event listener threw an error [eventName:%s]:%o", eventName, error);
      try {
        super.emit("listenererror", eventName, error);
      } catch (error2) {}
      return Boolean(super.listenerCount(eventName));
    }
  }
  on(eventName, listener) {
    super.on(eventName, listener);
    return this;
  }
  off(eventName, listener) {
    super.off(eventName, listener);
    return this;
  }
  addListener(eventName, listener) {
    super.on(eventName, listener);
    return this;
  }
  prependListener(eventName, listener) {
    super.prependListener(eventName, listener);
    return this;
  }
  once(eventName, listener) {
    super.once(eventName, listener);
    return this;
  }
  prependOnceListener(eventName, listener) {
    super.prependOnceListener(eventName, listener);
    return this;
  }
  removeListener(eventName, listener) {
    super.off(eventName, listener);
    return this;
  }
  removeAllListeners(eventName) {
    super.removeAllListeners(eventName);
    return this;
  }
  listenerCount(eventName) {
    return super.listenerCount(eventName);
  }
  listeners(eventName) {
    return super.listeners(eventName);
  }
  rawListeners(eventName) {
    return super.rawListeners(eventName);
  }
}

// ../ms/msc/src/errors.ts
class UnsupportedError extends Error {
  constructor(message) {
    super(message);
    this.name = "UnsupportedError";
    if (Error.hasOwnProperty("captureStackTrace")) {
      Error.captureStackTrace(this, UnsupportedError);
    } else {
      this.stack = new Error(message).stack;
    }
  }
}

class InvalidStateError extends Error {
  constructor(message) {
    super(message);
    this.name = "InvalidStateError";
    if (Error.hasOwnProperty("captureStackTrace")) {
      Error.captureStackTrace(this, InvalidStateError);
    } else {
      this.stack = new Error(message).stack;
    }
  }
}

// ../ms/msc/src/utils.ts
function clone(value) {
  if (value === undefined) {
    return;
  } else if (Number.isNaN(value)) {
    return NaN;
  } else if (typeof structuredClone === "function") {
    return structuredClone(value);
  } else {
    return JSON.parse(JSON.stringify(value));
  }
}

// ../ms/h264/src/Logger.ts
var APP_NAME2 = "h264-profile-level-id";

class Logger2 {
  _debug;
  _warn;
  _error;
  constructor(prefix) {
    if (prefix) {
      this._debug = debug_default(`${APP_NAME2}:${prefix}`);
      this._warn = debug_default(`${APP_NAME2}:WARN:${prefix}`);
      this._error = debug_default(`${APP_NAME2}:ERROR:${prefix}`);
    } else {
      this._debug = debug_default(APP_NAME2);
      this._warn = debug_default(`${APP_NAME2}:WARN`);
      this._error = debug_default(`${APP_NAME2}:ERROR`);
    }
    this._debug.log = console.info.bind(console);
    this._warn.log = console.warn.bind(console);
    this._error.log = console.error.bind(console);
  }
  get debug() {
    return this._debug;
  }
  get warn() {
    return this._warn;
  }
  get error() {
    return this._error;
  }
}

// ../ms/h264/src/index.ts
var logger = new Logger2;
class ProfileLevelId {
  profile;
  level;
  constructor(profile, level) {
    this.profile = profile;
    this.level = level;
  }
}
var DefaultProfileLevelId = new ProfileLevelId(1 /* ConstrainedBaseline */, 31 /* L3_1 */);

class BitPattern {
  mask;
  masked_value;
  constructor(str) {
    this.mask = ~byteMaskString("x", str);
    this.masked_value = byteMaskString("1", str);
  }
  isMatch(value) {
    return this.masked_value === (value & this.mask);
  }
}

class ProfilePattern {
  profile_idc;
  profile_iop;
  profile;
  constructor(profile_idc, profile_iop, profile) {
    this.profile_idc = profile_idc;
    this.profile_iop = profile_iop;
    this.profile = profile;
  }
}
var ProfilePatterns = [
  new ProfilePattern(66, new BitPattern("x1xx0000"), 1 /* ConstrainedBaseline */),
  new ProfilePattern(77, new BitPattern("1xxx0000"), 1 /* ConstrainedBaseline */),
  new ProfilePattern(88, new BitPattern("11xx0000"), 1 /* ConstrainedBaseline */),
  new ProfilePattern(66, new BitPattern("x0xx0000"), 2 /* Baseline */),
  new ProfilePattern(88, new BitPattern("10xx0000"), 2 /* Baseline */),
  new ProfilePattern(77, new BitPattern("0x0x0000"), 3 /* Main */),
  new ProfilePattern(100, new BitPattern("00000000"), 5 /* High */),
  new ProfilePattern(100, new BitPattern("00001100"), 4 /* ConstrainedHigh */),
  new ProfilePattern(244, new BitPattern("00000000"), 6 /* PredictiveHigh444 */)
];
function parseProfileLevelId(str) {
  const ConstraintSet3Flag = 16;
  if (typeof str !== "string" || str.length !== 6) {
    return;
  }
  const profile_level_id_numeric = parseInt(str, 16);
  if (profile_level_id_numeric === 0) {
    return;
  }
  const level_idc = profile_level_id_numeric & 255;
  const profile_iop = profile_level_id_numeric >> 8 & 255;
  const profile_idc = profile_level_id_numeric >> 16 & 255;
  let level;
  switch (level_idc) {
    case 11 /* L1_1 */: {
      level = (profile_iop & ConstraintSet3Flag) !== 0 ? 0 /* L1_b */ : 11 /* L1_1 */;
      break;
    }
    case 10 /* L1 */:
    case 12 /* L1_2 */:
    case 13 /* L1_3 */:
    case 20 /* L2 */:
    case 21 /* L2_1 */:
    case 22 /* L2_2 */:
    case 30 /* L3 */:
    case 31 /* L3_1 */:
    case 32 /* L3_2 */:
    case 40 /* L4 */:
    case 41 /* L4_1 */:
    case 42 /* L4_2 */:
    case 50 /* L5 */:
    case 51 /* L5_1 */:
    case 52 /* L5_2 */: {
      level = level_idc;
      break;
    }
    default: {
      logger.warn(`parseProfileLevelId() | unrecognized level_idc [str:${str}, level_idc:${level_idc}]`);
      return;
    }
  }
  for (const pattern of ProfilePatterns) {
    if (profile_idc === pattern.profile_idc && pattern.profile_iop.isMatch(profile_iop)) {
      logger.debug(`parseProfileLevelId() | result [str:${str}, profile:${pattern.profile}, level:${level}]`);
      return new ProfileLevelId(pattern.profile, level);
    }
  }
  logger.warn(`parseProfileLevelId() | unrecognized profile_idc/profile_iop combination [str:${str}, profile_idc:${profile_idc}, profile_iop:${profile_iop}]`);
  return;
}
function profileLevelIdToString(profile_level_id) {
  if (profile_level_id.level == 0 /* L1_b */) {
    switch (profile_level_id.profile) {
      case 1 /* ConstrainedBaseline */: {
        return "42f00b";
      }
      case 2 /* Baseline */: {
        return "42100b";
      }
      case 3 /* Main */: {
        return "4d100b";
      }
      default: {
        logger.warn(`profileLevelIdToString() | Level 1_b not is allowed for profile ${profile_level_id.profile}`);
        return;
      }
    }
  }
  let profile_idc_iop_string;
  switch (profile_level_id.profile) {
    case 1 /* ConstrainedBaseline */: {
      profile_idc_iop_string = "42e0";
      break;
    }
    case 2 /* Baseline */: {
      profile_idc_iop_string = "4200";
      break;
    }
    case 3 /* Main */: {
      profile_idc_iop_string = "4d00";
      break;
    }
    case 4 /* ConstrainedHigh */: {
      profile_idc_iop_string = "640c";
      break;
    }
    case 5 /* High */: {
      profile_idc_iop_string = "6400";
      break;
    }
    case 6 /* PredictiveHigh444 */: {
      profile_idc_iop_string = "f400";
      break;
    }
    default: {
      logger.warn(`profileLevelIdToString() | unrecognized profile ${profile_level_id.profile}`);
      return;
    }
  }
  let levelStr = profile_level_id.level.toString(16);
  if (levelStr.length === 1) {
    levelStr = `0${levelStr}`;
  }
  return `${profile_idc_iop_string}${levelStr}`;
}
function parseSdpProfileLevelId(params = {}) {
  const profile_level_id = params["profile-level-id"];
  return profile_level_id ? parseProfileLevelId(profile_level_id) : DefaultProfileLevelId;
}
function isSameProfile(params1 = {}, params2 = {}) {
  const profile_level_id_1 = parseSdpProfileLevelId(params1);
  const profile_level_id_2 = parseSdpProfileLevelId(params2);
  return Boolean(profile_level_id_1 && profile_level_id_1.profile === profile_level_id_2?.profile);
}
function generateProfileLevelIdStringForAnswer(local_supported_params = {}, remote_offered_params = {}) {
  if (!local_supported_params["profile-level-id"] && !remote_offered_params["profile-level-id"]) {
    logger.warn("generateProfileLevelIdStringForAnswer() | profile-level-id missing in local and remote params");
    return;
  }
  const local_profile_level_id = parseSdpProfileLevelId(local_supported_params);
  const remote_profile_level_id = parseSdpProfileLevelId(remote_offered_params);
  if (!local_profile_level_id) {
    throw new TypeError("invalid local_profile_level_id");
  }
  if (!remote_profile_level_id) {
    throw new TypeError("invalid remote_profile_level_id");
  }
  if (local_profile_level_id.profile !== remote_profile_level_id.profile) {
    throw new TypeError("H264 Profile mismatch");
  }
  const level_asymmetry_allowed = isLevelAsymmetryAllowed(local_supported_params) && isLevelAsymmetryAllowed(remote_offered_params);
  const local_level = local_profile_level_id.level;
  const remote_level = remote_profile_level_id.level;
  const min_level = minLevel(local_level, remote_level);
  const answer_level = level_asymmetry_allowed ? local_level : min_level;
  logger.debug(`generateProfileLevelIdStringForAnswer() | result [profile:${local_profile_level_id.profile}, level:${answer_level}]`);
  return profileLevelIdToString(new ProfileLevelId(local_profile_level_id.profile, answer_level));
}
function byteMaskString(c, str) {
  return Number(str[0] === c) << 7 | Number(str[1] === c) << 6 | Number(str[2] === c) << 5 | Number(str[3] === c) << 4 | Number(str[4] === c) << 3 | Number(str[5] === c) << 2 | Number(str[6] === c) << 1 | Number(str[7] === c) << 0;
}
function isLessLevel(a, b) {
  if (a === 0 /* L1_b */) {
    return b !== 10 /* L1 */ && b !== 0 /* L1_b */;
  }
  if (b === 0 /* L1_b */) {
    return a !== 10 /* L1 */;
  }
  return a < b;
}
function minLevel(a, b) {
  return isLessLevel(a, b) ? a : b;
}
function isLevelAsymmetryAllowed(params = {}) {
  const level_asymmetry_allowed = params["level-asymmetry-allowed"];
  return level_asymmetry_allowed === true || level_asymmetry_allowed === 1 || level_asymmetry_allowed === "1";
}

// ../ms/msc/src/ortc.ts
var RTP_PROBATOR_MID = "probator";
var RTP_PROBATOR_SSRC = 1234;
var RTP_PROBATOR_CODEC_PAYLOAD_TYPE = 127;
function validateAndNormalizeRtpCapabilities(caps) {
  if (typeof caps !== "object") {
    throw new TypeError("caps is not an object");
  }
  if (caps.codecs && !Array.isArray(caps.codecs)) {
    throw new TypeError("caps.codecs is not an array");
  } else if (!caps.codecs) {
    caps.codecs = [];
  }
  for (const codec of caps.codecs) {
    validateAndNormalizeRtpCodecCapability(codec);
  }
  if (caps.headerExtensions && !Array.isArray(caps.headerExtensions)) {
    throw new TypeError("caps.headerExtensions is not an array");
  } else if (!caps.headerExtensions) {
    caps.headerExtensions = [];
  }
  for (const ext of caps.headerExtensions) {
    validateAndNormalizeRtpHeaderExtension(ext);
  }
}
function validateAndNormalizeRtpParameters(params) {
  if (typeof params !== "object") {
    throw new TypeError("params is not an object");
  }
  if (params.mid && typeof params.mid !== "string") {
    throw new TypeError("params.mid is not a string");
  }
  if (!Array.isArray(params.codecs)) {
    throw new TypeError("missing params.codecs");
  }
  for (const codec of params.codecs) {
    validateAndNormalizeRtpCodecParameters(codec);
  }
  if (params.headerExtensions && !Array.isArray(params.headerExtensions)) {
    throw new TypeError("params.headerExtensions is not an array");
  } else if (!params.headerExtensions) {
    params.headerExtensions = [];
  }
  for (const ext of params.headerExtensions) {
    validateRtpHeaderExtensionParameters(ext);
  }
  if (params.encodings && !Array.isArray(params.encodings)) {
    throw new TypeError("params.encodings is not an array");
  } else if (!params.encodings) {
    params.encodings = [];
  }
  for (const encoding of params.encodings) {
    validateAndNormalizeRtpEncodingParameters(encoding);
  }
  if (params.rtcp && typeof params.rtcp !== "object") {
    throw new TypeError("params.rtcp is not an object");
  } else if (!params.rtcp) {
    params.rtcp = {};
  }
  validateAndNormalizeRtcpParameters(params.rtcp);
}
function validateAndNormalizeSctpStreamParameters(params) {
  if (typeof params !== "object") {
    throw new TypeError("params is not an object");
  }
  if (typeof params.streamId !== "number") {
    throw new TypeError("missing params.streamId");
  }
  let orderedGiven = false;
  if (typeof params.ordered === "boolean") {
    orderedGiven = true;
  } else {
    params.ordered = true;
  }
  if (params.maxPacketLifeTime !== undefined && typeof params.maxPacketLifeTime !== "number") {
    throw new TypeError("invalid params.maxPacketLifeTime");
  }
  if (params.maxRetransmits !== undefined && typeof params.maxRetransmits !== "number") {
    throw new TypeError("invalid params.maxRetransmits");
  }
  if (params.maxPacketLifeTime !== undefined && params.maxRetransmits !== undefined) {
    throw new TypeError("cannot provide both maxPacketLifeTime and maxRetransmits");
  }
  if (orderedGiven && params.ordered && (params.maxPacketLifeTime !== undefined || params.maxRetransmits !== undefined)) {
    throw new TypeError("cannot be ordered with maxPacketLifeTime or maxRetransmits");
  } else if (!orderedGiven && (params.maxPacketLifeTime !== undefined || params.maxRetransmits !== undefined)) {
    params.ordered = false;
  }
  if (params.label && typeof params.label !== "string") {
    throw new TypeError("invalid params.label");
  }
  if (params.protocol && typeof params.protocol !== "string") {
    throw new TypeError("invalid params.protocol");
  }
}
function getExtendedRtpCapabilities(localCaps, remoteCaps, preferLocalCodecsOrder) {
  const extendedRtpCapabilities = {
    codecs: [],
    headerExtensions: []
  };
  if (preferLocalCodecsOrder) {
    for (const localCodec of localCaps.codecs ?? []) {
      if (isRtxCodec(localCodec)) {
        continue;
      }
      const matchingRemoteCodec = (remoteCaps.codecs ?? []).find((remoteCodec) => matchCodecs(remoteCodec, localCodec, { strict: true, modify: true }));
      if (!matchingRemoteCodec) {
        continue;
      }
      const extendedCodec = {
        kind: localCodec.kind,
        mimeType: localCodec.mimeType,
        clockRate: localCodec.clockRate,
        channels: localCodec.channels,
        localPayloadType: localCodec.preferredPayloadType,
        localRtxPayloadType: undefined,
        remotePayloadType: matchingRemoteCodec.preferredPayloadType,
        remoteRtxPayloadType: undefined,
        localParameters: localCodec.parameters ?? {},
        remoteParameters: matchingRemoteCodec.parameters ?? {},
        rtcpFeedback: reduceRtcpFeedback(localCodec, matchingRemoteCodec)
      };
      extendedRtpCapabilities.codecs.push(extendedCodec);
    }
  } else {
    for (const remoteCodec of remoteCaps.codecs ?? []) {
      if (isRtxCodec(remoteCodec)) {
        continue;
      }
      const matchingLocalCodec = (localCaps.codecs ?? []).find((localCodec) => matchCodecs(localCodec, remoteCodec, { strict: true, modify: true }));
      if (!matchingLocalCodec) {
        continue;
      }
      const extendedCodec = {
        kind: matchingLocalCodec.kind,
        mimeType: matchingLocalCodec.mimeType,
        clockRate: matchingLocalCodec.clockRate,
        channels: matchingLocalCodec.channels,
        localPayloadType: matchingLocalCodec.preferredPayloadType,
        localRtxPayloadType: undefined,
        remotePayloadType: remoteCodec.preferredPayloadType,
        remoteRtxPayloadType: undefined,
        localParameters: matchingLocalCodec.parameters ?? {},
        remoteParameters: remoteCodec.parameters ?? {},
        rtcpFeedback: reduceRtcpFeedback(matchingLocalCodec, remoteCodec)
      };
      extendedRtpCapabilities.codecs.push(extendedCodec);
    }
  }
  for (const extendedCodec of extendedRtpCapabilities.codecs) {
    const matchingLocalRtxCodec = localCaps.codecs.find((localCodec) => isRtxCodec(localCodec) && localCodec.parameters?.["apt"] === extendedCodec.localPayloadType);
    const matchingRemoteRtxCodec = remoteCaps.codecs.find((remoteCodec) => isRtxCodec(remoteCodec) && remoteCodec.parameters?.["apt"] === extendedCodec.remotePayloadType);
    if (matchingLocalRtxCodec && matchingRemoteRtxCodec) {
      extendedCodec.localRtxPayloadType = matchingLocalRtxCodec.preferredPayloadType;
      extendedCodec.remoteRtxPayloadType = matchingRemoteRtxCodec.preferredPayloadType;
    }
  }
  for (const remoteExt of remoteCaps.headerExtensions) {
    const matchingLocalExt = localCaps.headerExtensions.find((localExt) => matchHeaderExtensions(localExt, remoteExt));
    if (!matchingLocalExt) {
      continue;
    }
    const extendedExt = {
      kind: remoteExt.kind,
      uri: remoteExt.uri,
      sendId: matchingLocalExt.preferredId,
      recvId: remoteExt.preferredId,
      encrypt: matchingLocalExt.preferredEncrypt ?? false,
      direction: "sendrecv"
    };
    switch (remoteExt.direction) {
      case "sendrecv": {
        extendedExt.direction = "sendrecv";
        break;
      }
      case "recvonly": {
        extendedExt.direction = "sendonly";
        break;
      }
      case "sendonly": {
        extendedExt.direction = "recvonly";
        break;
      }
      case "inactive": {
        extendedExt.direction = "inactive";
        break;
      }
    }
    extendedRtpCapabilities.headerExtensions.push(extendedExt);
  }
  return extendedRtpCapabilities;
}
function getRecvRtpCapabilities(extendedRtpCapabilities) {
  return getRtpCapabilities({ direction: "recvonly", extendedRtpCapabilities });
}
function getSendRtpCapabilities(extendedRtpCapabilities) {
  return getRtpCapabilities({ direction: "sendonly", extendedRtpCapabilities });
}
function getSendingRtpParameters(kind, extendedRtpCapabilities) {
  const rtpParameters = {
    mid: undefined,
    codecs: [],
    headerExtensions: [],
    encodings: [],
    rtcp: {}
  };
  for (const extendedCodec of extendedRtpCapabilities.codecs) {
    if (extendedCodec.kind !== kind) {
      continue;
    }
    const codec = {
      mimeType: extendedCodec.mimeType,
      payloadType: extendedCodec.localPayloadType,
      clockRate: extendedCodec.clockRate,
      channels: extendedCodec.channels,
      parameters: extendedCodec.localParameters,
      rtcpFeedback: extendedCodec.rtcpFeedback
    };
    rtpParameters.codecs.push(codec);
    if (extendedCodec.localRtxPayloadType) {
      const rtxCodec = {
        mimeType: `${extendedCodec.kind}/rtx`,
        payloadType: extendedCodec.localRtxPayloadType,
        clockRate: extendedCodec.clockRate,
        parameters: {
          apt: extendedCodec.localPayloadType
        },
        rtcpFeedback: []
      };
      rtpParameters.codecs.push(rtxCodec);
    }
  }
  for (const extendedExtension of extendedRtpCapabilities.headerExtensions) {
    if (extendedExtension.kind && extendedExtension.kind !== kind || extendedExtension.direction !== "sendrecv" && extendedExtension.direction !== "sendonly") {
      continue;
    }
    const ext = {
      uri: extendedExtension.uri,
      id: extendedExtension.sendId,
      encrypt: extendedExtension.encrypt,
      parameters: {}
    };
    rtpParameters.headerExtensions.push(ext);
  }
  return rtpParameters;
}
function getSendingRemoteRtpParameters(kind, extendedRtpCapabilities) {
  const rtpParameters = {
    mid: undefined,
    codecs: [],
    headerExtensions: [],
    encodings: [],
    rtcp: {}
  };
  for (const extendedCodec of extendedRtpCapabilities.codecs) {
    if (extendedCodec.kind !== kind) {
      continue;
    }
    const codec = {
      mimeType: extendedCodec.mimeType,
      payloadType: extendedCodec.localPayloadType,
      clockRate: extendedCodec.clockRate,
      channels: extendedCodec.channels,
      parameters: extendedCodec.remoteParameters,
      rtcpFeedback: extendedCodec.rtcpFeedback
    };
    rtpParameters.codecs.push(codec);
    if (extendedCodec.localRtxPayloadType) {
      const rtxCodec = {
        mimeType: `${extendedCodec.kind}/rtx`,
        payloadType: extendedCodec.localRtxPayloadType,
        clockRate: extendedCodec.clockRate,
        parameters: {
          apt: extendedCodec.localPayloadType
        },
        rtcpFeedback: []
      };
      rtpParameters.codecs.push(rtxCodec);
    }
  }
  for (const extendedExtension of extendedRtpCapabilities.headerExtensions) {
    if (extendedExtension.kind && extendedExtension.kind !== kind || extendedExtension.direction !== "sendrecv" && extendedExtension.direction !== "sendonly") {
      continue;
    }
    const ext = {
      uri: extendedExtension.uri,
      id: extendedExtension.sendId,
      encrypt: extendedExtension.encrypt,
      parameters: {}
    };
    rtpParameters.headerExtensions.push(ext);
  }
  if (rtpParameters.headerExtensions.some((ext) => ext.uri === "http://www.ietf.org/id/draft-holmer-rmcat-transport-wide-cc-extensions-01")) {
    for (const codec of rtpParameters.codecs) {
      codec.rtcpFeedback = (codec.rtcpFeedback ?? []).filter((fb) => fb.type !== "goog-remb");
    }
  } else if (rtpParameters.headerExtensions.some((ext) => ext.uri === "http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time")) {
    for (const codec of rtpParameters.codecs) {
      codec.rtcpFeedback = (codec.rtcpFeedback ?? []).filter((fb) => fb.type !== "transport-cc");
    }
  } else {
    for (const codec of rtpParameters.codecs) {
      codec.rtcpFeedback = (codec.rtcpFeedback ?? []).filter((fb) => fb.type !== "transport-cc" && fb.type !== "goog-remb");
    }
  }
  return rtpParameters;
}
function reduceCodecs(codecs, capCodec) {
  const filteredCodecs = [];
  if (!capCodec) {
    filteredCodecs.push(codecs[0]);
    if (isRtxCodec(codecs[1])) {
      filteredCodecs.push(codecs[1]);
    }
  } else {
    for (let idx = 0;idx < codecs.length; ++idx) {
      if (matchCodecs(codecs[idx], capCodec, { strict: true })) {
        filteredCodecs.push(codecs[idx]);
        if (isRtxCodec(codecs[idx + 1])) {
          filteredCodecs.push(codecs[idx + 1]);
        }
        break;
      }
    }
    if (filteredCodecs.length === 0) {
      throw new TypeError("no matching codec found");
    }
  }
  return filteredCodecs;
}
function generateProbatorRtpParameters(videoRtpParameters) {
  videoRtpParameters = clone(videoRtpParameters);
  validateAndNormalizeRtpParameters(videoRtpParameters);
  const rtpParameters = {
    mid: RTP_PROBATOR_MID,
    codecs: [],
    headerExtensions: [],
    encodings: [{ ssrc: RTP_PROBATOR_SSRC }],
    rtcp: { cname: "probator" }
  };
  rtpParameters.codecs.push(videoRtpParameters.codecs[0]);
  rtpParameters.codecs[0].payloadType = RTP_PROBATOR_CODEC_PAYLOAD_TYPE;
  rtpParameters.headerExtensions = videoRtpParameters.headerExtensions;
  return rtpParameters;
}
function canSend(kind, rtpCapabilities) {
  return (rtpCapabilities.codecs ?? []).some((codec) => codec.kind === kind);
}
function canReceive(rtpParameters, rtpCapabilities) {
  validateAndNormalizeRtpParameters(rtpParameters);
  if (rtpParameters.codecs.length === 0) {
    return false;
  }
  const firstMediaCodec = rtpParameters.codecs[0];
  return (rtpCapabilities.codecs ?? []).some((codec) => codec.preferredPayloadType === firstMediaCodec.payloadType);
}
function validateAndNormalizeRtpCodecCapability(codec) {
  const MimeTypeRegex = new RegExp("^(audio|video)/(.+)", "i");
  if (typeof codec !== "object") {
    throw new TypeError("codec is not an object");
  }
  if (!codec.mimeType || typeof codec.mimeType !== "string") {
    throw new TypeError("missing codec.mimeType");
  }
  const mimeTypeMatch = MimeTypeRegex.exec(codec.mimeType);
  if (!mimeTypeMatch) {
    throw new TypeError("invalid codec.mimeType");
  }
  codec.kind = mimeTypeMatch[1].toLowerCase();
  if (typeof codec.preferredPayloadType !== "number") {
    throw new TypeError("missing codec.preferredPayloadType");
  }
  if (typeof codec.clockRate !== "number") {
    throw new TypeError("missing codec.clockRate");
  }
  if (codec.kind === "audio") {
    if (typeof codec.channels !== "number") {
      codec.channels = 1;
    }
  } else {
    delete codec.channels;
  }
  if (!codec.parameters || typeof codec.parameters !== "object") {
    codec.parameters = {};
  }
  for (const key of Object.keys(codec.parameters)) {
    let value = codec.parameters[key];
    if (value === undefined) {
      codec.parameters[key] = "";
      value = "";
    }
    if (typeof value !== "string" && typeof value !== "number") {
      throw new TypeError(`invalid codec parameter [key:${key}s, value:${value}]`);
    }
    if (key === "apt") {
      if (typeof value !== "number") {
        throw new TypeError("invalid codec apt parameter");
      }
    }
  }
  if (!codec.rtcpFeedback || !Array.isArray(codec.rtcpFeedback)) {
    codec.rtcpFeedback = [];
  }
  for (const fb of codec.rtcpFeedback) {
    validateAndNormalizeRtcpFeedback(fb);
  }
}
function validateAndNormalizeRtcpFeedback(fb) {
  if (typeof fb !== "object") {
    throw new TypeError("fb is not an object");
  }
  if (!fb.type || typeof fb.type !== "string") {
    throw new TypeError("missing fb.type");
  }
  if (!fb.parameter || typeof fb.parameter !== "string") {
    fb.parameter = "";
  }
}
function validateAndNormalizeRtpHeaderExtension(ext) {
  if (typeof ext !== "object") {
    throw new TypeError("ext is not an object");
  }
  if (ext.kind !== "audio" && ext.kind !== "video") {
    throw new TypeError("invalid ext.kind");
  }
  if (!ext.uri || typeof ext.uri !== "string") {
    throw new TypeError("missing ext.uri");
  }
  if (typeof ext.preferredId !== "number") {
    throw new TypeError("missing ext.preferredId");
  }
  if (ext.preferredEncrypt && typeof ext.preferredEncrypt !== "boolean") {
    throw new TypeError("invalid ext.preferredEncrypt");
  } else if (!ext.preferredEncrypt) {
    ext.preferredEncrypt = false;
  }
  if (ext.direction && typeof ext.direction !== "string") {
    throw new TypeError("invalid ext.direction");
  } else if (!ext.direction) {
    ext.direction = "sendrecv";
  }
}
function validateAndNormalizeRtpCodecParameters(codec) {
  const MimeTypeRegex = new RegExp("^(audio|video)/(.+)", "i");
  if (typeof codec !== "object") {
    throw new TypeError("codec is not an object");
  }
  if (!codec.mimeType || typeof codec.mimeType !== "string") {
    throw new TypeError("missing codec.mimeType");
  }
  const mimeTypeMatch = MimeTypeRegex.exec(codec.mimeType);
  if (!mimeTypeMatch) {
    throw new TypeError("invalid codec.mimeType");
  }
  if (typeof codec.payloadType !== "number") {
    throw new TypeError("missing codec.payloadType");
  }
  if (typeof codec.clockRate !== "number") {
    throw new TypeError("missing codec.clockRate");
  }
  const kind = mimeTypeMatch[1].toLowerCase();
  if (kind === "audio") {
    if (typeof codec.channels !== "number") {
      codec.channels = 1;
    }
  } else {
    delete codec.channels;
  }
  if (!codec.parameters || typeof codec.parameters !== "object") {
    codec.parameters = {};
  }
  for (const key of Object.keys(codec.parameters)) {
    let value = codec.parameters[key];
    if (value === undefined) {
      codec.parameters[key] = "";
      value = "";
    }
    if (typeof value !== "string" && typeof value !== "number") {
      throw new TypeError(`invalid codec parameter [key:${key}s, value:${value}]`);
    }
    if (key === "apt") {
      if (typeof value !== "number") {
        throw new TypeError("invalid codec apt parameter");
      }
    }
  }
  if (!codec.rtcpFeedback || !Array.isArray(codec.rtcpFeedback)) {
    codec.rtcpFeedback = [];
  }
  for (const fb of codec.rtcpFeedback) {
    validateAndNormalizeRtcpFeedback(fb);
  }
}
function validateRtpHeaderExtensionParameters(ext) {
  if (typeof ext !== "object") {
    throw new TypeError("ext is not an object");
  }
  if (!ext.uri || typeof ext.uri !== "string") {
    throw new TypeError("missing ext.uri");
  }
  if (typeof ext.id !== "number") {
    throw new TypeError("missing ext.id");
  }
  if (ext.encrypt && typeof ext.encrypt !== "boolean") {
    throw new TypeError("invalid ext.encrypt");
  } else if (!ext.encrypt) {
    ext.encrypt = false;
  }
  if (!ext.parameters || typeof ext.parameters !== "object") {
    ext.parameters = {};
  }
  for (const key of Object.keys(ext.parameters)) {
    let value = ext.parameters[key];
    if (value === undefined) {
      ext.parameters[key] = "";
      value = "";
    }
    if (typeof value !== "string" && typeof value !== "number") {
      throw new TypeError("invalid header extension parameter");
    }
  }
}
function validateAndNormalizeRtpEncodingParameters(encoding) {
  if (typeof encoding !== "object") {
    throw new TypeError("encoding is not an object");
  }
  if (encoding.ssrc && typeof encoding.ssrc !== "number") {
    throw new TypeError("invalid encoding.ssrc");
  }
  if (encoding.rid && typeof encoding.rid !== "string") {
    throw new TypeError("invalid encoding.rid");
  }
  if (encoding.rtx && typeof encoding.rtx !== "object") {
    throw new TypeError("invalid encoding.rtx");
  } else if (encoding.rtx) {
    if (typeof encoding.rtx.ssrc !== "number") {
      throw new TypeError("missing encoding.rtx.ssrc");
    }
  }
  if (encoding.scalabilityMode && typeof encoding.scalabilityMode !== "string") {
    throw new TypeError("invalid encoding.scalabilityMode");
  }
}
function validateAndNormalizeRtcpParameters(rtcp) {
  if (typeof rtcp !== "object") {
    throw new TypeError("rtcp is not an object");
  }
  if (rtcp.cname && typeof rtcp.cname !== "string") {
    throw new TypeError("invalid rtcp.cname");
  }
  if (!rtcp.reducedSize || typeof rtcp.reducedSize !== "boolean") {
    rtcp.reducedSize = true;
  }
}
function getRtpCapabilities({
  direction,
  extendedRtpCapabilities
}) {
  const isSending = direction === "sendonly";
  const rtpCapabilities = {
    codecs: [],
    headerExtensions: []
  };
  for (const extendedCodec of extendedRtpCapabilities.codecs) {
    const codec = {
      kind: extendedCodec.kind,
      mimeType: extendedCodec.mimeType,
      preferredPayloadType: isSending ? extendedCodec.localPayloadType : extendedCodec.remotePayloadType,
      clockRate: extendedCodec.clockRate,
      channels: extendedCodec.channels,
      parameters: extendedCodec.localParameters,
      rtcpFeedback: extendedCodec.rtcpFeedback
    };
    rtpCapabilities.codecs.push(codec);
    if (!extendedCodec.localRtxPayloadType || !extendedCodec.remoteRtxPayloadType) {
      continue;
    }
    const rtxCodec = {
      kind: extendedCodec.kind,
      mimeType: `${extendedCodec.kind}/rtx`,
      preferredPayloadType: isSending ? extendedCodec.localRtxPayloadType : extendedCodec.remoteRtxPayloadType,
      clockRate: extendedCodec.clockRate,
      parameters: {
        apt: isSending ? extendedCodec.localPayloadType : extendedCodec.remotePayloadType
      },
      rtcpFeedback: []
    };
    rtpCapabilities.codecs.push(rtxCodec);
  }
  for (const extendedExtension of extendedRtpCapabilities.headerExtensions) {
    if (extendedExtension.direction !== "sendrecv" && extendedExtension.direction !== direction) {
      continue;
    }
    const ext = {
      kind: extendedExtension.kind,
      uri: extendedExtension.uri,
      preferredId: isSending ? extendedExtension.sendId : extendedExtension.recvId,
      preferredEncrypt: extendedExtension.encrypt ?? false,
      direction: extendedExtension.direction
    };
    rtpCapabilities.headerExtensions.push(ext);
  }
  return rtpCapabilities;
}
function isRtxCodec(codec) {
  if (!codec) {
    return false;
  }
  return /.+\/rtx$/i.test(codec.mimeType);
}
function matchCodecs(aCodec, bCodec, { strict = false, modify = false } = {}) {
  const aMimeType = aCodec.mimeType.toLowerCase();
  const bMimeType = bCodec.mimeType.toLowerCase();
  if (aMimeType !== bMimeType) {
    return false;
  }
  if (aCodec.clockRate !== bCodec.clockRate) {
    return false;
  }
  if (aCodec.channels !== bCodec.channels) {
    return false;
  }
  switch (aMimeType) {
    case "video/h264": {
      if (strict) {
        const aPacketizationMode = aCodec.parameters["packetization-mode"] ?? 0;
        const bPacketizationMode = bCodec.parameters["packetization-mode"] ?? 0;
        if (aPacketizationMode !== bPacketizationMode) {
          return false;
        }
        if (!isSameProfile(aCodec.parameters, bCodec.parameters)) {
          return false;
        }
        let selectedProfileLevelId;
        try {
          selectedProfileLevelId = generateProfileLevelIdStringForAnswer(aCodec.parameters, bCodec.parameters);
        } catch (error) {
          return false;
        }
        if (modify) {
          if (selectedProfileLevelId) {
            aCodec.parameters["profile-level-id"] = selectedProfileLevelId;
            bCodec.parameters["profile-level-id"] = selectedProfileLevelId;
          } else {
            delete aCodec.parameters["profile-level-id"];
            delete bCodec.parameters["profile-level-id"];
          }
        }
      }
      break;
    }
    case "video/vp9": {
      if (strict) {
        const aProfileId = aCodec.parameters["profile-id"] ?? 0;
        const bProfileId = bCodec.parameters["profile-id"] ?? 0;
        if (aProfileId !== bProfileId) {
          return false;
        }
      }
      break;
    }
  }
  return true;
}
function matchHeaderExtensions(aExt, bExt) {
  if (aExt.kind && bExt.kind && aExt.kind !== bExt.kind) {
    return false;
  }
  if (aExt.uri !== bExt.uri) {
    return false;
  }
  return true;
}
function reduceRtcpFeedback(codecA, codecB) {
  const reducedRtcpFeedback = [];
  for (const aFb of codecA.rtcpFeedback ?? []) {
    const matchingBFb = (codecB.rtcpFeedback ?? []).find((bFb) => bFb.type === aFb.type && (bFb.parameter === aFb.parameter || !bFb.parameter && !aFb.parameter));
    if (matchingBFb) {
      reducedRtcpFeedback.push(matchingBFb);
    }
  }
  return reducedRtcpFeedback;
}

// scripts/mediasoup/shims/awaitqueue.js
class AwaitQueueStoppedError extends Error {
  constructor(message) {
    super(message || "AwaitQueue stopped");
    this.name = "AwaitQueueStoppedError";
  }
}
class AwaitQueue {
  constructor() {
    this._tail = Promise.resolve();
    this._stopped = 0;
    this._size = 0;
  }
  get size() {
    return this._size;
  }
  push(task, name) {
    const epoch = this._stopped;
    this._size++;
    const run = this._tail.then(async () => {
      if (epoch !== this._stopped)
        throw new AwaitQueueStoppedError(`AwaitQueue stopped${name ? ` (${name})` : ""}`);
      return task();
    });
    const done = () => {
      this._size--;
    };
    run.then(done, done);
    this._tail = run.catch(() => {});
    return run;
  }
  stop() {
    this._stopped++;
  }
  remove() {}
  dump() {
    return [];
  }
}

// ../ms/msc/src/Producer.ts
var logger2 = new Logger("Producer");

class Producer extends EnhancedEventEmitter {
  _id;
  _localId;
  _closed = false;
  _rtpSender;
  _track;
  _kind;
  _rtpParameters;
  _paused;
  _maxSpatialLayer;
  _stopTracks;
  _disableTrackOnPause;
  _zeroRtpOnPause;
  _appData;
  _observer = new EnhancedEventEmitter;
  constructor({
    id,
    localId,
    rtpSender,
    track,
    rtpParameters,
    stopTracks,
    disableTrackOnPause,
    zeroRtpOnPause,
    appData
  }) {
    super();
    logger2.debug("constructor()");
    this._id = id;
    this._localId = localId;
    this._rtpSender = rtpSender;
    this._track = track;
    this._kind = track.kind;
    this._rtpParameters = rtpParameters;
    this._paused = disableTrackOnPause ? !track.enabled : false;
    this._maxSpatialLayer = undefined;
    this._stopTracks = stopTracks;
    this._disableTrackOnPause = disableTrackOnPause;
    this._zeroRtpOnPause = zeroRtpOnPause;
    this._appData = appData ?? {};
    this.onTrackEnded = this.onTrackEnded.bind(this);
    this.handleTrack();
  }
  get id() {
    return this._id;
  }
  get localId() {
    return this._localId;
  }
  get closed() {
    return this._closed;
  }
  get kind() {
    return this._kind;
  }
  get rtpSender() {
    return this._rtpSender;
  }
  get track() {
    return this._track;
  }
  get rtpParameters() {
    return this._rtpParameters;
  }
  get paused() {
    return this._paused;
  }
  get maxSpatialLayer() {
    return this._maxSpatialLayer;
  }
  get appData() {
    return this._appData;
  }
  set appData(appData) {
    this._appData = appData;
  }
  get observer() {
    return this._observer;
  }
  close() {
    if (this._closed) {
      return;
    }
    logger2.debug("close()");
    this._closed = true;
    this.destroyTrack();
    this.emit("@close");
    this._observer.safeEmit("close");
    super.close();
    this._observer.close();
  }
  transportClosed() {
    if (this._closed) {
      return;
    }
    logger2.debug("transportClosed()");
    this._closed = true;
    this.destroyTrack();
    this.safeEmit("transportclose");
    this._observer.safeEmit("close");
    super.close();
    this._observer.close();
  }
  async getStats() {
    if (this._closed) {
      throw new InvalidStateError("closed");
    }
    return new Promise((resolve, reject) => {
      this.safeEmit("@getstats", resolve, reject);
    });
  }
  pause() {
    logger2.debug("pause()");
    if (this._closed) {
      logger2.error("pause() | Producer closed");
      return;
    }
    this._paused = true;
    if (this._track && this._disableTrackOnPause) {
      this._track.enabled = false;
    }
    if (this._zeroRtpOnPause) {
      new Promise((resolve, reject) => {
        this.safeEmit("@pause", resolve, reject);
      }).catch(() => {});
    }
    this._observer.safeEmit("pause");
  }
  resume() {
    logger2.debug("resume()");
    if (this._closed) {
      logger2.error("resume() | Producer closed");
      return;
    }
    this._paused = false;
    if (this._track && this._disableTrackOnPause) {
      this._track.enabled = true;
    }
    if (this._zeroRtpOnPause) {
      new Promise((resolve, reject) => {
        this.safeEmit("@resume", resolve, reject);
      }).catch(() => {});
    }
    this._observer.safeEmit("resume");
  }
  async replaceTrack({
    track
  }) {
    logger2.debug("replaceTrack() [track:%o]", track);
    if (this._closed) {
      if (track && this._stopTracks) {
        try {
          track.stop();
        } catch (error) {}
      }
      throw new InvalidStateError("closed");
    } else if (track?.readyState === "ended") {
      throw new InvalidStateError("track ended");
    }
    if (track === this._track) {
      logger2.debug("replaceTrack() | same track, ignored");
      return;
    }
    try {
      await new Promise((resolve, reject) => {
        this.safeEmit("@replacetrack", track, resolve, reject);
      });
      if (this._closed) {
        throw new InvalidStateError("closed");
      }
    } catch (error) {
      if (track && this._stopTracks) {
        try {
          track.stop();
        } catch (error2) {}
      }
      throw error;
    }
    this.destroyTrack();
    this._track = track;
    if (this._track && this._disableTrackOnPause) {
      if (!this._paused) {
        this._track.enabled = true;
      } else if (this._paused) {
        this._track.enabled = false;
      }
    }
    this.handleTrack();
  }
  async setMaxSpatialLayer(spatialLayer) {
    if (this._closed) {
      throw new InvalidStateError("closed");
    } else if (this._kind !== "video") {
      throw new UnsupportedError("not a video Producer");
    } else if (typeof spatialLayer !== "number") {
      throw new TypeError("invalid spatialLayer");
    }
    if (spatialLayer === this._maxSpatialLayer) {
      return;
    }
    await new Promise((resolve, reject) => {
      this.safeEmit("@setmaxspatiallayer", spatialLayer, resolve, reject);
    });
    this._maxSpatialLayer = spatialLayer;
  }
  async setRtpEncodingParameters(params) {
    if (this._closed) {
      throw new InvalidStateError("closed");
    } else if (typeof params !== "object") {
      throw new TypeError("invalid params");
    }
    await new Promise((resolve, reject) => {
      this.safeEmit("@setrtpencodingparameters", params, resolve, reject);
    });
  }
  onTrackEnded() {
    logger2.debug('track "ended" event');
    this.safeEmit("trackended");
    this._observer.safeEmit("trackended");
  }
  handleTrack() {
    if (!this._track) {
      return;
    }
    this._track.addEventListener("ended", this.onTrackEnded);
  }
  destroyTrack() {
    if (!this._track) {
      return;
    }
    try {
      this._track.removeEventListener("ended", this.onTrackEnded);
      if (this._stopTracks) {
        this._track.stop();
      }
    } catch (error) {}
  }
}

// ../ms/msc/src/Consumer.ts
var logger3 = new Logger("Consumer");

class Consumer extends EnhancedEventEmitter {
  _id;
  _localId;
  _producerId;
  _closed = false;
  _rtpReceiver;
  _track;
  _rtpParameters;
  _paused;
  _appData;
  _observer = new EnhancedEventEmitter;
  constructor({
    id,
    localId,
    producerId,
    rtpReceiver,
    track,
    rtpParameters,
    appData
  }) {
    super();
    logger3.debug("constructor()");
    this._id = id;
    this._localId = localId;
    this._producerId = producerId;
    this._rtpReceiver = rtpReceiver;
    this._track = track;
    this._rtpParameters = rtpParameters;
    this._paused = !track.enabled;
    this._appData = appData ?? {};
    this.onTrackEnded = this.onTrackEnded.bind(this);
    this.handleTrack();
  }
  get id() {
    return this._id;
  }
  get localId() {
    return this._localId;
  }
  get producerId() {
    return this._producerId;
  }
  get closed() {
    return this._closed;
  }
  get kind() {
    return this._track.kind;
  }
  get rtpReceiver() {
    return this._rtpReceiver;
  }
  get track() {
    return this._track;
  }
  get rtpParameters() {
    return this._rtpParameters;
  }
  get paused() {
    return this._paused;
  }
  get appData() {
    return this._appData;
  }
  set appData(appData) {
    this._appData = appData;
  }
  get observer() {
    return this._observer;
  }
  close() {
    if (this._closed) {
      return;
    }
    logger3.debug("close()");
    this._closed = true;
    this.destroyTrack();
    this.emit("@close");
    this._observer.safeEmit("close");
    super.close();
    this._observer.close();
  }
  transportClosed() {
    if (this._closed) {
      return;
    }
    logger3.debug("transportClosed()");
    this._closed = true;
    this.destroyTrack();
    this.safeEmit("transportclose");
    this._observer.safeEmit("close");
    super.close();
    this._observer.close();
  }
  async getStats() {
    if (this._closed) {
      throw new InvalidStateError("closed");
    }
    return new Promise((resolve, reject) => {
      this.safeEmit("@getstats", resolve, reject);
    });
  }
  pause() {
    logger3.debug("pause()");
    if (this._closed) {
      logger3.error("pause() | Consumer closed");
      return;
    }
    if (this._paused) {
      logger3.debug("pause() | Consumer is already paused");
      return;
    }
    this._paused = true;
    this._track.enabled = false;
    this.emit("@pause");
    this._observer.safeEmit("pause");
  }
  resume() {
    logger3.debug("resume()");
    if (this._closed) {
      logger3.error("resume() | Consumer closed");
      return;
    }
    if (!this._paused) {
      logger3.debug("resume() | Consumer is already resumed");
      return;
    }
    this._paused = false;
    this._track.enabled = true;
    this.emit("@resume");
    this._observer.safeEmit("resume");
  }
  onTrackEnded() {
    logger3.debug('track "ended" event');
    this.safeEmit("trackended");
    this._observer.safeEmit("trackended");
  }
  handleTrack() {
    this._track.addEventListener("ended", this.onTrackEnded);
  }
  destroyTrack() {
    try {
      this._track.removeEventListener("ended", this.onTrackEnded);
      this._track.stop();
    } catch (error) {}
  }
}

// ../ms/msc/src/DataProducer.ts
var logger4 = new Logger("DataProducer");

class DataProducer extends EnhancedEventEmitter {
  _id;
  _dataChannel;
  _closed = false;
  _sctpStreamParameters;
  _appData;
  _observer = new EnhancedEventEmitter;
  constructor({
    id,
    dataChannel,
    sctpStreamParameters,
    appData
  }) {
    super();
    logger4.debug("constructor()");
    this._id = id;
    this._dataChannel = dataChannel;
    this._sctpStreamParameters = sctpStreamParameters;
    this._appData = appData ?? {};
    this.handleDataChannel();
  }
  get id() {
    return this._id;
  }
  get closed() {
    return this._closed;
  }
  get sctpStreamParameters() {
    return this._sctpStreamParameters;
  }
  get readyState() {
    return this._dataChannel.readyState;
  }
  get label() {
    return this._dataChannel.label;
  }
  get protocol() {
    return this._dataChannel.protocol;
  }
  get bufferedAmount() {
    return this._dataChannel.bufferedAmount;
  }
  get bufferedAmountLowThreshold() {
    return this._dataChannel.bufferedAmountLowThreshold;
  }
  set bufferedAmountLowThreshold(bufferedAmountLowThreshold) {
    this._dataChannel.bufferedAmountLowThreshold = bufferedAmountLowThreshold;
  }
  get appData() {
    return this._appData;
  }
  set appData(appData) {
    this._appData = appData;
  }
  get observer() {
    return this._observer;
  }
  close() {
    if (this._closed) {
      return;
    }
    logger4.debug("close()");
    this._closed = true;
    this._dataChannel.close();
    this.emit("@close");
    this._observer.safeEmit("close");
    super.close();
    this._observer.close();
  }
  transportClosed() {
    if (this._closed) {
      return;
    }
    logger4.debug("transportClosed()");
    this._closed = true;
    this._dataChannel.close();
    this.safeEmit("transportclose");
    this._observer.safeEmit("close");
    super.close();
    this._observer.close();
  }
  send(data) {
    logger4.debug("send()");
    if (this._closed) {
      throw new InvalidStateError("closed");
    }
    this._dataChannel.send(data);
  }
  handleDataChannel() {
    this._dataChannel.addEventListener("open", () => {
      if (this._closed) {
        return;
      }
      logger4.debug('DataChannel "open" event');
      this.safeEmit("open");
    });
    this._dataChannel.addEventListener("error", (event) => {
      if (this._closed) {
        return;
      }
      const error = event.error ?? new Error("unknown DataChannel error");
      if (event.error?.errorDetail === "sctp-failure") {
        logger4.error("DataChannel SCTP error [sctpCauseCode:%s]: %s", event.error?.sctpCauseCode, event.error.message);
      } else {
        logger4.error('DataChannel "error" event: %o', error);
      }
      this.safeEmit("error", error);
    });
    this._dataChannel.addEventListener("close", () => {
      if (this._closed) {
        return;
      }
      logger4.debug('DataChannel "close" event');
      this._closed = true;
      this._dataChannel.close();
      this.emit("@close");
      this.safeEmit("close");
      this._observer.safeEmit("close");
      super.close();
      this._observer.close();
    });
    this._dataChannel.addEventListener("message", () => {
      if (this._closed) {
        return;
      }
      logger4.warn('DataChannel "message" event in a DataProducer, message discarded');
    });
    this._dataChannel.addEventListener("bufferedamountlow", () => {
      if (this._closed) {
        return;
      }
      this.safeEmit("bufferedamountlow");
    });
  }
}

// ../ms/msc/src/DataConsumer.ts
var logger5 = new Logger("DataConsumer");

class DataConsumer extends EnhancedEventEmitter {
  _id;
  _dataProducerId;
  _dataChannel;
  _closed = false;
  _sctpStreamParameters;
  _appData;
  _observer = new EnhancedEventEmitter;
  constructor({
    id,
    dataProducerId,
    dataChannel,
    sctpStreamParameters,
    appData
  }) {
    super();
    logger5.debug("constructor()");
    this._id = id;
    this._dataProducerId = dataProducerId;
    this._dataChannel = dataChannel;
    this._sctpStreamParameters = sctpStreamParameters;
    this._appData = appData ?? {};
    this.handleDataChannel();
  }
  get id() {
    return this._id;
  }
  get dataProducerId() {
    return this._dataProducerId;
  }
  get closed() {
    return this._closed;
  }
  get sctpStreamParameters() {
    return this._sctpStreamParameters;
  }
  get readyState() {
    return this._dataChannel.readyState;
  }
  get label() {
    return this._dataChannel.label;
  }
  get protocol() {
    return this._dataChannel.protocol;
  }
  get binaryType() {
    return this._dataChannel.binaryType;
  }
  set binaryType(binaryType) {
    this._dataChannel.binaryType = binaryType;
  }
  get appData() {
    return this._appData;
  }
  set appData(appData) {
    this._appData = appData;
  }
  get observer() {
    return this._observer;
  }
  close() {
    if (this._closed) {
      return;
    }
    logger5.debug("close()");
    this._closed = true;
    this._dataChannel.close();
    this.emit("@close");
    this._observer.safeEmit("close");
    super.close();
    this._observer.close();
  }
  transportClosed() {
    if (this._closed) {
      return;
    }
    logger5.debug("transportClosed()");
    this._closed = true;
    this._dataChannel.close();
    this.safeEmit("transportclose");
    this._observer.safeEmit("close");
    super.close();
    this._observer.close();
  }
  handleDataChannel() {
    this._dataChannel.addEventListener("open", () => {
      if (this._closed) {
        return;
      }
      logger5.debug('DataChannel "open" event');
      this.safeEmit("open");
    });
    this._dataChannel.addEventListener("error", (event) => {
      if (this._closed) {
        return;
      }
      const error = event.error ?? new Error("unknown DataChannel error");
      if (event.error?.errorDetail === "sctp-failure") {
        logger5.error("DataChannel SCTP error [sctpCauseCode:%s]: %s", event.error?.sctpCauseCode, event.error.message);
      } else {
        logger5.error('DataChannel "error" event: %o', error);
      }
      this.safeEmit("error", error);
    });
    this._dataChannel.addEventListener("close", () => {
      if (this._closed) {
        return;
      }
      logger5.debug('DataChannel "close" event');
      this._closed = true;
      this._dataChannel.close();
      this.emit("@close");
      this.safeEmit("close");
      this._observer.safeEmit("close");
      super.close();
      this._observer.close();
    });
    this._dataChannel.addEventListener("message", (event) => {
      if (this._closed) {
        return;
      }
      this.safeEmit("message", event.data);
    });
  }
}

// ../ms/msc/src/Transport.ts
var logger6 = new Logger("Transport");

class ConsumerCreationTask {
  consumerOptions;
  promise;
  resolve;
  reject;
  constructor(consumerOptions) {
    this.consumerOptions = consumerOptions;
    this.promise = new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
  }
}

class Transport extends EnhancedEventEmitter {
  _id;
  _closed = false;
  _direction;
  _getSendExtendedRtpCapabilities;
  _recvRtpCapabilities;
  _canProduceByKind;
  _sctpParameters;
  _handler;
  _iceGatheringState = "new";
  _connectionState = "new";
  _appData;
  _producers = new Map;
  _consumers = new Map;
  _dataProducers = new Map;
  _dataConsumers = new Map;
  _probatorConsumerCreated = false;
  _awaitQueue = new AwaitQueue;
  _pendingConsumerTasks = [];
  _consumerCreationInProgress = false;
  _pendingPauseConsumers = new Map;
  _consumerPauseInProgress = false;
  _pendingResumeConsumers = new Map;
  _consumerResumeInProgress = false;
  _pendingCloseConsumers = new Map;
  _consumerCloseInProgress = false;
  _observer = new EnhancedEventEmitter;
  constructor({
    direction,
    id,
    iceParameters,
    iceCandidates,
    dtlsParameters,
    sctpParameters,
    iceServers,
    iceTransportPolicy,
    additionalSettings,
    appData,
    handlerFactory,
    getSendExtendedRtpCapabilities,
    recvRtpCapabilities,
    canProduceByKind
  }) {
    super();
    logger6.debug("constructor() [id:%s, direction:%s]", id, direction);
    this._id = id;
    this._direction = direction;
    this._getSendExtendedRtpCapabilities = getSendExtendedRtpCapabilities;
    this._recvRtpCapabilities = recvRtpCapabilities;
    this._canProduceByKind = canProduceByKind;
    this._sctpParameters = clone(sctpParameters);
    if (this._sctpParameters) {
      this._sctpParameters.maxSendMessageSize = this._sctpParameters.maxSendMessageSize ?? this._sctpParameters.maxMessageSize;
      this._sctpParameters.maxReceiveMessageSize = this._sctpParameters.maxReceiveMessageSize ?? this._sctpParameters.maxMessageSize;
    }
    const clonedAdditionalSettings = clone(additionalSettings) ?? {};
    delete clonedAdditionalSettings.iceServers;
    delete clonedAdditionalSettings.iceTransportPolicy;
    delete clonedAdditionalSettings.bundlePolicy;
    delete clonedAdditionalSettings.rtcpMuxPolicy;
    this._handler = handlerFactory.factory({
      direction,
      iceParameters,
      iceCandidates,
      dtlsParameters,
      sctpParameters: this._sctpParameters,
      iceServers,
      iceTransportPolicy,
      additionalSettings: clonedAdditionalSettings,
      getSendExtendedRtpCapabilities: this._getSendExtendedRtpCapabilities
    });
    this._appData = appData ?? {};
    this.handleHandler();
  }
  get id() {
    return this._id;
  }
  get closed() {
    return this._closed;
  }
  get direction() {
    return this._direction;
  }
  get handler() {
    return this._handler;
  }
  get iceGatheringState() {
    return this._iceGatheringState;
  }
  get connectionState() {
    return this._connectionState;
  }
  get appData() {
    return this._appData;
  }
  set appData(appData) {
    this._appData = appData;
  }
  get observer() {
    return this._observer;
  }
  close() {
    if (this._closed) {
      return;
    }
    logger6.debug("close()");
    this._closed = true;
    for (const task of this._pendingConsumerTasks) {
      task.reject(new InvalidStateError("closed"));
    }
    this._pendingConsumerTasks = [];
    this._awaitQueue.stop();
    this._handler.close();
    this._connectionState = "closed";
    for (const producer of this._producers.values()) {
      producer.transportClosed();
    }
    this._producers.clear();
    for (const consumer of this._consumers.values()) {
      consumer.transportClosed();
    }
    this._consumers.clear();
    for (const dataProducer of this._dataProducers.values()) {
      dataProducer.transportClosed();
    }
    this._dataProducers.clear();
    for (const dataConsumer of this._dataConsumers.values()) {
      dataConsumer.transportClosed();
    }
    this._dataConsumers.clear();
    this._observer.safeEmit("close");
    super.close();
    this._observer.close();
  }
  async getStats() {
    if (this._closed) {
      throw new InvalidStateError("closed");
    }
    return this._handler.getTransportStats();
  }
  async restartIce({
    iceParameters
  }) {
    logger6.debug("restartIce()");
    if (this._closed) {
      throw new InvalidStateError("closed");
    } else if (!iceParameters) {
      throw new TypeError("missing iceParameters");
    }
    await this._awaitQueue.push(async () => {
      await this._handler.restartIce(iceParameters);
    }, "transport.restartIce()");
  }
  async updateIceServers({
    iceServers
  } = {}) {
    logger6.debug("updateIceServers()");
    if (this._closed) {
      throw new InvalidStateError("closed");
    } else if (!Array.isArray(iceServers)) {
      throw new TypeError("missing iceServers");
    }
    await this._awaitQueue.push(async () => {
      await this._handler.updateIceServers(iceServers);
    }, "transport.updateIceServers()");
  }
  async produce({
    track,
    streamId,
    encodings,
    codecOptions,
    codec,
    stopTracks = true,
    disableTrackOnPause = true,
    zeroRtpOnPause = false,
    onRtpSender,
    appData = {}
  } = {}) {
    logger6.debug("produce() [track:%o]", track);
    if (this._closed) {
      if (track && stopTracks) {
        try {
          track.stop();
        } catch (error) {}
      }
      throw new InvalidStateError("closed");
    } else if (!track) {
      throw new TypeError("missing track");
    } else if (this._direction !== "send") {
      throw new UnsupportedError("not a sending transport");
    } else if (!this._canProduceByKind[track.kind]) {
      throw new UnsupportedError(`cannot produce ${track.kind}`);
    } else if (track.readyState === "ended") {
      throw new InvalidStateError("track ended");
    } else if (this.listenerCount("connect") === 0 && this._connectionState === "new") {
      throw new TypeError('no "connect" listener set into this transport');
    } else if (this.listenerCount("produce") === 0) {
      throw new TypeError('no "produce" listener set into this transport');
    } else if (appData && typeof appData !== "object") {
      throw new TypeError("if given, appData must be an object");
    }
    return this._awaitQueue.push(async () => {
      let normalizedEncodings;
      if (encodings && !Array.isArray(encodings)) {
        throw TypeError("encodings must be an array");
      } else if (encodings?.length === 0) {
        normalizedEncodings = undefined;
      } else if (encodings) {
        normalizedEncodings = encodings.map((encoding) => {
          const normalizedEncoding = {
            active: true
          };
          if (encoding.active === false) {
            normalizedEncoding.active = false;
          }
          if (typeof encoding.scalabilityMode === "string") {
            normalizedEncoding.scalabilityMode = encoding.scalabilityMode;
          }
          if (typeof encoding.scaleResolutionDownBy === "number") {
            normalizedEncoding.scaleResolutionDownBy = encoding.scaleResolutionDownBy;
          }
          if (typeof encoding.maxBitrate === "number") {
            normalizedEncoding.maxBitrate = encoding.maxBitrate;
          }
          if (typeof encoding.maxFramerate === "number") {
            normalizedEncoding.maxFramerate = encoding.maxFramerate;
          }
          if (typeof encoding.adaptivePtime === "boolean") {
            normalizedEncoding.adaptivePtime = encoding.adaptivePtime;
          }
          if (typeof encoding.priority === "string") {
            normalizedEncoding.priority = encoding.priority;
          }
          if (typeof encoding.networkPriority === "string") {
            normalizedEncoding.networkPriority = encoding.networkPriority;
          }
          return normalizedEncoding;
        });
      }
      const { localId, rtpParameters, rtpSender } = await this._handler.send({
        track,
        streamId,
        encodings: normalizedEncodings,
        codecOptions,
        codec,
        onRtpSender
      });
      try {
        validateAndNormalizeRtpParameters(rtpParameters);
        const { id } = await new Promise((resolve, reject) => {
          this.safeEmit("produce", {
            kind: track.kind,
            rtpParameters,
            appData
          }, resolve, reject);
        });
        const producer = new Producer({
          id,
          localId,
          rtpSender,
          track,
          rtpParameters,
          stopTracks,
          disableTrackOnPause,
          zeroRtpOnPause,
          appData
        });
        this._producers.set(producer.id, producer);
        this.handleProducer(producer);
        this._observer.safeEmit("newproducer", producer);
        return producer;
      } catch (error) {
        this._handler.stopSending(localId).catch(() => {});
        throw error;
      }
    }, "transport.produce()").catch((error) => {
      if (stopTracks) {
        try {
          track.stop();
        } catch (error2) {}
      }
      throw error;
    });
  }
  async consume({
    id,
    producerId,
    kind,
    rtpParameters,
    streamId,
    onRtpReceiver,
    appData = {}
  }) {
    logger6.debug("consume()");
    if (this._closed) {
      throw new InvalidStateError("closed");
    } else if (this._direction !== "recv") {
      throw new UnsupportedError("not a receiving transport");
    } else if (typeof id !== "string") {
      throw new TypeError("missing id");
    } else if (typeof producerId !== "string") {
      throw new TypeError("missing producerId");
    } else if (kind !== "audio" && kind !== "video") {
      throw new TypeError(`invalid kind '${kind}'`);
    } else if (this.listenerCount("connect") === 0 && this._connectionState === "new") {
      throw new TypeError('no "connect" listener set into this transport');
    } else if (appData && typeof appData !== "object") {
      throw new TypeError("if given, appData must be an object");
    }
    const clonedRtpParameters = clone(rtpParameters);
    const canConsume = canReceive(clonedRtpParameters, this._recvRtpCapabilities);
    if (!canConsume) {
      throw new UnsupportedError("cannot consume this Producer");
    }
    const consumerCreationTask = new ConsumerCreationTask({
      id,
      producerId,
      kind,
      rtpParameters: clonedRtpParameters,
      streamId,
      onRtpReceiver,
      appData
    });
    this._pendingConsumerTasks.push(consumerCreationTask);
    queueMicrotask(() => {
      if (this._closed) {
        return;
      }
      if (this._consumerCreationInProgress === false) {
        this.createPendingConsumers();
      }
    });
    return consumerCreationTask.promise;
  }
  async produceData({
    ordered = true,
    maxPacketLifeTime,
    maxRetransmits,
    label = "",
    protocol = "",
    appData = {}
  } = {}) {
    logger6.debug("produceData()");
    if (this._closed) {
      throw new InvalidStateError("closed");
    } else if (this._direction !== "send") {
      throw new UnsupportedError("not a sending transport");
    } else if (!this._sctpParameters) {
      throw new UnsupportedError("SCTP not enabled by remote transport");
    } else if (this.listenerCount("connect") === 0 && this._connectionState === "new") {
      throw new TypeError('no "connect" listener set into this transport');
    } else if (this.listenerCount("producedata") === 0) {
      throw new TypeError('no "producedata" listener set into this transport');
    } else if (appData && typeof appData !== "object") {
      throw new TypeError("if given, appData must be an object");
    }
    if (maxPacketLifeTime !== undefined || maxRetransmits !== undefined) {
      ordered = false;
    }
    return this._awaitQueue.push(async () => {
      const { dataChannel, sctpStreamParameters } = await this._handler.sendDataChannel({
        sctpStreamParameters: {
          ordered,
          maxPacketLifeTime,
          maxRetransmits,
          label,
          protocol
        }
      });
      let id;
      try {
        validateAndNormalizeSctpStreamParameters(sctpStreamParameters);
        ({ id } = await new Promise((resolve, reject) => {
          this.safeEmit("producedata", {
            sctpStreamParameters,
            label,
            protocol,
            appData
          }, resolve, reject);
        }));
      } catch (error) {
        try {
          dataChannel.close();
        } catch (error2) {}
        throw error;
      }
      const dataProducer = new DataProducer({
        id,
        dataChannel,
        sctpStreamParameters,
        appData
      });
      this._dataProducers.set(dataProducer.id, dataProducer);
      this.handleDataProducer(dataProducer);
      this._observer.safeEmit("newdataproducer", dataProducer);
      return dataProducer;
    }, "transport.produceData()");
  }
  async consumeData({
    id,
    dataProducerId,
    sctpStreamParameters,
    label = "",
    protocol = "",
    appData = {}
  }) {
    logger6.debug("consumeData()");
    if (this._closed) {
      throw new InvalidStateError("closed");
    } else if (this._direction !== "recv") {
      throw new UnsupportedError("not a receiving transport");
    } else if (!this._sctpParameters) {
      throw new UnsupportedError("SCTP not enabled by remote transport");
    } else if (typeof id !== "string") {
      throw new TypeError("missing id");
    } else if (typeof dataProducerId !== "string") {
      throw new TypeError("missing dataProducerId");
    } else if (this.listenerCount("connect") === 0 && this._connectionState === "new") {
      throw new TypeError('no "connect" listener set into this transport');
    } else if (appData && typeof appData !== "object") {
      throw new TypeError("if given, appData must be an object");
    }
    const clonedSctpStreamParameters = clone(sctpStreamParameters);
    validateAndNormalizeSctpStreamParameters(clonedSctpStreamParameters);
    return this._awaitQueue.push(async () => {
      const { dataChannel } = await this._handler.receiveDataChannel({
        maxMessageSize: this._sctpParameters?.maxSendMessageSize,
        sctpStreamParameters: clonedSctpStreamParameters,
        label,
        protocol
      });
      const dataConsumer = new DataConsumer({
        id,
        dataProducerId,
        dataChannel,
        sctpStreamParameters: clonedSctpStreamParameters,
        appData
      });
      this._dataConsumers.set(dataConsumer.id, dataConsumer);
      this.handleDataConsumer(dataConsumer);
      this._observer.safeEmit("newdataconsumer", dataConsumer);
      return dataConsumer;
    }, "transport.consumeData()");
  }
  getDataChannelMaxMessageSize() {
    return this._handler.getDataChannelMaxMessageSize();
  }
  createPendingConsumers() {
    this._consumerCreationInProgress = true;
    this._awaitQueue.push(async () => {
      if (this._pendingConsumerTasks.length === 0) {
        logger6.debug("createPendingConsumers() | there is no Consumer to be created");
        return;
      }
      const pendingConsumerTasks = [...this._pendingConsumerTasks];
      this._pendingConsumerTasks = [];
      let videoConsumerForProbator = undefined;
      const optionsList = [];
      for (const task of pendingConsumerTasks) {
        const { id, kind, rtpParameters, streamId, onRtpReceiver } = task.consumerOptions;
        optionsList.push({
          trackId: id,
          kind,
          rtpParameters,
          streamId,
          onRtpReceiver
        });
      }
      try {
        const results = await this._handler.receive(optionsList);
        for (let idx = 0;idx < results.length; ++idx) {
          const task = pendingConsumerTasks[idx];
          const result = results[idx];
          const { id, producerId, kind, rtpParameters, appData } = task.consumerOptions;
          const { localId, rtpReceiver, track } = result;
          const consumer = new Consumer({
            id,
            localId,
            producerId,
            rtpReceiver,
            track,
            rtpParameters,
            appData
          });
          this._consumers.set(consumer.id, consumer);
          this.handleConsumer(consumer);
          if (!this._probatorConsumerCreated && !videoConsumerForProbator && kind === "video") {
            videoConsumerForProbator = consumer;
          }
          this._observer.safeEmit("newconsumer", consumer);
          task.resolve(consumer);
        }
      } catch (error) {
        for (const task of pendingConsumerTasks) {
          task.reject(error);
        }
      }
      if (videoConsumerForProbator) {
        try {
          const probatorRtpParameters = generateProbatorRtpParameters(videoConsumerForProbator.rtpParameters);
          await this._handler.receive([
            {
              trackId: "probator",
              kind: "video",
              rtpParameters: probatorRtpParameters
            }
          ]);
          logger6.debug("createPendingConsumers() | Consumer for RTP probation created");
          this._probatorConsumerCreated = true;
        } catch (error) {
          logger6.error("createPendingConsumers() | failed to create Consumer for RTP probation:%o", error);
        }
      }
    }, "transport.createPendingConsumers()").then(() => {
      this._consumerCreationInProgress = false;
      if (this._pendingConsumerTasks.length > 0) {
        this.createPendingConsumers();
      }
    }).catch(() => {});
  }
  pausePendingConsumers() {
    this._consumerPauseInProgress = true;
    this._awaitQueue.push(async () => {
      if (this._pendingPauseConsumers.size === 0) {
        logger6.debug("pausePendingConsumers() | there is no Consumer to be paused");
        return;
      }
      const pendingPauseConsumers = Array.from(this._pendingPauseConsumers.values());
      this._pendingPauseConsumers.clear();
      try {
        const localIds = pendingPauseConsumers.map((consumer) => consumer.localId);
        await this._handler.pauseReceiving(localIds);
      } catch (error) {
        logger6.error("pausePendingConsumers() | failed to pause Consumers:", error);
      }
    }, "transport.pausePendingConsumers()").then(() => {
      this._consumerPauseInProgress = false;
      if (this._pendingPauseConsumers.size > 0) {
        this.pausePendingConsumers();
      }
    }).catch(() => {});
  }
  resumePendingConsumers() {
    this._consumerResumeInProgress = true;
    this._awaitQueue.push(async () => {
      if (this._pendingResumeConsumers.size === 0) {
        logger6.debug("resumePendingConsumers() | there is no Consumer to be resumed");
        return;
      }
      const pendingResumeConsumers = Array.from(this._pendingResumeConsumers.values());
      this._pendingResumeConsumers.clear();
      try {
        const localIds = pendingResumeConsumers.map((consumer) => consumer.localId);
        await this._handler.resumeReceiving(localIds);
      } catch (error) {
        logger6.error("resumePendingConsumers() | failed to resume Consumers:", error);
      }
    }, "transport.resumePendingConsumers()").then(() => {
      this._consumerResumeInProgress = false;
      if (this._pendingResumeConsumers.size > 0) {
        this.resumePendingConsumers();
      }
    }).catch(() => {});
  }
  closePendingConsumers() {
    this._consumerCloseInProgress = true;
    this._awaitQueue.push(async () => {
      if (this._pendingCloseConsumers.size === 0) {
        logger6.debug("closePendingConsumers() | there is no Consumer to be closed");
        return;
      }
      const pendingCloseConsumers = Array.from(this._pendingCloseConsumers.values());
      this._pendingCloseConsumers.clear();
      try {
        await this._handler.stopReceiving(pendingCloseConsumers.map((consumer) => consumer.localId));
      } catch (error) {
        logger6.error("closePendingConsumers() | failed to close Consumers:", error);
      }
    }, "transport.closePendingConsumers()").then(() => {
      this._consumerCloseInProgress = false;
      if (this._pendingCloseConsumers.size > 0) {
        this.closePendingConsumers();
      }
    }).catch(() => {});
  }
  handleHandler() {
    const handler = this._handler;
    handler.on("@connect", ({ dtlsParameters }, callback, errback) => {
      if (this._closed) {
        errback(new InvalidStateError("closed"));
        return;
      }
      this.safeEmit("connect", { dtlsParameters }, callback, errback);
    });
    handler.on("@icegatheringstatechange", (iceGatheringState) => {
      if (iceGatheringState === this._iceGatheringState) {
        return;
      }
      logger6.debug("ICE gathering state changed to %s", iceGatheringState);
      this._iceGatheringState = iceGatheringState;
      if (!this._closed) {
        this.safeEmit("icegatheringstatechange", iceGatheringState);
      }
    });
    handler.on("@icecandidateerror", (event) => {
      logger6.debug(`ICE candidate error [url:${event.url}, localAddress:${event.address}, localPort:${event.port}]: ${event.errorCode} "${event.errorText}"`);
      this.safeEmit("icecandidateerror", event);
    });
    handler.on("@connectionstatechange", (connectionState) => {
      if (connectionState === this._connectionState) {
        return;
      }
      logger6.debug("connection state changed to %s", connectionState);
      this._connectionState = connectionState;
      if (!this._closed) {
        this.safeEmit("connectionstatechange", connectionState);
      }
    });
  }
  handleProducer(producer) {
    producer.on("@close", () => {
      this._producers.delete(producer.id);
      if (this._closed) {
        return;
      }
      this._awaitQueue.push(async () => {
        await this._handler.stopSending(producer.localId);
      }, "producer @close event").catch((error) => logger6.warn("producer closure failed:%o", error));
    });
    producer.on("@pause", (callback, errback) => {
      this._awaitQueue.push(async () => {
        await this._handler.pauseSending(producer.localId);
      }, "producer @pause event").then(callback).catch(errback);
    });
    producer.on("@resume", (callback, errback) => {
      this._awaitQueue.push(async () => {
        await this._handler.resumeSending(producer.localId);
      }, "producer @resume event").then(callback).catch(errback);
    });
    producer.on("@replacetrack", (track, callback, errback) => {
      this._awaitQueue.push(async () => {
        await this._handler.replaceTrack(producer.localId, track);
      }, "producer @replacetrack event").then(callback).catch(errback);
    });
    producer.on("@setmaxspatiallayer", (spatialLayer, callback, errback) => {
      this._awaitQueue.push(async () => {
        await this._handler.setMaxSpatialLayer(producer.localId, spatialLayer);
      }, "producer @setmaxspatiallayer event").then(callback).catch(errback);
    });
    producer.on("@setrtpencodingparameters", (params, callback, errback) => {
      this._awaitQueue.push(async () => {
        await this._handler.setRtpEncodingParameters(producer.localId, params);
      }, "producer @setrtpencodingparameters event").then(callback).catch(errback);
    });
    producer.on("@getstats", (callback, errback) => {
      if (this._closed) {
        return errback(new InvalidStateError("closed"));
      }
      this._handler.getSenderStats(producer.localId).then(callback).catch(errback);
    });
  }
  handleConsumer(consumer) {
    consumer.on("@close", () => {
      this._consumers.delete(consumer.id);
      this._pendingPauseConsumers.delete(consumer.id);
      this._pendingResumeConsumers.delete(consumer.id);
      if (this._closed) {
        return;
      }
      this._pendingCloseConsumers.set(consumer.id, consumer);
      if (this._consumerCloseInProgress === false) {
        this.closePendingConsumers();
      }
    });
    consumer.on("@pause", () => {
      if (this._pendingResumeConsumers.has(consumer.id)) {
        this._pendingResumeConsumers.delete(consumer.id);
      }
      this._pendingPauseConsumers.set(consumer.id, consumer);
      queueMicrotask(() => {
        if (this._closed) {
          return;
        }
        if (this._consumerPauseInProgress === false) {
          this.pausePendingConsumers();
        }
      });
    });
    consumer.on("@resume", () => {
      if (this._pendingPauseConsumers.has(consumer.id)) {
        this._pendingPauseConsumers.delete(consumer.id);
      }
      this._pendingResumeConsumers.set(consumer.id, consumer);
      queueMicrotask(() => {
        if (this._closed) {
          return;
        }
        if (this._consumerResumeInProgress === false) {
          this.resumePendingConsumers();
        }
      });
    });
    consumer.on("@getstats", (callback, errback) => {
      if (this._closed) {
        return errback(new InvalidStateError("closed"));
      }
      this._handler.getReceiverStats(consumer.localId).then(callback).catch(errback);
    });
  }
  handleDataProducer(dataProducer) {
    dataProducer.on("@close", () => {
      this._dataProducers.delete(dataProducer.id);
    });
  }
  handleDataConsumer(dataConsumer) {
    dataConsumer.on("@close", () => {
      this._dataConsumers.delete(dataConsumer.id);
    });
  }
}

// ../ms/sdpt/lib/index.js
var exports_lib = {};
__exportCjs(exports_lib, {
  grammar: () => $grammar,
  write: () => $write,
  parse: () => $parse,
  parseParams: () => $parseParams,
  parseFmtpConfig: () => $parseFmtpConfig,
  parsePayloads: () => $parsePayloads,
  parseRemoteCandidates: () => $parseRemoteCandidates,
  parseImageAttributes: () => $parseImageAttributes,
  parseSimulcastStreamList: () => $parseSimulcastStreamList
}, {
  grammar: (value) => $grammar = value,
  write: (value) => $write = value,
  parse: (value) => $parse = value,
  parseParams: (value) => $parseParams = value,
  parseFmtpConfig: (value) => $parseFmtpConfig = value,
  parsePayloads: (value) => $parsePayloads = value,
  parseRemoteCandidates: (value) => $parseRemoteCandidates = value,
  parseImageAttributes: (value) => $parseImageAttributes = value,
  parseSimulcastStreamList: (value) => $parseSimulcastStreamList = value
});
var parser = require_parser();
var writer = require_writer();
var grammar = require_grammar();
var $grammar = grammar;
var $write = writer;
var $parse = parser.parse;
var $parseParams = parser.parseParams;
var $parseFmtpConfig = parser.parseFmtpConfig;
var $parsePayloads = parser.parsePayloads;
var $parseRemoteCandidates = parser.parseRemoteCandidates;
var $parseImageAttributes = parser.parseImageAttributes;
var $parseSimulcastStreamList = parser.parseSimulcastStreamList;

// ../ms/msc/src/scalabilityModes.ts
var ScalabilityModeRegex = new RegExp("^[LS]([1-9]\\d{0,1})T([1-9]\\d{0,1})");
function parse(scalabilityMode) {
  const match = ScalabilityModeRegex.exec(scalabilityMode ?? "");
  if (match) {
    return {
      spatialLayers: Number(match[1]),
      temporalLayers: Number(match[2])
    };
  } else {
    return {
      spatialLayers: 1,
      temporalLayers: 1
    };
  }
}

// ../ms/msc/src/handlers/sdp/RemoteMediaSection.ts
class RemoteMediaSection {
  _mediaObject;
  constructor({
    iceParameters,
    iceCandidates,
    dtlsParameters
  }) {
    this._mediaObject = {
      type: "",
      port: 0,
      protocol: "",
      payloads: "",
      rtp: [],
      fmtp: []
    };
    if (iceParameters) {
      this.setIceParameters(iceParameters);
    }
    if (iceCandidates) {
      this._mediaObject.candidates = [];
      for (const candidate of iceCandidates) {
        const candidateObject = {
          foundation: candidate.foundation,
          component: 1,
          ip: candidate.address ?? candidate.ip,
          port: candidate.port,
          priority: candidate.priority,
          transport: candidate.protocol,
          type: candidate.type
        };
        if (candidate.tcpType) {
          candidateObject.tcptype = candidate.tcpType;
        }
        this._mediaObject.candidates.push(candidateObject);
      }
      this._mediaObject.endOfCandidates = "end-of-candidates";
      this._mediaObject.iceOptions = "renomination";
    }
    if (dtlsParameters) {
      this.setDtlsRole(dtlsParameters.role);
    }
  }
  get mid() {
    return String(this._mediaObject.mid);
  }
  get closed() {
    return this._mediaObject.port === 0;
  }
  getObject() {
    return this._mediaObject;
  }
  setIceParameters(iceParameters) {
    this._mediaObject.iceUfrag = iceParameters.usernameFragment;
    this._mediaObject.icePwd = iceParameters.password;
  }
  pause() {
    this._mediaObject.direction = "inactive";
  }
  disable() {
    this.pause();
  }
  close() {
    this.disable();
    this._mediaObject.port = 0;
    delete this._mediaObject.candidates;
    delete this._mediaObject.endOfCandidates;
    delete this._mediaObject.iceUfrag;
    delete this._mediaObject.icePwd;
    delete this._mediaObject.iceOptions;
    this._mediaObject.rtp = [];
    this._mediaObject.fmtp = [];
    delete this._mediaObject.rtcp;
    delete this._mediaObject.rtcpFb;
    delete this._mediaObject.ssrcs;
    delete this._mediaObject.ssrcGroups;
    delete this._mediaObject.simulcast;
    delete this._mediaObject.simulcast_03;
    delete this._mediaObject.rids;
    delete this._mediaObject.extmapAllowMixed;
  }
}

class RemoteAnswerMediaSection extends RemoteMediaSection {
  constructor({
    iceParameters,
    iceCandidates,
    dtlsParameters,
    sctpParameters,
    plainRtpParameters,
    offerMediaObject,
    offerRtpParameters,
    answerRtpParameters,
    codecOptions
  }) {
    super({ iceParameters, iceCandidates, dtlsParameters });
    this._mediaObject.mid = String(offerMediaObject.mid);
    this._mediaObject.type = offerMediaObject.type;
    this._mediaObject.protocol = offerMediaObject.protocol;
    if (!plainRtpParameters) {
      this._mediaObject.connection = { ip: "127.0.0.1", version: 4 };
      this._mediaObject.port = 7;
    } else {
      this._mediaObject.connection = {
        ip: plainRtpParameters.ip,
        version: plainRtpParameters.ipVersion
      };
      this._mediaObject.port = plainRtpParameters.port;
    }
    switch (offerMediaObject.type) {
      case "audio":
      case "video": {
        this._mediaObject.direction = "recvonly";
        this._mediaObject.rtp = [];
        this._mediaObject.rtcpFb = [];
        this._mediaObject.fmtp = [];
        for (const codec of answerRtpParameters.codecs) {
          const rtp = {
            payload: codec.payloadType,
            codec: getCodecName(codec),
            rate: codec.clockRate
          };
          if (codec.channels > 1) {
            rtp.encoding = codec.channels;
          }
          this._mediaObject.rtp.push(rtp);
          const codecParameters = clone(codec.parameters) ?? {};
          let codecRtcpFeedback = clone(codec.rtcpFeedback) ?? [];
          if (codecOptions) {
            const {
              opusStereo,
              opusFec,
              opusDtx,
              opusMaxPlaybackRate,
              opusMaxAverageBitrate,
              opusPtime,
              opusNack,
              videoGoogleStartBitrate,
              videoGoogleMaxBitrate,
              videoGoogleMinBitrate
            } = codecOptions;
            const offerCodec = offerRtpParameters.codecs.find((c) => c.payloadType === codec.payloadType);
            switch (codec.mimeType.toLowerCase()) {
              case "audio/opus":
              case "audio/multiopus": {
                if (opusStereo !== undefined) {
                  offerCodec.parameters["sprop-stereo"] = opusStereo ? 1 : 0;
                  codecParameters["stereo"] = opusStereo ? 1 : 0;
                }
                if (opusFec !== undefined) {
                  offerCodec.parameters["useinbandfec"] = opusFec ? 1 : 0;
                  codecParameters["useinbandfec"] = opusFec ? 1 : 0;
                }
                if (opusDtx !== undefined) {
                  offerCodec.parameters["usedtx"] = opusDtx ? 1 : 0;
                  codecParameters["usedtx"] = opusDtx ? 1 : 0;
                }
                if (opusMaxPlaybackRate !== undefined) {
                  codecParameters["maxplaybackrate"] = opusMaxPlaybackRate;
                }
                if (opusMaxAverageBitrate !== undefined) {
                  codecParameters["maxaveragebitrate"] = opusMaxAverageBitrate;
                }
                if (opusPtime !== undefined) {
                  offerCodec.parameters["ptime"] = opusPtime;
                  codecParameters["ptime"] = opusPtime;
                }
                if (!opusNack) {
                  offerCodec.rtcpFeedback = offerCodec.rtcpFeedback.filter((fb) => fb.type !== "nack" || fb.parameter);
                  codecRtcpFeedback = codecRtcpFeedback.filter((fb) => fb.type !== "nack" || fb.parameter);
                }
                break;
              }
              case "video/vp8":
              case "video/vp9":
              case "video/h264":
              case "video/h265":
              case "video/av1": {
                if (videoGoogleStartBitrate !== undefined) {
                  codecParameters["x-google-start-bitrate"] = videoGoogleStartBitrate;
                }
                if (videoGoogleMaxBitrate !== undefined) {
                  codecParameters["x-google-max-bitrate"] = videoGoogleMaxBitrate;
                }
                if (videoGoogleMinBitrate !== undefined) {
                  codecParameters["x-google-min-bitrate"] = videoGoogleMinBitrate;
                }
                break;
              }
            }
          }
          const fmtp = {
            payload: codec.payloadType,
            config: ""
          };
          for (const key of Object.keys(codecParameters)) {
            if (fmtp.config) {
              fmtp.config += ";";
            }
            fmtp.config += `${key}=${codecParameters[key]}`;
          }
          if (fmtp.config) {
            this._mediaObject.fmtp.push(fmtp);
          }
          for (const fb of codecRtcpFeedback) {
            this._mediaObject.rtcpFb.push({
              payload: codec.payloadType,
              type: fb.type,
              subtype: fb.parameter
            });
          }
        }
        this._mediaObject.payloads = answerRtpParameters.codecs.map((codec) => codec.payloadType).join(" ");
        this._mediaObject.ext = [];
        for (const ext of answerRtpParameters.headerExtensions) {
          const found = (offerMediaObject.ext ?? []).some((localExt) => localExt.uri === ext.uri);
          if (!found) {
            continue;
          }
          this._mediaObject.ext.push({
            uri: ext.uri,
            value: ext.id
          });
        }
        if (offerMediaObject.extmapAllowMixed === "extmap-allow-mixed") {
          this._mediaObject.extmapAllowMixed = "extmap-allow-mixed";
        }
        if (offerMediaObject.simulcast) {
          this._mediaObject.simulcast = {
            dir1: "recv",
            list1: offerMediaObject.simulcast.list1
          };
          this._mediaObject.rids = [];
          for (const rid of offerMediaObject.rids ?? []) {
            if (rid.direction !== "send") {
              continue;
            }
            this._mediaObject.rids.push({
              id: rid.id,
              direction: "recv"
            });
          }
        } else if (offerMediaObject.simulcast_03) {
          this._mediaObject.simulcast_03 = {
            value: offerMediaObject.simulcast_03.value.replace(/send/g, "recv")
          };
          this._mediaObject.rids = [];
          for (const rid of offerMediaObject.rids ?? []) {
            if (rid.direction !== "send") {
              continue;
            }
            this._mediaObject.rids.push({
              id: rid.id,
              direction: "recv"
            });
          }
        }
        this._mediaObject.rtcpMux = "rtcp-mux";
        this._mediaObject.rtcpRsize = "rtcp-rsize";
        break;
      }
      case "application": {
        if (typeof offerMediaObject.sctpPort === "number") {
          this._mediaObject.payloads = "webrtc-datachannel";
          this._mediaObject.sctpPort = sctpParameters.port;
          this._mediaObject.maxMessageSize = sctpParameters.maxReceiveMessageSize;
        } else if (offerMediaObject.sctpmap) {
          this._mediaObject.payloads = String(sctpParameters.port);
          this._mediaObject.sctpmap = {
            app: "webrtc-datachannel",
            sctpmapNumber: sctpParameters.port,
            maxMessageSize: sctpParameters.maxReceiveMessageSize
          };
        }
        break;
      }
    }
  }
  setDtlsRole(role) {
    switch (role) {
      case "client": {
        this._mediaObject.setup = "active";
        break;
      }
      case "server": {
        this._mediaObject.setup = "passive";
        break;
      }
      case "auto": {
        this._mediaObject.setup = "actpass";
        break;
      }
    }
  }
  resume() {
    this._mediaObject.direction = "recvonly";
  }
  muxSimulcastStreams(encodings) {
    if (!this._mediaObject.simulcast?.list1) {
      return;
    }
    const layers = {};
    for (const encoding of encodings) {
      if (encoding.rid) {
        layers[encoding.rid] = encoding;
      }
    }
    const raw = this._mediaObject.simulcast.list1;
    const simulcastStreams = exports_lib.parseSimulcastStreamList(raw);
    for (const simulcastStream of simulcastStreams) {
      for (const simulcastFormat of simulcastStream) {
        simulcastFormat.paused = !layers[simulcastFormat.scid]?.active;
      }
    }
    this._mediaObject.simulcast.list1 = simulcastStreams.map((simulcastFormats) => simulcastFormats.map((f) => `${f.paused ? "~" : ""}${f.scid}`).join(",")).join(";");
  }
}

class RemoteOfferMediaSection extends RemoteMediaSection {
  constructor({
    iceParameters,
    iceCandidates,
    dtlsParameters,
    sctpParameters,
    plainRtpParameters,
    mid,
    kind,
    offerRtpParameters,
    streamId,
    trackId
  }) {
    super({ iceParameters, iceCandidates, dtlsParameters });
    this._mediaObject.mid = String(mid);
    this._mediaObject.type = kind;
    if (!plainRtpParameters) {
      this._mediaObject.connection = { ip: "127.0.0.1", version: 4 };
      if (!sctpParameters) {
        this._mediaObject.protocol = "UDP/TLS/RTP/SAVPF";
      } else {
        this._mediaObject.protocol = "UDP/DTLS/SCTP";
      }
      this._mediaObject.port = 7;
    } else {
      this._mediaObject.connection = {
        ip: plainRtpParameters.ip,
        version: plainRtpParameters.ipVersion
      };
      this._mediaObject.protocol = "RTP/AVP";
      this._mediaObject.port = plainRtpParameters.port;
    }
    this._mediaObject.extmapAllowMixed = "extmap-allow-mixed";
    switch (kind) {
      case "audio":
      case "video": {
        this._mediaObject.direction = "sendonly";
        this._mediaObject.rtp = [];
        this._mediaObject.rtcpFb = [];
        this._mediaObject.fmtp = [];
        this._mediaObject.msid = [{ id: streamId, appdata: trackId }];
        for (const codec of offerRtpParameters.codecs) {
          const rtp = {
            payload: codec.payloadType,
            codec: getCodecName(codec),
            rate: codec.clockRate
          };
          if (codec.channels > 1) {
            rtp.encoding = codec.channels;
          }
          this._mediaObject.rtp.push(rtp);
          const fmtp = {
            payload: codec.payloadType,
            config: ""
          };
          for (const key of Object.keys(codec.parameters ?? {})) {
            if (fmtp.config) {
              fmtp.config += ";";
            }
            fmtp.config += `${key}=${codec.parameters[key]}`;
          }
          if (fmtp.config) {
            this._mediaObject.fmtp.push(fmtp);
          }
          for (const fb of codec.rtcpFeedback) {
            this._mediaObject.rtcpFb.push({
              payload: codec.payloadType,
              type: fb.type,
              subtype: fb.parameter
            });
          }
        }
        this._mediaObject.payloads = offerRtpParameters.codecs.map((codec) => codec.payloadType).join(" ");
        this._mediaObject.ext = [];
        for (const ext of offerRtpParameters.headerExtensions) {
          this._mediaObject.ext.push({
            uri: ext.uri,
            value: ext.id
          });
        }
        this._mediaObject.rtcpMux = "rtcp-mux";
        this._mediaObject.rtcpRsize = "rtcp-rsize";
        const encoding = offerRtpParameters.encodings[0];
        const ssrc = encoding.ssrc;
        const rtxSsrc = encoding.rtx?.ssrc;
        this._mediaObject.ssrcs = [];
        this._mediaObject.ssrcGroups = [];
        if (ssrc && offerRtpParameters.rtcp.cname) {
          this._mediaObject.ssrcs.push({
            id: ssrc,
            attribute: "cname",
            value: offerRtpParameters.rtcp.cname
          });
        }
        if (rtxSsrc) {
          if (offerRtpParameters.rtcp.cname) {
            this._mediaObject.ssrcs.push({
              id: rtxSsrc,
              attribute: "cname",
              value: offerRtpParameters.rtcp.cname
            });
          }
          if (ssrc) {
            this._mediaObject.ssrcGroups.push({
              semantics: "FID",
              ssrcs: `${ssrc} ${rtxSsrc}`
            });
          }
        }
        break;
      }
      case "application": {
        this._mediaObject.payloads = "webrtc-datachannel";
        this._mediaObject.sctpPort = sctpParameters.port;
        this._mediaObject.maxMessageSize = sctpParameters.maxReceiveMessageSize;
        break;
      }
    }
  }
  setDtlsRole(role) {
    this._mediaObject.setup = "actpass";
  }
  resume() {
    this._mediaObject.direction = "sendonly";
  }
}
function getCodecName(codec) {
  const MimeTypeRegex = new RegExp("^(audio|video)/(.+)", "i");
  const mimeTypeMatch = MimeTypeRegex.exec(codec.mimeType);
  if (!mimeTypeMatch) {
    throw new TypeError("invalid codec.mimeType");
  }
  return mimeTypeMatch[2];
}

// ../ms/skh-msc-version.ts
var version = "3.25.3";

// ../ms/msc/src/handlers/sdp/RemoteSdp.ts
var DependencyDescriptorCodecs = ["av1", "h264"];
var logger7 = new Logger("RemoteSdp");

class RemoteSdp {
  _iceParameters;
  _iceCandidates;
  _dtlsParameters;
  _sctpParameters;
  _plainRtpParameters;
  _mediaSections = [];
  _midToIndex = new Map;
  _firstMid;
  _sdpObject;
  constructor({
    iceParameters,
    iceCandidates,
    dtlsParameters,
    sctpParameters,
    plainRtpParameters
  }) {
    this._iceParameters = iceParameters;
    this._iceCandidates = iceCandidates;
    this._dtlsParameters = dtlsParameters;
    this._sctpParameters = sctpParameters;
    this._plainRtpParameters = plainRtpParameters;
    this._sdpObject = {
      version: 0,
      origin: {
        address: "0.0.0.0",
        ipVer: 4,
        netType: "IN",
        sessionId: "10000",
        sessionVersion: 0,
        username: `mediasoup-client-v${version}`
      },
      name: "-",
      timing: { start: 0, stop: 0 },
      media: []
    };
    this._sdpObject.iceOptions = "ice2";
    if (iceParameters?.iceLite) {
      this._sdpObject.icelite = "ice-lite";
    }
    if (dtlsParameters) {
      this._sdpObject.msidSemantic = { semantic: "WMS", token: "*" };
      const numFingerprints = this._dtlsParameters.fingerprints.length;
      this._sdpObject.fingerprint = {
        type: dtlsParameters.fingerprints[numFingerprints - 1].algorithm,
        hash: dtlsParameters.fingerprints[numFingerprints - 1].value
      };
      this._sdpObject.groups = [{ type: "BUNDLE", mids: "" }];
    }
    if (plainRtpParameters) {
      this._sdpObject.origin.address = plainRtpParameters.ip;
      this._sdpObject.origin.ipVer = plainRtpParameters.ipVersion;
    }
  }
  updateIceParameters(iceParameters) {
    logger7.debug("updateIceParameters() [iceParameters:%o]", iceParameters);
    this._iceParameters = iceParameters;
    this._sdpObject.icelite = iceParameters.iceLite ? "ice-lite" : undefined;
    for (const mediaSection of this._mediaSections) {
      mediaSection.setIceParameters(iceParameters);
    }
  }
  updateDtlsRole(role) {
    logger7.debug("updateDtlsRole() [role:%s]", role);
    this._dtlsParameters.role = role;
    for (const mediaSection of this._mediaSections) {
      mediaSection.setDtlsRole(role);
    }
  }
  setSessionExtmapAllowMixed() {
    logger7.debug("setSessionExtmapAllowMixed()");
    this._sdpObject.extmapAllowMixed = "extmap-allow-mixed";
  }
  getNextMediaSectionIdx() {
    for (let idx = 0;idx < this._mediaSections.length; ++idx) {
      const mediaSection = this._mediaSections[idx];
      if (mediaSection.closed) {
        return { idx, reuseMid: mediaSection.mid };
      }
    }
    return { idx: this._mediaSections.length };
  }
  send({
    offerMediaObject,
    reuseMid,
    offerRtpParameters,
    answerRtpParameters,
    codecOptions
  }) {
    const mediaSection = new RemoteAnswerMediaSection({
      iceParameters: this._iceParameters,
      iceCandidates: this._iceCandidates,
      dtlsParameters: this._dtlsParameters,
      plainRtpParameters: this._plainRtpParameters,
      offerMediaObject,
      offerRtpParameters,
      answerRtpParameters,
      codecOptions
    });
    const mediaObject = mediaSection.getObject();
    const ddCodec = mediaObject.rtp.find((rtp) => DependencyDescriptorCodecs.includes(rtp.codec.toLowerCase()));
    if (!ddCodec) {
      mediaObject.ext = mediaObject.ext?.filter((extmap) => extmap.uri !== "https://aomediacodec.github.io/av1-rtp-spec/#dependency-descriptor-rtp-header-extension");
    }
    if (reuseMid) {
      this.replaceMediaSection(mediaSection, reuseMid);
    } else if (!this._midToIndex.has(mediaSection.mid)) {
      this.addMediaSection(mediaSection);
    } else {
      this.replaceMediaSection(mediaSection);
    }
  }
  receive({
    mid,
    kind,
    offerRtpParameters,
    streamId,
    trackId
  }) {
    this.setSessionExtmapAllowMixed();
    const mediaSection = new RemoteOfferMediaSection({
      iceParameters: this._iceParameters,
      iceCandidates: this._iceCandidates,
      dtlsParameters: this._dtlsParameters,
      plainRtpParameters: this._plainRtpParameters,
      mid,
      kind,
      offerRtpParameters,
      streamId,
      trackId
    });
    const oldMediaSection = this._mediaSections.find((m) => m.closed && m.getObject().type === kind);
    if (oldMediaSection) {
      this.replaceMediaSection(mediaSection, oldMediaSection.mid);
    } else {
      this.addMediaSection(mediaSection);
    }
  }
  pauseMediaSection(mid) {
    const mediaSection = this.findMediaSection(mid);
    mediaSection.pause();
  }
  resumeSendingMediaSection(mid) {
    const mediaSection = this.findMediaSection(mid);
    mediaSection.resume();
  }
  resumeReceivingMediaSection(mid) {
    const mediaSection = this.findMediaSection(mid);
    mediaSection.resume();
  }
  disableMediaSection(mid) {
    const mediaSection = this.findMediaSection(mid);
    mediaSection.disable();
  }
  closeMediaSection(mid) {
    const mediaSection = this.findMediaSection(mid);
    if (mid === this._firstMid) {
      logger7.debug("closeMediaSection() | cannot close first media section, disabling it instead [mid:%s]", mid);
      this.disableMediaSection(mid);
      return false;
    }
    mediaSection.close();
    this.regenerateBundleMids();
    return true;
  }
  muxMediaSectionSimulcast(mid, encodings) {
    const mediaSection = this.findMediaSection(mid);
    mediaSection.muxSimulcastStreams(encodings);
    this.replaceMediaSection(mediaSection);
  }
  sendSctpAssociation({
    offerMediaObject
  }) {
    const mediaSection = new RemoteAnswerMediaSection({
      iceParameters: this._iceParameters,
      iceCandidates: this._iceCandidates,
      dtlsParameters: this._dtlsParameters,
      sctpParameters: this._sctpParameters,
      plainRtpParameters: this._plainRtpParameters,
      offerMediaObject
    });
    this.addMediaSection(mediaSection);
  }
  receiveSctpAssociation() {
    const mediaSection = new RemoteOfferMediaSection({
      iceParameters: this._iceParameters,
      iceCandidates: this._iceCandidates,
      dtlsParameters: this._dtlsParameters,
      sctpParameters: this._sctpParameters,
      plainRtpParameters: this._plainRtpParameters,
      mid: "datachannel",
      kind: "application"
    });
    this.addMediaSection(mediaSection);
  }
  getSdp() {
    this._sdpObject.origin.sessionVersion++;
    return exports_lib.write(this._sdpObject);
  }
  addMediaSection(newMediaSection) {
    if (!this._firstMid) {
      this._firstMid = newMediaSection.mid;
    }
    this._mediaSections.push(newMediaSection);
    this._midToIndex.set(newMediaSection.mid, this._mediaSections.length - 1);
    this._sdpObject.media.push(newMediaSection.getObject());
    this.regenerateBundleMids();
  }
  replaceMediaSection(newMediaSection, reuseMid) {
    if (typeof reuseMid === "string") {
      const idx = this._midToIndex.get(reuseMid);
      if (idx === undefined) {
        throw new Error(`no media section found for reuseMid '${reuseMid}'`);
      }
      const oldMediaSection = this._mediaSections[idx];
      this._mediaSections[idx] = newMediaSection;
      this._midToIndex.delete(oldMediaSection.mid);
      this._midToIndex.set(newMediaSection.mid, idx);
      this._sdpObject.media[idx] = newMediaSection.getObject();
      this.regenerateBundleMids();
    } else {
      const idx = this._midToIndex.get(newMediaSection.mid);
      if (idx === undefined) {
        throw new Error(`no media section found with mid '${newMediaSection.mid}'`);
      }
      this._mediaSections[idx] = newMediaSection;
      this._sdpObject.media[idx] = newMediaSection.getObject();
    }
  }
  findMediaSection(mid) {
    const idx = this._midToIndex.get(mid);
    if (idx === undefined) {
      throw new Error(`no media section found with mid '${mid}'`);
    }
    return this._mediaSections[idx];
  }
  regenerateBundleMids() {
    if (!this._dtlsParameters) {
      return;
    }
    this._sdpObject.groups[0].mids = this._mediaSections.filter((mediaSection) => !mediaSection.closed).map((mediaSection) => mediaSection.mid).join(" ");
  }
}

// ../ms/msc/src/handlers/sdp/commonUtils.ts
function extractRtpCapabilities({
  sdpObject
}) {
  const codecsMap = new Map;
  const headerExtensionMap = new Map;
  for (const m of sdpObject.media) {
    const kind = m.type;
    switch (kind) {
      case "audio":
      case "video": {
        break;
      }
      default: {
        continue;
      }
    }
    for (const rtp of m.rtp) {
      const codec = {
        kind,
        mimeType: `${kind}/${rtp.codec}`,
        preferredPayloadType: rtp.payload,
        clockRate: rtp.rate,
        channels: rtp.encoding,
        parameters: {},
        rtcpFeedback: []
      };
      codecsMap.set(codec.preferredPayloadType, codec);
    }
    for (const fmtp of m.fmtp ?? []) {
      const parameters = exports_lib.parseParams(fmtp.config);
      const codec = codecsMap.get(fmtp.payload);
      if (!codec) {
        continue;
      }
      if (parameters?.hasOwnProperty("profile-level-id")) {
        parameters["profile-level-id"] = String(parameters["profile-level-id"]);
      }
      codec.parameters = parameters;
    }
    for (const fb of m.rtcpFb ?? []) {
      const feedback = {
        type: fb.type,
        parameter: fb.subtype
      };
      if (!feedback.parameter) {
        delete feedback.parameter;
      }
      if (fb.payload !== "*") {
        const codec = codecsMap.get(Number(fb.payload));
        if (!codec) {
          continue;
        }
        codec.rtcpFeedback.push(feedback);
      } else {
        for (const codec of codecsMap.values()) {
          if (codec.kind === kind && !/.+\/rtx$/i.test(codec.mimeType)) {
            codec.rtcpFeedback.push(feedback);
          }
        }
      }
    }
    for (const ext of m.ext ?? []) {
      if (ext["encrypt-uri"]) {
        continue;
      }
      const headerExtension = {
        kind,
        uri: ext.uri,
        preferredId: ext.value
      };
      headerExtensionMap.set(`${kind}:${headerExtension.preferredId}`, headerExtension);
    }
  }
  const rtpCapabilities = {
    codecs: Array.from(codecsMap.values()),
    headerExtensions: Array.from(headerExtensionMap.values())
  };
  return rtpCapabilities;
}
function extractDtlsParameters({
  sdpObject
}) {
  let setup = sdpObject.setup;
  let fingerprint = sdpObject.fingerprint;
  if (!setup || !fingerprint) {
    const mediaObject = (sdpObject.media ?? []).find((m) => m.port !== 0);
    if (mediaObject) {
      setup = setup ?? mediaObject.setup;
      fingerprint = fingerprint ?? mediaObject.fingerprint;
    }
  }
  if (!setup) {
    throw new Error("no a=setup found at SDP session or media level");
  } else if (!fingerprint) {
    throw new Error("no a=fingerprint found at SDP session or media level");
  }
  let role;
  switch (setup) {
    case "active": {
      role = "client";
      break;
    }
    case "passive": {
      role = "server";
      break;
    }
    case "actpass": {
      role = "auto";
      break;
    }
  }
  const dtlsParameters = {
    role,
    fingerprints: [
      {
        algorithm: fingerprint.type,
        value: fingerprint.hash
      }
    ]
  };
  return dtlsParameters;
}
function getCname({
  offerMediaObject
}) {
  const ssrcCnameLine = (offerMediaObject.ssrcs ?? []).find((line) => line.attribute === "cname");
  if (!ssrcCnameLine) {
    return "";
  }
  return ssrcCnameLine.value;
}
function applyCodecParameters({
  offerRtpParameters,
  answerMediaObject
}) {
  for (const codec of offerRtpParameters.codecs) {
    const mimeType = codec.mimeType.toLowerCase();
    if (mimeType !== "audio/opus") {
      continue;
    }
    const rtp = (answerMediaObject.rtp ?? []).find((r) => r.payload === codec.payloadType);
    if (!rtp) {
      continue;
    }
    answerMediaObject.fmtp = answerMediaObject.fmtp ?? [];
    let fmtp = answerMediaObject.fmtp.find((f) => f.payload === codec.payloadType);
    if (!fmtp) {
      fmtp = { payload: codec.payloadType, config: "" };
      answerMediaObject.fmtp.push(fmtp);
    }
    const parameters = exports_lib.parseParams(fmtp.config);
    switch (mimeType) {
      case "audio/opus": {
        const spropStereo = codec.parameters?.["sprop-stereo"];
        if (spropStereo !== undefined) {
          parameters["stereo"] = Number(spropStereo) ? 1 : 0;
        }
        break;
      }
    }
    fmtp.config = "";
    for (const key of Object.keys(parameters)) {
      if (fmtp.config) {
        fmtp.config += ";";
      }
      fmtp.config += `${key}=${parameters[key]}`;
    }
  }
}

// ../ms/msc/src/handlers/sdp/unifiedPlanUtils.ts
function getRtpEncodings({
  offerMediaObject,
  codecs
}) {
  const ssrcs = new Set;
  for (const line of offerMediaObject.ssrcs ?? []) {
    const ssrc = line.id;
    if (ssrc) {
      ssrcs.add(ssrc);
    }
  }
  if (ssrcs.size === 0) {
    throw new Error("no a=ssrc lines found");
  }
  const ssrcToRtxSsrc = new Map;
  for (const line of offerMediaObject.ssrcGroups ?? []) {
    if (line.semantics !== "FID") {
      continue;
    }
    const ssrcsStr = line.ssrcs.split(/\s+/);
    const ssrc = Number(ssrcsStr[0]);
    const rtxSsrc = Number(ssrcsStr[1]);
    if (ssrcs.has(ssrc)) {
      ssrcs.delete(ssrc);
      ssrcs.delete(rtxSsrc);
      ssrcToRtxSsrc.set(ssrc, rtxSsrc);
    }
  }
  for (const ssrc of ssrcs) {
    ssrcToRtxSsrc.set(ssrc, undefined);
  }
  const encodings = [];
  for (const [ssrc, rtxSsrc] of ssrcToRtxSsrc) {
    const encoding = { ssrc };
    if (rtxSsrc && codecs.length > 1) {
      encoding.rtx = { ssrc: rtxSsrc };
    }
    encodings.push(encoding);
  }
  return encodings;
}
function addLegacySimulcast({
  offerMediaObject,
  numStreams
}) {
  if (numStreams <= 1) {
    throw new TypeError("numStreams must be greater than 1");
  }
  const ssrcMsidLine = (offerMediaObject.ssrcs ?? []).find((line) => line.attribute === "msid");
  if (!ssrcMsidLine) {
    throw new Error("a=ssrc line with msid information not found");
  }
  const [streamId, trackId] = ssrcMsidLine.value.split(" ");
  const firstSsrc = Number(ssrcMsidLine.id);
  let firstRtxSsrc;
  (offerMediaObject.ssrcGroups ?? []).some((line) => {
    if (line.semantics !== "FID") {
      return false;
    }
    const ssrcs = line.ssrcs.split(/\s+/);
    if (Number(ssrcs[0]) === firstSsrc) {
      firstRtxSsrc = Number(ssrcs[1]);
      return true;
    } else {
      return false;
    }
  });
  const ssrcCnameLine = (offerMediaObject.ssrcs ?? []).find((line) => line.attribute === "cname");
  if (!ssrcCnameLine) {
    throw new Error("a=ssrc line with cname information not found");
  }
  const cname = ssrcCnameLine.value;
  const ssrcs = [];
  const rtxSsrcs = [];
  for (let i = 0;i < numStreams; ++i) {
    ssrcs.push(firstSsrc + i);
    if (firstRtxSsrc) {
      rtxSsrcs.push(firstRtxSsrc + i);
    }
  }
  offerMediaObject.ssrcGroups = [];
  offerMediaObject.ssrcs = [];
  offerMediaObject.ssrcGroups.push({
    semantics: "SIM",
    ssrcs: ssrcs.join(" ")
  });
  for (const ssrc of ssrcs) {
    offerMediaObject.ssrcs.push({
      id: ssrc,
      attribute: "cname",
      value: cname
    });
    offerMediaObject.ssrcs.push({
      id: ssrc,
      attribute: "msid",
      value: `${streamId} ${trackId}`
    });
  }
  for (let i = 0;i < rtxSsrcs.length; ++i) {
    const ssrc = ssrcs[i];
    const rtxSsrc = rtxSsrcs[i];
    offerMediaObject.ssrcs.push({
      id: rtxSsrc,
      attribute: "cname",
      value: cname
    });
    offerMediaObject.ssrcs.push({
      id: rtxSsrc,
      attribute: "msid",
      value: `${streamId} ${trackId}`
    });
    offerMediaObject.ssrcGroups.push({
      semantics: "FID",
      ssrcs: `${ssrc} ${rtxSsrc}`
    });
  }
}

// ../ms/msc/src/handlers/ortc/utils.ts
var logger8 = new Logger("ortc/utils");
function addNackSupportForOpus(rtpCapabilities) {
  for (const codec of rtpCapabilities.codecs ?? []) {
    if ((codec.mimeType.toLowerCase() === "audio/opus" || codec.mimeType.toLowerCase() === "audio/multiopus") && !codec.rtcpFeedback?.some((fb) => fb.type === "nack" && !fb.parameter)) {
      if (!codec.rtcpFeedback) {
        codec.rtcpFeedback = [];
      }
      codec.rtcpFeedback.push({ type: "nack" });
    }
  }
}
function getMsidStreamIdAndTrackId(msid) {
  if (!msid || typeof msid !== "string") {
    return { msidStreamId: undefined, msidTrackId: undefined };
  }
  const [msidStreamId, msidTrackId] = msid.trim().split(/\s+/);
  if (!msidStreamId) {
    return { msidStreamId: undefined, msidTrackId: undefined };
  }
  return { msidStreamId, msidTrackId };
}
function applyForcedRtpExtensions(transceiver, forcedRtpExtensions) {
  if (!transceiver.getHeaderExtensionsToNegotiate || !transceiver.setHeaderExtensionsToNegotiate) {
    return false;
  }
  if (Object.keys(forcedRtpExtensions).length === 0) {
    return false;
  }
  let extensionsToNegotiate = transceiver.getHeaderExtensionsToNegotiate();
  extensionsToNegotiate = extensionsToNegotiate.map((extenCap) => {
    const uri = extenCap.uri;
    const enabled = forcedRtpExtensions[uri];
    if (enabled === true) {
      extenCap.direction = "sendrecv";
    } else if (enabled === false) {
      extenCap.direction = "stopped";
    }
    return extenCap;
  });
  try {
    transceiver.setHeaderExtensionsToNegotiate(extensionsToNegotiate);
  } catch (error) {
    logger8.error("applyForcedRtpExtensions() | transceiver.setHeaderExtensionsToNegotiate() failed", {
      transceiver,
      forcedRtpExtensions,
      extensionsToNegotiate,
      error
    });
    return false;
  }
  return true;
}

// ../ms/msc/src/handlers/Chrome111.ts
var logger9 = new Logger("Chrome111");
var NAME = "Chrome111";

class Chrome111 extends EnhancedEventEmitter {
  _closed = false;
  _direction;
  _sctpMaxReceiveMessageSize;
  _remoteSdp;
  _getSendExtendedRtpCapabilities;
  _forcedRtpExtensions;
  _forcedLocalDtlsRole;
  _pc;
  _mapMidTransceiver = new Map;
  _sendStream = new MediaStream;
  _hasDataChannelMediaSection = false;
  _nextSendSctpStreamId = 0;
  _transportReady = false;
  static createFactory({
    forcedRtpExtensions
  }) {
    return {
      name: NAME,
      factory: (options) => new Chrome111({ ...options, forcedRtpExtensions }),
      getNativeRtpCapabilities: async ({
        direction
      }) => {
        logger9.debug("getNativeRtpCapabilities() [direction:%o]", direction);
        let pc = new RTCPeerConnection({
          iceServers: [],
          iceTransportPolicy: "all",
          bundlePolicy: "max-bundle",
          rtcpMuxPolicy: "require"
        });
        try {
          const audioTransceiver = pc.addTransceiver("audio", { direction });
          if (forcedRtpExtensions) {
            applyForcedRtpExtensions(audioTransceiver, forcedRtpExtensions);
          }
          const videoTransceiver = pc.addTransceiver("video", {
            direction,
            sendEncodings: [{ scalabilityMode: "L3T3" }]
          });
          if (forcedRtpExtensions) {
            applyForcedRtpExtensions(videoTransceiver, forcedRtpExtensions);
          }
          const offer = await pc.createOffer();
          try {
            pc.close();
          } catch (error) {}
          pc = undefined;
          const sdpObject = exports_lib.parse(offer.sdp);
          const nativeRtpCapabilities = Chrome111.getLocalRtpCapabilities(sdpObject);
          return nativeRtpCapabilities;
        } catch (error) {
          try {
            pc?.close();
          } catch (error2) {}
          pc = undefined;
          throw error;
        }
      }
    };
  }
  static getLocalRtpCapabilities(localSdpObject) {
    const nativeRtpCapabilities = extractRtpCapabilities({
      sdpObject: localSdpObject
    });
    validateAndNormalizeRtpCapabilities(nativeRtpCapabilities);
    addNackSupportForOpus(nativeRtpCapabilities);
    return nativeRtpCapabilities;
  }
  constructor({
    direction,
    iceParameters,
    iceCandidates,
    dtlsParameters,
    sctpParameters,
    iceServers,
    iceTransportPolicy,
    additionalSettings,
    getSendExtendedRtpCapabilities,
    forcedRtpExtensions
  }) {
    super();
    logger9.debug("constructor()");
    this._direction = direction;
    this._sctpMaxReceiveMessageSize = sctpParameters?.maxSendMessageSize;
    this._remoteSdp = new RemoteSdp({
      iceParameters,
      iceCandidates,
      dtlsParameters,
      sctpParameters
    });
    this._getSendExtendedRtpCapabilities = getSendExtendedRtpCapabilities;
    this._forcedRtpExtensions = forcedRtpExtensions;
    if (dtlsParameters.role && dtlsParameters.role !== "auto") {
      this._forcedLocalDtlsRole = dtlsParameters.role === "server" ? "client" : "server";
    }
    this._pc = new RTCPeerConnection({
      iceServers: iceServers ?? [],
      iceTransportPolicy: iceTransportPolicy ?? "all",
      bundlePolicy: "max-bundle",
      rtcpMuxPolicy: "require",
      ...additionalSettings
    });
    this._pc.addEventListener("icegatheringstatechange", this.onIceGatheringStateChange);
    this._pc.addEventListener("icecandidateerror", this.onIceCandidateError);
    if (this._pc.connectionState) {
      this._pc.addEventListener("connectionstatechange", this.onConnectionStateChange);
    } else {
      logger9.warn("run() | pc.connectionState not supported, using pc.iceConnectionState");
      this._pc.addEventListener("iceconnectionstatechange", this.onIceConnectionStateChange);
    }
  }
  get name() {
    return NAME;
  }
  close() {
    logger9.debug("close()");
    if (this._closed) {
      return;
    }
    this._closed = true;
    try {
      this._pc.close();
    } catch (error) {}
    this._pc.removeEventListener("icegatheringstatechange", this.onIceGatheringStateChange);
    this._pc.removeEventListener("icecandidateerror", this.onIceCandidateError);
    this._pc.removeEventListener("connectionstatechange", this.onConnectionStateChange);
    this._pc.removeEventListener("iceconnectionstatechange", this.onIceConnectionStateChange);
    this.emit("@close");
    super.close();
  }
  async updateIceServers(iceServers) {
    this.assertNotClosed();
    logger9.debug("updateIceServers()");
    const configuration = this._pc.getConfiguration();
    configuration.iceServers = iceServers;
    this._pc.setConfiguration(configuration);
  }
  async restartIce(iceParameters) {
    this.assertNotClosed();
    logger9.debug("restartIce()");
    this._remoteSdp.updateIceParameters(iceParameters);
    if (!this._transportReady) {
      return;
    }
    if (this._direction === "send") {
      const offer = await this._pc.createOffer({ iceRestart: true });
      logger9.debug("restartIce() | calling pc.setLocalDescription() [offer:%o]", offer);
      await this._pc.setLocalDescription(offer);
      const answer = {
        type: "answer",
        sdp: this._remoteSdp.getSdp()
      };
      logger9.debug("restartIce() | calling pc.setRemoteDescription() [answer:%o]", answer);
      await this._pc.setRemoteDescription(answer);
    } else {
      const offer = {
        type: "offer",
        sdp: this._remoteSdp.getSdp()
      };
      logger9.debug("restartIce() | calling pc.setRemoteDescription() [offer:%o]", offer);
      await this._pc.setRemoteDescription(offer);
      const answer = await this._pc.createAnswer();
      logger9.debug("restartIce() | calling pc.setLocalDescription() [answer:%o]", answer);
      await this._pc.setLocalDescription(answer);
    }
  }
  async getTransportStats() {
    this.assertNotClosed();
    return this._pc.getStats();
  }
  async send({
    track,
    streamId,
    encodings,
    codecOptions,
    codec,
    onRtpSender
  }) {
    this.assertNotClosed();
    this.assertSendDirection();
    logger9.debug("send() [kind:%s, track.id:%s, streamId:%s]", track.kind, track.id, streamId);
    if (encodings && encodings.length > 1) {
      let maxTemporalLayers = 1;
      for (const encoding of encodings) {
        const temporalLayers = encoding.scalabilityMode ? parse(encoding.scalabilityMode).temporalLayers : 3;
        if (temporalLayers > maxTemporalLayers) {
          maxTemporalLayers = temporalLayers;
        }
      }
      encodings.forEach((encoding, idx) => {
        encoding.rid = `r${idx}`;
        encoding.scalabilityMode = `L1T${maxTemporalLayers}`;
      });
    }
    let transceiver;
    try {
      transceiver = this._pc.addTransceiver(track, {
        direction: "sendonly",
        streams: [this._sendStream],
        sendEncodings: encodings
      });
      const mediaSectionIdx = this._remoteSdp.getNextMediaSectionIdx();
      if (this._forcedRtpExtensions) {
        applyForcedRtpExtensions(transceiver, this._forcedRtpExtensions);
      }
      if (onRtpSender) {
        onRtpSender(transceiver.sender);
      }
      const offer = await this._pc.createOffer();
      let localSdpObject = exports_lib.parse(offer.sdp);
      if (localSdpObject.extmapAllowMixed) {
        this._remoteSdp.setSessionExtmapAllowMixed();
      }
      const nativeRtpCapabilities = Chrome111.getLocalRtpCapabilities(localSdpObject);
      const sendExtendedRtpCapabilities = this._getSendExtendedRtpCapabilities(nativeRtpCapabilities);
      const sendingRtpParameters = getSendingRtpParameters(track.kind, sendExtendedRtpCapabilities);
      sendingRtpParameters.codecs = reduceCodecs(sendingRtpParameters.codecs, codec);
      const sendingRemoteRtpParameters = getSendingRemoteRtpParameters(track.kind, sendExtendedRtpCapabilities);
      sendingRemoteRtpParameters.codecs = reduceCodecs(sendingRemoteRtpParameters.codecs, codec);
      if (!this._transportReady) {
        await this.setupTransport({
          localDtlsRole: this._forcedLocalDtlsRole ?? "client",
          localSdpObject
        });
      }
      logger9.debug("send() | calling pc.setLocalDescription() [offer:%o]", offer);
      await this._pc.setLocalDescription(offer);
      const localId = transceiver.mid;
      sendingRtpParameters.mid = localId;
      localSdpObject = exports_lib.parse(this._pc.localDescription.sdp);
      const offerMediaObject = localSdpObject.media[mediaSectionIdx.idx];
      sendingRtpParameters.rtcp.cname = getCname({
        offerMediaObject
      });
      sendingRtpParameters.msid = `${streamId ?? this._sendStream.id} ${track.id}`;
      if (!encodings) {
        sendingRtpParameters.encodings = getRtpEncodings({
          offerMediaObject,
          codecs: sendingRtpParameters.codecs
        });
      } else if (encodings.length === 1) {
        const newEncodings = getRtpEncodings({
          offerMediaObject,
          codecs: sendingRtpParameters.codecs
        });
        Object.assign(newEncodings[0], encodings[0]);
        sendingRtpParameters.encodings = newEncodings;
      } else {
        sendingRtpParameters.encodings = encodings;
      }
      this._remoteSdp.send({
        offerMediaObject,
        reuseMid: mediaSectionIdx.reuseMid,
        offerRtpParameters: sendingRtpParameters,
        answerRtpParameters: sendingRemoteRtpParameters,
        codecOptions
      });
      const answer = {
        type: "answer",
        sdp: this._remoteSdp.getSdp()
      };
      logger9.debug("send() | calling pc.setRemoteDescription() [answer:%o]", answer);
      await this._pc.setRemoteDescription(answer);
      this._mapMidTransceiver.set(localId, transceiver);
      return {
        localId,
        rtpParameters: sendingRtpParameters,
        rtpSender: transceiver.sender
      };
    } catch (error) {
      try {
        if (this._pc.signalingState === "have-local-offer") {
          try {
            await this._pc.setLocalDescription({ type: "rollback" });
          } catch (error2) {}
        }
        transceiver?.stop();
      } catch (error3) {}
      throw error;
    }
  }
  async stopSending(localId) {
    this.assertSendDirection();
    logger9.debug("stopSending() [localId:%s]", localId);
    if (this._closed) {
      return;
    }
    const transceiver = this._mapMidTransceiver.get(localId);
    if (!transceiver) {
      throw new Error("associated RTCRtpTransceiver not found");
    }
    transceiver.sender.replaceTrack(null);
    this._pc.removeTrack(transceiver.sender);
    const mediaSectionClosed = this._remoteSdp.closeMediaSection(transceiver.mid);
    if (mediaSectionClosed) {
      try {
        transceiver.stop();
      } catch (error) {}
    }
    const offer = await this._pc.createOffer();
    logger9.debug("stopSending() | calling pc.setLocalDescription() [offer:%o]", offer);
    await this._pc.setLocalDescription(offer);
    const answer = {
      type: "answer",
      sdp: this._remoteSdp.getSdp()
    };
    logger9.debug("stopSending() | calling pc.setRemoteDescription() [answer:%o]", answer);
    await this._pc.setRemoteDescription(answer);
    this._mapMidTransceiver.delete(localId);
  }
  async pauseSending(localId) {
    this.assertNotClosed();
    this.assertSendDirection();
    logger9.debug("pauseSending() [localId:%s]", localId);
    const transceiver = this._mapMidTransceiver.get(localId);
    if (!transceiver) {
      throw new Error("associated RTCRtpTransceiver not found");
    }
    transceiver.direction = "inactive";
    this._remoteSdp.pauseMediaSection(localId);
    const offer = await this._pc.createOffer();
    logger9.debug("pauseSending() | calling pc.setLocalDescription() [offer:%o]", offer);
    await this._pc.setLocalDescription(offer);
    const answer = {
      type: "answer",
      sdp: this._remoteSdp.getSdp()
    };
    logger9.debug("pauseSending() | calling pc.setRemoteDescription() [answer:%o]", answer);
    await this._pc.setRemoteDescription(answer);
  }
  async resumeSending(localId) {
    this.assertNotClosed();
    this.assertSendDirection();
    logger9.debug("resumeSending() [localId:%s]", localId);
    const transceiver = this._mapMidTransceiver.get(localId);
    this._remoteSdp.resumeSendingMediaSection(localId);
    if (!transceiver) {
      throw new Error("associated RTCRtpTransceiver not found");
    }
    transceiver.direction = "sendonly";
    const offer = await this._pc.createOffer();
    logger9.debug("resumeSending() | calling pc.setLocalDescription() [offer:%o]", offer);
    await this._pc.setLocalDescription(offer);
    const answer = {
      type: "answer",
      sdp: this._remoteSdp.getSdp()
    };
    logger9.debug("resumeSending() | calling pc.setRemoteDescription() [answer:%o]", answer);
    await this._pc.setRemoteDescription(answer);
  }
  async replaceTrack(localId, track) {
    this.assertNotClosed();
    this.assertSendDirection();
    if (track) {
      logger9.debug("replaceTrack() [localId:%s, track.id:%s]", localId, track.id);
    } else {
      logger9.debug("replaceTrack() [localId:%s, no track]", localId);
    }
    const transceiver = this._mapMidTransceiver.get(localId);
    if (!transceiver) {
      throw new Error("associated RTCRtpTransceiver not found");
    }
    await transceiver.sender.replaceTrack(track);
  }
  async setMaxSpatialLayer(localId, spatialLayer) {
    this.assertNotClosed();
    this.assertSendDirection();
    logger9.debug("setMaxSpatialLayer() [localId:%s, spatialLayer:%s]", localId, spatialLayer);
    const transceiver = this._mapMidTransceiver.get(localId);
    if (!transceiver) {
      throw new Error("associated RTCRtpTransceiver not found");
    }
    const parameters = transceiver.sender.getParameters();
    parameters.encodings.forEach((encoding, idx) => {
      if (idx <= spatialLayer) {
        encoding.active = true;
      } else {
        encoding.active = false;
      }
    });
    await transceiver.sender.setParameters(parameters);
    this._remoteSdp.muxMediaSectionSimulcast(localId, parameters.encodings);
    const offer = await this._pc.createOffer();
    logger9.debug("setMaxSpatialLayer() | calling pc.setLocalDescription() [offer:%o]", offer);
    await this._pc.setLocalDescription(offer);
    const answer = {
      type: "answer",
      sdp: this._remoteSdp.getSdp()
    };
    logger9.debug("setMaxSpatialLayer() | calling pc.setRemoteDescription() [answer:%o]", answer);
    await this._pc.setRemoteDescription(answer);
  }
  async setRtpEncodingParameters(localId, params) {
    this.assertNotClosed();
    this.assertSendDirection();
    logger9.debug("setRtpEncodingParameters() [localId:%s, params:%o]", localId, params);
    const transceiver = this._mapMidTransceiver.get(localId);
    if (!transceiver) {
      throw new Error("associated RTCRtpTransceiver not found");
    }
    const parameters = transceiver.sender.getParameters();
    parameters.encodings.forEach((encoding, idx) => {
      parameters.encodings[idx] = { ...encoding, ...params };
    });
    await transceiver.sender.setParameters(parameters);
    this._remoteSdp.muxMediaSectionSimulcast(localId, parameters.encodings);
    const offer = await this._pc.createOffer();
    logger9.debug("setRtpEncodingParameters() | calling pc.setLocalDescription() [offer:%o]", offer);
    await this._pc.setLocalDescription(offer);
    const answer = {
      type: "answer",
      sdp: this._remoteSdp.getSdp()
    };
    logger9.debug("setRtpEncodingParameters() | calling pc.setRemoteDescription() [answer:%o]", answer);
    await this._pc.setRemoteDescription(answer);
  }
  async getSenderStats(localId) {
    this.assertNotClosed();
    this.assertSendDirection();
    const transceiver = this._mapMidTransceiver.get(localId);
    if (!transceiver) {
      throw new Error("associated RTCRtpTransceiver not found");
    }
    return transceiver.sender.getStats();
  }
  async sendDataChannel({
    sctpStreamParameters
  }) {
    this.assertNotClosed();
    this.assertSendDirection();
    const options = {
      negotiated: true,
      id: this._nextSendSctpStreamId,
      ordered: sctpStreamParameters.ordered,
      maxPacketLifeTime: sctpStreamParameters.maxPacketLifeTime,
      maxRetransmits: sctpStreamParameters.maxRetransmits,
      protocol: sctpStreamParameters.protocol
    };
    logger9.debug("sendDataChannel() [options:%o]", options);
    const dataChannel = this._pc.createDataChannel(sctpStreamParameters.label, options);
    this._nextSendSctpStreamId = ++this._nextSendSctpStreamId % (this._pc.sctp?.maxChannels ?? 65536);
    if (!this._hasDataChannelMediaSection) {
      try {
        const offer = await this._pc.createOffer();
        const localSdpObject = exports_lib.parse(offer.sdp);
        const offerMediaObject = localSdpObject.media.find((m) => m.type === "application");
        if (!this._transportReady) {
          await this.setupTransport({
            localDtlsRole: this._forcedLocalDtlsRole ?? "client",
            localSdpObject
          });
        }
        logger9.debug("sendDataChannel() | calling pc.setLocalDescription() [offer:%o]", offer);
        await this._pc.setLocalDescription(offer);
        this._remoteSdp.sendSctpAssociation({ offerMediaObject });
        const answer = {
          type: "answer",
          sdp: this._remoteSdp.getSdp()
        };
        logger9.debug("sendDataChannel() | calling pc.setRemoteDescription() [answer:%o]", answer);
        await this._pc.setRemoteDescription(answer);
        this._hasDataChannelMediaSection = true;
      } catch (error) {
        try {
          if (this._pc.signalingState === "have-local-offer") {
            try {
              await this._pc.setLocalDescription({ type: "rollback" });
            } catch (error2) {}
          }
          dataChannel.close();
        } catch (error3) {}
        throw error;
      }
    }
    const newSctpStreamParameters = {
      streamId: options.id,
      ordered: options.ordered,
      maxPacketLifeTime: options.maxPacketLifeTime,
      maxRetransmits: options.maxRetransmits
    };
    return { dataChannel, sctpStreamParameters: newSctpStreamParameters };
  }
  async receive(optionsList) {
    this.assertNotClosed();
    this.assertRecvDirection();
    const results = [];
    const mapLocalId = new Map;
    for (const options of optionsList) {
      const { trackId, kind, rtpParameters, streamId } = options;
      logger9.debug("receive() [trackId:%s, kind:%s]", trackId, kind);
      const localId = rtpParameters.mid ?? String(this._mapMidTransceiver.size);
      mapLocalId.set(trackId, localId);
      const { msidStreamId } = getMsidStreamIdAndTrackId(rtpParameters.msid);
      this._remoteSdp.receive({
        mid: localId,
        kind,
        offerRtpParameters: rtpParameters,
        streamId: streamId ?? msidStreamId ?? rtpParameters.rtcp?.cname ?? "-",
        trackId
      });
    }
    const offer = {
      type: "offer",
      sdp: this._remoteSdp.getSdp()
    };
    logger9.debug("receive() | calling pc.setRemoteDescription() [offer:%o]", offer);
    await this._pc.setRemoteDescription(offer);
    for (const options of optionsList) {
      const { trackId, onRtpReceiver } = options;
      if (onRtpReceiver) {
        const localId = mapLocalId.get(trackId);
        const transceiver = this._pc.getTransceivers().find((t) => t.mid === localId);
        if (!transceiver) {
          throw new Error("transceiver not found");
        }
        if (this._forcedRtpExtensions) {
          applyForcedRtpExtensions(transceiver, this._forcedRtpExtensions);
        }
        onRtpReceiver(transceiver.receiver);
      }
    }
    let answer = await this._pc.createAnswer();
    const localSdpObject = exports_lib.parse(answer.sdp);
    for (const options of optionsList) {
      const { trackId, rtpParameters } = options;
      const localId = mapLocalId.get(trackId);
      const answerMediaObject = localSdpObject.media.find((m) => String(m.mid) === localId);
      applyCodecParameters({
        offerRtpParameters: rtpParameters,
        answerMediaObject
      });
    }
    answer = {
      type: "answer",
      sdp: exports_lib.write(localSdpObject)
    };
    if (!this._transportReady) {
      await this.setupTransport({
        localDtlsRole: this._forcedLocalDtlsRole ?? "client",
        localSdpObject
      });
    }
    logger9.debug("receive() | calling pc.setLocalDescription() [answer:%o]", answer);
    await this._pc.setLocalDescription(answer);
    for (const options of optionsList) {
      const { trackId } = options;
      const localId = mapLocalId.get(trackId);
      const transceiver = this._pc.getTransceivers().find((t) => t.mid === localId);
      if (!transceiver) {
        throw new Error("new RTCRtpTransceiver not found");
      } else {
        this._mapMidTransceiver.set(localId, transceiver);
        results.push({
          localId,
          track: transceiver.receiver.track,
          rtpReceiver: transceiver.receiver
        });
      }
    }
    return results;
  }
  async stopReceiving(localIds) {
    this.assertRecvDirection();
    if (this._closed) {
      return;
    }
    for (const localId of localIds) {
      logger9.debug("stopReceiving() [localId:%s]", localId);
      const transceiver = this._mapMidTransceiver.get(localId);
      if (!transceiver) {
        throw new Error("associated RTCRtpTransceiver not found");
      }
      this._remoteSdp.closeMediaSection(transceiver.mid);
    }
    const offer = {
      type: "offer",
      sdp: this._remoteSdp.getSdp()
    };
    logger9.debug("stopReceiving() | calling pc.setRemoteDescription() [offer:%o]", offer);
    await this._pc.setRemoteDescription(offer);
    const answer = await this._pc.createAnswer();
    logger9.debug("stopReceiving() | calling pc.setLocalDescription() [answer:%o]", answer);
    await this._pc.setLocalDescription(answer);
    for (const localId of localIds) {
      this._mapMidTransceiver.delete(localId);
    }
  }
  async pauseReceiving(localIds) {
    this.assertNotClosed();
    this.assertRecvDirection();
    for (const localId of localIds) {
      logger9.debug("pauseReceiving() [localId:%s]", localId);
      const transceiver = this._mapMidTransceiver.get(localId);
      if (!transceiver) {
        throw new Error("associated RTCRtpTransceiver not found");
      }
      transceiver.direction = "inactive";
      this._remoteSdp.pauseMediaSection(localId);
    }
    const offer = {
      type: "offer",
      sdp: this._remoteSdp.getSdp()
    };
    logger9.debug("pauseReceiving() | calling pc.setRemoteDescription() [offer:%o]", offer);
    await this._pc.setRemoteDescription(offer);
    const answer = await this._pc.createAnswer();
    logger9.debug("pauseReceiving() | calling pc.setLocalDescription() [answer:%o]", answer);
    await this._pc.setLocalDescription(answer);
  }
  async resumeReceiving(localIds) {
    this.assertNotClosed();
    this.assertRecvDirection();
    for (const localId of localIds) {
      logger9.debug("resumeReceiving() [localId:%s]", localId);
      const transceiver = this._mapMidTransceiver.get(localId);
      if (!transceiver) {
        throw new Error("associated RTCRtpTransceiver not found");
      }
      transceiver.direction = "recvonly";
      this._remoteSdp.resumeReceivingMediaSection(localId);
    }
    const offer = {
      type: "offer",
      sdp: this._remoteSdp.getSdp()
    };
    logger9.debug("resumeReceiving() | calling pc.setRemoteDescription() [offer:%o]", offer);
    await this._pc.setRemoteDescription(offer);
    const answer = await this._pc.createAnswer();
    logger9.debug("resumeReceiving() | calling pc.setLocalDescription() [answer:%o]", answer);
    await this._pc.setLocalDescription(answer);
  }
  async getReceiverStats(localId) {
    this.assertNotClosed();
    this.assertRecvDirection();
    const transceiver = this._mapMidTransceiver.get(localId);
    if (!transceiver) {
      throw new Error("associated RTCRtpTransceiver not found");
    }
    return transceiver.receiver.getStats();
  }
  async receiveDataChannel({
    maxMessageSize,
    sctpStreamParameters,
    label,
    protocol
  }) {
    this.assertNotClosed();
    this.assertRecvDirection();
    const {
      streamId,
      ordered,
      maxPacketLifeTime,
      maxRetransmits
    } = sctpStreamParameters;
    const options = {
      negotiated: true,
      id: streamId,
      ordered,
      maxPacketLifeTime,
      maxRetransmits,
      protocol
    };
    logger9.debug("receiveDataChannel() [options:%o]", options);
    const dataChannel = this._pc.createDataChannel(label, options);
    if (!this._hasDataChannelMediaSection) {
      this._remoteSdp.receiveSctpAssociation();
      const offer = {
        type: "offer",
        sdp: this._remoteSdp.getSdp()
      };
      logger9.debug("receiveDataChannel() | calling pc.setRemoteDescription() [offer:%o]", offer);
      await this._pc.setRemoteDescription(offer);
      let answer = await this._pc.createAnswer();
      const localSdpObject = exports_lib.parse(answer.sdp);
      const answerMediaObject = localSdpObject.media.find((m) => m.type === "application");
      if (typeof maxMessageSize === "number") {
        answerMediaObject.maxMessageSize = maxMessageSize;
      }
      if (!this._transportReady) {
        await this.setupTransport({
          localDtlsRole: this._forcedLocalDtlsRole ?? "client",
          localSdpObject
        });
      }
      answer = {
        type: "answer",
        sdp: exports_lib.write(localSdpObject)
      };
      logger9.debug("receiveDataChannel() | calling pc.setLocalDescription() [answer:%o]", answer);
      await this._pc.setLocalDescription(answer);
      this._hasDataChannelMediaSection = true;
    }
    return { dataChannel };
  }
  getDataChannelMaxMessageSize() {
    return this._direction === "send" ? this._pc.sctp?.maxMessageSize : this._sctpMaxReceiveMessageSize;
  }
  async setupTransport({
    localDtlsRole,
    localSdpObject
  }) {
    if (!localSdpObject) {
      localSdpObject = exports_lib.parse(this._pc.localDescription.sdp);
    }
    const dtlsParameters = extractDtlsParameters({
      sdpObject: localSdpObject
    });
    dtlsParameters.role = localDtlsRole;
    this._remoteSdp.updateDtlsRole(localDtlsRole === "client" ? "server" : "client");
    await new Promise((resolve, reject) => {
      this.safeEmit("@connect", { dtlsParameters }, resolve, reject);
    });
    this._transportReady = true;
  }
  onIceGatheringStateChange = () => {
    this.emit("@icegatheringstatechange", this._pc.iceGatheringState);
  };
  onIceCandidateError = (event) => {
    this.emit("@icecandidateerror", event);
  };
  onConnectionStateChange = () => {
    this.emit("@connectionstatechange", this._pc.connectionState);
  };
  onIceConnectionStateChange = () => {
    switch (this._pc.iceConnectionState) {
      case "checking": {
        this.emit("@connectionstatechange", "connecting");
        break;
      }
      case "connected":
      case "completed": {
        this.emit("@connectionstatechange", "connected");
        break;
      }
      case "failed": {
        this.emit("@connectionstatechange", "failed");
        break;
      }
      case "disconnected": {
        this.emit("@connectionstatechange", "disconnected");
        break;
      }
      case "closed": {
        this.emit("@connectionstatechange", "closed");
        break;
      }
    }
  };
  assertNotClosed() {
    if (this._closed) {
      throw new InvalidStateError("method called in a closed handler");
    }
  }
  assertSendDirection() {
    if (this._direction !== "send") {
      throw new Error('method can just be called for handlers with "send" direction');
    }
  }
  assertRecvDirection() {
    if (this._direction !== "recv") {
      throw new Error('method can just be called for handlers with "recv" direction');
    }
  }
}

// ../ms/msc/src/handlers/Chrome74.ts
var logger10 = new Logger("Chrome74");
var NAME2 = "Chrome74";

class Chrome74 extends EnhancedEventEmitter {
  _closed = false;
  _direction;
  _sctpMaxReceiveMessageSize;
  _remoteSdp;
  _getSendExtendedRtpCapabilities;
  _forcedRtpExtensions;
  _forcedLocalDtlsRole;
  _pc;
  _mapMidTransceiver = new Map;
  _sendStream = new MediaStream;
  _hasDataChannelMediaSection = false;
  _nextSendSctpStreamId = 0;
  _transportReady = false;
  static createFactory({
    forcedRtpExtensions
  }) {
    return {
      name: NAME2,
      factory: (options) => new Chrome74({ ...options, forcedRtpExtensions }),
      getNativeRtpCapabilities: async ({
        direction
      }) => {
        logger10.debug("getNativeRtpCapabilities() [direction:%o]", direction);
        let pc = new RTCPeerConnection({
          iceServers: [],
          iceTransportPolicy: "all",
          bundlePolicy: "max-bundle",
          rtcpMuxPolicy: "require"
        });
        try {
          const audioTransceiver = pc.addTransceiver("audio", { direction });
          if (forcedRtpExtensions) {
            applyForcedRtpExtensions(audioTransceiver, forcedRtpExtensions);
          }
          const videoTransceiver = pc.addTransceiver("video", { direction });
          if (forcedRtpExtensions) {
            applyForcedRtpExtensions(videoTransceiver, forcedRtpExtensions);
          }
          const offer = await pc.createOffer();
          try {
            pc.close();
          } catch (error) {}
          pc = undefined;
          const sdpObject = exports_lib.parse(offer.sdp);
          const nativeRtpCapabilities = Chrome74.getLocalRtpCapabilities(sdpObject);
          return nativeRtpCapabilities;
        } catch (error) {
          try {
            pc?.close();
          } catch (error2) {}
          pc = undefined;
          throw error;
        }
      }
    };
  }
  static getLocalRtpCapabilities(localSdpObject) {
    const nativeRtpCapabilities = extractRtpCapabilities({
      sdpObject: localSdpObject
    });
    validateAndNormalizeRtpCapabilities(nativeRtpCapabilities);
    addNackSupportForOpus(nativeRtpCapabilities);
    return nativeRtpCapabilities;
  }
  constructor({
    direction,
    iceParameters,
    iceCandidates,
    dtlsParameters,
    sctpParameters,
    iceServers,
    iceTransportPolicy,
    additionalSettings,
    getSendExtendedRtpCapabilities,
    forcedRtpExtensions
  }) {
    super();
    logger10.debug("constructor()");
    this._direction = direction;
    this._sctpMaxReceiveMessageSize = sctpParameters?.maxSendMessageSize;
    this._remoteSdp = new RemoteSdp({
      iceParameters,
      iceCandidates,
      dtlsParameters,
      sctpParameters
    });
    this._getSendExtendedRtpCapabilities = getSendExtendedRtpCapabilities;
    this._forcedRtpExtensions = forcedRtpExtensions;
    if (dtlsParameters.role && dtlsParameters.role !== "auto") {
      this._forcedLocalDtlsRole = dtlsParameters.role === "server" ? "client" : "server";
    }
    this._pc = new RTCPeerConnection({
      iceServers: iceServers ?? [],
      iceTransportPolicy: iceTransportPolicy ?? "all",
      bundlePolicy: "max-bundle",
      rtcpMuxPolicy: "require",
      ...additionalSettings
    });
    this._pc.addEventListener("icegatheringstatechange", this.onIceGatheringStateChange);
    this._pc.addEventListener("icecandidateerror", this.onIceCandidateError);
    if (this._pc.connectionState) {
      this._pc.addEventListener("connectionstatechange", this.onConnectionStateChange);
    } else {
      logger10.warn("run() | pc.connectionState not supported, using pc.iceConnectionState");
      this._pc.addEventListener("iceconnectionstatechange", this.onIceConnectionStateChange);
    }
  }
  get name() {
    return NAME2;
  }
  close() {
    logger10.debug("close()");
    if (this._closed) {
      return;
    }
    this._closed = true;
    try {
      this._pc.close();
    } catch (error) {}
    this._pc.removeEventListener("icegatheringstatechange", this.onIceGatheringStateChange);
    this._pc.removeEventListener("icecandidateerror", this.onIceCandidateError);
    this._pc.removeEventListener("connectionstatechange", this.onConnectionStateChange);
    this._pc.removeEventListener("iceconnectionstatechange", this.onIceConnectionStateChange);
    this.emit("@close");
    super.close();
  }
  async updateIceServers(iceServers) {
    this.assertNotClosed();
    logger10.debug("updateIceServers()");
    const configuration = this._pc.getConfiguration();
    configuration.iceServers = iceServers;
    this._pc.setConfiguration(configuration);
  }
  async restartIce(iceParameters) {
    this.assertNotClosed();
    logger10.debug("restartIce()");
    this._remoteSdp.updateIceParameters(iceParameters);
    if (!this._transportReady) {
      return;
    }
    if (this._direction === "send") {
      const offer = await this._pc.createOffer({ iceRestart: true });
      logger10.debug("restartIce() | calling pc.setLocalDescription() [offer:%o]", offer);
      await this._pc.setLocalDescription(offer);
      const answer = {
        type: "answer",
        sdp: this._remoteSdp.getSdp()
      };
      logger10.debug("restartIce() | calling pc.setRemoteDescription() [answer:%o]", answer);
      await this._pc.setRemoteDescription(answer);
    } else {
      const offer = {
        type: "offer",
        sdp: this._remoteSdp.getSdp()
      };
      logger10.debug("restartIce() | calling pc.setRemoteDescription() [offer:%o]", offer);
      await this._pc.setRemoteDescription(offer);
      const answer = await this._pc.createAnswer();
      logger10.debug("restartIce() | calling pc.setLocalDescription() [answer:%o]", answer);
      await this._pc.setLocalDescription(answer);
    }
  }
  async getTransportStats() {
    this.assertNotClosed();
    return this._pc.getStats();
  }
  async send({
    track,
    streamId,
    encodings,
    codecOptions,
    codec,
    onRtpSender
  }) {
    this.assertNotClosed();
    this.assertSendDirection();
    logger10.debug("send() [kind:%s, track.id:%s, streamId:%s]", track.kind, track.id, streamId);
    if (encodings && encodings.length > 1) {
      encodings.forEach((encoding, idx) => {
        encoding.rid = `r${idx}`;
      });
    }
    let transceiver;
    try {
      transceiver = this._pc.addTransceiver(track, {
        direction: "sendonly",
        streams: [this._sendStream],
        sendEncodings: encodings
      });
      const mediaSectionIdx = this._remoteSdp.getNextMediaSectionIdx();
      if (this._forcedRtpExtensions) {
        applyForcedRtpExtensions(transceiver, this._forcedRtpExtensions);
      }
      if (onRtpSender) {
        onRtpSender(transceiver.sender);
      }
      let offer = await this._pc.createOffer();
      let localSdpObject = exports_lib.parse(offer.sdp);
      if (localSdpObject.extmapAllowMixed) {
        this._remoteSdp.setSessionExtmapAllowMixed();
      }
      const nativeRtpCapabilities = Chrome74.getLocalRtpCapabilities(localSdpObject);
      const sendExtendedRtpCapabilities = this._getSendExtendedRtpCapabilities(nativeRtpCapabilities);
      const sendingRtpParameters = getSendingRtpParameters(track.kind, sendExtendedRtpCapabilities);
      sendingRtpParameters.codecs = reduceCodecs(sendingRtpParameters.codecs, codec);
      const sendingRemoteRtpParameters = getSendingRemoteRtpParameters(track.kind, sendExtendedRtpCapabilities);
      sendingRemoteRtpParameters.codecs = reduceCodecs(sendingRemoteRtpParameters.codecs, codec);
      if (!this._transportReady) {
        await this.setupTransport({
          localDtlsRole: this._forcedLocalDtlsRole ?? "client",
          localSdpObject
        });
      }
      let hackVp9Svc = false;
      const layers = parse((encodings ?? [{}])[0].scalabilityMode);
      let offerMediaObject;
      if (encodings?.length === 1 && layers.spatialLayers > 1 && sendingRtpParameters.codecs[0].mimeType.toLowerCase() === "video/vp9") {
        logger10.debug("send() | enabling legacy simulcast for VP9 SVC");
        hackVp9Svc = true;
        localSdpObject = exports_lib.parse(offer.sdp);
        offerMediaObject = localSdpObject.media[mediaSectionIdx.idx];
        addLegacySimulcast({
          offerMediaObject,
          numStreams: layers.spatialLayers
        });
        offer = {
          type: "offer",
          sdp: exports_lib.write(localSdpObject)
        };
      }
      logger10.debug("send() | calling pc.setLocalDescription() [offer:%o]", offer);
      await this._pc.setLocalDescription(offer);
      const localId = transceiver.mid;
      sendingRtpParameters.mid = localId;
      localSdpObject = exports_lib.parse(this._pc.localDescription.sdp);
      offerMediaObject = localSdpObject.media[mediaSectionIdx.idx];
      sendingRtpParameters.rtcp.cname = getCname({
        offerMediaObject
      });
      sendingRtpParameters.msid = `${streamId ?? this._sendStream.id} ${track.id}`;
      if (!encodings) {
        sendingRtpParameters.encodings = getRtpEncodings({
          offerMediaObject,
          codecs: sendingRtpParameters.codecs
        });
      } else if (encodings.length === 1) {
        let newEncodings = getRtpEncodings({
          offerMediaObject,
          codecs: sendingRtpParameters.codecs
        });
        Object.assign(newEncodings[0], encodings[0]);
        if (hackVp9Svc) {
          newEncodings = [newEncodings[0]];
        }
        sendingRtpParameters.encodings = newEncodings;
      } else {
        sendingRtpParameters.encodings = encodings;
      }
      if (sendingRtpParameters.encodings.length > 1 && (sendingRtpParameters.codecs[0].mimeType.toLowerCase() === "video/vp8" || sendingRtpParameters.codecs[0].mimeType.toLowerCase() === "video/h264")) {
        for (const encoding of sendingRtpParameters.encodings) {
          if (encoding.scalabilityMode) {
            encoding.scalabilityMode = `L1T${layers.temporalLayers}`;
          } else {
            encoding.scalabilityMode = "L1T3";
          }
        }
      }
      this._remoteSdp.send({
        offerMediaObject,
        reuseMid: mediaSectionIdx.reuseMid,
        offerRtpParameters: sendingRtpParameters,
        answerRtpParameters: sendingRemoteRtpParameters,
        codecOptions
      });
      const answer = {
        type: "answer",
        sdp: this._remoteSdp.getSdp()
      };
      logger10.debug("send() | calling pc.setRemoteDescription() [answer:%o]", answer);
      await this._pc.setRemoteDescription(answer);
      this._mapMidTransceiver.set(localId, transceiver);
      return {
        localId,
        rtpParameters: sendingRtpParameters,
        rtpSender: transceiver.sender
      };
    } catch (error) {
      try {
        if (this._pc.signalingState === "have-local-offer") {
          try {
            await this._pc.setLocalDescription({ type: "rollback" });
          } catch (error2) {}
        }
        transceiver?.stop();
      } catch (error3) {}
      throw error;
    }
  }
  async stopSending(localId) {
    this.assertSendDirection();
    logger10.debug("stopSending() [localId:%s]", localId);
    if (this._closed) {
      return;
    }
    const transceiver = this._mapMidTransceiver.get(localId);
    if (!transceiver) {
      throw new Error("associated RTCRtpTransceiver not found");
    }
    transceiver.sender.replaceTrack(null);
    this._pc.removeTrack(transceiver.sender);
    const mediaSectionClosed = this._remoteSdp.closeMediaSection(transceiver.mid);
    if (mediaSectionClosed) {
      try {
        transceiver.stop();
      } catch (error) {}
    }
    const offer = await this._pc.createOffer();
    logger10.debug("stopSending() | calling pc.setLocalDescription() [offer:%o]", offer);
    await this._pc.setLocalDescription(offer);
    const answer = {
      type: "answer",
      sdp: this._remoteSdp.getSdp()
    };
    logger10.debug("stopSending() | calling pc.setRemoteDescription() [answer:%o]", answer);
    await this._pc.setRemoteDescription(answer);
    this._mapMidTransceiver.delete(localId);
  }
  async pauseSending(localId) {
    this.assertNotClosed();
    this.assertSendDirection();
    logger10.debug("pauseSending() [localId:%s]", localId);
    const transceiver = this._mapMidTransceiver.get(localId);
    if (!transceiver) {
      throw new Error("associated RTCRtpTransceiver not found");
    }
    transceiver.direction = "inactive";
    this._remoteSdp.pauseMediaSection(localId);
    const offer = await this._pc.createOffer();
    logger10.debug("pauseSending() | calling pc.setLocalDescription() [offer:%o]", offer);
    await this._pc.setLocalDescription(offer);
    const answer = {
      type: "answer",
      sdp: this._remoteSdp.getSdp()
    };
    logger10.debug("pauseSending() | calling pc.setRemoteDescription() [answer:%o]", answer);
    await this._pc.setRemoteDescription(answer);
  }
  async resumeSending(localId) {
    this.assertNotClosed();
    this.assertSendDirection();
    logger10.debug("resumeSending() [localId:%s]", localId);
    const transceiver = this._mapMidTransceiver.get(localId);
    this._remoteSdp.resumeSendingMediaSection(localId);
    if (!transceiver) {
      throw new Error("associated RTCRtpTransceiver not found");
    }
    transceiver.direction = "sendonly";
    const offer = await this._pc.createOffer();
    logger10.debug("resumeSending() | calling pc.setLocalDescription() [offer:%o]", offer);
    await this._pc.setLocalDescription(offer);
    const answer = {
      type: "answer",
      sdp: this._remoteSdp.getSdp()
    };
    logger10.debug("resumeSending() | calling pc.setRemoteDescription() [answer:%o]", answer);
    await this._pc.setRemoteDescription(answer);
  }
  async replaceTrack(localId, track) {
    this.assertNotClosed();
    this.assertSendDirection();
    if (track) {
      logger10.debug("replaceTrack() [localId:%s, track.id:%s]", localId, track.id);
    } else {
      logger10.debug("replaceTrack() [localId:%s, no track]", localId);
    }
    const transceiver = this._mapMidTransceiver.get(localId);
    if (!transceiver) {
      throw new Error("associated RTCRtpTransceiver not found");
    }
    await transceiver.sender.replaceTrack(track);
  }
  async setMaxSpatialLayer(localId, spatialLayer) {
    this.assertNotClosed();
    this.assertSendDirection();
    logger10.debug("setMaxSpatialLayer() [localId:%s, spatialLayer:%s]", localId, spatialLayer);
    const transceiver = this._mapMidTransceiver.get(localId);
    if (!transceiver) {
      throw new Error("associated RTCRtpTransceiver not found");
    }
    const parameters = transceiver.sender.getParameters();
    parameters.encodings.forEach((encoding, idx) => {
      if (idx <= spatialLayer) {
        encoding.active = true;
      } else {
        encoding.active = false;
      }
    });
    await transceiver.sender.setParameters(parameters);
    this._remoteSdp.muxMediaSectionSimulcast(localId, parameters.encodings);
    const offer = await this._pc.createOffer();
    logger10.debug("setMaxSpatialLayer() | calling pc.setLocalDescription() [offer:%o]", offer);
    await this._pc.setLocalDescription(offer);
    const answer = {
      type: "answer",
      sdp: this._remoteSdp.getSdp()
    };
    logger10.debug("setMaxSpatialLayer() | calling pc.setRemoteDescription() [answer:%o]", answer);
    await this._pc.setRemoteDescription(answer);
  }
  async setRtpEncodingParameters(localId, params) {
    this.assertNotClosed();
    this.assertSendDirection();
    logger10.debug("setRtpEncodingParameters() [localId:%s, params:%o]", localId, params);
    const transceiver = this._mapMidTransceiver.get(localId);
    if (!transceiver) {
      throw new Error("associated RTCRtpTransceiver not found");
    }
    const parameters = transceiver.sender.getParameters();
    parameters.encodings.forEach((encoding, idx) => {
      parameters.encodings[idx] = { ...encoding, ...params };
    });
    await transceiver.sender.setParameters(parameters);
    this._remoteSdp.muxMediaSectionSimulcast(localId, parameters.encodings);
    const offer = await this._pc.createOffer();
    logger10.debug("setRtpEncodingParameters() | calling pc.setLocalDescription() [offer:%o]", offer);
    await this._pc.setLocalDescription(offer);
    const answer = {
      type: "answer",
      sdp: this._remoteSdp.getSdp()
    };
    logger10.debug("setRtpEncodingParameters() | calling pc.setRemoteDescription() [answer:%o]", answer);
    await this._pc.setRemoteDescription(answer);
  }
  async getSenderStats(localId) {
    this.assertNotClosed();
    this.assertSendDirection();
    const transceiver = this._mapMidTransceiver.get(localId);
    if (!transceiver) {
      throw new Error("associated RTCRtpTransceiver not found");
    }
    return transceiver.sender.getStats();
  }
  async sendDataChannel({
    sctpStreamParameters
  }) {
    this.assertNotClosed();
    this.assertSendDirection();
    const options = {
      negotiated: true,
      id: this._nextSendSctpStreamId,
      ordered: sctpStreamParameters.ordered,
      maxPacketLifeTime: sctpStreamParameters.maxPacketLifeTime,
      maxRetransmits: sctpStreamParameters.maxRetransmits,
      protocol: sctpStreamParameters.protocol
    };
    logger10.debug("sendDataChannel() [options:%o]", options);
    const dataChannel = this._pc.createDataChannel(sctpStreamParameters.label, options);
    this._nextSendSctpStreamId = ++this._nextSendSctpStreamId % (this._pc.sctp?.maxChannels ?? 65536);
    if (!this._hasDataChannelMediaSection) {
      try {
        const offer = await this._pc.createOffer();
        const localSdpObject = exports_lib.parse(offer.sdp);
        const offerMediaObject = localSdpObject.media.find((m) => m.type === "application");
        if (!this._transportReady) {
          await this.setupTransport({
            localDtlsRole: this._forcedLocalDtlsRole ?? "client",
            localSdpObject
          });
        }
        logger10.debug("sendDataChannel() | calling pc.setLocalDescription() [offer:%o]", offer);
        await this._pc.setLocalDescription(offer);
        this._remoteSdp.sendSctpAssociation({ offerMediaObject });
        const answer = {
          type: "answer",
          sdp: this._remoteSdp.getSdp()
        };
        logger10.debug("sendDataChannel() | calling pc.setRemoteDescription() [answer:%o]", answer);
        await this._pc.setRemoteDescription(answer);
        this._hasDataChannelMediaSection = true;
      } catch (error) {
        try {
          if (this._pc.signalingState === "have-local-offer") {
            try {
              await this._pc.setLocalDescription({ type: "rollback" });
            } catch (error2) {}
          }
          dataChannel.close();
        } catch (error3) {}
        throw error;
      }
    }
    const newSctpStreamParameters = {
      streamId: options.id,
      ordered: options.ordered,
      maxPacketLifeTime: options.maxPacketLifeTime,
      maxRetransmits: options.maxRetransmits
    };
    return { dataChannel, sctpStreamParameters: newSctpStreamParameters };
  }
  async receive(optionsList) {
    this.assertNotClosed();
    this.assertRecvDirection();
    const results = [];
    const mapLocalId = new Map;
    for (const options of optionsList) {
      const { trackId, kind, rtpParameters, streamId } = options;
      logger10.debug("receive() [trackId:%s, kind:%s]", trackId, kind);
      const localId = rtpParameters.mid ?? String(this._mapMidTransceiver.size);
      mapLocalId.set(trackId, localId);
      const { msidStreamId } = getMsidStreamIdAndTrackId(rtpParameters.msid);
      this._remoteSdp.receive({
        mid: localId,
        kind,
        offerRtpParameters: rtpParameters,
        streamId: streamId ?? msidStreamId ?? rtpParameters.rtcp?.cname ?? "-",
        trackId
      });
    }
    const offer = {
      type: "offer",
      sdp: this._remoteSdp.getSdp()
    };
    logger10.debug("receive() | calling pc.setRemoteDescription() [offer:%o]", offer);
    await this._pc.setRemoteDescription(offer);
    for (const options of optionsList) {
      const { trackId, onRtpReceiver } = options;
      if (onRtpReceiver) {
        const localId = mapLocalId.get(trackId);
        const transceiver = this._pc.getTransceivers().find((t) => t.mid === localId);
        if (!transceiver) {
          throw new Error("transceiver not found");
        }
        if (this._forcedRtpExtensions) {
          applyForcedRtpExtensions(transceiver, this._forcedRtpExtensions);
        }
        onRtpReceiver(transceiver.receiver);
      }
    }
    let answer = await this._pc.createAnswer();
    const localSdpObject = exports_lib.parse(answer.sdp);
    for (const options of optionsList) {
      const { trackId, rtpParameters } = options;
      const localId = mapLocalId.get(trackId);
      const answerMediaObject = localSdpObject.media.find((m) => String(m.mid) === localId);
      applyCodecParameters({
        offerRtpParameters: rtpParameters,
        answerMediaObject
      });
    }
    answer = {
      type: "answer",
      sdp: exports_lib.write(localSdpObject)
    };
    if (!this._transportReady) {
      await this.setupTransport({
        localDtlsRole: this._forcedLocalDtlsRole ?? "client",
        localSdpObject
      });
    }
    logger10.debug("receive() | calling pc.setLocalDescription() [answer:%o]", answer);
    await this._pc.setLocalDescription(answer);
    for (const options of optionsList) {
      const { trackId } = options;
      const localId = mapLocalId.get(trackId);
      const transceiver = this._pc.getTransceivers().find((t) => t.mid === localId);
      if (!transceiver) {
        throw new Error("new RTCRtpTransceiver not found");
      } else {
        this._mapMidTransceiver.set(localId, transceiver);
        results.push({
          localId,
          track: transceiver.receiver.track,
          rtpReceiver: transceiver.receiver
        });
      }
    }
    return results;
  }
  async stopReceiving(localIds) {
    this.assertRecvDirection();
    if (this._closed) {
      return;
    }
    for (const localId of localIds) {
      logger10.debug("stopReceiving() [localId:%s]", localId);
      const transceiver = this._mapMidTransceiver.get(localId);
      if (!transceiver) {
        throw new Error("associated RTCRtpTransceiver not found");
      }
      this._remoteSdp.closeMediaSection(transceiver.mid);
    }
    const offer = {
      type: "offer",
      sdp: this._remoteSdp.getSdp()
    };
    logger10.debug("stopReceiving() | calling pc.setRemoteDescription() [offer:%o]", offer);
    await this._pc.setRemoteDescription(offer);
    const answer = await this._pc.createAnswer();
    logger10.debug("stopReceiving() | calling pc.setLocalDescription() [answer:%o]", answer);
    await this._pc.setLocalDescription(answer);
    for (const localId of localIds) {
      this._mapMidTransceiver.delete(localId);
    }
  }
  async pauseReceiving(localIds) {
    this.assertNotClosed();
    this.assertRecvDirection();
    for (const localId of localIds) {
      logger10.debug("pauseReceiving() [localId:%s]", localId);
      const transceiver = this._mapMidTransceiver.get(localId);
      if (!transceiver) {
        throw new Error("associated RTCRtpTransceiver not found");
      }
      transceiver.direction = "inactive";
      this._remoteSdp.pauseMediaSection(localId);
    }
    const offer = {
      type: "offer",
      sdp: this._remoteSdp.getSdp()
    };
    logger10.debug("pauseReceiving() | calling pc.setRemoteDescription() [offer:%o]", offer);
    await this._pc.setRemoteDescription(offer);
    const answer = await this._pc.createAnswer();
    logger10.debug("pauseReceiving() | calling pc.setLocalDescription() [answer:%o]", answer);
    await this._pc.setLocalDescription(answer);
  }
  async resumeReceiving(localIds) {
    this.assertNotClosed();
    this.assertRecvDirection();
    for (const localId of localIds) {
      logger10.debug("resumeReceiving() [localId:%s]", localId);
      const transceiver = this._mapMidTransceiver.get(localId);
      if (!transceiver) {
        throw new Error("associated RTCRtpTransceiver not found");
      }
      transceiver.direction = "recvonly";
      this._remoteSdp.resumeReceivingMediaSection(localId);
    }
    const offer = {
      type: "offer",
      sdp: this._remoteSdp.getSdp()
    };
    logger10.debug("resumeReceiving() | calling pc.setRemoteDescription() [offer:%o]", offer);
    await this._pc.setRemoteDescription(offer);
    const answer = await this._pc.createAnswer();
    logger10.debug("resumeReceiving() | calling pc.setLocalDescription() [answer:%o]", answer);
    await this._pc.setLocalDescription(answer);
  }
  async getReceiverStats(localId) {
    this.assertNotClosed();
    this.assertRecvDirection();
    const transceiver = this._mapMidTransceiver.get(localId);
    if (!transceiver) {
      throw new Error("associated RTCRtpTransceiver not found");
    }
    return transceiver.receiver.getStats();
  }
  async receiveDataChannel({
    maxMessageSize,
    sctpStreamParameters,
    label,
    protocol
  }) {
    this.assertNotClosed();
    this.assertRecvDirection();
    const {
      streamId,
      ordered,
      maxPacketLifeTime,
      maxRetransmits
    } = sctpStreamParameters;
    const options = {
      negotiated: true,
      id: streamId,
      ordered,
      maxPacketLifeTime,
      maxRetransmits,
      protocol
    };
    logger10.debug("receiveDataChannel() [options:%o]", options);
    const dataChannel = this._pc.createDataChannel(label, options);
    if (!this._hasDataChannelMediaSection) {
      this._remoteSdp.receiveSctpAssociation();
      const offer = {
        type: "offer",
        sdp: this._remoteSdp.getSdp()
      };
      logger10.debug("receiveDataChannel() | calling pc.setRemoteDescription() [offer:%o]", offer);
      await this._pc.setRemoteDescription(offer);
      let answer = await this._pc.createAnswer();
      const localSdpObject = exports_lib.parse(answer.sdp);
      const answerMediaObject = localSdpObject.media.find((m) => m.type === "application");
      if (typeof maxMessageSize === "number") {
        answerMediaObject.maxMessageSize = maxMessageSize;
      }
      if (!this._transportReady) {
        await this.setupTransport({
          localDtlsRole: this._forcedLocalDtlsRole ?? "client",
          localSdpObject
        });
      }
      answer = {
        type: "answer",
        sdp: exports_lib.write(localSdpObject)
      };
      logger10.debug("receiveDataChannel() | calling pc.setLocalDescription() [answer:%o]", answer);
      await this._pc.setLocalDescription(answer);
      this._hasDataChannelMediaSection = true;
    }
    return { dataChannel };
  }
  getDataChannelMaxMessageSize() {
    return this._direction === "send" ? this._pc.sctp?.maxMessageSize : this._sctpMaxReceiveMessageSize;
  }
  async setupTransport({
    localDtlsRole,
    localSdpObject
  }) {
    if (!localSdpObject) {
      localSdpObject = exports_lib.parse(this._pc.localDescription.sdp);
    }
    const dtlsParameters = extractDtlsParameters({
      sdpObject: localSdpObject
    });
    dtlsParameters.role = localDtlsRole;
    this._remoteSdp.updateDtlsRole(localDtlsRole === "client" ? "server" : "client");
    await new Promise((resolve, reject) => {
      this.safeEmit("@connect", { dtlsParameters }, resolve, reject);
    });
    this._transportReady = true;
  }
  onIceGatheringStateChange = () => {
    this.emit("@icegatheringstatechange", this._pc.iceGatheringState);
  };
  onIceCandidateError = (event) => {
    this.emit("@icecandidateerror", event);
  };
  onConnectionStateChange = () => {
    this.emit("@connectionstatechange", this._pc.connectionState);
  };
  onIceConnectionStateChange = () => {
    switch (this._pc.iceConnectionState) {
      case "checking": {
        this.emit("@connectionstatechange", "connecting");
        break;
      }
      case "connected":
      case "completed": {
        this.emit("@connectionstatechange", "connected");
        break;
      }
      case "failed": {
        this.emit("@connectionstatechange", "failed");
        break;
      }
      case "disconnected": {
        this.emit("@connectionstatechange", "disconnected");
        break;
      }
      case "closed": {
        this.emit("@connectionstatechange", "closed");
        break;
      }
    }
  };
  assertNotClosed() {
    if (this._closed) {
      throw new InvalidStateError("method called in a closed handler");
    }
  }
  assertSendDirection() {
    if (this._direction !== "send") {
      throw new Error('method can just be called for handlers with "send" direction');
    }
  }
  assertRecvDirection() {
    if (this._direction !== "recv") {
      throw new Error('method can just be called for handlers with "recv" direction');
    }
  }
}

// ../ms/msc/src/handlers/Firefox120.ts
var logger11 = new Logger("Firefox120");
var NAME3 = "Firefox120";

class Firefox120 extends EnhancedEventEmitter {
  _closed = false;
  _direction;
  _sctpMaxReceiveMessageSize;
  _remoteSdp;
  _getSendExtendedRtpCapabilities;
  _forcedRtpExtensions;
  _pc;
  _mapMidTransceiver = new Map;
  _sendStream = new MediaStream;
  _hasDataChannelMediaSection = false;
  _nextSendSctpStreamId = 0;
  _transportReady = false;
  static createFactory({
    forcedRtpExtensions
  }) {
    return {
      name: NAME3,
      factory: (options) => new Firefox120({ ...options, forcedRtpExtensions }),
      getNativeRtpCapabilities: async ({
        direction
      }) => {
        logger11.debug("getNativeRtpCapabilities() [direction:%o]", direction);
        let pc = new RTCPeerConnection({
          iceServers: [],
          iceTransportPolicy: "all",
          bundlePolicy: "max-bundle",
          rtcpMuxPolicy: "require"
        });
        const canvas = document.createElement("canvas");
        canvas.getContext("2d");
        const fakeStream = canvas.captureStream();
        const fakeVideoTrack = fakeStream.getVideoTracks()[0];
        try {
          const audioTransceiver = pc.addTransceiver("audio", { direction });
          if (forcedRtpExtensions) {
            applyForcedRtpExtensions(audioTransceiver, forcedRtpExtensions);
          }
          const videoTransceiver = pc.addTransceiver(fakeVideoTrack, {
            direction,
            sendEncodings: [
              { rid: "r0", maxBitrate: 1e5 },
              { rid: "r1", maxBitrate: 500000 }
            ]
          });
          if (forcedRtpExtensions) {
            applyForcedRtpExtensions(videoTransceiver, forcedRtpExtensions);
          }
          const offer = await pc.createOffer();
          try {
            canvas.remove();
          } catch (error) {}
          try {
            fakeVideoTrack.stop();
          } catch (error) {}
          try {
            pc.close();
          } catch (error) {}
          pc = undefined;
          const sdpObject = exports_lib.parse(offer.sdp);
          const nativeRtpCapabilities = Firefox120.getLocalRtpCapabilities(sdpObject);
          return nativeRtpCapabilities;
        } catch (error) {
          try {
            canvas.remove();
          } catch (error2) {}
          try {
            fakeVideoTrack.stop();
          } catch (error2) {}
          try {
            pc?.close();
          } catch (error2) {}
          pc = undefined;
          throw error;
        }
      }
    };
  }
  static getLocalRtpCapabilities(localSdpObject) {
    const nativeRtpCapabilities = extractRtpCapabilities({
      sdpObject: localSdpObject
    });
    validateAndNormalizeRtpCapabilities(nativeRtpCapabilities);
    return nativeRtpCapabilities;
  }
  constructor({
    direction,
    iceParameters,
    iceCandidates,
    dtlsParameters,
    sctpParameters,
    iceServers,
    iceTransportPolicy,
    additionalSettings,
    getSendExtendedRtpCapabilities,
    forcedRtpExtensions
  }) {
    super();
    logger11.debug("constructor()");
    this._direction = direction;
    this._sctpMaxReceiveMessageSize = sctpParameters?.maxSendMessageSize;
    this._remoteSdp = new RemoteSdp({
      iceParameters,
      iceCandidates,
      dtlsParameters,
      sctpParameters
    });
    this._getSendExtendedRtpCapabilities = getSendExtendedRtpCapabilities;
    this._forcedRtpExtensions = forcedRtpExtensions;
    this._pc = new RTCPeerConnection({
      iceServers: iceServers ?? [],
      iceTransportPolicy: iceTransportPolicy ?? "all",
      bundlePolicy: "max-bundle",
      rtcpMuxPolicy: "require",
      ...additionalSettings
    });
    this._pc.addEventListener("icegatheringstatechange", this.onIceGatheringStateChange);
    this._pc.addEventListener("icecandidateerror", this.onIceCandidateError);
    if (this._pc.connectionState) {
      this._pc.addEventListener("connectionstatechange", this.onConnectionStateChange);
    } else {
      logger11.warn("run() | pc.connectionState not supported, using pc.iceConnectionState");
      this._pc.addEventListener("iceconnectionstatechange", this.onIceConnectionStateChange);
    }
  }
  get name() {
    return NAME3;
  }
  close() {
    logger11.debug("close()");
    if (this._closed) {
      return;
    }
    this._closed = true;
    try {
      this._pc.close();
    } catch (error) {}
    this._pc.removeEventListener("icegatheringstatechange", this.onIceGatheringStateChange);
    this._pc.removeEventListener("icecandidateerror", this.onIceCandidateError);
    this._pc.removeEventListener("connectionstatechange", this.onConnectionStateChange);
    this._pc.removeEventListener("iceconnectionstatechange", this.onIceConnectionStateChange);
    this.emit("@close");
    super.close();
  }
  async updateIceServers(iceServers) {
    this.assertNotClosed();
    throw new UnsupportedError("not supported");
  }
  async restartIce(iceParameters) {
    this.assertNotClosed();
    logger11.debug("restartIce()");
    this._remoteSdp.updateIceParameters(iceParameters);
    if (!this._transportReady) {
      return;
    }
    if (this._direction === "send") {
      const offer = await this._pc.createOffer({ iceRestart: true });
      logger11.debug("restartIce() | calling pc.setLocalDescription() [offer:%o]", offer);
      await this._pc.setLocalDescription(offer);
      const answer = {
        type: "answer",
        sdp: this._remoteSdp.getSdp()
      };
      logger11.debug("restartIce() | calling pc.setRemoteDescription() [answer:%o]", answer);
      await this._pc.setRemoteDescription(answer);
    } else {
      const offer = {
        type: "offer",
        sdp: this._remoteSdp.getSdp()
      };
      logger11.debug("restartIce() | calling pc.setRemoteDescription() [offer:%o]", offer);
      await this._pc.setRemoteDescription(offer);
      const answer = await this._pc.createAnswer();
      logger11.debug("restartIce() | calling pc.setLocalDescription() [answer:%o]", answer);
      await this._pc.setLocalDescription(answer);
    }
  }
  async getTransportStats() {
    this.assertNotClosed();
    return this._pc.getStats();
  }
  async send({
    track,
    streamId,
    encodings,
    codecOptions,
    codec,
    onRtpSender
  }) {
    this.assertNotClosed();
    this.assertSendDirection();
    logger11.debug("send() [kind:%s, track.id:%s, streamId:%s]", track.kind, track.id, streamId);
    if (encodings && encodings.length > 1) {
      encodings.forEach((encoding, idx) => {
        encoding.rid = `r${idx}`;
      });
    }
    let transceiver;
    try {
      transceiver = this._pc.addTransceiver(track, {
        direction: "sendonly",
        streams: [this._sendStream],
        sendEncodings: encodings
      });
      if (this._forcedRtpExtensions) {
        applyForcedRtpExtensions(transceiver, this._forcedRtpExtensions);
      }
      if (onRtpSender) {
        onRtpSender(transceiver.sender);
      }
      const offer = await this._pc.createOffer();
      let localSdpObject = exports_lib.parse(offer.sdp);
      if (localSdpObject.extmapAllowMixed) {
        this._remoteSdp.setSessionExtmapAllowMixed();
      }
      const nativeRtpCapabilities = Firefox120.getLocalRtpCapabilities(localSdpObject);
      const sendExtendedRtpCapabilities = this._getSendExtendedRtpCapabilities(nativeRtpCapabilities);
      const sendingRtpParameters = getSendingRtpParameters(track.kind, sendExtendedRtpCapabilities);
      sendingRtpParameters.codecs = reduceCodecs(sendingRtpParameters.codecs, codec);
      const sendingRemoteRtpParameters = getSendingRemoteRtpParameters(track.kind, sendExtendedRtpCapabilities);
      sendingRemoteRtpParameters.codecs = reduceCodecs(sendingRemoteRtpParameters.codecs, codec);
      if (!this._transportReady) {
        await this.setupTransport({ localDtlsRole: "client", localSdpObject });
      }
      const layers = parse((encodings ?? [{}])[0].scalabilityMode);
      logger11.debug("send() | calling pc.setLocalDescription() [offer:%o]", offer);
      await this._pc.setLocalDescription(offer);
      const localId = transceiver.mid;
      sendingRtpParameters.mid = localId;
      localSdpObject = exports_lib.parse(this._pc.localDescription.sdp);
      const offerMediaObject = localSdpObject.media[localSdpObject.media.length - 1];
      sendingRtpParameters.rtcp.cname = getCname({
        offerMediaObject
      });
      sendingRtpParameters.msid = `${streamId ?? this._sendStream.id} ${track.id}`;
      if (!encodings) {
        sendingRtpParameters.encodings = getRtpEncodings({
          offerMediaObject,
          codecs: sendingRtpParameters.codecs
        });
      } else if (encodings.length === 1) {
        const newEncodings = getRtpEncodings({
          offerMediaObject,
          codecs: sendingRtpParameters.codecs
        });
        Object.assign(newEncodings[0], encodings[0]);
        sendingRtpParameters.encodings = newEncodings;
      } else {
        sendingRtpParameters.encodings = encodings;
      }
      if (sendingRtpParameters.encodings.length > 1 && (sendingRtpParameters.codecs[0].mimeType.toLowerCase() === "video/vp8" || sendingRtpParameters.codecs[0].mimeType.toLowerCase() === "video/h264")) {
        for (const encoding of sendingRtpParameters.encodings) {
          if (encoding.scalabilityMode) {
            encoding.scalabilityMode = `L1T${layers.temporalLayers}`;
          } else {
            encoding.scalabilityMode = "L1T3";
          }
        }
      }
      this._remoteSdp.send({
        offerMediaObject,
        offerRtpParameters: sendingRtpParameters,
        answerRtpParameters: sendingRemoteRtpParameters,
        codecOptions
      });
      const answer = {
        type: "answer",
        sdp: this._remoteSdp.getSdp()
      };
      logger11.debug("send() | calling pc.setRemoteDescription() [answer:%o]", answer);
      await this._pc.setRemoteDescription(answer);
      this._mapMidTransceiver.set(localId, transceiver);
      return {
        localId,
        rtpParameters: sendingRtpParameters,
        rtpSender: transceiver.sender
      };
    } catch (error) {
      try {
        if (this._pc.signalingState === "have-local-offer") {
          try {
            await this._pc.setLocalDescription({ type: "rollback" });
          } catch (error2) {}
        }
        transceiver?.stop();
      } catch (error3) {}
      throw error;
    }
  }
  async stopSending(localId) {
    this.assertSendDirection();
    logger11.debug("stopSending() [localId:%s]", localId);
    if (this._closed) {
      return;
    }
    const transceiver = this._mapMidTransceiver.get(localId);
    if (!transceiver) {
      throw new Error("associated transceiver not found");
    }
    transceiver.sender.replaceTrack(null);
    this._pc.removeTrack(transceiver.sender);
    this._remoteSdp.disableMediaSection(transceiver.mid);
    const offer = await this._pc.createOffer();
    logger11.debug("stopSending() | calling pc.setLocalDescription() [offer:%o]", offer);
    await this._pc.setLocalDescription(offer);
    const answer = {
      type: "answer",
      sdp: this._remoteSdp.getSdp()
    };
    logger11.debug("stopSending() | calling pc.setRemoteDescription() [answer:%o]", answer);
    await this._pc.setRemoteDescription(answer);
    this._mapMidTransceiver.delete(localId);
  }
  async pauseSending(localId) {
    this.assertNotClosed();
    this.assertSendDirection();
    logger11.debug("pauseSending() [localId:%s]", localId);
    const transceiver = this._mapMidTransceiver.get(localId);
    if (!transceiver) {
      throw new Error("associated RTCRtpTransceiver not found");
    }
    transceiver.direction = "inactive";
    this._remoteSdp.pauseMediaSection(localId);
    const offer = await this._pc.createOffer();
    logger11.debug("pauseSending() | calling pc.setLocalDescription() [offer:%o]", offer);
    await this._pc.setLocalDescription(offer);
    const answer = {
      type: "answer",
      sdp: this._remoteSdp.getSdp()
    };
    logger11.debug("pauseSending() | calling pc.setRemoteDescription() [answer:%o]", answer);
    await this._pc.setRemoteDescription(answer);
  }
  async resumeSending(localId) {
    this.assertNotClosed();
    this.assertSendDirection();
    logger11.debug("resumeSending() [localId:%s]", localId);
    const transceiver = this._mapMidTransceiver.get(localId);
    if (!transceiver) {
      throw new Error("associated RTCRtpTransceiver not found");
    }
    transceiver.direction = "sendonly";
    this._remoteSdp.resumeSendingMediaSection(localId);
    const offer = await this._pc.createOffer();
    logger11.debug("resumeSending() | calling pc.setLocalDescription() [offer:%o]", offer);
    await this._pc.setLocalDescription(offer);
    const answer = {
      type: "answer",
      sdp: this._remoteSdp.getSdp()
    };
    logger11.debug("resumeSending() | calling pc.setRemoteDescription() [answer:%o]", answer);
    await this._pc.setRemoteDescription(answer);
  }
  async replaceTrack(localId, track) {
    this.assertNotClosed();
    this.assertSendDirection();
    if (track) {
      logger11.debug("replaceTrack() [localId:%s, track.id:%s]", localId, track.id);
    } else {
      logger11.debug("replaceTrack() [localId:%s, no track]", localId);
    }
    const transceiver = this._mapMidTransceiver.get(localId);
    if (!transceiver) {
      throw new Error("associated RTCRtpTransceiver not found");
    }
    await transceiver.sender.replaceTrack(track);
  }
  async setMaxSpatialLayer(localId, spatialLayer) {
    this.assertNotClosed();
    this.assertSendDirection();
    logger11.debug("setMaxSpatialLayer() [localId:%s, spatialLayer:%s]", localId, spatialLayer);
    const transceiver = this._mapMidTransceiver.get(localId);
    if (!transceiver) {
      throw new Error("associated transceiver not found");
    }
    const parameters = transceiver.sender.getParameters();
    parameters.encodings.forEach((encoding, idx) => {
      if (idx <= spatialLayer) {
        encoding.active = true;
      } else {
        encoding.active = false;
      }
    });
    await transceiver.sender.setParameters(parameters);
    this._remoteSdp.muxMediaSectionSimulcast(localId, parameters.encodings);
    const offer = await this._pc.createOffer();
    logger11.debug("setMaxSpatialLayer() | calling pc.setLocalDescription() [offer:%o]", offer);
    await this._pc.setLocalDescription(offer);
    const answer = {
      type: "answer",
      sdp: this._remoteSdp.getSdp()
    };
    logger11.debug("setMaxSpatialLayer() | calling pc.setRemoteDescription() [answer:%o]", answer);
    await this._pc.setRemoteDescription(answer);
  }
  async setRtpEncodingParameters(localId, params) {
    this.assertNotClosed();
    this.assertSendDirection();
    logger11.debug("setRtpEncodingParameters() [localId:%s, params:%o]", localId, params);
    const transceiver = this._mapMidTransceiver.get(localId);
    if (!transceiver) {
      throw new Error("associated RTCRtpTransceiver not found");
    }
    const parameters = transceiver.sender.getParameters();
    parameters.encodings.forEach((encoding, idx) => {
      parameters.encodings[idx] = { ...encoding, ...params };
    });
    await transceiver.sender.setParameters(parameters);
    this._remoteSdp.muxMediaSectionSimulcast(localId, parameters.encodings);
    const offer = await this._pc.createOffer();
    logger11.debug("setRtpEncodingParameters() | calling pc.setLocalDescription() [offer:%o]", offer);
    await this._pc.setLocalDescription(offer);
    const answer = {
      type: "answer",
      sdp: this._remoteSdp.getSdp()
    };
    logger11.debug("setRtpEncodingParameters() | calling pc.setRemoteDescription() [answer:%o]", answer);
    await this._pc.setRemoteDescription(answer);
  }
  async getSenderStats(localId) {
    this.assertNotClosed();
    this.assertSendDirection();
    const transceiver = this._mapMidTransceiver.get(localId);
    if (!transceiver) {
      throw new Error("associated RTCRtpTransceiver not found");
    }
    return transceiver.sender.getStats();
  }
  async sendDataChannel({
    sctpStreamParameters
  }) {
    this.assertNotClosed();
    this.assertSendDirection();
    const options = {
      negotiated: true,
      id: this._nextSendSctpStreamId,
      ordered: sctpStreamParameters.ordered,
      maxPacketLifeTime: sctpStreamParameters.maxPacketLifeTime,
      maxRetransmits: sctpStreamParameters.maxRetransmits,
      protocol: sctpStreamParameters.protocol
    };
    logger11.debug("sendDataChannel() [options:%o]", options);
    const dataChannel = this._pc.createDataChannel(sctpStreamParameters.label, options);
    this._nextSendSctpStreamId = ++this._nextSendSctpStreamId % (this._pc.sctp?.maxChannels ?? 65536);
    if (!this._hasDataChannelMediaSection) {
      try {
        const offer = await this._pc.createOffer();
        const localSdpObject = exports_lib.parse(offer.sdp);
        const offerMediaObject = localSdpObject.media.find((m) => m.type === "application");
        if (!this._transportReady) {
          await this.setupTransport({
            localDtlsRole: "client",
            localSdpObject
          });
        }
        logger11.debug("sendDataChannel() | calling pc.setLocalDescription() [offer:%o]", offer);
        await this._pc.setLocalDescription(offer);
        this._remoteSdp.sendSctpAssociation({ offerMediaObject });
        const answer = {
          type: "answer",
          sdp: this._remoteSdp.getSdp()
        };
        logger11.debug("sendDataChannel() | calling pc.setRemoteDescription() [answer:%o]", answer);
        await this._pc.setRemoteDescription(answer);
        this._hasDataChannelMediaSection = true;
      } catch (error) {
        try {
          if (this._pc.signalingState === "have-local-offer") {
            try {
              await this._pc.setLocalDescription({ type: "rollback" });
            } catch (error2) {}
          }
          dataChannel.close();
        } catch (error3) {}
        throw error;
      }
    }
    const newSctpStreamParameters = {
      streamId: options.id,
      ordered: options.ordered,
      maxPacketLifeTime: options.maxPacketLifeTime,
      maxRetransmits: options.maxRetransmits
    };
    return { dataChannel, sctpStreamParameters: newSctpStreamParameters };
  }
  async receive(optionsList) {
    this.assertNotClosed();
    this.assertRecvDirection();
    const results = [];
    const mapLocalId = new Map;
    for (const options of optionsList) {
      const { trackId, kind, rtpParameters, streamId } = options;
      logger11.debug("receive() [trackId:%s, kind:%s]", trackId, kind);
      const localId = rtpParameters.mid ?? String(this._mapMidTransceiver.size);
      mapLocalId.set(trackId, localId);
      const { msidStreamId } = getMsidStreamIdAndTrackId(rtpParameters.msid);
      this._remoteSdp.receive({
        mid: localId,
        kind,
        offerRtpParameters: rtpParameters,
        streamId: streamId ?? msidStreamId ?? rtpParameters.rtcp?.cname ?? "-",
        trackId
      });
    }
    const offer = {
      type: "offer",
      sdp: this._remoteSdp.getSdp()
    };
    logger11.debug("receive() | calling pc.setRemoteDescription() [offer:%o]", offer);
    await this._pc.setRemoteDescription(offer);
    for (const options of optionsList) {
      const { trackId, onRtpReceiver } = options;
      if (onRtpReceiver) {
        const localId = mapLocalId.get(trackId);
        const transceiver = this._pc.getTransceivers().find((t) => t.mid === localId);
        if (!transceiver) {
          throw new Error("transceiver not found");
        }
        if (this._forcedRtpExtensions) {
          applyForcedRtpExtensions(transceiver, this._forcedRtpExtensions);
        }
        onRtpReceiver(transceiver.receiver);
      }
    }
    let answer = await this._pc.createAnswer();
    const localSdpObject = exports_lib.parse(answer.sdp);
    for (const options of optionsList) {
      const { trackId, rtpParameters } = options;
      const localId = mapLocalId.get(trackId);
      const answerMediaObject = localSdpObject.media.find((m) => String(m.mid) === localId);
      applyCodecParameters({
        offerRtpParameters: rtpParameters,
        answerMediaObject
      });
      answer = {
        type: "answer",
        sdp: exports_lib.write(localSdpObject)
      };
    }
    if (!this._transportReady) {
      await this.setupTransport({ localDtlsRole: "client", localSdpObject });
    }
    logger11.debug("receive() | calling pc.setLocalDescription() [answer:%o]", answer);
    await this._pc.setLocalDescription(answer);
    for (const options of optionsList) {
      const { trackId } = options;
      const localId = mapLocalId.get(trackId);
      const transceiver = this._pc.getTransceivers().find((t) => t.mid === localId);
      if (!transceiver) {
        throw new Error("new RTCRtpTransceiver not found");
      }
      this._mapMidTransceiver.set(localId, transceiver);
      results.push({
        localId,
        track: transceiver.receiver.track,
        rtpReceiver: transceiver.receiver
      });
    }
    return results;
  }
  async stopReceiving(localIds) {
    this.assertRecvDirection();
    if (this._closed) {
      return;
    }
    for (const localId of localIds) {
      logger11.debug("stopReceiving() [localId:%s]", localId);
      const transceiver = this._mapMidTransceiver.get(localId);
      if (!transceiver) {
        throw new Error("associated RTCRtpTransceiver not found");
      }
      this._remoteSdp.closeMediaSection(transceiver.mid);
    }
    const offer = {
      type: "offer",
      sdp: this._remoteSdp.getSdp()
    };
    logger11.debug("stopReceiving() | calling pc.setRemoteDescription() [offer:%o]", offer);
    await this._pc.setRemoteDescription(offer);
    const answer = await this._pc.createAnswer();
    logger11.debug("stopReceiving() | calling pc.setLocalDescription() [answer:%o]", answer);
    await this._pc.setLocalDescription(answer);
    for (const localId of localIds) {
      this._mapMidTransceiver.delete(localId);
    }
  }
  async pauseReceiving(localIds) {
    this.assertNotClosed();
    this.assertRecvDirection();
    for (const localId of localIds) {
      logger11.debug("pauseReceiving() [localId:%s]", localId);
      const transceiver = this._mapMidTransceiver.get(localId);
      if (!transceiver) {
        throw new Error("associated RTCRtpTransceiver not found");
      }
      transceiver.direction = "inactive";
      this._remoteSdp.pauseMediaSection(localId);
    }
    const offer = {
      type: "offer",
      sdp: this._remoteSdp.getSdp()
    };
    logger11.debug("pauseReceiving() | calling pc.setRemoteDescription() [offer:%o]", offer);
    await this._pc.setRemoteDescription(offer);
    const answer = await this._pc.createAnswer();
    logger11.debug("pauseReceiving() | calling pc.setLocalDescription() [answer:%o]", answer);
    await this._pc.setLocalDescription(answer);
  }
  async resumeReceiving(localIds) {
    this.assertNotClosed();
    this.assertRecvDirection();
    for (const localId of localIds) {
      logger11.debug("resumeReceiving() [localId:%s]", localId);
      const transceiver = this._mapMidTransceiver.get(localId);
      if (!transceiver) {
        throw new Error("associated RTCRtpTransceiver not found");
      }
      transceiver.direction = "recvonly";
      this._remoteSdp.resumeReceivingMediaSection(localId);
    }
    const offer = {
      type: "offer",
      sdp: this._remoteSdp.getSdp()
    };
    logger11.debug("resumeReceiving() | calling pc.setRemoteDescription() [offer:%o]", offer);
    await this._pc.setRemoteDescription(offer);
    const answer = await this._pc.createAnswer();
    logger11.debug("resumeReceiving() | calling pc.setLocalDescription() [answer:%o]", answer);
    await this._pc.setLocalDescription(answer);
  }
  async getReceiverStats(localId) {
    this.assertRecvDirection();
    const transceiver = this._mapMidTransceiver.get(localId);
    if (!transceiver) {
      throw new Error("associated RTCRtpTransceiver not found");
    }
    return transceiver.receiver.getStats();
  }
  async receiveDataChannel({
    maxMessageSize,
    sctpStreamParameters,
    label,
    protocol
  }) {
    this.assertNotClosed();
    this.assertRecvDirection();
    const {
      streamId,
      ordered,
      maxPacketLifeTime,
      maxRetransmits
    } = sctpStreamParameters;
    const options = {
      negotiated: true,
      id: streamId,
      ordered,
      maxPacketLifeTime,
      maxRetransmits,
      protocol
    };
    logger11.debug("receiveDataChannel() [options:%o]", options);
    const dataChannel = this._pc.createDataChannel(label, options);
    if (!this._hasDataChannelMediaSection) {
      this._remoteSdp.receiveSctpAssociation();
      const offer = {
        type: "offer",
        sdp: this._remoteSdp.getSdp()
      };
      logger11.debug("receiveDataChannel() | calling pc.setRemoteDescription() [offer:%o]", offer);
      await this._pc.setRemoteDescription(offer);
      let answer = await this._pc.createAnswer();
      const localSdpObject = exports_lib.parse(answer.sdp);
      const answerMediaObject = localSdpObject.media.find((m) => m.type === "application");
      if (typeof maxMessageSize === "number") {
        answerMediaObject.maxMessageSize = maxMessageSize;
      }
      if (!this._transportReady) {
        await this.setupTransport({ localDtlsRole: "client", localSdpObject });
      }
      answer = {
        type: "answer",
        sdp: exports_lib.write(localSdpObject)
      };
      logger11.debug("receiveDataChannel() | calling pc.setLocalDescription() [answer:%o]", answer);
      await this._pc.setLocalDescription(answer);
      this._hasDataChannelMediaSection = true;
    }
    return { dataChannel };
  }
  getDataChannelMaxMessageSize() {
    return this._direction === "send" ? this._pc.sctp?.maxMessageSize : this._sctpMaxReceiveMessageSize;
  }
  async setupTransport({
    localDtlsRole,
    localSdpObject
  }) {
    if (!localSdpObject) {
      localSdpObject = exports_lib.parse(this._pc.localDescription.sdp);
    }
    const dtlsParameters = extractDtlsParameters({
      sdpObject: localSdpObject
    });
    dtlsParameters.role = localDtlsRole;
    this._remoteSdp.updateDtlsRole(localDtlsRole === "client" ? "server" : "client");
    await new Promise((resolve, reject) => {
      this.safeEmit("@connect", { dtlsParameters }, resolve, reject);
    });
    this._transportReady = true;
  }
  onIceGatheringStateChange = () => {
    this.emit("@icegatheringstatechange", this._pc.iceGatheringState);
  };
  onIceCandidateError = (event) => {
    this.emit("@icecandidateerror", event);
  };
  onConnectionStateChange = () => {
    this.emit("@connectionstatechange", this._pc.connectionState);
  };
  onIceConnectionStateChange = () => {
    switch (this._pc.iceConnectionState) {
      case "checking": {
        this.emit("@connectionstatechange", "connecting");
        break;
      }
      case "connected":
      case "completed": {
        this.emit("@connectionstatechange", "connected");
        break;
      }
      case "failed": {
        this.emit("@connectionstatechange", "failed");
        break;
      }
      case "disconnected": {
        this.emit("@connectionstatechange", "disconnected");
        break;
      }
      case "closed": {
        this.emit("@connectionstatechange", "closed");
        break;
      }
    }
  };
  assertNotClosed() {
    if (this._closed) {
      throw new InvalidStateError("method called in a closed handler");
    }
  }
  assertSendDirection() {
    if (this._direction !== "send") {
      throw new Error('method can just be called for handlers with "send" direction');
    }
  }
  assertRecvDirection() {
    if (this._direction !== "recv") {
      throw new Error('method can just be called for handlers with "recv" direction');
    }
  }
}

// ../ms/msc/src/handlers/Safari12.ts
var logger12 = new Logger("Safari12");
var NAME4 = "Safari12";

class Safari12 extends EnhancedEventEmitter {
  _closed = false;
  _direction;
  _sctpMaxReceiveMessageSize;
  _remoteSdp;
  _getSendExtendedRtpCapabilities;
  _forcedRtpExtensions;
  _forcedLocalDtlsRole;
  _pc;
  _mapMidTransceiver = new Map;
  _sendStream = new MediaStream;
  _hasDataChannelMediaSection = false;
  _nextSendSctpStreamId = 0;
  _transportReady = false;
  static createFactory({
    forcedRtpExtensions
  }) {
    return {
      name: NAME4,
      factory: (options) => new Safari12({ ...options, forcedRtpExtensions }),
      getNativeRtpCapabilities: async ({
        direction
      }) => {
        logger12.debug("getNativeRtpCapabilities() [direction:%o]", direction);
        let pc = new RTCPeerConnection({
          iceServers: [],
          iceTransportPolicy: "all",
          bundlePolicy: "max-bundle",
          rtcpMuxPolicy: "require"
        });
        try {
          const audioTransceiver = pc.addTransceiver("audio", { direction });
          if (forcedRtpExtensions) {
            applyForcedRtpExtensions(audioTransceiver, forcedRtpExtensions);
          }
          const videoTransceiver = pc.addTransceiver("video", { direction });
          if (forcedRtpExtensions) {
            applyForcedRtpExtensions(videoTransceiver, forcedRtpExtensions);
          }
          const offer = await pc.createOffer();
          try {
            pc.close();
          } catch (error) {}
          pc = undefined;
          const sdpObject = exports_lib.parse(offer.sdp);
          const nativeRtpCapabilities = Safari12.getLocalRtpCapabilities(sdpObject);
          return nativeRtpCapabilities;
        } catch (error) {
          try {
            pc?.close();
          } catch (error2) {}
          pc = undefined;
          throw error;
        }
      }
    };
  }
  static getLocalRtpCapabilities(localSdpObject) {
    const nativeRtpCapabilities = extractRtpCapabilities({
      sdpObject: localSdpObject
    });
    validateAndNormalizeRtpCapabilities(nativeRtpCapabilities);
    addNackSupportForOpus(nativeRtpCapabilities);
    return nativeRtpCapabilities;
  }
  constructor({
    direction,
    iceParameters,
    iceCandidates,
    dtlsParameters,
    sctpParameters,
    iceServers,
    iceTransportPolicy,
    additionalSettings,
    getSendExtendedRtpCapabilities,
    forcedRtpExtensions
  }) {
    super();
    logger12.debug("constructor()");
    this._direction = direction;
    this._sctpMaxReceiveMessageSize = sctpParameters?.maxSendMessageSize;
    this._remoteSdp = new RemoteSdp({
      iceParameters,
      iceCandidates,
      dtlsParameters,
      sctpParameters
    });
    this._getSendExtendedRtpCapabilities = getSendExtendedRtpCapabilities;
    this._forcedRtpExtensions = forcedRtpExtensions;
    if (dtlsParameters.role && dtlsParameters.role !== "auto") {
      this._forcedLocalDtlsRole = dtlsParameters.role === "server" ? "client" : "server";
    }
    this._pc = new RTCPeerConnection({
      iceServers: iceServers ?? [],
      iceTransportPolicy: iceTransportPolicy ?? "all",
      bundlePolicy: "max-bundle",
      rtcpMuxPolicy: "require",
      ...additionalSettings
    });
    this._pc.addEventListener("icegatheringstatechange", () => {
      this.emit("@icegatheringstatechange", this._pc.iceGatheringState);
    });
    this._pc.addEventListener("icecandidateerror", (event) => {
      this.emit("@icecandidateerror", event);
    });
    this._pc.addEventListener("icegatheringstatechange", this.onIceGatheringStateChange);
    this._pc.addEventListener("icecandidateerror", this.onIceCandidateError);
    if (this._pc.connectionState) {
      this._pc.addEventListener("connectionstatechange", this.onConnectionStateChange);
    } else {
      logger12.warn("run() | pc.connectionState not supported, using pc.iceConnectionState");
      this._pc.addEventListener("iceconnectionstatechange", this.onIceConnectionStateChange);
    }
  }
  get name() {
    return NAME4;
  }
  close() {
    logger12.debug("close()");
    if (this._closed) {
      return;
    }
    this._closed = true;
    try {
      this._pc.close();
    } catch (error) {}
    this._pc.removeEventListener("icegatheringstatechange", this.onIceGatheringStateChange);
    this._pc.removeEventListener("icecandidateerror", this.onIceCandidateError);
    this._pc.removeEventListener("connectionstatechange", this.onConnectionStateChange);
    this._pc.removeEventListener("iceconnectionstatechange", this.onIceConnectionStateChange);
    this.emit("@close");
    super.close();
  }
  async updateIceServers(iceServers) {
    this.assertNotClosed();
    logger12.debug("updateIceServers()");
    const configuration = this._pc.getConfiguration();
    configuration.iceServers = iceServers;
    this._pc.setConfiguration(configuration);
  }
  async restartIce(iceParameters) {
    this.assertNotClosed();
    logger12.debug("restartIce()");
    this._remoteSdp.updateIceParameters(iceParameters);
    if (!this._transportReady) {
      return;
    }
    if (this._direction === "send") {
      const offer = await this._pc.createOffer({ iceRestart: true });
      logger12.debug("restartIce() | calling pc.setLocalDescription() [offer:%o]", offer);
      await this._pc.setLocalDescription(offer);
      const answer = {
        type: "answer",
        sdp: this._remoteSdp.getSdp()
      };
      logger12.debug("restartIce() | calling pc.setRemoteDescription() [answer:%o]", answer);
      await this._pc.setRemoteDescription(answer);
    } else {
      const offer = {
        type: "offer",
        sdp: this._remoteSdp.getSdp()
      };
      logger12.debug("restartIce() | calling pc.setRemoteDescription() [offer:%o]", offer);
      await this._pc.setRemoteDescription(offer);
      const answer = await this._pc.createAnswer();
      logger12.debug("restartIce() | calling pc.setLocalDescription() [answer:%o]", answer);
      await this._pc.setLocalDescription(answer);
    }
  }
  async getTransportStats() {
    this.assertNotClosed();
    return this._pc.getStats();
  }
  async send({
    track,
    streamId,
    encodings,
    codecOptions,
    codec,
    onRtpSender
  }) {
    this.assertNotClosed();
    this.assertSendDirection();
    logger12.debug("send() [kind:%s, track.id:%s, streamId:%s]", track.kind, track.id, streamId);
    if (encodings && encodings.length > 1) {
      let maxTemporalLayers = 1;
      for (const encoding of encodings) {
        const temporalLayers = encoding.scalabilityMode ? parse(encoding.scalabilityMode).temporalLayers : 3;
        if (temporalLayers > maxTemporalLayers) {
          maxTemporalLayers = temporalLayers;
        }
      }
      encodings.forEach((encoding, idx) => {
        encoding.rid = `r${idx}`;
        encoding.scalabilityMode = `L1T${maxTemporalLayers}`;
      });
    }
    let transceiver;
    try {
      transceiver = this._pc.addTransceiver(track, {
        direction: "sendonly",
        streams: [this._sendStream],
        sendEncodings: encodings
      });
      const mediaSectionIdx = this._remoteSdp.getNextMediaSectionIdx();
      if (this._forcedRtpExtensions) {
        applyForcedRtpExtensions(transceiver, this._forcedRtpExtensions);
      }
      if (onRtpSender) {
        onRtpSender(transceiver.sender);
      }
      const offer = await this._pc.createOffer();
      let localSdpObject = exports_lib.parse(offer.sdp);
      if (localSdpObject.extmapAllowMixed) {
        this._remoteSdp.setSessionExtmapAllowMixed();
      }
      const nativeRtpCapabilities = Safari12.getLocalRtpCapabilities(localSdpObject);
      const sendExtendedRtpCapabilities = this._getSendExtendedRtpCapabilities(nativeRtpCapabilities);
      const sendingRtpParameters = getSendingRtpParameters(track.kind, sendExtendedRtpCapabilities);
      sendingRtpParameters.codecs = reduceCodecs(sendingRtpParameters.codecs, codec);
      const sendingRemoteRtpParameters = getSendingRemoteRtpParameters(track.kind, sendExtendedRtpCapabilities);
      sendingRemoteRtpParameters.codecs = reduceCodecs(sendingRemoteRtpParameters.codecs, codec);
      if (!this._transportReady) {
        await this.setupTransport({
          localDtlsRole: this._forcedLocalDtlsRole ?? "client",
          localSdpObject
        });
      }
      logger12.debug("send() | calling pc.setLocalDescription() [offer:%o]", offer);
      await this._pc.setLocalDescription(offer);
      const localId = transceiver.mid;
      sendingRtpParameters.mid = localId;
      localSdpObject = exports_lib.parse(this._pc.localDescription.sdp);
      const offerMediaObject = localSdpObject.media[mediaSectionIdx.idx];
      sendingRtpParameters.rtcp.cname = getCname({
        offerMediaObject
      });
      sendingRtpParameters.msid = `${streamId ?? this._sendStream.id} ${track.id}`;
      if (!encodings) {
        sendingRtpParameters.encodings = getRtpEncodings({
          offerMediaObject,
          codecs: sendingRtpParameters.codecs
        });
      } else if (encodings.length === 1) {
        const newEncodings = getRtpEncodings({
          offerMediaObject,
          codecs: sendingRtpParameters.codecs
        });
        Object.assign(newEncodings[0], encodings[0]);
        sendingRtpParameters.encodings = newEncodings;
      } else {
        sendingRtpParameters.encodings = encodings;
      }
      this._remoteSdp.send({
        offerMediaObject,
        reuseMid: mediaSectionIdx.reuseMid,
        offerRtpParameters: sendingRtpParameters,
        answerRtpParameters: sendingRemoteRtpParameters,
        codecOptions
      });
      const answer = {
        type: "answer",
        sdp: this._remoteSdp.getSdp()
      };
      logger12.debug("send() | calling pc.setRemoteDescription() [answer:%o]", answer);
      await this._pc.setRemoteDescription(answer);
      this._mapMidTransceiver.set(localId, transceiver);
      return {
        localId,
        rtpParameters: sendingRtpParameters,
        rtpSender: transceiver.sender
      };
    } catch (error) {
      try {
        if (this._pc.signalingState === "have-local-offer") {
          try {
            await this._pc.setLocalDescription({ type: "rollback" });
          } catch (error2) {}
        }
        transceiver?.stop();
      } catch (error3) {}
      throw error;
    }
  }
  async stopSending(localId) {
    this.assertSendDirection();
    if (this._closed) {
      return;
    }
    logger12.debug("stopSending() [localId:%s]", localId);
    const transceiver = this._mapMidTransceiver.get(localId);
    if (!transceiver) {
      throw new Error("associated RTCRtpTransceiver not found");
    }
    transceiver.sender.replaceTrack(null);
    this._pc.removeTrack(transceiver.sender);
    const mediaSectionClosed = this._remoteSdp.closeMediaSection(transceiver.mid);
    if (mediaSectionClosed) {
      try {
        transceiver.stop();
      } catch (error) {}
    }
    const offer = await this._pc.createOffer();
    logger12.debug("stopSending() | calling pc.setLocalDescription() [offer:%o]", offer);
    await this._pc.setLocalDescription(offer);
    const answer = {
      type: "answer",
      sdp: this._remoteSdp.getSdp()
    };
    logger12.debug("stopSending() | calling pc.setRemoteDescription() [answer:%o]", answer);
    await this._pc.setRemoteDescription(answer);
    this._mapMidTransceiver.delete(localId);
  }
  async pauseSending(localId) {
    this.assertNotClosed();
    this.assertSendDirection();
    logger12.debug("pauseSending() [localId:%s]", localId);
    const transceiver = this._mapMidTransceiver.get(localId);
    if (!transceiver) {
      throw new Error("associated RTCRtpTransceiver not found");
    }
    transceiver.direction = "inactive";
    this._remoteSdp.pauseMediaSection(localId);
    const offer = await this._pc.createOffer();
    logger12.debug("pauseSending() | calling pc.setLocalDescription() [offer:%o]", offer);
    await this._pc.setLocalDescription(offer);
    const answer = {
      type: "answer",
      sdp: this._remoteSdp.getSdp()
    };
    logger12.debug("pauseSending() | calling pc.setRemoteDescription() [answer:%o]", answer);
    await this._pc.setRemoteDescription(answer);
  }
  async resumeSending(localId) {
    this.assertNotClosed();
    this.assertSendDirection();
    logger12.debug("resumeSending() [localId:%s]", localId);
    const transceiver = this._mapMidTransceiver.get(localId);
    if (!transceiver) {
      throw new Error("associated RTCRtpTransceiver not found");
    }
    transceiver.direction = "sendonly";
    this._remoteSdp.resumeSendingMediaSection(localId);
    const offer = await this._pc.createOffer();
    logger12.debug("resumeSending() | calling pc.setLocalDescription() [offer:%o]", offer);
    await this._pc.setLocalDescription(offer);
    const answer = {
      type: "answer",
      sdp: this._remoteSdp.getSdp()
    };
    logger12.debug("resumeSending() | calling pc.setRemoteDescription() [answer:%o]", answer);
    await this._pc.setRemoteDescription(answer);
  }
  async replaceTrack(localId, track) {
    this.assertNotClosed();
    this.assertSendDirection();
    if (track) {
      logger12.debug("replaceTrack() [localId:%s, track.id:%s]", localId, track.id);
    } else {
      logger12.debug("replaceTrack() [localId:%s, no track]", localId);
    }
    const transceiver = this._mapMidTransceiver.get(localId);
    if (!transceiver) {
      throw new Error("associated RTCRtpTransceiver not found");
    }
    await transceiver.sender.replaceTrack(track);
  }
  async setMaxSpatialLayer(localId, spatialLayer) {
    this.assertNotClosed();
    this.assertSendDirection();
    logger12.debug("setMaxSpatialLayer() [localId:%s, spatialLayer:%s]", localId, spatialLayer);
    const transceiver = this._mapMidTransceiver.get(localId);
    if (!transceiver) {
      throw new Error("associated RTCRtpTransceiver not found");
    }
    const parameters = transceiver.sender.getParameters();
    parameters.encodings.forEach((encoding, idx) => {
      if (idx <= spatialLayer) {
        encoding.active = true;
      } else {
        encoding.active = false;
      }
    });
    await transceiver.sender.setParameters(parameters);
    this._remoteSdp.muxMediaSectionSimulcast(localId, parameters.encodings);
    const offer = await this._pc.createOffer();
    logger12.debug("setMaxSpatialLayer() | calling pc.setLocalDescription() [offer:%o]", offer);
    await this._pc.setLocalDescription(offer);
    const answer = {
      type: "answer",
      sdp: this._remoteSdp.getSdp()
    };
    logger12.debug("setMaxSpatialLayer() | calling pc.setRemoteDescription() [answer:%o]", answer);
    await this._pc.setRemoteDescription(answer);
  }
  async setRtpEncodingParameters(localId, params) {
    this.assertNotClosed();
    this.assertSendDirection();
    logger12.debug("setRtpEncodingParameters() [localId:%s, params:%o]", localId, params);
    const transceiver = this._mapMidTransceiver.get(localId);
    if (!transceiver) {
      throw new Error("associated RTCRtpTransceiver not found");
    }
    const parameters = transceiver.sender.getParameters();
    parameters.encodings.forEach((encoding, idx) => {
      parameters.encodings[idx] = { ...encoding, ...params };
    });
    await transceiver.sender.setParameters(parameters);
    this._remoteSdp.muxMediaSectionSimulcast(localId, parameters.encodings);
    const offer = await this._pc.createOffer();
    logger12.debug("setRtpEncodingParameters() | calling pc.setLocalDescription() [offer:%o]", offer);
    await this._pc.setLocalDescription(offer);
    const answer = {
      type: "answer",
      sdp: this._remoteSdp.getSdp()
    };
    logger12.debug("setRtpEncodingParameters() | calling pc.setRemoteDescription() [answer:%o]", answer);
    await this._pc.setRemoteDescription(answer);
  }
  async getSenderStats(localId) {
    this.assertNotClosed();
    this.assertSendDirection();
    const transceiver = this._mapMidTransceiver.get(localId);
    if (!transceiver) {
      throw new Error("associated RTCRtpTransceiver not found");
    }
    return transceiver.sender.getStats();
  }
  async sendDataChannel({
    sctpStreamParameters
  }) {
    this.assertNotClosed();
    this.assertSendDirection();
    const options = {
      negotiated: true,
      id: this._nextSendSctpStreamId,
      ordered: sctpStreamParameters.ordered,
      maxPacketLifeTime: sctpStreamParameters.maxPacketLifeTime,
      maxRetransmits: sctpStreamParameters.maxRetransmits,
      protocol: sctpStreamParameters.protocol
    };
    logger12.debug("sendDataChannel() [options:%o]", options);
    const dataChannel = this._pc.createDataChannel(sctpStreamParameters.label, options);
    this._nextSendSctpStreamId = ++this._nextSendSctpStreamId % (this._pc.sctp?.maxChannels ?? 65536);
    if (!this._hasDataChannelMediaSection) {
      try {
        const offer = await this._pc.createOffer();
        const localSdpObject = exports_lib.parse(offer.sdp);
        const offerMediaObject = localSdpObject.media.find((m) => m.type === "application");
        if (!this._transportReady) {
          await this.setupTransport({
            localDtlsRole: this._forcedLocalDtlsRole ?? "client",
            localSdpObject
          });
        }
        logger12.debug("sendDataChannel() | calling pc.setLocalDescription() [offer:%o]", offer);
        await this._pc.setLocalDescription(offer);
        this._remoteSdp.sendSctpAssociation({ offerMediaObject });
        const answer = {
          type: "answer",
          sdp: this._remoteSdp.getSdp()
        };
        logger12.debug("sendDataChannel() | calling pc.setRemoteDescription() [answer:%o]", answer);
        await this._pc.setRemoteDescription(answer);
        this._hasDataChannelMediaSection = true;
      } catch (error) {
        try {
          if (this._pc.signalingState === "have-local-offer") {
            try {
              await this._pc.setLocalDescription({ type: "rollback" });
            } catch (error2) {}
          }
          dataChannel.close();
        } catch (error3) {}
        throw error;
      }
    }
    const newSctpStreamParameters = {
      streamId: options.id,
      ordered: options.ordered,
      maxPacketLifeTime: options.maxPacketLifeTime,
      maxRetransmits: options.maxRetransmits
    };
    return { dataChannel, sctpStreamParameters: newSctpStreamParameters };
  }
  async receive(optionsList) {
    this.assertNotClosed();
    this.assertRecvDirection();
    const results = [];
    const mapLocalId = new Map;
    for (const options of optionsList) {
      const { trackId, kind, rtpParameters, streamId } = options;
      logger12.debug("receive() [trackId:%s, kind:%s]", trackId, kind);
      const localId = rtpParameters.mid ?? String(this._mapMidTransceiver.size);
      mapLocalId.set(trackId, localId);
      const { msidStreamId } = getMsidStreamIdAndTrackId(rtpParameters.msid);
      this._remoteSdp.receive({
        mid: localId,
        kind,
        offerRtpParameters: rtpParameters,
        streamId: streamId ?? msidStreamId ?? rtpParameters.rtcp?.cname ?? "-",
        trackId
      });
    }
    const offer = {
      type: "offer",
      sdp: this._remoteSdp.getSdp()
    };
    logger12.debug("receive() | calling pc.setRemoteDescription() [offer:%o]", offer);
    await this._pc.setRemoteDescription(offer);
    for (const options of optionsList) {
      const { trackId, onRtpReceiver } = options;
      if (onRtpReceiver) {
        const localId = mapLocalId.get(trackId);
        const transceiver = this._pc.getTransceivers().find((t) => t.mid === localId);
        if (!transceiver) {
          throw new Error("transceiver not found");
        }
        if (this._forcedRtpExtensions) {
          applyForcedRtpExtensions(transceiver, this._forcedRtpExtensions);
        }
        onRtpReceiver(transceiver.receiver);
      }
    }
    let answer = await this._pc.createAnswer();
    const localSdpObject = exports_lib.parse(answer.sdp);
    for (const options of optionsList) {
      const { trackId, rtpParameters } = options;
      const localId = mapLocalId.get(trackId);
      const answerMediaObject = localSdpObject.media.find((m) => String(m.mid) === localId);
      applyCodecParameters({
        offerRtpParameters: rtpParameters,
        answerMediaObject
      });
    }
    answer = {
      type: "answer",
      sdp: exports_lib.write(localSdpObject)
    };
    if (!this._transportReady) {
      await this.setupTransport({
        localDtlsRole: this._forcedLocalDtlsRole ?? "client",
        localSdpObject
      });
    }
    logger12.debug("receive() | calling pc.setLocalDescription() [answer:%o]", answer);
    await this._pc.setLocalDescription(answer);
    for (const options of optionsList) {
      const { trackId } = options;
      const localId = mapLocalId.get(trackId);
      const transceiver = this._pc.getTransceivers().find((t) => t.mid === localId);
      if (!transceiver) {
        throw new Error("new RTCRtpTransceiver not found");
      }
      this._mapMidTransceiver.set(localId, transceiver);
      results.push({
        localId,
        track: transceiver.receiver.track,
        rtpReceiver: transceiver.receiver
      });
    }
    return results;
  }
  async stopReceiving(localIds) {
    this.assertRecvDirection();
    if (this._closed) {
      return;
    }
    for (const localId of localIds) {
      logger12.debug("stopReceiving() [localId:%s]", localId);
      const transceiver = this._mapMidTransceiver.get(localId);
      if (!transceiver) {
        throw new Error("associated RTCRtpTransceiver not found");
      }
      this._remoteSdp.closeMediaSection(transceiver.mid);
    }
    const offer = {
      type: "offer",
      sdp: this._remoteSdp.getSdp()
    };
    logger12.debug("stopReceiving() | calling pc.setRemoteDescription() [offer:%o]", offer);
    await this._pc.setRemoteDescription(offer);
    const answer = await this._pc.createAnswer();
    logger12.debug("stopReceiving() | calling pc.setLocalDescription() [answer:%o]", answer);
    await this._pc.setLocalDescription(answer);
    for (const localId of localIds) {
      this._mapMidTransceiver.delete(localId);
    }
  }
  async pauseReceiving(localIds) {
    this.assertNotClosed();
    this.assertRecvDirection();
    for (const localId of localIds) {
      logger12.debug("pauseReceiving() [localId:%s]", localId);
      const transceiver = this._mapMidTransceiver.get(localId);
      if (!transceiver) {
        throw new Error("associated RTCRtpTransceiver not found");
      }
      transceiver.direction = "inactive";
      this._remoteSdp.pauseMediaSection(localId);
    }
    const offer = {
      type: "offer",
      sdp: this._remoteSdp.getSdp()
    };
    logger12.debug("pauseReceiving() | calling pc.setRemoteDescription() [offer:%o]", offer);
    await this._pc.setRemoteDescription(offer);
    const answer = await this._pc.createAnswer();
    logger12.debug("pauseReceiving() | calling pc.setLocalDescription() [answer:%o]", answer);
    await this._pc.setLocalDescription(answer);
  }
  async resumeReceiving(localIds) {
    this.assertNotClosed();
    this.assertRecvDirection();
    for (const localId of localIds) {
      logger12.debug("resumeReceiving() [localId:%s]", localId);
      const transceiver = this._mapMidTransceiver.get(localId);
      if (!transceiver) {
        throw new Error("associated RTCRtpTransceiver not found");
      }
      transceiver.direction = "recvonly";
      this._remoteSdp.resumeReceivingMediaSection(localId);
    }
    const offer = {
      type: "offer",
      sdp: this._remoteSdp.getSdp()
    };
    logger12.debug("resumeReceiving() | calling pc.setRemoteDescription() [offer:%o]", offer);
    await this._pc.setRemoteDescription(offer);
    const answer = await this._pc.createAnswer();
    logger12.debug("resumeReceiving() | calling pc.setLocalDescription() [answer:%o]", answer);
    await this._pc.setLocalDescription(answer);
  }
  async getReceiverStats(localId) {
    this.assertNotClosed();
    this.assertRecvDirection();
    const transceiver = this._mapMidTransceiver.get(localId);
    if (!transceiver) {
      throw new Error("associated RTCRtpTransceiver not found");
    }
    return transceiver.receiver.getStats();
  }
  async receiveDataChannel({
    maxMessageSize,
    sctpStreamParameters,
    label,
    protocol
  }) {
    this.assertNotClosed();
    this.assertRecvDirection();
    const {
      streamId,
      ordered,
      maxPacketLifeTime,
      maxRetransmits
    } = sctpStreamParameters;
    const options = {
      negotiated: true,
      id: streamId,
      ordered,
      maxPacketLifeTime,
      maxRetransmits,
      protocol
    };
    logger12.debug("receiveDataChannel() [options:%o]", options);
    const dataChannel = this._pc.createDataChannel(label, options);
    if (!this._hasDataChannelMediaSection) {
      this._remoteSdp.receiveSctpAssociation();
      const offer = {
        type: "offer",
        sdp: this._remoteSdp.getSdp()
      };
      logger12.debug("receiveDataChannel() | calling pc.setRemoteDescription() [offer:%o]", offer);
      await this._pc.setRemoteDescription(offer);
      let answer = await this._pc.createAnswer();
      const localSdpObject = exports_lib.parse(answer.sdp);
      const answerMediaObject = localSdpObject.media.find((m) => m.type === "application");
      if (typeof maxMessageSize === "number") {
        answerMediaObject.maxMessageSize = maxMessageSize;
      }
      if (!this._transportReady) {
        await this.setupTransport({
          localDtlsRole: this._forcedLocalDtlsRole ?? "client",
          localSdpObject
        });
      }
      answer = {
        type: "answer",
        sdp: exports_lib.write(localSdpObject)
      };
      logger12.debug("receiveDataChannel() | calling pc.setLocalDescription() [answer:%o]", answer);
      await this._pc.setLocalDescription(answer);
      this._hasDataChannelMediaSection = true;
    }
    return { dataChannel };
  }
  getDataChannelMaxMessageSize() {
    return this._direction === "send" ? this._pc.sctp?.maxMessageSize : this._sctpMaxReceiveMessageSize;
  }
  async setupTransport({
    localDtlsRole,
    localSdpObject
  }) {
    if (!localSdpObject) {
      localSdpObject = exports_lib.parse(this._pc.localDescription.sdp);
    }
    const dtlsParameters = extractDtlsParameters({
      sdpObject: localSdpObject
    });
    dtlsParameters.role = localDtlsRole;
    this._remoteSdp.updateDtlsRole(localDtlsRole === "client" ? "server" : "client");
    await new Promise((resolve, reject) => {
      this.safeEmit("@connect", { dtlsParameters }, resolve, reject);
    });
    this._transportReady = true;
  }
  onIceGatheringStateChange = () => {
    this.emit("@icegatheringstatechange", this._pc.iceGatheringState);
  };
  onIceCandidateError = (event) => {
    this.emit("@icecandidateerror", event);
  };
  onConnectionStateChange = () => {
    this.emit("@connectionstatechange", this._pc.connectionState);
  };
  onIceConnectionStateChange = () => {
    switch (this._pc.iceConnectionState) {
      case "checking": {
        this.emit("@connectionstatechange", "connecting");
        break;
      }
      case "connected":
      case "completed": {
        this.emit("@connectionstatechange", "connected");
        break;
      }
      case "failed": {
        this.emit("@connectionstatechange", "failed");
        break;
      }
      case "disconnected": {
        this.emit("@connectionstatechange", "disconnected");
        break;
      }
      case "closed": {
        this.emit("@connectionstatechange", "closed");
        break;
      }
    }
  };
  assertNotClosed() {
    if (this._closed) {
      throw new InvalidStateError("method called in a closed handler");
    }
  }
  assertSendDirection() {
    if (this._direction !== "send") {
      throw new Error('method can just be called for handlers with "send" direction');
    }
  }
  assertRecvDirection() {
    if (this._direction !== "recv") {
      throw new Error('method can just be called for handlers with "recv" direction');
    }
  }
}

// ../ms/msc/src/handlers/ReactNative106.ts
var logger13 = new Logger("ReactNative106");
var NAME5 = "ReactNative106";

class ReactNative106 extends EnhancedEventEmitter {
  _closed = false;
  _direction;
  _sctpMaxReceiveMessageSize;
  _remoteSdp;
  _getSendExtendedRtpCapabilities;
  _forcedRtpExtensions;
  _forcedLocalDtlsRole;
  _pc;
  _mapMidTransceiver = new Map;
  _sendStream = new MediaStream;
  _hasDataChannelMediaSection = false;
  _nextSendSctpStreamId = 0;
  _transportReady = false;
  static createFactory({
    forcedRtpExtensions
  }) {
    return {
      name: NAME5,
      factory: (options) => new ReactNative106({ ...options, forcedRtpExtensions }),
      getNativeRtpCapabilities: async ({
        direction
      }) => {
        logger13.debug("getNativeRtpCapabilities() [direction:%o]", direction);
        let pc = new RTCPeerConnection({
          iceServers: [],
          iceTransportPolicy: "all",
          bundlePolicy: "max-bundle",
          rtcpMuxPolicy: "require"
        });
        try {
          const audioTransceiver = pc.addTransceiver("audio", { direction });
          if (forcedRtpExtensions) {
            applyForcedRtpExtensions(audioTransceiver, forcedRtpExtensions);
          }
          const videoTransceiver = pc.addTransceiver("video", { direction });
          if (forcedRtpExtensions) {
            applyForcedRtpExtensions(videoTransceiver, forcedRtpExtensions);
          }
          const offer = await pc.createOffer();
          try {
            pc.close();
          } catch (error) {}
          pc = undefined;
          const sdpObject = exports_lib.parse(offer.sdp);
          const nativeRtpCapabilities = ReactNative106.getLocalRtpCapabilities(sdpObject);
          return nativeRtpCapabilities;
        } catch (error) {
          try {
            pc?.close();
          } catch (error2) {}
          pc = undefined;
          throw error;
        }
      }
    };
  }
  static getLocalRtpCapabilities(localSdpObject) {
    const nativeRtpCapabilities = extractRtpCapabilities({
      sdpObject: localSdpObject
    });
    validateAndNormalizeRtpCapabilities(nativeRtpCapabilities);
    addNackSupportForOpus(nativeRtpCapabilities);
    return nativeRtpCapabilities;
  }
  constructor({
    direction,
    iceParameters,
    iceCandidates,
    dtlsParameters,
    sctpParameters,
    iceServers,
    iceTransportPolicy,
    additionalSettings,
    getSendExtendedRtpCapabilities,
    forcedRtpExtensions
  }) {
    super();
    logger13.debug("constructor()");
    this._direction = direction;
    this._sctpMaxReceiveMessageSize = sctpParameters?.maxSendMessageSize;
    this._remoteSdp = new RemoteSdp({
      iceParameters,
      iceCandidates,
      dtlsParameters,
      sctpParameters
    });
    this._getSendExtendedRtpCapabilities = getSendExtendedRtpCapabilities;
    this._forcedRtpExtensions = forcedRtpExtensions;
    if (dtlsParameters.role && dtlsParameters.role !== "auto") {
      this._forcedLocalDtlsRole = dtlsParameters.role === "server" ? "client" : "server";
    }
    this._pc = new RTCPeerConnection({
      iceServers: iceServers ?? [],
      iceTransportPolicy: iceTransportPolicy ?? "all",
      bundlePolicy: "max-bundle",
      rtcpMuxPolicy: "require",
      ...additionalSettings
    });
    this._pc.addEventListener("icegatheringstatechange", this.onIceGatheringStateChange);
    this._pc.addEventListener("icecandidateerror", this.onIceCandidateError);
    if (this._pc.connectionState) {
      this._pc.addEventListener("connectionstatechange", this.onConnectionStateChange);
    } else {
      logger13.warn("run() | pc.connectionState not supported, using pc.iceConnectionState");
      this._pc.addEventListener("iceconnectionstatechange", this.onIceConnectionStateChange);
    }
  }
  get name() {
    return NAME5;
  }
  close() {
    logger13.debug("close()");
    if (this._closed) {
      return;
    }
    this._closed = true;
    this._sendStream.release(false);
    try {
      this._pc.close();
    } catch (error) {}
    this._pc.removeEventListener("icegatheringstatechange", this.onIceGatheringStateChange);
    this._pc.removeEventListener("icecandidateerror", this.onIceCandidateError);
    this._pc.removeEventListener("connectionstatechange", this.onConnectionStateChange);
    this._pc.removeEventListener("iceconnectionstatechange", this.onIceConnectionStateChange);
    this.emit("@close");
    super.close();
  }
  async updateIceServers(iceServers) {
    this.assertNotClosed();
    logger13.debug("updateIceServers()");
    const configuration = this._pc.getConfiguration();
    configuration.iceServers = iceServers;
    this._pc.setConfiguration(configuration);
  }
  async restartIce(iceParameters) {
    this.assertNotClosed();
    logger13.debug("restartIce()");
    this._remoteSdp.updateIceParameters(iceParameters);
    if (!this._transportReady) {
      return;
    }
    if (this._direction === "send") {
      const offer = await this._pc.createOffer({ iceRestart: true });
      logger13.debug("restartIce() | calling pc.setLocalDescription() [offer:%o]", offer);
      await this._pc.setLocalDescription(offer);
      const answer = {
        type: "answer",
        sdp: this._remoteSdp.getSdp()
      };
      logger13.debug("restartIce() | calling pc.setRemoteDescription() [answer:%o]", answer);
      await this._pc.setRemoteDescription(answer);
    } else {
      const offer = {
        type: "offer",
        sdp: this._remoteSdp.getSdp()
      };
      logger13.debug("restartIce() | calling pc.setRemoteDescription() [offer:%o]", offer);
      await this._pc.setRemoteDescription(offer);
      const answer = await this._pc.createAnswer();
      logger13.debug("restartIce() | calling pc.setLocalDescription() [answer:%o]", answer);
      await this._pc.setLocalDescription(answer);
    }
  }
  async getTransportStats() {
    this.assertNotClosed();
    return this._pc.getStats();
  }
  async send({
    track,
    streamId,
    encodings,
    codecOptions,
    codec,
    onRtpSender
  }) {
    this.assertNotClosed();
    this.assertSendDirection();
    logger13.debug("send() [kind:%s, track.id:%s, streamId:%s]", track.kind, track.id, streamId);
    if (encodings && encodings.length > 1) {
      encodings.forEach((encoding, idx) => {
        encoding.rid = `r${idx}`;
      });
    }
    let transceiver;
    try {
      transceiver = this._pc.addTransceiver(track, {
        direction: "sendonly",
        streams: [this._sendStream],
        sendEncodings: encodings
      });
      const mediaSectionIdx = this._remoteSdp.getNextMediaSectionIdx();
      if (this._forcedRtpExtensions) {
        applyForcedRtpExtensions(transceiver, this._forcedRtpExtensions);
      }
      if (onRtpSender) {
        onRtpSender(transceiver.sender);
      }
      let offer = await this._pc.createOffer();
      let localSdpObject = exports_lib.parse(offer.sdp);
      if (localSdpObject.extmapAllowMixed) {
        this._remoteSdp.setSessionExtmapAllowMixed();
      }
      const nativeRtpCapabilities = ReactNative106.getLocalRtpCapabilities(localSdpObject);
      const sendExtendedRtpCapabilities = this._getSendExtendedRtpCapabilities(nativeRtpCapabilities);
      const sendingRtpParameters = getSendingRtpParameters(track.kind, sendExtendedRtpCapabilities);
      sendingRtpParameters.codecs = reduceCodecs(sendingRtpParameters.codecs, codec);
      const sendingRemoteRtpParameters = getSendingRemoteRtpParameters(track.kind, sendExtendedRtpCapabilities);
      sendingRemoteRtpParameters.codecs = reduceCodecs(sendingRemoteRtpParameters.codecs, codec);
      if (!this._transportReady) {
        await this.setupTransport({
          localDtlsRole: this._forcedLocalDtlsRole ?? "client",
          localSdpObject
        });
      }
      let hackVp9Svc = false;
      const layers = parse((encodings ?? [{}])[0].scalabilityMode);
      let offerMediaObject;
      if (encodings?.length === 1 && layers.spatialLayers > 1 && sendingRtpParameters.codecs[0].mimeType.toLowerCase() === "video/vp9") {
        logger13.debug("send() | enabling legacy simulcast for VP9 SVC");
        hackVp9Svc = true;
        localSdpObject = exports_lib.parse(offer.sdp);
        offerMediaObject = localSdpObject.media[mediaSectionIdx.idx];
        addLegacySimulcast({
          offerMediaObject,
          numStreams: layers.spatialLayers
        });
        offer = {
          type: "offer",
          sdp: exports_lib.write(localSdpObject)
        };
      }
      logger13.debug("send() | calling pc.setLocalDescription() [offer:%o]", offer);
      await this._pc.setLocalDescription(offer);
      let localId = transceiver.mid ?? undefined;
      if (!localId) {
        logger13.warn("send() | missing transceiver.mid (bug in react-native-webrtc, using a workaround");
      }
      sendingRtpParameters.mid = localId;
      localSdpObject = exports_lib.parse(this._pc.localDescription.sdp);
      offerMediaObject = localSdpObject.media[mediaSectionIdx.idx];
      sendingRtpParameters.rtcp.cname = getCname({
        offerMediaObject
      });
      sendingRtpParameters.msid = `${streamId ?? this._sendStream.id} ${track.id}`;
      if (!encodings) {
        sendingRtpParameters.encodings = getRtpEncodings({
          offerMediaObject,
          codecs: sendingRtpParameters.codecs
        });
      } else if (encodings.length === 1) {
        let newEncodings = getRtpEncodings({
          offerMediaObject,
          codecs: sendingRtpParameters.codecs
        });
        Object.assign(newEncodings[0], encodings[0]);
        if (hackVp9Svc) {
          newEncodings = [newEncodings[0]];
        }
        sendingRtpParameters.encodings = newEncodings;
      } else {
        sendingRtpParameters.encodings = encodings;
      }
      if (sendingRtpParameters.encodings.length > 1 && (sendingRtpParameters.codecs[0].mimeType.toLowerCase() === "video/vp8" || sendingRtpParameters.codecs[0].mimeType.toLowerCase() === "video/h264")) {
        for (const encoding of sendingRtpParameters.encodings) {
          if (encoding.scalabilityMode) {
            encoding.scalabilityMode = `L1T${layers.temporalLayers}`;
          } else {
            encoding.scalabilityMode = "L1T3";
          }
        }
      }
      this._remoteSdp.send({
        offerMediaObject,
        reuseMid: mediaSectionIdx.reuseMid,
        offerRtpParameters: sendingRtpParameters,
        answerRtpParameters: sendingRemoteRtpParameters,
        codecOptions
      });
      const answer = {
        type: "answer",
        sdp: this._remoteSdp.getSdp()
      };
      logger13.debug("send() | calling pc.setRemoteDescription() [answer:%o]", answer);
      await this._pc.setRemoteDescription(answer);
      if (!localId) {
        localId = transceiver.mid;
        sendingRtpParameters.mid = localId;
      }
      this._mapMidTransceiver.set(localId, transceiver);
      return {
        localId,
        rtpParameters: sendingRtpParameters,
        rtpSender: transceiver.sender
      };
    } catch (error) {
      try {
        if (this._pc.signalingState === "have-local-offer") {
          try {
            await this._pc.setLocalDescription({ type: "rollback" });
          } catch (error2) {}
        }
        transceiver?.stop();
      } catch (error3) {}
      throw error;
    }
  }
  async stopSending(localId) {
    this.assertSendDirection();
    if (this._closed) {
      return;
    }
    logger13.debug("stopSending() [localId:%s]", localId);
    const transceiver = this._mapMidTransceiver.get(localId);
    if (!transceiver) {
      throw new Error("associated RTCRtpTransceiver not found");
    }
    transceiver.sender.replaceTrack(null);
    this._pc.removeTrack(transceiver.sender);
    const mediaSectionClosed = this._remoteSdp.closeMediaSection(transceiver.mid);
    if (mediaSectionClosed) {
      try {
        transceiver.stop();
      } catch (error) {}
    }
    const offer = await this._pc.createOffer();
    logger13.debug("stopSending() | calling pc.setLocalDescription() [offer:%o]", offer);
    await this._pc.setLocalDescription(offer);
    const answer = {
      type: "answer",
      sdp: this._remoteSdp.getSdp()
    };
    logger13.debug("stopSending() | calling pc.setRemoteDescription() [answer:%o]", answer);
    await this._pc.setRemoteDescription(answer);
    this._mapMidTransceiver.delete(localId);
  }
  async pauseSending(localId) {
    this.assertNotClosed();
    this.assertSendDirection();
    logger13.debug("pauseSending() [localId:%s]", localId);
    const transceiver = this._mapMidTransceiver.get(localId);
    if (!transceiver) {
      throw new Error("associated RTCRtpTransceiver not found");
    }
    transceiver.direction = "inactive";
    this._remoteSdp.pauseMediaSection(localId);
    const offer = await this._pc.createOffer();
    logger13.debug("pauseSending() | calling pc.setLocalDescription() [offer:%o]", offer);
    await this._pc.setLocalDescription(offer);
    const answer = {
      type: "answer",
      sdp: this._remoteSdp.getSdp()
    };
    logger13.debug("pauseSending() | calling pc.setRemoteDescription() [answer:%o]", answer);
    await this._pc.setRemoteDescription(answer);
  }
  async resumeSending(localId) {
    this.assertNotClosed();
    this.assertSendDirection();
    logger13.debug("resumeSending() [localId:%s]", localId);
    const transceiver = this._mapMidTransceiver.get(localId);
    this._remoteSdp.resumeSendingMediaSection(localId);
    if (!transceiver) {
      throw new Error("associated RTCRtpTransceiver not found");
    }
    transceiver.direction = "sendonly";
    const offer = await this._pc.createOffer();
    logger13.debug("resumeSending() | calling pc.setLocalDescription() [offer:%o]", offer);
    await this._pc.setLocalDescription(offer);
    const answer = {
      type: "answer",
      sdp: this._remoteSdp.getSdp()
    };
    logger13.debug("resumeSending() | calling pc.setRemoteDescription() [answer:%o]", answer);
    await this._pc.setRemoteDescription(answer);
  }
  async replaceTrack(localId, track) {
    this.assertNotClosed();
    this.assertSendDirection();
    if (track) {
      logger13.debug("replaceTrack() [localId:%s, track.id:%s]", localId, track.id);
    } else {
      logger13.debug("replaceTrack() [localId:%s, no track]", localId);
    }
    const transceiver = this._mapMidTransceiver.get(localId);
    if (!transceiver) {
      throw new Error("associated RTCRtpTransceiver not found");
    }
    await transceiver.sender.replaceTrack(track);
  }
  async setMaxSpatialLayer(localId, spatialLayer) {
    this.assertNotClosed();
    this.assertSendDirection();
    logger13.debug("setMaxSpatialLayer() [localId:%s, spatialLayer:%s]", localId, spatialLayer);
    const transceiver = this._mapMidTransceiver.get(localId);
    if (!transceiver) {
      throw new Error("associated RTCRtpTransceiver not found");
    }
    const parameters = transceiver.sender.getParameters();
    parameters.encodings.forEach((encoding, idx) => {
      if (idx <= spatialLayer) {
        encoding.active = true;
      } else {
        encoding.active = false;
      }
    });
    await transceiver.sender.setParameters(parameters);
    this._remoteSdp.muxMediaSectionSimulcast(localId, parameters.encodings);
    const offer = await this._pc.createOffer();
    logger13.debug("setMaxSpatialLayer() | calling pc.setLocalDescription() [offer:%o]", offer);
    await this._pc.setLocalDescription(offer);
    const answer = {
      type: "answer",
      sdp: this._remoteSdp.getSdp()
    };
    logger13.debug("setMaxSpatialLayer() | calling pc.setRemoteDescription() [answer:%o]", answer);
    await this._pc.setRemoteDescription(answer);
  }
  async setRtpEncodingParameters(localId, params) {
    this.assertNotClosed();
    this.assertSendDirection();
    logger13.debug("setRtpEncodingParameters() [localId:%s, params:%o]", localId, params);
    const transceiver = this._mapMidTransceiver.get(localId);
    if (!transceiver) {
      throw new Error("associated RTCRtpTransceiver not found");
    }
    const parameters = transceiver.sender.getParameters();
    parameters.encodings.forEach((encoding, idx) => {
      parameters.encodings[idx] = { ...encoding, ...params };
    });
    await transceiver.sender.setParameters(parameters);
    this._remoteSdp.muxMediaSectionSimulcast(localId, parameters.encodings);
    const offer = await this._pc.createOffer();
    logger13.debug("setRtpEncodingParameters() | calling pc.setLocalDescription() [offer:%o]", offer);
    await this._pc.setLocalDescription(offer);
    const answer = {
      type: "answer",
      sdp: this._remoteSdp.getSdp()
    };
    logger13.debug("setRtpEncodingParameters() | calling pc.setRemoteDescription() [answer:%o]", answer);
    await this._pc.setRemoteDescription(answer);
  }
  async getSenderStats(localId) {
    this.assertNotClosed();
    this.assertSendDirection();
    const transceiver = this._mapMidTransceiver.get(localId);
    if (!transceiver) {
      throw new Error("associated RTCRtpTransceiver not found");
    }
    return transceiver.sender.getStats();
  }
  async sendDataChannel({
    sctpStreamParameters
  }) {
    this.assertNotClosed();
    this.assertSendDirection();
    const options = {
      negotiated: true,
      id: this._nextSendSctpStreamId,
      ordered: sctpStreamParameters.ordered,
      maxPacketLifeTime: sctpStreamParameters.maxPacketLifeTime,
      maxRetransmits: sctpStreamParameters.maxRetransmits,
      protocol: sctpStreamParameters.protocol
    };
    logger13.debug("sendDataChannel() [options:%o]", options);
    const dataChannel = this._pc.createDataChannel(sctpStreamParameters.label, options);
    this._nextSendSctpStreamId = ++this._nextSendSctpStreamId % (this._pc.sctp?.maxChannels ?? 65536);
    if (!this._hasDataChannelMediaSection) {
      try {
        const offer = await this._pc.createOffer();
        const localSdpObject = exports_lib.parse(offer.sdp);
        const offerMediaObject = localSdpObject.media.find((m) => m.type === "application");
        if (!this._transportReady) {
          await this.setupTransport({
            localDtlsRole: this._forcedLocalDtlsRole ?? "client",
            localSdpObject
          });
        }
        logger13.debug("sendDataChannel() | calling pc.setLocalDescription() [offer:%o]", offer);
        await this._pc.setLocalDescription(offer);
        this._remoteSdp.sendSctpAssociation({ offerMediaObject });
        const answer = {
          type: "answer",
          sdp: this._remoteSdp.getSdp()
        };
        logger13.debug("sendDataChannel() | calling pc.setRemoteDescription() [answer:%o]", answer);
        await this._pc.setRemoteDescription(answer);
        this._hasDataChannelMediaSection = true;
      } catch (error) {
        try {
          if (this._pc.signalingState === "have-local-offer") {
            try {
              await this._pc.setLocalDescription({ type: "rollback" });
            } catch (error2) {}
          }
          dataChannel.close();
        } catch (error3) {}
        throw error;
      }
    }
    const newSctpStreamParameters = {
      streamId: options.id,
      ordered: options.ordered,
      maxPacketLifeTime: options.maxPacketLifeTime,
      maxRetransmits: options.maxRetransmits
    };
    return { dataChannel, sctpStreamParameters: newSctpStreamParameters };
  }
  async receive(optionsList) {
    this.assertNotClosed();
    this.assertRecvDirection();
    const results = [];
    const mapLocalId = new Map;
    for (const options of optionsList) {
      const { trackId, kind, rtpParameters, streamId } = options;
      logger13.debug("receive() [trackId:%s, kind:%s]", trackId, kind);
      const localId = rtpParameters.mid ?? String(this._mapMidTransceiver.size);
      mapLocalId.set(trackId, localId);
      const { msidStreamId } = getMsidStreamIdAndTrackId(rtpParameters.msid);
      this._remoteSdp.receive({
        mid: localId,
        kind,
        offerRtpParameters: rtpParameters,
        streamId: streamId ?? msidStreamId ?? rtpParameters.rtcp?.cname ?? "-",
        trackId
      });
    }
    const offer = {
      type: "offer",
      sdp: this._remoteSdp.getSdp()
    };
    logger13.debug("receive() | calling pc.setRemoteDescription() [offer:%o]", offer);
    await this._pc.setRemoteDescription(offer);
    for (const options of optionsList) {
      const { trackId, onRtpReceiver } = options;
      if (onRtpReceiver) {
        const localId = mapLocalId.get(trackId);
        const transceiver = this._pc.getTransceivers().find((t) => t.mid === localId);
        if (!transceiver) {
          throw new Error("transceiver not found");
        }
        if (this._forcedRtpExtensions) {
          applyForcedRtpExtensions(transceiver, this._forcedRtpExtensions);
        }
        onRtpReceiver(transceiver.receiver);
      }
    }
    let answer = await this._pc.createAnswer();
    const localSdpObject = exports_lib.parse(answer.sdp);
    for (const options of optionsList) {
      const { trackId, rtpParameters } = options;
      const localId = mapLocalId.get(trackId);
      const answerMediaObject = localSdpObject.media.find((m) => String(m.mid) === localId);
      applyCodecParameters({
        offerRtpParameters: rtpParameters,
        answerMediaObject
      });
    }
    answer = {
      type: "answer",
      sdp: exports_lib.write(localSdpObject)
    };
    if (!this._transportReady) {
      await this.setupTransport({
        localDtlsRole: this._forcedLocalDtlsRole ?? "client",
        localSdpObject
      });
    }
    logger13.debug("receive() | calling pc.setLocalDescription() [answer:%o]", answer);
    await this._pc.setLocalDescription(answer);
    for (const options of optionsList) {
      const { trackId } = options;
      const localId = mapLocalId.get(trackId);
      const transceiver = this._pc.getTransceivers().find((t) => t.mid === localId);
      if (!transceiver) {
        throw new Error("new RTCRtpTransceiver not found");
      } else {
        this._mapMidTransceiver.set(localId, transceiver);
        results.push({
          localId,
          track: transceiver.receiver.track,
          rtpReceiver: transceiver.receiver
        });
      }
    }
    return results;
  }
  async stopReceiving(localIds) {
    this.assertRecvDirection();
    if (this._closed) {
      return;
    }
    for (const localId of localIds) {
      logger13.debug("stopReceiving() [localId:%s]", localId);
      const transceiver = this._mapMidTransceiver.get(localId);
      if (!transceiver) {
        throw new Error("associated RTCRtpTransceiver not found");
      }
      this._remoteSdp.closeMediaSection(transceiver.mid);
    }
    const offer = {
      type: "offer",
      sdp: this._remoteSdp.getSdp()
    };
    logger13.debug("stopReceiving() | calling pc.setRemoteDescription() [offer:%o]", offer);
    await this._pc.setRemoteDescription(offer);
    const answer = await this._pc.createAnswer();
    logger13.debug("stopReceiving() | calling pc.setLocalDescription() [answer:%o]", answer);
    await this._pc.setLocalDescription(answer);
    for (const localId of localIds) {
      this._mapMidTransceiver.delete(localId);
    }
  }
  async pauseReceiving(localIds) {
    this.assertNotClosed();
    this.assertRecvDirection();
    for (const localId of localIds) {
      logger13.debug("pauseReceiving() [localId:%s]", localId);
      const transceiver = this._mapMidTransceiver.get(localId);
      if (!transceiver) {
        throw new Error("associated RTCRtpTransceiver not found");
      }
      transceiver.direction = "inactive";
      this._remoteSdp.pauseMediaSection(localId);
    }
    const offer = {
      type: "offer",
      sdp: this._remoteSdp.getSdp()
    };
    logger13.debug("pauseReceiving() | calling pc.setRemoteDescription() [offer:%o]", offer);
    await this._pc.setRemoteDescription(offer);
    const answer = await this._pc.createAnswer();
    logger13.debug("pauseReceiving() | calling pc.setLocalDescription() [answer:%o]", answer);
    await this._pc.setLocalDescription(answer);
  }
  async resumeReceiving(localIds) {
    this.assertNotClosed();
    this.assertRecvDirection();
    for (const localId of localIds) {
      logger13.debug("resumeReceiving() [localId:%s]", localId);
      const transceiver = this._mapMidTransceiver.get(localId);
      if (!transceiver) {
        throw new Error("associated RTCRtpTransceiver not found");
      }
      transceiver.direction = "recvonly";
      this._remoteSdp.resumeReceivingMediaSection(localId);
    }
    const offer = {
      type: "offer",
      sdp: this._remoteSdp.getSdp()
    };
    logger13.debug("resumeReceiving() | calling pc.setRemoteDescription() [offer:%o]", offer);
    await this._pc.setRemoteDescription(offer);
    const answer = await this._pc.createAnswer();
    logger13.debug("resumeReceiving() | calling pc.setLocalDescription() [answer:%o]", answer);
    await this._pc.setLocalDescription(answer);
  }
  async getReceiverStats(localId) {
    this.assertNotClosed();
    this.assertRecvDirection();
    const transceiver = this._mapMidTransceiver.get(localId);
    if (!transceiver) {
      throw new Error("associated RTCRtpTransceiver not found");
    }
    return transceiver.receiver.getStats();
  }
  async receiveDataChannel({
    maxMessageSize,
    sctpStreamParameters,
    label,
    protocol
  }) {
    this.assertNotClosed();
    this.assertRecvDirection();
    const {
      streamId,
      ordered,
      maxPacketLifeTime,
      maxRetransmits
    } = sctpStreamParameters;
    const options = {
      negotiated: true,
      id: streamId,
      ordered,
      maxPacketLifeTime,
      maxRetransmits,
      protocol
    };
    logger13.debug("receiveDataChannel() [options:%o]", options);
    const dataChannel = this._pc.createDataChannel(label, options);
    if (!this._hasDataChannelMediaSection) {
      this._remoteSdp.receiveSctpAssociation();
      const offer = {
        type: "offer",
        sdp: this._remoteSdp.getSdp()
      };
      logger13.debug("receiveDataChannel() | calling pc.setRemoteDescription() [offer:%o]", offer);
      await this._pc.setRemoteDescription(offer);
      let answer = await this._pc.createAnswer();
      const localSdpObject = exports_lib.parse(answer.sdp);
      const answerMediaObject = localSdpObject.media.find((m) => m.type === "application");
      if (typeof maxMessageSize === "number") {
        answerMediaObject.maxMessageSize = maxMessageSize;
      }
      if (!this._transportReady) {
        await this.setupTransport({
          localDtlsRole: this._forcedLocalDtlsRole ?? "client",
          localSdpObject
        });
      }
      answer = {
        type: "answer",
        sdp: exports_lib.write(localSdpObject)
      };
      logger13.debug("receiveDataChannel() | calling pc.setLocalDescription() [answer:%o]", answer);
      await this._pc.setLocalDescription(answer);
      this._hasDataChannelMediaSection = true;
    }
    return { dataChannel };
  }
  getDataChannelMaxMessageSize() {
    return this._direction === "send" ? this._pc.sctp?.maxMessageSize : this._sctpMaxReceiveMessageSize;
  }
  async setupTransport({
    localDtlsRole,
    localSdpObject
  }) {
    if (!localSdpObject) {
      localSdpObject = exports_lib.parse(this._pc.localDescription.sdp);
    }
    const dtlsParameters = extractDtlsParameters({
      sdpObject: localSdpObject
    });
    dtlsParameters.role = localDtlsRole;
    this._remoteSdp.updateDtlsRole(localDtlsRole === "client" ? "server" : "client");
    await new Promise((resolve, reject) => {
      this.safeEmit("@connect", { dtlsParameters }, resolve, reject);
    });
    this._transportReady = true;
  }
  onIceGatheringStateChange = () => {
    this.emit("@icegatheringstatechange", this._pc.iceGatheringState);
  };
  onIceCandidateError = (event) => {
    this.emit("@icecandidateerror", event);
  };
  onConnectionStateChange = () => {
    this.emit("@connectionstatechange", this._pc.connectionState);
  };
  onIceConnectionStateChange = () => {
    switch (this._pc.iceConnectionState) {
      case "checking": {
        this.emit("@connectionstatechange", "connecting");
        break;
      }
      case "connected":
      case "completed": {
        this.emit("@connectionstatechange", "connected");
        break;
      }
      case "failed": {
        this.emit("@connectionstatechange", "failed");
        break;
      }
      case "disconnected": {
        this.emit("@connectionstatechange", "disconnected");
        break;
      }
      case "closed": {
        this.emit("@connectionstatechange", "closed");
        break;
      }
    }
  };
  assertNotClosed() {
    if (this._closed) {
      throw new InvalidStateError("method called in a closed handler");
    }
  }
  assertSendDirection() {
    if (this._direction !== "send") {
      throw new Error('method can just be called for handlers with "send" direction');
    }
  }
  assertRecvDirection() {
    if (this._direction !== "recv") {
      throw new Error('method can just be called for handlers with "recv" direction');
    }
  }
}

// ../ms/msc/src/Device.ts
var logger14 = new Logger("Device");
function detectDevice(userAgent, userAgentData) {
  logger14.debug("detectDevice()");
  if (!userAgent && typeof navigator === "object") {
    userAgent = navigator.userAgent;
  }
  if (!userAgentData && typeof navigator === "object") {
    userAgentData = navigator.userAgentData;
  }
  return detectDeviceImpl(userAgent, userAgentData);
}
async function detectDeviceAsync(userAgent, userAgentData) {
  logger14.debug("detectDeviceAsync()");
  if (!userAgent && typeof navigator === "object") {
    userAgent = navigator.userAgent;
  }
  if (!userAgentData && typeof navigator === "object") {
    userAgentData = navigator.userAgentData;
  }
  return detectDeviceImpl(userAgent, userAgentData);
}

class Device {
  _handlerFactory;
  _handlerName;
  _loaded = false;
  _getSendExtendedRtpCapabilities;
  _recvRtpCapabilities;
  _sendRtpCapabilities;
  _canProduceByKind = {
    audio: false,
    video: false
  };
  _observer = new EnhancedEventEmitter;
  static async factory({
    handlerName,
    handlerFactory,
    forcedRtpExtensions
  } = {}) {
    logger14.debug("factory()");
    if (handlerName && handlerFactory) {
      throw new TypeError("just one of handlerName or handlerInterface can be given");
    }
    if (!handlerName && !handlerFactory) {
      handlerName = await detectDeviceAsync();
      if (!handlerName) {
        throw new UnsupportedError("device not supported");
      }
    }
    return new Device({
      handlerName,
      handlerFactory,
      forcedRtpExtensions
    });
  }
  constructor({
    handlerName,
    handlerFactory,
    forcedRtpExtensions
  } = {}) {
    logger14.debug("constructor()");
    if (handlerName && handlerFactory) {
      throw new TypeError("just one of handlerName or handlerInterface can be given");
    }
    if (handlerFactory) {
      this._handlerFactory = handlerFactory;
    } else {
      if (handlerName) {
        logger14.debug("constructor() | handler given: %s", handlerName);
      } else {
        handlerName = detectDevice();
        if (handlerName) {
          logger14.debug("constructor() | detected handler: %s", handlerName);
        } else {
          throw new UnsupportedError("device not supported");
        }
      }
      switch (handlerName) {
        case "Chrome111": {
          this._handlerFactory = Chrome111.createFactory({
            forcedRtpExtensions
          });
          break;
        }
        case "Chrome74": {
          this._handlerFactory = Chrome74.createFactory({
            forcedRtpExtensions
          });
          break;
        }
        case "Firefox120": {
          this._handlerFactory = Firefox120.createFactory({
            forcedRtpExtensions
          });
          break;
        }
        case "Safari12": {
          this._handlerFactory = Safari12.createFactory({
            forcedRtpExtensions
          });
          break;
        }
        case "ReactNative106": {
          this._handlerFactory = ReactNative106.createFactory({
            forcedRtpExtensions
          });
          break;
        }
        default: {
          throw new TypeError(`unknown handlerName "${handlerName}"`);
        }
      }
    }
    this._handlerName = this._handlerFactory.name;
  }
  get handlerName() {
    return this._handlerName;
  }
  get loaded() {
    return this._loaded;
  }
  get rtpCapabilities() {
    return this.recvRtpCapabilities;
  }
  get recvRtpCapabilities() {
    if (!this._loaded) {
      throw new InvalidStateError("not loaded");
    }
    return this._recvRtpCapabilities;
  }
  get sendRtpCapabilities() {
    if (!this._loaded) {
      throw new InvalidStateError("not loaded");
    }
    return this._sendRtpCapabilities;
  }
  get observer() {
    return this._observer;
  }
  async load({
    routerRtpCapabilities,
    preferLocalCodecsOrder = false
  }) {
    logger14.debug("load() [routerRtpCapabilities:%o]", routerRtpCapabilities);
    if (this._loaded) {
      throw new InvalidStateError("already loaded");
    }
    const clonedRouterRtpCapabilities = clone(routerRtpCapabilities);
    validateAndNormalizeRtpCapabilities(clonedRouterRtpCapabilities);
    const { getNativeRtpCapabilities } = this._handlerFactory;
    const clonedNativeRecvRtpCapabilities = clone(await getNativeRtpCapabilities({ direction: "recvonly" }));
    logger14.debug("load() | got native receiving RTP capabilities:%o", clonedNativeRecvRtpCapabilities);
    validateAndNormalizeRtpCapabilities(clonedNativeRecvRtpCapabilities);
    const clonedNativeSendRtpCapabilities = clone(await getNativeRtpCapabilities({ direction: "sendonly" }));
    logger14.debug("load() | got native sending RTP capabilities:%o", clonedNativeSendRtpCapabilities);
    validateAndNormalizeRtpCapabilities(clonedNativeSendRtpCapabilities);
    this._getSendExtendedRtpCapabilities = (nativeSendRtpCapabilities) => {
      return clone(getExtendedRtpCapabilities(nativeSendRtpCapabilities, clonedRouterRtpCapabilities, preferLocalCodecsOrder));
    };
    const recvExtendedRtpCapabilities = getExtendedRtpCapabilities(clonedNativeRecvRtpCapabilities, clonedRouterRtpCapabilities, false);
    this._recvRtpCapabilities = getRecvRtpCapabilities(recvExtendedRtpCapabilities);
    logger14.debug("load() | got receiving RTP capabilities:%o", this._recvRtpCapabilities);
    validateAndNormalizeRtpCapabilities(this._recvRtpCapabilities);
    const sendExtendedRtpCapabilities = getExtendedRtpCapabilities(clonedNativeSendRtpCapabilities, clonedRouterRtpCapabilities, preferLocalCodecsOrder);
    this._sendRtpCapabilities = getSendRtpCapabilities(sendExtendedRtpCapabilities);
    logger14.debug("load() | got sending RTP capabilities:%o", this._sendRtpCapabilities);
    validateAndNormalizeRtpCapabilities(this._sendRtpCapabilities);
    this._canProduceByKind.audio = canSend("audio", this._sendRtpCapabilities);
    this._canProduceByKind.video = canSend("video", this._sendRtpCapabilities);
    logger14.debug("load() succeeded");
    this._loaded = true;
  }
  canProduce(kind) {
    if (!this._loaded) {
      throw new InvalidStateError("not loaded");
    } else if (kind !== "audio" && kind !== "video") {
      throw new TypeError(`invalid kind "${kind}"`);
    }
    return this._canProduceByKind[kind];
  }
  createSendTransport({
    id,
    iceParameters,
    iceCandidates,
    dtlsParameters,
    sctpParameters,
    iceServers,
    iceTransportPolicy,
    additionalSettings,
    appData
  }) {
    logger14.debug("createSendTransport()");
    return this.createTransport({
      direction: "send",
      id,
      iceParameters,
      iceCandidates,
      dtlsParameters,
      sctpParameters,
      iceServers,
      iceTransportPolicy,
      additionalSettings,
      appData
    });
  }
  createRecvTransport({
    id,
    iceParameters,
    iceCandidates,
    dtlsParameters,
    sctpParameters,
    iceServers,
    iceTransportPolicy,
    additionalSettings,
    appData
  }) {
    logger14.debug("createRecvTransport()");
    return this.createTransport({
      direction: "recv",
      id,
      iceParameters,
      iceCandidates,
      dtlsParameters,
      sctpParameters,
      iceServers,
      iceTransportPolicy,
      additionalSettings,
      appData
    });
  }
  createTransport({
    direction,
    id,
    iceParameters,
    iceCandidates,
    dtlsParameters,
    sctpParameters,
    iceServers,
    iceTransportPolicy,
    additionalSettings,
    appData
  }) {
    if (!this._loaded) {
      throw new InvalidStateError("not loaded");
    } else if (typeof id !== "string") {
      throw new TypeError("missing id");
    } else if (typeof iceParameters !== "object") {
      throw new TypeError("missing iceParameters");
    } else if (!Array.isArray(iceCandidates)) {
      throw new TypeError("missing iceCandidates");
    } else if (typeof dtlsParameters !== "object") {
      throw new TypeError("missing dtlsParameters");
    } else if (sctpParameters && typeof sctpParameters !== "object") {
      throw new TypeError("wrong sctpParameters");
    } else if (appData && typeof appData !== "object") {
      throw new TypeError("if given, appData must be an object");
    }
    const transport = new Transport({
      direction,
      id,
      iceParameters,
      iceCandidates,
      dtlsParameters,
      sctpParameters,
      iceServers,
      iceTransportPolicy,
      additionalSettings,
      appData,
      handlerFactory: this._handlerFactory,
      getSendExtendedRtpCapabilities: this._getSendExtendedRtpCapabilities,
      recvRtpCapabilities: this._recvRtpCapabilities,
      canProduceByKind: this._canProduceByKind
    });
    this._observer.safeEmit("newtransport", transport);
    return transport;
  }
}
function detectDeviceImpl(userAgent, userAgentData) {
  logger14.debug('detectDeviceImpl() [userAgent:"%s", userAgentData:%o]', userAgent, userAgentData);
  const chromiumMajorVersion = getChromiumMajorVersion(userAgent, userAgentData);
  if (chromiumMajorVersion) {
    if (chromiumMajorVersion >= 111) {
      logger14.debug("detectDeviceImpl() | using Chrome111 handler");
      return "Chrome111";
    } else if (chromiumMajorVersion >= 74) {
      logger14.debug("detectDeviceImpl() | using Chrome74 handler");
      return "Chrome74";
    } else {
      logger14.warn("detectDeviceImpl() | unsupported Chromium based browser/version");
      return;
    }
  }
  const firefoxMajorVersion = getFirefoxMajorVersion(userAgent);
  if (firefoxMajorVersion) {
    if (firefoxMajorVersion >= 120) {
      logger14.debug("detectDeviceImpl() | using Firefox120 handler");
      return "Firefox120";
    } else {
      logger14.warn("detectDeviceImpl() | unsupported Firefox browser/version");
      return;
    }
  }
  const macOSWebKitMajorVersion = getMacOSWebKitMajorVersion(userAgent);
  if (macOSWebKitMajorVersion) {
    if (macOSWebKitMajorVersion >= 605) {
      logger14.debug("detectDeviceImpl() | using Safari12 handler");
      return "Safari12";
    } else {
      logger14.warn("detectDeviceImpl() | unsupported desktop Safari browser/version");
      return;
    }
  }
  const iOSWebKitMajorVersion = getIOSWebKitMajorVersion(userAgent);
  if (iOSWebKitMajorVersion) {
    if (iOSWebKitMajorVersion >= 605) {
      logger14.debug("detectDeviceImpl() | using Safari12 handler");
      return "Safari12";
    } else {
      logger14.warn("detectDeviceImpl() | unsupported iOS Safari based browser/version");
      return;
    }
  }
  if (isReactNative()) {
    if (typeof RTCPeerConnection !== "undefined" && typeof RTCRtpTransceiver !== "undefined") {
      logger14.debug("detectDeviceImpl() | using ReactNative106 handler");
      return "ReactNative106";
    } else {
      logger14.warn("detectDeviceImpl() | unsupported react-native-webrtc version without RTCPeerConnection or RTCRtpTransceiver, forgot to call registerGlobals() on it?");
      return;
    }
  }
  logger14.warn('detectDeviceImpl() | device not supported [userAgent:"%s", userAgentData:%o]', userAgent, userAgentData);
  return;
}
function getChromiumMajorVersion(userAgent, userAgentData) {
  logger14.debug("getChromiumMajorVersion()");
  if (isIOS(userAgent, userAgentData)) {
    logger14.debug("getChromiumMajorVersion() | this is iOS => undefined");
    return;
  }
  if (isReactNative()) {
    logger14.debug("getChromiumMajorVersion() | this is React-Native => undefined");
    return;
  }
  if (userAgentData) {
    const brands = Array.isArray(userAgentData.brands) ? userAgentData.brands : [];
    const chromiumBrand = brands.find((b) => b.brand === "Chromium");
    if (chromiumBrand) {
      const majorVersion = Number(chromiumBrand.version);
      logger14.debug(`getChromiumMajorVersion() | Chromium major version based on NavigatorUAData => ${majorVersion}`);
      return majorVersion;
    }
  }
  const match = userAgent?.match(/\b(?:Chrome|Chromium)\/(\w+)/i);
  if (match?.[1]) {
    const majorVersion = Number(match[1]);
    logger14.debug(`getChromiumMajorVersion() | Chromium major version based on User-Agent => ${majorVersion}`);
    return majorVersion;
  }
  logger14.debug("getChromiumMajorVersion() | this is not Chromium => undefined");
  return;
}
function getFirefoxMajorVersion(userAgent) {
  logger14.debug("getFirefoxMajorVersion()");
  if (isIOS(userAgent)) {
    logger14.debug("getFirefoxMajorVersion() | this is iOS => undefined");
    return;
  }
  if (isReactNative()) {
    logger14.debug("getFirefoxMajorVersion() | this is React-Native => undefined");
    return;
  }
  const match = userAgent?.match(/\bFirefox\/(\w+)/i);
  if (match?.[1]) {
    const majorVersion = Number(match[1]);
    logger14.debug(`getFirefoxMajorVersion() | Firefox major version based on User-Agent => ${majorVersion}`);
    return majorVersion;
  }
  logger14.debug("getFirefoxMajorVersion() | this is not Firefox => undefined");
  return;
}
function getMacOSWebKitMajorVersion(userAgent) {
  logger14.debug("getMacOSWebKitMajorVersion()");
  if (isIOS(userAgent)) {
    logger14.debug("getMacOSWebKitMajorVersion() | this is iOS => undefined");
    return;
  }
  if (isReactNative()) {
    logger14.debug("getMacOSWebKitMajorVersion() | this is React-Native => undefined");
    return;
  }
  const isSafari = userAgent && /\bSafari\b/i.test(userAgent) && !/\bChrome\b/i.test(userAgent) && !/\bChromium\b/i.test(userAgent) && !/\bFirefox\b/i.test(userAgent);
  if (!isSafari) {
    logger14.debug("getMacOSWebKitMajorVersion() | this is not Safari => undefined");
    return;
  }
  const match = userAgent.match(/AppleWebKit\/(\w+)/i);
  if (match?.[1]) {
    const majorVersion = Number(match[1]);
    logger14.debug(`getMacOSWebKitMajorVersion() | WebKit major version based on User-Agent => ${majorVersion}`);
    return majorVersion;
  }
  logger14.debug("getMacOSWebKitMajorVersion() | this is not WebKit => undefined");
  return;
}
function getIOSWebKitMajorVersion(userAgent) {
  logger14.debug("getIOSWebKitMajorVersion()");
  if (!isIOS(userAgent)) {
    logger14.debug("getIOSWebKitMajorVersion() | this is not iOS => undefined");
    return;
  }
  if (isReactNative()) {
    logger14.debug("getIOSWebKitMajorVersion() | this is React-Native => undefined");
    return;
  }
  const match = userAgent?.match(/AppleWebKit\/(\w+)/i);
  if (match?.[1]) {
    const majorVersion = Number(match[1]);
    logger14.debug(`getIOSWebKitMajorVersion() | WebKit major version based on User-Agent => ${majorVersion}`);
    return majorVersion;
  }
  logger14.debug("getIOSWebKitMajorVersion() | this is not WebKit => undefined");
  return;
}
function isIOS(userAgent, userAgentData) {
  logger14.debug("isIOS()");
  if (userAgentData?.platform === "iOS") {
    logger14.debug("isIOS() | this is iOS based on NavigatorUAData.platform => true");
    return true;
  }
  if (userAgentData?.platform) {
    logger14.debug("isIOS() | this is not iOS based on NavigatorUAData.platform => false");
    return false;
  }
  if (userAgent && /iPad|iPhone|iPod/.test(userAgent)) {
    logger14.debug("isIOS() | this is iOS based on User-Agent => true");
    return true;
  }
  if (typeof navigator === "object" && navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1) {
    logger14.debug("isIOS() | this is iPadOS 13+ based on User-Agent => true");
    return true;
  }
  logger14.debug("isIOS() | this is not iOS => false");
  return false;
}
function isReactNative() {
  logger14.debug("isReactNative()");
  if (typeof navigator === "object" && navigator.product === "ReactNative") {
    logger14.debug("isReactNative() | this is React-Native based on navigator.product");
    return true;
  }
  logger14.debug("isReactNative() | this is not React-Native => false");
  return false;
}

// ../ms/skh-client-entry.ts
var version2 = "3.25.3";
export {
  Device,
  detectDeviceAsync,
  version2 as version
};
