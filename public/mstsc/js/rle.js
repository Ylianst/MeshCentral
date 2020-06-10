// Note: Some Emscripten settings will significantly limit the speed of the generated code.
// Note: Some Emscripten settings may limit the speed of the generated code.
// The Module object: Our interface to the outside world. We import
// and export values on it, and do the work to get that through
// closure compiler if necessary. There are various ways Module can be used:
// 1. Not defined. We create it here
// 2. A function parameter, function(Module) { ..generated code.. }
// 3. pre-run appended it, var Module = {}; ..generated code..
// 4. External script tag defines var Module.
// We need to do an eval in order to handle the closure compiler
// case, where this code here is minified but Module was defined
// elsewhere (e.g. case 4 above). We also need to check if Module
// already exists (e.g. case 3 above).
// Note that if you want to run closure, and also to use Module
// after the generated code, you will need to define   var Module = {};
// before the code. Then that object will be used in the code, and you
// can continue to use Module afterwards as well.
var Module = { };
//if (!Module) { Module = eval('(function() { try { return Module || {} } catch(e) { return {} } })()'); }

// Sometimes an existing Module object exists with properties
// meant to overwrite the default module functionality. Here
// we collect those properties and reapply _after_ we configure
// the current environment's defaults to avoid having to be so
// defensive during initialization.
var moduleOverrides = {};
for (var key in Module) {
  if (Module.hasOwnProperty(key)) {
    moduleOverrides[key] = Module[key];
  }
}

// The environment setup code below is customized to use Module.
// *** Environment setup code ***
var ENVIRONMENT_IS_NODE = typeof process === 'object' && typeof require === 'function';
var ENVIRONMENT_IS_WEB = typeof window === 'object';
var ENVIRONMENT_IS_WORKER = typeof importScripts === 'function';
var ENVIRONMENT_IS_SHELL = !ENVIRONMENT_IS_WEB && !ENVIRONMENT_IS_NODE && !ENVIRONMENT_IS_WORKER;

if (ENVIRONMENT_IS_NODE) {
  // Expose functionality in the same simple way that the shells work
  // Note that we pollute the global namespace here, otherwise we break in node
  if (!Module['print']) Module['print'] = function print(x) {
    process['stdout'].write(x + '\n');
  };
  if (!Module['printErr']) Module['printErr'] = function printErr(x) {
    process['stderr'].write(x + '\n');
  };

  var nodeFS = require('fs');
  var nodePath = require('path');

  Module['read'] = function read(filename, binary) {
    filename = nodePath['normalize'](filename);
    var ret = nodeFS['readFileSync'](filename);
    // The path is absolute if the normalized version is the same as the resolved.
    if (!ret && filename != nodePath['resolve'](filename)) {
      filename = path.join(__dirname, '..', 'src', filename);
      ret = nodeFS['readFileSync'](filename);
    }
    if (ret && !binary) ret = ret.toString();
    return ret;
  };

  Module['readBinary'] = function readBinary(filename) { return Module['read'](filename, true) };

  Module['load'] = function load(f) {
    globalEval(read(f));
  };

  Module['arguments'] = process['argv'].slice(2);

  module['exports'] = Module;
}
else if (ENVIRONMENT_IS_SHELL) {
  if (!Module['print']) Module['print'] = print;
  if (typeof printErr != 'undefined') Module['printErr'] = printErr; // not present in v8 or older sm

  if (typeof read != 'undefined') {
    Module['read'] = read;
  } else {
    Module['read'] = function read() { throw 'no read() available (jsc?)' };
  }

  Module['readBinary'] = function readBinary(f) {
    return read(f, 'binary');
  };

  if (typeof scriptArgs != 'undefined') {
    Module['arguments'] = scriptArgs;
  } else if (typeof arguments != 'undefined') {
    Module['arguments'] = arguments;
  }

  this['Module'] = Module;

  eval("if (typeof gc === 'function' && gc.toString().indexOf('[native code]') > 0) var gc = undefined"); // wipe out the SpiderMonkey shell 'gc' function, which can confuse closure (uses it as a minified name, and it is then initted to a non-falsey value unexpectedly)
}
else if (ENVIRONMENT_IS_WEB || ENVIRONMENT_IS_WORKER) {
  Module['read'] = function read(url) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, false);
    xhr.send(null);
    return xhr.responseText;
  };

  if (typeof arguments != 'undefined') {
    Module['arguments'] = arguments;
  }

  if (typeof console !== 'undefined') {
    if (!Module['print']) Module['print'] = function print(x) {
      console.log(x);
    };
    if (!Module['printErr']) Module['printErr'] = function printErr(x) {
      console.log(x);
    };
  } else {
    // Probably a worker, and without console.log. We can do very little here...
    var TRY_USE_DUMP = false;
    if (!Module['print']) Module['print'] = (TRY_USE_DUMP && (typeof(dump) !== "undefined") ? (function(x) {
      dump(x);
    }) : (function(x) {
      // self.postMessage(x); // enable this if you want stdout to be sent as messages
    }));
  }

  if (ENVIRONMENT_IS_WEB) {
    this['Module'] = Module;
  } else {
    Module['load'] = importScripts;
  }
}
else {
  // Unreachable because SHELL is dependant on the others
  throw 'Unknown runtime environment. Where are we?';
}

function globalEval(x) {
  eval.call(null, x);
}
if (!Module['load'] == 'undefined' && Module['read']) {
  Module['load'] = function load(f) {
    globalEval(Module['read'](f));
  };
}
if (!Module['print']) {
  Module['print'] = function(){};
}
if (!Module['printErr']) {
  Module['printErr'] = Module['print'];
}
if (!Module['arguments']) {
  Module['arguments'] = [];
}
// *** Environment setup code ***

// Closure helpers
Module.print = Module['print'];
Module.printErr = Module['printErr'];

// Callbacks
Module['preRun'] = [];
Module['postRun'] = [];

// Merge back in the overrides
for (var key in moduleOverrides) {
  if (moduleOverrides.hasOwnProperty(key)) {
    Module[key] = moduleOverrides[key];
  }
}



// === Auto-generated preamble library stuff ===

//========================================
// Runtime code shared with compiler
//========================================

var Runtime = {
  stackSave: function () {
    return STACKTOP;
  },
  stackRestore: function (stackTop) {
    STACKTOP = stackTop;
  },
  forceAlign: function (target, quantum) {
    quantum = quantum || 4;
    if (quantum == 1) return target;
    if (isNumber(target) && isNumber(quantum)) {
      return Math.ceil(target/quantum)*quantum;
    } else if (isNumber(quantum) && isPowerOfTwo(quantum)) {
      return '(((' +target + ')+' + (quantum-1) + ')&' + -quantum + ')';
    }
    return 'Math.ceil((' + target + ')/' + quantum + ')*' + quantum;
  },
  isNumberType: function (type) {
    return type in Runtime.INT_TYPES || type in Runtime.FLOAT_TYPES;
  },
  isPointerType: function isPointerType(type) {
  return type[type.length-1] == '*';
},
  isStructType: function isStructType(type) {
  if (isPointerType(type)) return false;
  if (isArrayType(type)) return true;
  if (/<?{ ?[^}]* ?}>?/.test(type)) return true; // { i32, i8 } etc. - anonymous struct types
  // See comment in isStructPointerType()
  return type[0] == '%';
},
  INT_TYPES: {"i1":0,"i8":0,"i16":0,"i32":0,"i64":0},
  FLOAT_TYPES: {"float":0,"double":0},
  or64: function (x, y) {
    var l = (x | 0) | (y | 0);
    var h = (Math.round(x / 4294967296) | Math.round(y / 4294967296)) * 4294967296;
    return l + h;
  },
  and64: function (x, y) {
    var l = (x | 0) & (y | 0);
    var h = (Math.round(x / 4294967296) & Math.round(y / 4294967296)) * 4294967296;
    return l + h;
  },
  xor64: function (x, y) {
    var l = (x | 0) ^ (y | 0);
    var h = (Math.round(x / 4294967296) ^ Math.round(y / 4294967296)) * 4294967296;
    return l + h;
  },
  getNativeTypeSize: function (type) {
    switch (type) {
      case 'i1': case 'i8': return 1;
      case 'i16': return 2;
      case 'i32': return 4;
      case 'i64': return 8;
      case 'float': return 4;
      case 'double': return 8;
      default: {
        if (type[type.length-1] === '*') {
          return Runtime.QUANTUM_SIZE; // A pointer
        } else if (type[0] === 'i') {
          var bits = parseInt(type.substr(1));
          assert(bits % 8 === 0);
          return bits/8;
        } else {
          return 0;
        }
      }
    }
  },
  getNativeFieldSize: function (type) {
    return Math.max(Runtime.getNativeTypeSize(type), Runtime.QUANTUM_SIZE);
  },
  dedup: function dedup(items, ident) {
  var seen = {};
  if (ident) {
    return items.filter(function(item) {
      if (seen[item[ident]]) return false;
      seen[item[ident]] = true;
      return true;
    });
  } else {
    return items.filter(function(item) {
      if (seen[item]) return false;
      seen[item] = true;
      return true;
    });
  }
},
  set: function set() {
  var args = typeof arguments[0] === 'object' ? arguments[0] : arguments;
  var ret = {};
  for (var i = 0; i < args.length; i++) {
    ret[args[i]] = 0;
  }
  return ret;
},
  STACK_ALIGN: 8,
  getAlignSize: function (type, size, vararg) {
    // we align i64s and doubles on 64-bit boundaries, unlike x86
    if (vararg) return 8;
    if (!vararg && (type == 'i64' || type == 'double')) return 8;
    if (!type) return Math.min(size, 8); // align structures internally to 64 bits
    return Math.min(size || (type ? Runtime.getNativeFieldSize(type) : 0), Runtime.QUANTUM_SIZE);
  },
  calculateStructAlignment: function calculateStructAlignment(type) {
    type.flatSize = 0;
    type.alignSize = 0;
    var diffs = [];
    var prev = -1;
    var index = 0;
    type.flatIndexes = type.fields.map(function(field) {
      index++;
      var size, alignSize;
      if (Runtime.isNumberType(field) || Runtime.isPointerType(field)) {
        size = Runtime.getNativeTypeSize(field); // pack char; char; in structs, also char[X]s.
        alignSize = Runtime.getAlignSize(field, size);
      } else if (Runtime.isStructType(field)) {
        if (field[1] === '0') {
          // this is [0 x something]. When inside another structure like here, it must be at the end,
          // and it adds no size
          // XXX this happens in java-nbody for example... assert(index === type.fields.length, 'zero-length in the middle!');
          size = 0;
          if (Types.types[field]) {
            alignSize = Runtime.getAlignSize(null, Types.types[field].alignSize);
          } else {
            alignSize = type.alignSize || QUANTUM_SIZE;
          }
        } else {
          size = Types.types[field].flatSize;
          alignSize = Runtime.getAlignSize(null, Types.types[field].alignSize);
        }
      } else if (field[0] == 'b') {
        // bN, large number field, like a [N x i8]
        size = field.substr(1)|0;
        alignSize = 1;
      } else if (field[0] === '<') {
        // vector type
        size = alignSize = Types.types[field].flatSize; // fully aligned
      } else if (field[0] === 'i') {
        // illegal integer field, that could not be legalized because it is an internal structure field
        // it is ok to have such fields, if we just use them as markers of field size and nothing more complex
        size = alignSize = parseInt(field.substr(1))/8;
        assert(size % 1 === 0, 'cannot handle non-byte-size field ' + field);
      } else {
        assert(false, 'invalid type for calculateStructAlignment');
      }
      if (type.packed) alignSize = 1;
      type.alignSize = Math.max(type.alignSize, alignSize);
      var curr = Runtime.alignMemory(type.flatSize, alignSize); // if necessary, place this on aligned memory
      type.flatSize = curr + size;
      if (prev >= 0) {
        diffs.push(curr-prev);
      }
      prev = curr;
      return curr;
    });
    if (type.name_ && type.name_[0] === '[') {
      // arrays have 2 elements, so we get the proper difference. then we scale here. that way we avoid
      // allocating a potentially huge array for [999999 x i8] etc.
      type.flatSize = parseInt(type.name_.substr(1))*type.flatSize/2;
    }
    type.flatSize = Runtime.alignMemory(type.flatSize, type.alignSize);
    if (diffs.length == 0) {
      type.flatFactor = type.flatSize;
    } else if (Runtime.dedup(diffs).length == 1) {
      type.flatFactor = diffs[0];
    }
    type.needsFlattening = (type.flatFactor != 1);
    return type.flatIndexes;
  },
  generateStructInfo: function (struct, typeName, offset) {
    var type, alignment;
    if (typeName) {
      offset = offset || 0;
      type = (typeof Types === 'undefined' ? Runtime.typeInfo : Types.types)[typeName];
      if (!type) return null;
      if (type.fields.length != struct.length) {
        printErr('Number of named fields must match the type for ' + typeName + ': possibly duplicate struct names. Cannot return structInfo');
        return null;
      }
      alignment = type.flatIndexes;
    } else {
      var type = { fields: struct.map(function(item) { return item[0] }) };
      alignment = Runtime.calculateStructAlignment(type);
    }
    var ret = {
      __size__: type.flatSize
    };
    if (typeName) {
      struct.forEach(function(item, i) {
        if (typeof item === 'string') {
          ret[item] = alignment[i] + offset;
        } else {
          // embedded struct
          var key;
          for (var k in item) key = k;
          ret[key] = Runtime.generateStructInfo(item[key], type.fields[i], alignment[i]);
        }
      });
    } else {
      struct.forEach(function(item, i) {
        ret[item[1]] = alignment[i];
      });
    }
    return ret;
  },
  dynCall: function (sig, ptr, args) {
    if (args && args.length) {
      assert(args.length == sig.length-1);
      return FUNCTION_TABLE[ptr].apply(null, args);
    } else {
      assert(sig.length == 1);
      return FUNCTION_TABLE[ptr]();
    }
  },
  addFunction: function (func) {
    var table = FUNCTION_TABLE;
    var ret = table.length;
    assert(ret % 2 === 0);
    table.push(func);
    for (var i = 0; i < 2-1; i++) table.push(0);
    return ret;
  },
  removeFunction: function (index) {
    var table = FUNCTION_TABLE;
    table[index] = null;
  },
  getAsmConst: function (code, numArgs) {
    // code is a constant string on the heap, so we can cache these
    if (!Runtime.asmConstCache) Runtime.asmConstCache = {};
    var func = Runtime.asmConstCache[code];
    if (func) return func;
    var args = [];
    for (var i = 0; i < numArgs; i++) {
      args.push(String.fromCharCode(36) + i); // $0, $1 etc
    }
    code = Pointer_stringify(code);
    if (code[0] === '"') {
      // tolerate EM_ASM("..code..") even though EM_ASM(..code..) is correct
      if (code.indexOf('"', 1) === code.length-1) {
        code = code.substr(1, code.length-2);
      } else {
        // something invalid happened, e.g. EM_ASM("..code($0)..", input)
        abort('invalid EM_ASM input |' + code + '|. Please use EM_ASM(..code..) (no quotes) or EM_ASM({ ..code($0).. }, input) (to input values)');
      }
    }
    return Runtime.asmConstCache[code] = eval('(function(' + args.join(',') + '){ ' + code + ' })'); // new Function does not allow upvars in node
  },
  warnOnce: function (text) {
    if (!Runtime.warnOnce.shown) Runtime.warnOnce.shown = {};
    if (!Runtime.warnOnce.shown[text]) {
      Runtime.warnOnce.shown[text] = 1;
      Module.printErr(text);
    }
  },
  funcWrappers: {},
  getFuncWrapper: function (func, sig) {
    assert(sig);
    if (!Runtime.funcWrappers[func]) {
      Runtime.funcWrappers[func] = function dynCall_wrapper() {
        return Runtime.dynCall(sig, func, arguments);
      };
    }
    return Runtime.funcWrappers[func];
  },
  UTF8Processor: function () {
    var buffer = [];
    var needed = 0;
    this.processCChar = function (code) {
      code = code & 0xFF;

      if (buffer.length == 0) {
        if ((code & 0x80) == 0x00) {        // 0xxxxxxx
          return String.fromCharCode(code);
        }
        buffer.push(code);
        if ((code & 0xE0) == 0xC0) {        // 110xxxxx
          needed = 1;
        } else if ((code & 0xF0) == 0xE0) { // 1110xxxx
          needed = 2;
        } else {                            // 11110xxx
          needed = 3;
        }
        return '';
      }

      if (needed) {
        buffer.push(code);
        needed--;
        if (needed > 0) return '';
      }

      var c1 = buffer[0];
      var c2 = buffer[1];
      var c3 = buffer[2];
      var c4 = buffer[3];
      var ret;
      if (buffer.length == 2) {
        ret = String.fromCharCode(((c1 & 0x1F) << 6)  | (c2 & 0x3F));
      } else if (buffer.length == 3) {
        ret = String.fromCharCode(((c1 & 0x0F) << 12) | ((c2 & 0x3F) << 6)  | (c3 & 0x3F));
      } else {
        // http://mathiasbynens.be/notes/javascript-encoding#surrogate-formulae
        var codePoint = ((c1 & 0x07) << 18) | ((c2 & 0x3F) << 12) |
                        ((c3 & 0x3F) << 6)  | (c4 & 0x3F);
        ret = String.fromCharCode(
          Math.floor((codePoint - 0x10000) / 0x400) + 0xD800,
          (codePoint - 0x10000) % 0x400 + 0xDC00);
      }
      buffer.length = 0;
      return ret;
    }
    this.processJSString = function processJSString(string) {
      string = unescape(encodeURIComponent(string));
      var ret = [];
      for (var i = 0; i < string.length; i++) {
        ret.push(string.charCodeAt(i));
      }
      return ret;
    }
  },
  stackAlloc: function (size) { var ret = STACKTOP;STACKTOP = (STACKTOP + size)|0;STACKTOP = (((STACKTOP)+7)&-8);(assert((STACKTOP|0) < (STACK_MAX|0))|0); return ret; },
  staticAlloc: function (size) { var ret = STATICTOP;STATICTOP = (STATICTOP + (assert(!staticSealed),size))|0;STATICTOP = (((STATICTOP)+7)&-8); return ret; },
  dynamicAlloc: function (size) { var ret = DYNAMICTOP;DYNAMICTOP = (DYNAMICTOP + (assert(DYNAMICTOP > 0),size))|0;DYNAMICTOP = (((DYNAMICTOP)+7)&-8); if (DYNAMICTOP >= TOTAL_MEMORY) enlargeMemory();; return ret; },
  alignMemory: function (size,quantum) { var ret = size = Math.ceil((size)/(quantum ? quantum : 8))*(quantum ? quantum : 8); return ret; },
  makeBigInt: function (low,high,unsigned) { var ret = (unsigned ? ((low>>>0)+((high>>>0)*4294967296)) : ((low>>>0)+((high|0)*4294967296))); return ret; },
  GLOBAL_BASE: 8,
  QUANTUM_SIZE: 4,
  __dummy__: 0
}


Module['Runtime'] = Runtime;









//========================================
// Runtime essentials
//========================================

var __THREW__ = 0; // Used in checking for thrown exceptions.
var setjmpId = 1; // Used in setjmp/longjmp
var setjmpLabels = {};

var ABORT = false; // whether we are quitting the application. no code should run after this. set in exit() and abort()
var EXITSTATUS = 0;

var undef = 0;
// tempInt is used for 32-bit signed values or smaller. tempBigInt is used
// for 32-bit unsigned values or more than 32 bits. TODO: audit all uses of tempInt
var tempValue, tempInt, tempBigInt, tempInt2, tempBigInt2, tempPair, tempBigIntI, tempBigIntR, tempBigIntS, tempBigIntP, tempBigIntD, tempDouble, tempFloat;
var tempI64, tempI64b;
var tempRet0, tempRet1, tempRet2, tempRet3, tempRet4, tempRet5, tempRet6, tempRet7, tempRet8, tempRet9;

function assert(condition, text) {
  if (!condition) {
    abort('Assertion failed: ' + text);
  }
}

var globalScope = this;

// C calling interface. A convenient way to call C functions (in C files, or
// defined with extern "C").
//
// Note: LLVM optimizations can inline and remove functions, after which you will not be
//       able to call them. Closure can also do so. To avoid that, add your function to
//       the exports using something like
//
//         -s EXPORTED_FUNCTIONS='["_main", "_myfunc"]'
//
// @param ident      The name of the C function (note that C++ functions will be name-mangled - use extern "C")
// @param returnType The return type of the function, one of the JS types 'number', 'string' or 'array' (use 'number' for any C pointer, and
//                   'array' for JavaScript arrays and typed arrays; note that arrays are 8-bit).
// @param argTypes   An array of the types of arguments for the function (if there are no arguments, this can be ommitted). Types are as in returnType,
//                   except that 'array' is not possible (there is no way for us to know the length of the array)
// @param args       An array of the arguments to the function, as native JS values (as in returnType)
//                   Note that string arguments will be stored on the stack (the JS string will become a C string on the stack).
// @return           The return value, as a native JS value (as in returnType)
function ccall(ident, returnType, argTypes, args) {
  return ccallFunc(getCFunc(ident), returnType, argTypes, args);
}
Module["ccall"] = ccall;

// Returns the C function with a specified identifier (for C++, you need to do manual name mangling)
function getCFunc(ident) {
  try {
    var func = Module['_' + ident]; // closure exported function
    if (!func) func = eval('_' + ident); // explicit lookup
  } catch(e) {
  }
  assert(func, 'Cannot call unknown function ' + ident + ' (perhaps LLVM optimizations or closure removed it?)');
  return func;
}

// Internal function that does a C call using a function, not an identifier
function ccallFunc(func, returnType, argTypes, args) {
  var stack = 0;
  function toC(value, type) {
    if (type == 'string') {
      if (value === null || value === undefined || value === 0) return 0; // null string
      value = intArrayFromString(value);
      type = 'array';
    }
    if (type == 'array') {
      if (!stack) stack = Runtime.stackSave();
      var ret = Runtime.stackAlloc(value.length);
      writeArrayToMemory(value, ret);
      return ret;
    }
    return value;
  }
  function fromC(value, type) {
    if (type == 'string') {
      return Pointer_stringify(value);
    }
    assert(type != 'array');
    return value;
  }
  var i = 0;
  var cArgs = args ? args.map(function(arg) {
    return toC(arg, argTypes[i++]);
  }) : [];
  var ret = fromC(func.apply(null, cArgs), returnType);
  if (stack) Runtime.stackRestore(stack);
  return ret;
}

// Returns a native JS wrapper for a C function. This is similar to ccall, but
// returns a function you can call repeatedly in a normal way. For example:
//
//   var my_function = cwrap('my_c_function', 'number', ['number', 'number']);
//   alert(my_function(5, 22));
//   alert(my_function(99, 12));
//
function cwrap(ident, returnType, argTypes) {
  var func = getCFunc(ident);
  return function() {
    return ccallFunc(func, returnType, argTypes, Array.prototype.slice.call(arguments));
  }
}
Module["cwrap"] = cwrap;

// Sets a value in memory in a dynamic way at run-time. Uses the
// type data. This is the same as makeSetValue, except that
// makeSetValue is done at compile-time and generates the needed
// code then, whereas this function picks the right code at
// run-time.
// Note that setValue and getValue only do *aligned* writes and reads!
// Note that ccall uses JS types as for defining types, while setValue and
// getValue need LLVM types ('i8', 'i32') - this is a lower-level operation
function setValue(ptr, value, type, noSafe) {
  type = type || 'i8';
  if (type.charAt(type.length-1) === '*') type = 'i32'; // pointers are 32-bit
    switch(type) {
      case 'i1': HEAP8[(ptr)]=value; break;
      case 'i8': HEAP8[(ptr)]=value; break;
      case 'i16': HEAP16[((ptr)>>1)]=value; break;
      case 'i32': HEAP32[((ptr)>>2)]=value; break;
      case 'i64': (tempI64 = [value>>>0,(tempDouble=value,Math_abs(tempDouble) >= 1 ? (tempDouble > 0 ? Math_min(Math_floor((tempDouble)/4294967296), 4294967295)>>>0 : (~~(Math_ceil((tempDouble - +(((~~(tempDouble)))>>>0))/4294967296)))>>>0) : 0)],HEAP32[((ptr)>>2)]=tempI64[0],HEAP32[(((ptr)+(4))>>2)]=tempI64[1]); break;
      case 'float': HEAPF32[((ptr)>>2)]=value; break;
      case 'double': HEAPF64[((ptr)>>3)]=value; break;
      default: abort('invalid type for setValue: ' + type);
    }
}
Module['setValue'] = setValue;

// Parallel to setValue.
function getValue(ptr, type, noSafe) {
  type = type || 'i8';
  if (type.charAt(type.length-1) === '*') type = 'i32'; // pointers are 32-bit
    switch(type) {
      case 'i1': return HEAP8[(ptr)];
      case 'i8': return HEAP8[(ptr)];
      case 'i16': return HEAP16[((ptr)>>1)];
      case 'i32': return HEAP32[((ptr)>>2)];
      case 'i64': return HEAP32[((ptr)>>2)];
      case 'float': return HEAPF32[((ptr)>>2)];
      case 'double': return HEAPF64[((ptr)>>3)];
      default: abort('invalid type for setValue: ' + type);
    }
  return null;
}
Module['getValue'] = getValue;

var ALLOC_NORMAL = 0; // Tries to use _malloc()
var ALLOC_STACK = 1; // Lives for the duration of the current function call
var ALLOC_STATIC = 2; // Cannot be freed
var ALLOC_DYNAMIC = 3; // Cannot be freed except through sbrk
var ALLOC_NONE = 4; // Do not allocate
Module['ALLOC_NORMAL'] = ALLOC_NORMAL;
Module['ALLOC_STACK'] = ALLOC_STACK;
Module['ALLOC_STATIC'] = ALLOC_STATIC;
Module['ALLOC_DYNAMIC'] = ALLOC_DYNAMIC;
Module['ALLOC_NONE'] = ALLOC_NONE;

// allocate(): This is for internal use. You can use it yourself as well, but the interface
//             is a little tricky (see docs right below). The reason is that it is optimized
//             for multiple syntaxes to save space in generated code. So you should
//             normally not use allocate(), and instead allocate memory using _malloc(),
//             initialize it with setValue(), and so forth.
// @slab: An array of data, or a number. If a number, then the size of the block to allocate,
//        in *bytes* (note that this is sometimes confusing: the next parameter does not
//        affect this!)
// @types: Either an array of types, one for each byte (or 0 if no type at that position),
//         or a single type which is used for the entire block. This only matters if there
//         is initial data - if @slab is a number, then this does not matter at all and is
//         ignored.
// @allocator: How to allocate memory, see ALLOC_*
function allocate(slab, types, allocator, ptr) {
  var zeroinit, size;
  if (typeof slab === 'number') {
    zeroinit = true;
    size = slab;
  } else {
    zeroinit = false;
    size = slab.length;
  }

  var singleType = typeof types === 'string' ? types : null;

  var ret;
  if (allocator == ALLOC_NONE) {
    ret = ptr;
  } else {
    ret = [_malloc, Runtime.stackAlloc, Runtime.staticAlloc, Runtime.dynamicAlloc][allocator === undefined ? ALLOC_STATIC : allocator](Math.max(size, singleType ? 1 : types.length));
  }

  if (zeroinit) {
    var ptr = ret, stop;
    assert((ret & 3) == 0);
    stop = ret + (size & ~3);
    for (; ptr < stop; ptr += 4) {
      HEAP32[((ptr)>>2)]=0;
    }
    stop = ret + size;
    while (ptr < stop) {
      HEAP8[((ptr++)|0)]=0;
    }
    return ret;
  }

  if (singleType === 'i8') {
    if (slab.subarray || slab.slice) {
      HEAPU8.set(slab, ret);
    } else {
      HEAPU8.set(new Uint8Array(slab), ret);
    }
    return ret;
  }

  var i = 0, type, typeSize, previousType;
  while (i < size) {
    var curr = slab[i];

    if (typeof curr === 'function') {
      curr = Runtime.getFunctionIndex(curr);
    }

    type = singleType || types[i];
    if (type === 0) {
      i++;
      continue;
    }
    assert(type, 'Must know what type to store in allocate!');

    if (type == 'i64') type = 'i32'; // special case: we have one i32 here, and one i32 later

    setValue(ret+i, curr, type);

    // no need to look up size unless type changes, so cache it
    if (previousType !== type) {
      typeSize = Runtime.getNativeTypeSize(type);
      previousType = type;
    }
    i += typeSize;
  }

  return ret;
}
Module['allocate'] = allocate;

function Pointer_stringify(ptr, /* optional */ length) {
  // TODO: use TextDecoder
  // Find the length, and check for UTF while doing so
  var hasUtf = false;
  var t;
  var i = 0;
  while (1) {
    assert(ptr + i < TOTAL_MEMORY);
    t = HEAPU8[(((ptr)+(i))|0)];
    if (t >= 128) hasUtf = true;
    else if (t == 0 && !length) break;
    i++;
    if (length && i == length) break;
  }
  if (!length) length = i;

  var ret = '';

  if (!hasUtf) {
    var MAX_CHUNK = 1024; // split up into chunks, because .apply on a huge string can overflow the stack
    var curr;
    while (length > 0) {
      curr = String.fromCharCode.apply(String, HEAPU8.subarray(ptr, ptr + Math.min(length, MAX_CHUNK)));
      ret = ret ? ret + curr : curr;
      ptr += MAX_CHUNK;
      length -= MAX_CHUNK;
    }
    return ret;
  }

  var utf8 = new Runtime.UTF8Processor();
  for (i = 0; i < length; i++) {
    assert(ptr + i < TOTAL_MEMORY);
    t = HEAPU8[(((ptr)+(i))|0)];
    ret += utf8.processCChar(t);
  }
  return ret;
}
Module['Pointer_stringify'] = Pointer_stringify;

// Given a pointer 'ptr' to a null-terminated UTF16LE-encoded string in the emscripten HEAP, returns
// a copy of that string as a Javascript String object.
function UTF16ToString(ptr) {
  var i = 0;

  var str = '';
  while (1) {
    var codeUnit = HEAP16[(((ptr)+(i*2))>>1)];
    if (codeUnit == 0)
      return str;
    ++i;
    // fromCharCode constructs a character from a UTF-16 code unit, so we can pass the UTF16 string right through.
    str += String.fromCharCode(codeUnit);
  }
}
Module['UTF16ToString'] = UTF16ToString;

// Copies the given Javascript String object 'str' to the emscripten HEAP at address 'outPtr',
// null-terminated and encoded in UTF16LE form. The copy will require at most (str.length*2+1)*2 bytes of space in the HEAP.
function stringToUTF16(str, outPtr) {
  for(var i = 0; i < str.length; ++i) {
    // charCodeAt returns a UTF-16 encoded code unit, so it can be directly written to the HEAP.
    var codeUnit = str.charCodeAt(i); // possibly a lead surrogate
    HEAP16[(((outPtr)+(i*2))>>1)]=codeUnit;
  }
  // Null-terminate the pointer to the HEAP.
  HEAP16[(((outPtr)+(str.length*2))>>1)]=0;
}
Module['stringToUTF16'] = stringToUTF16;

// Given a pointer 'ptr' to a null-terminated UTF32LE-encoded string in the emscripten HEAP, returns
// a copy of that string as a Javascript String object.
function UTF32ToString(ptr) {
  var i = 0;

  var str = '';
  while (1) {
    var utf32 = HEAP32[(((ptr)+(i*4))>>2)];
    if (utf32 == 0)
      return str;
    ++i;
    // Gotcha: fromCharCode constructs a character from a UTF-16 encoded code (pair), not from a Unicode code point! So encode the code point to UTF-16 for constructing.
    if (utf32 >= 0x10000) {
      var ch = utf32 - 0x10000;
      str += String.fromCharCode(0xD800 | (ch >> 10), 0xDC00 | (ch & 0x3FF));
    } else {
      str += String.fromCharCode(utf32);
    }
  }
}
Module['UTF32ToString'] = UTF32ToString;

// Copies the given Javascript String object 'str' to the emscripten HEAP at address 'outPtr',
// null-terminated and encoded in UTF32LE form. The copy will require at most (str.length+1)*4 bytes of space in the HEAP,
// but can use less, since str.length does not return the number of characters in the string, but the number of UTF-16 code units in the string.
function stringToUTF32(str, outPtr) {
  var iChar = 0;
  for(var iCodeUnit = 0; iCodeUnit < str.length; ++iCodeUnit) {
    // Gotcha: charCodeAt returns a 16-bit word that is a UTF-16 encoded code unit, not a Unicode code point of the character! We must decode the string to UTF-32 to the heap.
    var codeUnit = str.charCodeAt(iCodeUnit); // possibly a lead surrogate
    if (codeUnit >= 0xD800 && codeUnit <= 0xDFFF) {
      var trailSurrogate = str.charCodeAt(++iCodeUnit);
      codeUnit = 0x10000 + ((codeUnit & 0x3FF) << 10) | (trailSurrogate & 0x3FF);
    }
    HEAP32[(((outPtr)+(iChar*4))>>2)]=codeUnit;
    ++iChar;
  }
  // Null-terminate the pointer to the HEAP.
  HEAP32[(((outPtr)+(iChar*4))>>2)]=0;
}
Module['stringToUTF32'] = stringToUTF32;

function demangle(func) {
  try {
    // Special-case the entry point, since its name differs from other name mangling.
    if (func == 'Object._main' || func == '_main') {
      return 'main()';
    }
    if (typeof func === 'number') func = Pointer_stringify(func);
    if (func[0] !== '_') return func;
    if (func[1] !== '_') return func; // C function
    if (func[2] !== 'Z') return func;
    switch (func[3]) {
      case 'n': return 'operator new()';
      case 'd': return 'operator delete()';
    }
    var i = 3;
    // params, etc.
    var basicTypes = {
      'v': 'void',
      'b': 'bool',
      'c': 'char',
      's': 'short',
      'i': 'int',
      'l': 'long',
      'f': 'float',
      'd': 'double',
      'w': 'wchar_t',
      'a': 'signed char',
      'h': 'unsigned char',
      't': 'unsigned short',
      'j': 'unsigned int',
      'm': 'unsigned long',
      'x': 'long long',
      'y': 'unsigned long long',
      'z': '...'
    };
    function dump(x) {
      //return;
      if (x) Module.print(x);
      Module.print(func);
      var pre = '';
      for (var a = 0; a < i; a++) pre += ' ';
      Module.print (pre + '^');
    }
    var subs = [];
    function parseNested() {
      i++;
      if (func[i] === 'K') i++; // ignore const
      var parts = [];
      while (func[i] !== 'E') {
        if (func[i] === 'S') { // substitution
          i++;
          var next = func.indexOf('_', i);
          var num = func.substring(i, next) || 0;
          parts.push(subs[num] || '?');
          i = next+1;
          continue;
        }
        if (func[i] === 'C') { // constructor
          parts.push(parts[parts.length-1]);
          i += 2;
          continue;
        }
        var size = parseInt(func.substr(i));
        var pre = size.toString().length;
        if (!size || !pre) { i--; break; } // counter i++ below us
        var curr = func.substr(i + pre, size);
        parts.push(curr);
        subs.push(curr);
        i += pre + size;
      }
      i++; // skip E
      return parts;
    }
    var first = true;
    function parse(rawList, limit, allowVoid) { // main parser
      limit = limit || Infinity;
      var ret = '', list = [];
      function flushList() {
        return '(' + list.join(', ') + ')';
      }
      var name;
      if (func[i] === 'N') {
        // namespaced N-E
        name = parseNested().join('::');
        limit--;
        if (limit === 0) return rawList ? [name] : name;
      } else {
        // not namespaced
        if (func[i] === 'K' || (first && func[i] === 'L')) i++; // ignore const and first 'L'
        var size = parseInt(func.substr(i));
        if (size) {
          var pre = size.toString().length;
          name = func.substr(i + pre, size);
          i += pre + size;
        }
      }
      first = false;
      if (func[i] === 'I') {
        i++;
        var iList = parse(true);
        var iRet = parse(true, 1, true);
        ret += iRet[0] + ' ' + name + '<' + iList.join(', ') + '>';
      } else {
        ret = name;
      }
      paramLoop: while (i < func.length && limit-- > 0) {
        //dump('paramLoop');
        var c = func[i++];
        if (c in basicTypes) {
          list.push(basicTypes[c]);
        } else {
          switch (c) {
            case 'P': list.push(parse(true, 1, true)[0] + '*'); break; // pointer
            case 'R': list.push(parse(true, 1, true)[0] + '&'); break; // reference
            case 'L': { // literal
              i++; // skip basic type
              var end = func.indexOf('E', i);
              var size = end - i;
              list.push(func.substr(i, size));
              i += size + 2; // size + 'EE'
              break;
            }
            case 'A': { // array
              var size = parseInt(func.substr(i));
              i += size.toString().length;
              if (func[i] !== '_') throw '?';
              i++; // skip _
              list.push(parse(true, 1, true)[0] + ' [' + size + ']');
              break;
            }
            case 'E': break paramLoop;
            default: ret += '?' + c; break paramLoop;
          }
        }
      }
      if (!allowVoid && list.length === 1 && list[0] === 'void') list = []; // avoid (void)
      return rawList ? list : ret + flushList();
    }
    return parse();
  } catch(e) {
    return func;
  }
}

function demangleAll(text) {
  return text.replace(/__Z[\w\d_]+/g, function(x) { var y = demangle(x); return x === y ? x : (x + ' [' + y + ']') });
}

function stackTrace() {
  var stack = new Error().stack;
  return stack ? demangleAll(stack) : '(no stack trace available)'; // Stack trace is not available at least on IE10 and Safari 6.
}

// Memory management

var PAGE_SIZE = 4096;
function alignMemoryPage(x) {
  return (x+4095)&-4096;
}

var HEAP;
var HEAP8, HEAPU8, HEAP16, HEAPU16, HEAP32, HEAPU32, HEAPF32, HEAPF64;

var STATIC_BASE = 0, STATICTOP = 0, staticSealed = false; // static area
var STACK_BASE = 0, STACKTOP = 0, STACK_MAX = 0; // stack area
var DYNAMIC_BASE = 0, DYNAMICTOP = 0; // dynamic area handled by sbrk

function enlargeMemory() {
  abort('Cannot enlarge memory arrays. Either (1) compile with -s TOTAL_MEMORY=X with X higher than the current value ' + TOTAL_MEMORY + ', (2) compile with ALLOW_MEMORY_GROWTH which adjusts the size at runtime but prevents some optimizations, or (3) set Module.TOTAL_MEMORY before the program runs.');
}

var TOTAL_STACK = Module['TOTAL_STACK'] || 5242880;
var TOTAL_MEMORY = Module['TOTAL_MEMORY'] || 16777216;
var FAST_MEMORY = Module['FAST_MEMORY'] || 2097152;


// Initialize the runtime's memory
// check for full engine support (use string 'subarray' to avoid closure compiler confusion)
assert(typeof Int32Array !== 'undefined' && typeof Float64Array !== 'undefined' && !!(new Int32Array(1)['subarray']) && !!(new Int32Array(1)['set']),
       'Cannot fallback to non-typed array case: Code is too specialized');

var buffer = new ArrayBuffer(TOTAL_MEMORY);
HEAP8 = new Int8Array(buffer);
HEAP16 = new Int16Array(buffer);
HEAP32 = new Int32Array(buffer);
HEAPU8 = new Uint8Array(buffer);
HEAPU16 = new Uint16Array(buffer);
HEAPU32 = new Uint32Array(buffer);
HEAPF32 = new Float32Array(buffer);
HEAPF64 = new Float64Array(buffer);

// Endianness check (note: assumes compiler arch was little-endian)
HEAP32[0] = 255;
assert(HEAPU8[0] === 255 && HEAPU8[3] === 0, 'Typed arrays 2 must be run on a little-endian system');

Module['HEAP'] = HEAP;
Module['HEAP8'] = HEAP8;
Module['HEAP16'] = HEAP16;
Module['HEAP32'] = HEAP32;
Module['HEAPU8'] = HEAPU8;
Module['HEAPU16'] = HEAPU16;
Module['HEAPU32'] = HEAPU32;
Module['HEAPF32'] = HEAPF32;
Module['HEAPF64'] = HEAPF64;

function callRuntimeCallbacks(callbacks) {
  while(callbacks.length > 0) {
    var callback = callbacks.shift();
    if (typeof callback == 'function') {
      callback();
      continue;
    }
    var func = callback.func;
    if (typeof func === 'number') {
      if (callback.arg === undefined) {
        Runtime.dynCall('v', func);
      } else {
        Runtime.dynCall('vi', func, [callback.arg]);
      }
    } else {
      func(callback.arg === undefined ? null : callback.arg);
    }
  }
}

var __ATPRERUN__  = []; // functions called before the runtime is initialized
var __ATINIT__    = []; // functions called during startup
var __ATMAIN__    = []; // functions called when main() is to be run
var __ATEXIT__    = []; // functions called during shutdown
var __ATPOSTRUN__ = []; // functions called after the runtime has exited

var runtimeInitialized = false;

function preRun() {
  // compatibility - merge in anything from Module['preRun'] at this time
  if (Module['preRun']) {
    if (typeof Module['preRun'] == 'function') Module['preRun'] = [Module['preRun']];
    while (Module['preRun'].length) {
      addOnPreRun(Module['preRun'].shift());
    }
  }
  callRuntimeCallbacks(__ATPRERUN__);
}

function ensureInitRuntime() {
  if (runtimeInitialized) return;
  runtimeInitialized = true;
  callRuntimeCallbacks(__ATINIT__);
}

function preMain() {
  callRuntimeCallbacks(__ATMAIN__);
}

function exitRuntime() {
  callRuntimeCallbacks(__ATEXIT__);
}

function postRun() {
  // compatibility - merge in anything from Module['postRun'] at this time
  if (Module['postRun']) {
    if (typeof Module['postRun'] == 'function') Module['postRun'] = [Module['postRun']];
    while (Module['postRun'].length) {
      addOnPostRun(Module['postRun'].shift());
    }
  }
  callRuntimeCallbacks(__ATPOSTRUN__);
}

function addOnPreRun(cb) {
  __ATPRERUN__.unshift(cb);
}
Module['addOnPreRun'] = Module.addOnPreRun = addOnPreRun;

function addOnInit(cb) {
  __ATINIT__.unshift(cb);
}
Module['addOnInit'] = Module.addOnInit = addOnInit;

function addOnPreMain(cb) {
  __ATMAIN__.unshift(cb);
}
Module['addOnPreMain'] = Module.addOnPreMain = addOnPreMain;

function addOnExit(cb) {
  __ATEXIT__.unshift(cb);
}
Module['addOnExit'] = Module.addOnExit = addOnExit;

function addOnPostRun(cb) {
  __ATPOSTRUN__.unshift(cb);
}
Module['addOnPostRun'] = Module.addOnPostRun = addOnPostRun;

// Tools

// This processes a JS string into a C-line array of numbers, 0-terminated.
// For LLVM-originating strings, see parser.js:parseLLVMString function
function intArrayFromString(stringy, dontAddNull, length /* optional */) {
  var ret = (new Runtime.UTF8Processor()).processJSString(stringy);
  if (length) {
    ret.length = length;
  }
  if (!dontAddNull) {
    ret.push(0);
  }
  return ret;
}
Module['intArrayFromString'] = intArrayFromString;

function intArrayToString(array) {
  var ret = [];
  for (var i = 0; i < array.length; i++) {
    var chr = array[i];
    if (chr > 0xFF) {
        assert(false, 'Character code ' + chr + ' (' + String.fromCharCode(chr) + ')  at offset ' + i + ' not in 0x00-0xFF.');
      chr &= 0xFF;
    }
    ret.push(String.fromCharCode(chr));
  }
  return ret.join('');
}
Module['intArrayToString'] = intArrayToString;

// Write a Javascript array to somewhere in the heap
function writeStringToMemory(string, buffer, dontAddNull) {
  var array = intArrayFromString(string, dontAddNull);
  var i = 0;
  while (i < array.length) {
    var chr = array[i];
    HEAP8[(((buffer)+(i))|0)]=chr;
    i = i + 1;
  }
}
Module['writeStringToMemory'] = writeStringToMemory;

function writeArrayToMemory(array, buffer) {
  for (var i = 0; i < array.length; i++) {
    HEAP8[(((buffer)+(i))|0)]=array[i];
  }
}
Module['writeArrayToMemory'] = writeArrayToMemory;

function writeAsciiToMemory(str, buffer, dontAddNull) {
  for (var i = 0; i < str.length; i++) {
    assert(str.charCodeAt(i) === str.charCodeAt(i)&0xff);
    HEAP8[(((buffer)+(i))|0)]=str.charCodeAt(i);
  }
  if (!dontAddNull) HEAP8[(((buffer)+(str.length))|0)]=0;
}
Module['writeAsciiToMemory'] = writeAsciiToMemory;

function unSign(value, bits, ignore, sig) {
  if (value >= 0) {
    return value;
  }
  return bits <= 32 ? 2*Math.abs(1 << (bits-1)) + value // Need some trickery, since if bits == 32, we are right at the limit of the bits JS uses in bitshifts
                    : Math.pow(2, bits)         + value;
}
function reSign(value, bits, ignore, sig) {
  if (value <= 0) {
    return value;
  }
  var half = bits <= 32 ? Math.abs(1 << (bits-1)) // abs is needed if bits == 32
                        : Math.pow(2, bits-1);
  if (value >= half && (bits <= 32 || value > half)) { // for huge values, we can hit the precision limit and always get true here. so don't do that
                                                       // but, in general there is no perfect solution here. With 64-bit ints, we get rounding and errors
                                                       // TODO: In i64 mode 1, resign the two parts separately and safely
    value = -2*half + value; // Cannot bitshift half, as it may be at the limit of the bits JS uses in bitshifts
  }
  return value;
}

// check for imul support, and also for correctness ( https://bugs.webkit.org/show_bug.cgi?id=126345 )
if (!Math['imul'] || Math['imul'](0xffffffff, 5) !== -5) Math['imul'] = function imul(a, b) {
  var ah  = a >>> 16;
  var al = a & 0xffff;
  var bh  = b >>> 16;
  var bl = b & 0xffff;
  return (al*bl + ((ah*bl + al*bh) << 16))|0;
};
Math.imul = Math['imul'];


var Math_abs = Math.abs;
var Math_cos = Math.cos;
var Math_sin = Math.sin;
var Math_tan = Math.tan;
var Math_acos = Math.acos;
var Math_asin = Math.asin;
var Math_atan = Math.atan;
var Math_atan2 = Math.atan2;
var Math_exp = Math.exp;
var Math_log = Math.log;
var Math_sqrt = Math.sqrt;
var Math_ceil = Math.ceil;
var Math_floor = Math.floor;
var Math_pow = Math.pow;
var Math_imul = Math.imul;
var Math_fround = Math.fround;
var Math_min = Math.min;

// A counter of dependencies for calling run(). If we need to
// do asynchronous work before running, increment this and
// decrement it. Incrementing must happen in a place like
// PRE_RUN_ADDITIONS (used by emcc to add file preloading).
// Note that you can add dependencies in preRun, even though
// it happens right before run - run will be postponed until
// the dependencies are met.
var runDependencies = 0;
var runDependencyWatcher = null;
var dependenciesFulfilled = null; // overridden to take different actions when all run dependencies are fulfilled
var runDependencyTracking = {};

function addRunDependency(id) {
  runDependencies++;
  if (Module['monitorRunDependencies']) {
    Module['monitorRunDependencies'](runDependencies);
  }
  if (id) {
    assert(!runDependencyTracking[id]);
    runDependencyTracking[id] = 1;
    if (runDependencyWatcher === null && typeof setInterval !== 'undefined') {
      // Check for missing dependencies every few seconds
      runDependencyWatcher = setInterval(function() {
        var shown = false;
        for (var dep in runDependencyTracking) {
          if (!shown) {
            shown = true;
            Module.printErr('still waiting on run dependencies:');
          }
          Module.printErr('dependency: ' + dep);
        }
        if (shown) {
          Module.printErr('(end of list)');
        }
      }, 10000);
    }
  } else {
    Module.printErr('warning: run dependency added without ID');
  }
}
Module['addRunDependency'] = addRunDependency;
function removeRunDependency(id) {
  runDependencies--;
  if (Module['monitorRunDependencies']) {
    Module['monitorRunDependencies'](runDependencies);
  }
  if (id) {
    assert(runDependencyTracking[id]);
    delete runDependencyTracking[id];
  } else {
    Module.printErr('warning: run dependency removed without ID');
  }
  if (runDependencies == 0) {
    if (runDependencyWatcher !== null) {
      clearInterval(runDependencyWatcher);
      runDependencyWatcher = null;
    }
    if (dependenciesFulfilled) {
      var callback = dependenciesFulfilled;
      dependenciesFulfilled = null;
      callback(); // can add another dependenciesFulfilled
    }
  }
}
Module['removeRunDependency'] = removeRunDependency;

Module["preloadedImages"] = {}; // maps url to image data
Module["preloadedAudios"] = {}; // maps url to audio data


var memoryInitializer = null;

// === Body ===



STATIC_BASE = 8;

STATICTOP = STATIC_BASE + 504;


/* global initializers */ __ATINIT__.push({ func: function() { runPostSets() } });





/* memory initializer */ allocate([255,255,255,0,0,0,0,0], "i8", ALLOC_NONE, Runtime.GLOBAL_BASE);
function runPostSets() {


}

var tempDoublePtr = Runtime.alignMemory(allocate(12, "i8", ALLOC_STATIC), 8);

assert(tempDoublePtr % 8 == 0);

function copyTempFloat(ptr) { // functions, because inlining this code increases code size too much

  HEAP8[tempDoublePtr] = HEAP8[ptr];

  HEAP8[tempDoublePtr+1] = HEAP8[ptr+1];

  HEAP8[tempDoublePtr+2] = HEAP8[ptr+2];

  HEAP8[tempDoublePtr+3] = HEAP8[ptr+3];

}

function copyTempDouble(ptr) {

  HEAP8[tempDoublePtr] = HEAP8[ptr];

  HEAP8[tempDoublePtr+1] = HEAP8[ptr+1];

  HEAP8[tempDoublePtr+2] = HEAP8[ptr+2];

  HEAP8[tempDoublePtr+3] = HEAP8[ptr+3];

  HEAP8[tempDoublePtr+4] = HEAP8[ptr+4];

  HEAP8[tempDoublePtr+5] = HEAP8[ptr+5];

  HEAP8[tempDoublePtr+6] = HEAP8[ptr+6];

  HEAP8[tempDoublePtr+7] = HEAP8[ptr+7];

}


  
  function _memset(ptr, value, num) {
      ptr = ptr|0; value = value|0; num = num|0;
      var stop = 0, value4 = 0, stop4 = 0, unaligned = 0;
      stop = (ptr + num)|0;
      if ((num|0) >= 20) {
        // This is unaligned, but quite large, so work hard to get to aligned settings
        value = value & 0xff;
        unaligned = ptr & 3;
        value4 = value | (value << 8) | (value << 16) | (value << 24);
        stop4 = stop & ~3;
        if (unaligned) {
          unaligned = (ptr + 4 - unaligned)|0;
          while ((ptr|0) < (unaligned|0)) { // no need to check for stop, since we have large num
            HEAP8[(ptr)]=value;
            ptr = (ptr+1)|0;
          }
        }
        while ((ptr|0) < (stop4|0)) {
          HEAP32[((ptr)>>2)]=value4;
          ptr = (ptr+4)|0;
        }
      }
      while ((ptr|0) < (stop|0)) {
        HEAP8[(ptr)]=value;
        ptr = (ptr+1)|0;
      }
      return (ptr-num)|0;
    }var _llvm_memset_p0i8_i32=_memset;

  
  function _memcpy(dest, src, num) {
      dest = dest|0; src = src|0; num = num|0;
      var ret = 0;
      ret = dest|0;
      if ((dest&3) == (src&3)) {
        while (dest & 3) {
          if ((num|0) == 0) return ret|0;
          HEAP8[(dest)]=HEAP8[(src)];
          dest = (dest+1)|0;
          src = (src+1)|0;
          num = (num-1)|0;
        }
        while ((num|0) >= 4) {
          HEAP32[((dest)>>2)]=HEAP32[((src)>>2)];
          dest = (dest+4)|0;
          src = (src+4)|0;
          num = (num-4)|0;
        }
      }
      while ((num|0) > 0) {
        HEAP8[(dest)]=HEAP8[(src)];
        dest = (dest+1)|0;
        src = (src+1)|0;
        num = (num-1)|0;
      }
      return ret|0;
    }var _llvm_memcpy_p0i8_p0i8_i32=_memcpy;

  function _abort() {
      Module['abort']();
    }

  
  
  var ___errno_state=0;function ___setErrNo(value) {
      // For convenient setting and returning of errno.
      HEAP32[((___errno_state)>>2)]=value;
      return value;
    }function ___errno_location() {
      return ___errno_state;
    }

  function _sbrk(bytes) {
      // Implement a Linux-like 'memory area' for our 'process'.
      // Changes the size of the memory area by |bytes|; returns the
      // address of the previous top ('break') of the memory area
      // We control the "dynamic" memory - DYNAMIC_BASE to DYNAMICTOP
      var self = _sbrk;
      if (!self.called) {
        DYNAMICTOP = alignMemoryPage(DYNAMICTOP); // make sure we start out aligned
        self.called = true;
        assert(Runtime.dynamicAlloc);
        self.alloc = Runtime.dynamicAlloc;
        Runtime.dynamicAlloc = function() { abort('cannot dynamically allocate, sbrk now has control') };
      }
      var ret = DYNAMICTOP;
      if (bytes != 0) self.alloc(bytes);
      return ret;  // Previous break location.
    }

  
  var ERRNO_CODES={EPERM:1,ENOENT:2,ESRCH:3,EINTR:4,EIO:5,ENXIO:6,E2BIG:7,ENOEXEC:8,EBADF:9,ECHILD:10,EAGAIN:11,EWOULDBLOCK:11,ENOMEM:12,EACCES:13,EFAULT:14,ENOTBLK:15,EBUSY:16,EEXIST:17,EXDEV:18,ENODEV:19,ENOTDIR:20,EISDIR:21,EINVAL:22,ENFILE:23,EMFILE:24,ENOTTY:25,ETXTBSY:26,EFBIG:27,ENOSPC:28,ESPIPE:29,EROFS:30,EMLINK:31,EPIPE:32,EDOM:33,ERANGE:34,ENOMSG:42,EIDRM:43,ECHRNG:44,EL2NSYNC:45,EL3HLT:46,EL3RST:47,ELNRNG:48,EUNATCH:49,ENOCSI:50,EL2HLT:51,EDEADLK:35,ENOLCK:37,EBADE:52,EBADR:53,EXFULL:54,ENOANO:55,EBADRQC:56,EBADSLT:57,EDEADLOCK:35,EBFONT:59,ENOSTR:60,ENODATA:61,ETIME:62,ENOSR:63,ENONET:64,ENOPKG:65,EREMOTE:66,ENOLINK:67,EADV:68,ESRMNT:69,ECOMM:70,EPROTO:71,EMULTIHOP:72,EDOTDOT:73,EBADMSG:74,ENOTUNIQ:76,EBADFD:77,EREMCHG:78,ELIBACC:79,ELIBBAD:80,ELIBSCN:81,ELIBMAX:82,ELIBEXEC:83,ENOSYS:38,ENOTEMPTY:39,ENAMETOOLONG:36,ELOOP:40,EOPNOTSUPP:95,EPFNOSUPPORT:96,ECONNRESET:104,ENOBUFS:105,EAFNOSUPPORT:97,EPROTOTYPE:91,ENOTSOCK:88,ENOPROTOOPT:92,ESHUTDOWN:108,ECONNREFUSED:111,EADDRINUSE:98,ECONNABORTED:103,ENETUNREACH:101,ENETDOWN:100,ETIMEDOUT:110,EHOSTDOWN:112,EHOSTUNREACH:113,EINPROGRESS:115,EALREADY:114,EDESTADDRREQ:89,EMSGSIZE:90,EPROTONOSUPPORT:93,ESOCKTNOSUPPORT:94,EADDRNOTAVAIL:99,ENETRESET:102,EISCONN:106,ENOTCONN:107,ETOOMANYREFS:109,EUSERS:87,EDQUOT:122,ESTALE:116,ENOTSUP:95,ENOMEDIUM:123,EILSEQ:84,EOVERFLOW:75,ECANCELED:125,ENOTRECOVERABLE:131,EOWNERDEAD:130,ESTRPIPE:86};function _sysconf(name) {
      // long sysconf(int name);
      // http://pubs.opengroup.org/onlinepubs/009695399/functions/sysconf.html
      switch(name) {
        case 30: return PAGE_SIZE;
        case 132:
        case 133:
        case 12:
        case 137:
        case 138:
        case 15:
        case 235:
        case 16:
        case 17:
        case 18:
        case 19:
        case 20:
        case 149:
        case 13:
        case 10:
        case 236:
        case 153:
        case 9:
        case 21:
        case 22:
        case 159:
        case 154:
        case 14:
        case 77:
        case 78:
        case 139:
        case 80:
        case 81:
        case 79:
        case 82:
        case 68:
        case 67:
        case 164:
        case 11:
        case 29:
        case 47:
        case 48:
        case 95:
        case 52:
        case 51:
        case 46:
          return 200809;
        case 27:
        case 246:
        case 127:
        case 128:
        case 23:
        case 24:
        case 160:
        case 161:
        case 181:
        case 182:
        case 242:
        case 183:
        case 184:
        case 243:
        case 244:
        case 245:
        case 165:
        case 178:
        case 179:
        case 49:
        case 50:
        case 168:
        case 169:
        case 175:
        case 170:
        case 171:
        case 172:
        case 97:
        case 76:
        case 32:
        case 173:
        case 35:
          return -1;
        case 176:
        case 177:
        case 7:
        case 155:
        case 8:
        case 157:
        case 125:
        case 126:
        case 92:
        case 93:
        case 129:
        case 130:
        case 131:
        case 94:
        case 91:
          return 1;
        case 74:
        case 60:
        case 69:
        case 70:
        case 4:
          return 1024;
        case 31:
        case 42:
        case 72:
          return 32;
        case 87:
        case 26:
        case 33:
          return 2147483647;
        case 34:
        case 1:
          return 47839;
        case 38:
        case 36:
          return 99;
        case 43:
        case 37:
          return 2048;
        case 0: return 2097152;
        case 3: return 65536;
        case 28: return 32768;
        case 44: return 32767;
        case 75: return 16384;
        case 39: return 1000;
        case 89: return 700;
        case 71: return 256;
        case 40: return 255;
        case 2: return 100;
        case 180: return 64;
        case 25: return 20;
        case 5: return 16;
        case 6: return 6;
        case 73: return 4;
        case 84: return 1;
      }
      ___setErrNo(ERRNO_CODES.EINVAL);
      return -1;
    }

  function _time(ptr) {
      var ret = Math.floor(Date.now()/1000);
      if (ptr) {
        HEAP32[((ptr)>>2)]=ret;
      }
      return ret;
    }





  function _strlen(ptr) {
      ptr = ptr|0;
      var curr = 0;
      curr = ptr;
      while (HEAP8[(curr)]) {
        curr = (curr + 1)|0;
      }
      return (curr - ptr)|0;
    }

  
  
  
  var ERRNO_MESSAGES={0:"Success",1:"Not super-user",2:"No such file or directory",3:"No such process",4:"Interrupted system call",5:"I/O error",6:"No such device or address",7:"Arg list too long",8:"Exec format error",9:"Bad file number",10:"No children",11:"No more processes",12:"Not enough core",13:"Permission denied",14:"Bad address",15:"Block device required",16:"Mount device busy",17:"File exists",18:"Cross-device link",19:"No such device",20:"Not a directory",21:"Is a directory",22:"Invalid argument",23:"Too many open files in system",24:"Too many open files",25:"Not a typewriter",26:"Text file busy",27:"File too large",28:"No space left on device",29:"Illegal seek",30:"Read only file system",31:"Too many links",32:"Broken pipe",33:"Math arg out of domain of func",34:"Math result not representable",35:"File locking deadlock error",36:"File or path name too long",37:"No record locks available",38:"Function not implemented",39:"Directory not empty",40:"Too many symbolic links",42:"No message of desired type",43:"Identifier removed",44:"Channel number out of range",45:"Level 2 not synchronized",46:"Level 3 halted",47:"Level 3 reset",48:"Link number out of range",49:"Protocol driver not attached",50:"No CSI structure available",51:"Level 2 halted",52:"Invalid exchange",53:"Invalid request descriptor",54:"Exchange full",55:"No anode",56:"Invalid request code",57:"Invalid slot",59:"Bad font file fmt",60:"Device not a stream",61:"No data (for no delay io)",62:"Timer expired",63:"Out of streams resources",64:"Machine is not on the network",65:"Package not installed",66:"The object is remote",67:"The link has been severed",68:"Advertise error",69:"Srmount error",70:"Communication error on send",71:"Protocol error",72:"Multihop attempted",73:"Cross mount point (not really error)",74:"Trying to read unreadable message",75:"Value too large for defined data type",76:"Given log. name not unique",77:"f.d. invalid for this operation",78:"Remote address changed",79:"Can   access a needed shared lib",80:"Accessing a corrupted shared lib",81:".lib section in a.out corrupted",82:"Attempting to link in too many libs",83:"Attempting to exec a shared library",84:"Illegal byte sequence",86:"Streams pipe error",87:"Too many users",88:"Socket operation on non-socket",89:"Destination address required",90:"Message too long",91:"Protocol wrong type for socket",92:"Protocol not available",93:"Unknown protocol",94:"Socket type not supported",95:"Not supported",96:"Protocol family not supported",97:"Address family not supported by protocol family",98:"Address already in use",99:"Address not available",100:"Network interface is not configured",101:"Network is unreachable",102:"Connection reset by network",103:"Connection aborted",104:"Connection reset by peer",105:"No buffer space available",106:"Socket is already connected",107:"Socket is not connected",108:"Can't send after socket shutdown",109:"Too many references",110:"Connection timed out",111:"Connection refused",112:"Host is down",113:"Host is unreachable",114:"Socket already connected",115:"Connection already in progress",116:"Stale file handle",122:"Quota exceeded",123:"No medium (in tape drive)",125:"Operation canceled",130:"Previous owner died",131:"State not recoverable"};
  
  var TTY={ttys:[],init:function () {
        // https://github.com/kripken/emscripten/pull/1555
        // if (ENVIRONMENT_IS_NODE) {
        //   // currently, FS.init does not distinguish if process.stdin is a file or TTY
        //   // device, it always assumes it's a TTY device. because of this, we're forcing
        //   // process.stdin to UTF8 encoding to at least make stdin reading compatible
        //   // with text files until FS.init can be refactored.
        //   process['stdin']['setEncoding']('utf8');
        // }
      },shutdown:function () {
        // https://github.com/kripken/emscripten/pull/1555
        // if (ENVIRONMENT_IS_NODE) {
        //   // inolen: any idea as to why node -e 'process.stdin.read()' wouldn't exit immediately (with process.stdin being a tty)?
        //   // isaacs: because now it's reading from the stream, you've expressed interest in it, so that read() kicks off a _read() which creates a ReadReq operation
        //   // inolen: I thought read() in that case was a synchronous operation that just grabbed some amount of buffered data if it exists?
        //   // isaacs: it is. but it also triggers a _read() call, which calls readStart() on the handle
        //   // isaacs: do process.stdin.pause() and i'd think it'd probably close the pending call
        //   process['stdin']['pause']();
        // }
      },register:function (dev, ops) {
        TTY.ttys[dev] = { input: [], output: [], ops: ops };
        FS.registerDevice(dev, TTY.stream_ops);
      },stream_ops:{open:function (stream) {
          var tty = TTY.ttys[stream.node.rdev];
          if (!tty) {
            throw new FS.ErrnoError(ERRNO_CODES.ENODEV);
          }
          stream.tty = tty;
          stream.seekable = false;
        },close:function (stream) {
          // flush any pending line data
          if (stream.tty.output.length) {
            stream.tty.ops.put_char(stream.tty, 10);
          }
        },read:function (stream, buffer, offset, length, pos /* ignored */) {
          if (!stream.tty || !stream.tty.ops.get_char) {
            throw new FS.ErrnoError(ERRNO_CODES.ENXIO);
          }
          var bytesRead = 0;
          for (var i = 0; i < length; i++) {
            var result;
            try {
              result = stream.tty.ops.get_char(stream.tty);
            } catch (e) {
              throw new FS.ErrnoError(ERRNO_CODES.EIO);
            }
            if (result === undefined && bytesRead === 0) {
              throw new FS.ErrnoError(ERRNO_CODES.EAGAIN);
            }
            if (result === null || result === undefined) break;
            bytesRead++;
            buffer[offset+i] = result;
          }
          if (bytesRead) {
            stream.node.timestamp = Date.now();
          }
          return bytesRead;
        },write:function (stream, buffer, offset, length, pos) {
          if (!stream.tty || !stream.tty.ops.put_char) {
            throw new FS.ErrnoError(ERRNO_CODES.ENXIO);
          }
          for (var i = 0; i < length; i++) {
            try {
              stream.tty.ops.put_char(stream.tty, buffer[offset+i]);
            } catch (e) {
              throw new FS.ErrnoError(ERRNO_CODES.EIO);
            }
          }
          if (length) {
            stream.node.timestamp = Date.now();
          }
          return i;
        }},default_tty_ops:{get_char:function (tty) {
          if (!tty.input.length) {
            var result = null;
            if (ENVIRONMENT_IS_NODE) {
              result = process['stdin']['read']();
              if (!result) {
                if (process['stdin']['_readableState'] && process['stdin']['_readableState']['ended']) {
                  return null;  // EOF
                }
                return undefined;  // no data available
              }
            } else if (typeof window != 'undefined' &&
              typeof window.prompt == 'function') {
              // Browser.
              result = window.prompt('Input: ');  // returns null on cancel
              if (result !== null) {
                result += '\n';
              }
            } else if (typeof readline == 'function') {
              // Command line.
              result = readline();
              if (result !== null) {
                result += '\n';
              }
            }
            if (!result) {
              return null;
            }
            tty.input = intArrayFromString(result, true);
          }
          return tty.input.shift();
        },put_char:function (tty, val) {
          if (val === null || val === 10) {
            Module['print'](tty.output.join(''));
            tty.output = [];
          } else {
            tty.output.push(TTY.utf8.processCChar(val));
          }
        }},default_tty1_ops:{put_char:function (tty, val) {
          if (val === null || val === 10) {
            Module['printErr'](tty.output.join(''));
            tty.output = [];
          } else {
            tty.output.push(TTY.utf8.processCChar(val));
          }
        }}};
  
  var MEMFS={ops_table:null,CONTENT_OWNING:1,CONTENT_FLEXIBLE:2,CONTENT_FIXED:3,mount:function (mount) {
        return MEMFS.createNode(null, '/', 16384 | 0777, 0);
      },createNode:function (parent, name, mode, dev) {
        if (FS.isBlkdev(mode) || FS.isFIFO(mode)) {
          // no supported
          throw new FS.ErrnoError(ERRNO_CODES.EPERM);
        }
        if (!MEMFS.ops_table) {
          MEMFS.ops_table = {
            dir: {
              node: {
                getattr: MEMFS.node_ops.getattr,
                setattr: MEMFS.node_ops.setattr,
                lookup: MEMFS.node_ops.lookup,
                mknod: MEMFS.node_ops.mknod,
                mknod: MEMFS.node_ops.mknod,
                rename: MEMFS.node_ops.rename,
                unlink: MEMFS.node_ops.unlink,
                rmdir: MEMFS.node_ops.rmdir,
                readdir: MEMFS.node_ops.readdir,
                symlink: MEMFS.node_ops.symlink
              },
              stream: {
                llseek: MEMFS.stream_ops.llseek
              }
            },
            file: {
              node: {
                getattr: MEMFS.node_ops.getattr,
                setattr: MEMFS.node_ops.setattr
              },
              stream: {
                llseek: MEMFS.stream_ops.llseek,
                read: MEMFS.stream_ops.read,
                write: MEMFS.stream_ops.write,
                allocate: MEMFS.stream_ops.allocate,
                mmap: MEMFS.stream_ops.mmap
              }
            },
            link: {
              node: {
                getattr: MEMFS.node_ops.getattr,
                setattr: MEMFS.node_ops.setattr,
                readlink: MEMFS.node_ops.readlink
              },
              stream: {}
            },
            chrdev: {
              node: {
                getattr: MEMFS.node_ops.getattr,
                setattr: MEMFS.node_ops.setattr
              },
              stream: FS.chrdev_stream_ops
            },
          };
        }
        var node = FS.createNode(parent, name, mode, dev);
        if (FS.isDir(node.mode)) {
          node.node_ops = MEMFS.ops_table.dir.node;
          node.stream_ops = MEMFS.ops_table.dir.stream;
          node.contents = {};
        } else if (FS.isFile(node.mode)) {
          node.node_ops = MEMFS.ops_table.file.node;
          node.stream_ops = MEMFS.ops_table.file.stream;
          node.contents = [];
          node.contentMode = MEMFS.CONTENT_FLEXIBLE;
        } else if (FS.isLink(node.mode)) {
          node.node_ops = MEMFS.ops_table.link.node;
          node.stream_ops = MEMFS.ops_table.link.stream;
        } else if (FS.isChrdev(node.mode)) {
          node.node_ops = MEMFS.ops_table.chrdev.node;
          node.stream_ops = MEMFS.ops_table.chrdev.stream;
        }
        node.timestamp = Date.now();
        // add the new node to the parent
        if (parent) {
          parent.contents[name] = node;
        }
        return node;
      },ensureFlexible:function (node) {
        if (node.contentMode !== MEMFS.CONTENT_FLEXIBLE) {
          var contents = node.contents;
          node.contents = Array.prototype.slice.call(contents);
          node.contentMode = MEMFS.CONTENT_FLEXIBLE;
        }
      },node_ops:{getattr:function (node) {
          var attr = {};
          // device numbers reuse inode numbers.
          attr.dev = FS.isChrdev(node.mode) ? node.id : 1;
          attr.ino = node.id;
          attr.mode = node.mode;
          attr.nlink = 1;
          attr.uid = 0;
          attr.gid = 0;
          attr.rdev = node.rdev;
          if (FS.isDir(node.mode)) {
            attr.size = 4096;
          } else if (FS.isFile(node.mode)) {
            attr.size = node.contents.length;
          } else if (FS.isLink(node.mode)) {
            attr.size = node.link.length;
          } else {
            attr.size = 0;
          }
          attr.atime = new Date(node.timestamp);
          attr.mtime = new Date(node.timestamp);
          attr.ctime = new Date(node.timestamp);
          // NOTE: In our implementation, st_blocks = Math.ceil(st_size/st_blksize),
          //       but this is not required by the standard.
          attr.blksize = 4096;
          attr.blocks = Math.ceil(attr.size / attr.blksize);
          return attr;
        },setattr:function (node, attr) {
          if (attr.mode !== undefined) {
            node.mode = attr.mode;
          }
          if (attr.timestamp !== undefined) {
            node.timestamp = attr.timestamp;
          }
          if (attr.size !== undefined) {
            MEMFS.ensureFlexible(node);
            var contents = node.contents;
            if (attr.size < contents.length) contents.length = attr.size;
            else while (attr.size > contents.length) contents.push(0);
          }
        },lookup:function (parent, name) {
          throw FS.genericErrors[ERRNO_CODES.ENOENT];
        },mknod:function (parent, name, mode, dev) {
          return MEMFS.createNode(parent, name, mode, dev);
        },rename:function (old_node, new_dir, new_name) {
          // if we're overwriting a directory at new_name, make sure it's empty.
          if (FS.isDir(old_node.mode)) {
            var new_node;
            try {
              new_node = FS.lookupNode(new_dir, new_name);
            } catch (e) {
            }
            if (new_node) {
              for (var i in new_node.contents) {
                throw new FS.ErrnoError(ERRNO_CODES.ENOTEMPTY);
              }
            }
          }
          // do the internal rewiring
          delete old_node.parent.contents[old_node.name];
          old_node.name = new_name;
          new_dir.contents[new_name] = old_node;
          old_node.parent = new_dir;
        },unlink:function (parent, name) {
          delete parent.contents[name];
        },rmdir:function (parent, name) {
          var node = FS.lookupNode(parent, name);
          for (var i in node.contents) {
            throw new FS.ErrnoError(ERRNO_CODES.ENOTEMPTY);
          }
          delete parent.contents[name];
        },readdir:function (node) {
          var entries = ['.', '..']
          for (var key in node.contents) {
            if (!node.contents.hasOwnProperty(key)) {
              continue;
            }
            entries.push(key);
          }
          return entries;
        },symlink:function (parent, newname, oldpath) {
          var node = MEMFS.createNode(parent, newname, 0777 | 40960, 0);
          node.link = oldpath;
          return node;
        },readlink:function (node) {
          if (!FS.isLink(node.mode)) {
            throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
          }
          return node.link;
        }},stream_ops:{read:function (stream, buffer, offset, length, position) {
          var contents = stream.node.contents;
          if (position >= contents.length)
            return 0;
          var size = Math.min(contents.length - position, length);
          assert(size >= 0);
          if (size > 8 && contents.subarray) { // non-trivial, and typed array
            buffer.set(contents.subarray(position, position + size), offset);
          } else
          {
            for (var i = 0; i < size; i++) {
              buffer[offset + i] = contents[position + i];
            }
          }
          return size;
        },write:function (stream, buffer, offset, length, position, canOwn) {
          var node = stream.node;
          node.timestamp = Date.now();
          var contents = node.contents;
          if (length && contents.length === 0 && position === 0 && buffer.subarray) {
            // just replace it with the new data
            assert(buffer.length);
            if (canOwn && offset === 0) {
              node.contents = buffer; // this could be a subarray of Emscripten HEAP, or allocated from some other source.
              node.contentMode = (buffer.buffer === HEAP8.buffer) ? MEMFS.CONTENT_OWNING : MEMFS.CONTENT_FIXED;
            } else {
              node.contents = new Uint8Array(buffer.subarray(offset, offset+length));
              node.contentMode = MEMFS.CONTENT_FIXED;
            }
            return length;
          }
          MEMFS.ensureFlexible(node);
          var contents = node.contents;
          while (contents.length < position) contents.push(0);
          for (var i = 0; i < length; i++) {
            contents[position + i] = buffer[offset + i];
          }
          return length;
        },llseek:function (stream, offset, whence) {
          var position = offset;
          if (whence === 1) {  // SEEK_CUR.
            position += stream.position;
          } else if (whence === 2) {  // SEEK_END.
            if (FS.isFile(stream.node.mode)) {
              position += stream.node.contents.length;
            }
          }
          if (position < 0) {
            throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
          }
          stream.ungotten = [];
          stream.position = position;
          return position;
        },allocate:function (stream, offset, length) {
          MEMFS.ensureFlexible(stream.node);
          var contents = stream.node.contents;
          var limit = offset + length;
          while (limit > contents.length) contents.push(0);
        },mmap:function (stream, buffer, offset, length, position, prot, flags) {
          if (!FS.isFile(stream.node.mode)) {
            throw new FS.ErrnoError(ERRNO_CODES.ENODEV);
          }
          var ptr;
          var allocated;
          var contents = stream.node.contents;
          // Only make a new copy when MAP_PRIVATE is specified.
          if ( !(flags & 2) &&
                (contents.buffer === buffer || contents.buffer === buffer.buffer) ) {
            // We can't emulate MAP_SHARED when the file is not backed by the buffer
            // we're mapping to (e.g. the HEAP buffer).
            allocated = false;
            ptr = contents.byteOffset;
          } else {
            // Try to avoid unnecessary slices.
            if (position > 0 || position + length < contents.length) {
              if (contents.subarray) {
                contents = contents.subarray(position, position + length);
              } else {
                contents = Array.prototype.slice.call(contents, position, position + length);
              }
            }
            allocated = true;
            ptr = _malloc(length);
            if (!ptr) {
              throw new FS.ErrnoError(ERRNO_CODES.ENOMEM);
            }
            buffer.set(contents, ptr);
          }
          return { ptr: ptr, allocated: allocated };
        }}};
  
  var IDBFS={dbs:{},indexedDB:function () {
        return window.indexedDB || window.mozIndexedDB || window.webkitIndexedDB || window.msIndexedDB;
      },DB_VERSION:20,DB_STORE_NAME:"FILE_DATA",mount:function (mount) {
        return MEMFS.mount.apply(null, arguments);
      },syncfs:function (mount, populate, callback) {
        IDBFS.getLocalSet(mount, function(err, local) {
          if (err) return callback(err);
  
          IDBFS.getRemoteSet(mount, function(err, remote) {
            if (err) return callback(err);
  
            var src = populate ? remote : local;
            var dst = populate ? local : remote;
  
            IDBFS.reconcile(src, dst, callback);
          });
        });
      },reconcile:function (src, dst, callback) {
        var total = 0;
  
        var create = {};
        for (var key in src.files) {
          if (!src.files.hasOwnProperty(key)) continue;
          var e = src.files[key];
          var e2 = dst.files[key];
          if (!e2 || e.timestamp > e2.timestamp) {
            create[key] = e;
            total++;
          }
        }
  
        var remove = {};
        for (var key in dst.files) {
          if (!dst.files.hasOwnProperty(key)) continue;
          var e = dst.files[key];
          var e2 = src.files[key];
          if (!e2) {
            remove[key] = e;
            total++;
          }
        }
  
        if (!total) {
          // early out
          return callback(null);
        }
  
        var completed = 0;
        function done(err) {
          if (err) return callback(err);
          if (++completed >= total) {
            return callback(null);
          }
        };
  
        // create a single transaction to handle and IDB reads / writes we'll need to do
        var db = src.type === 'remote' ? src.db : dst.db;
        var transaction = db.transaction([IDBFS.DB_STORE_NAME], 'readwrite');
        transaction.onerror = function transaction_onerror() { callback(this.error); };
        var store = transaction.objectStore(IDBFS.DB_STORE_NAME);
  
        for (var path in create) {
          if (!create.hasOwnProperty(path)) continue;
          var entry = create[path];
  
          if (dst.type === 'local') {
            // save file to local
            try {
              if (FS.isDir(entry.mode)) {
                FS.mkdir(path, entry.mode);
              } else if (FS.isFile(entry.mode)) {
                var stream = FS.open(path, 'w+', 0666);
                FS.write(stream, entry.contents, 0, entry.contents.length, 0, true /* canOwn */);
                FS.close(stream);
              }
              done(null);
            } catch (e) {
              return done(e);
            }
          } else {
            // save file to IDB
            var req = store.put(entry, path);
            req.onsuccess = function req_onsuccess() { done(null); };
            req.onerror = function req_onerror() { done(this.error); };
          }
        }
  
        for (var path in remove) {
          if (!remove.hasOwnProperty(path)) continue;
          var entry = remove[path];
  
          if (dst.type === 'local') {
            // delete file from local
            try {
              if (FS.isDir(entry.mode)) {
                // TODO recursive delete?
                FS.rmdir(path);
              } else if (FS.isFile(entry.mode)) {
                FS.unlink(path);
              }
              done(null);
            } catch (e) {
              return done(e);
            }
          } else {
            // delete file from IDB
            var req = store.delete(path);
            req.onsuccess = function req_onsuccess() { done(null); };
            req.onerror = function req_onerror() { done(this.error); };
          }
        }
      },getLocalSet:function (mount, callback) {
        var files = {};
  
        function isRealDir(p) {
          return p !== '.' && p !== '..';
        };
        function toAbsolute(root) {
          return function(p) {
            return PATH.join2(root, p);
          }
        };
  
        var check = FS.readdir(mount.mountpoint)
          .filter(isRealDir)
          .map(toAbsolute(mount.mountpoint));
  
        while (check.length) {
          var path = check.pop();
          var stat, node;
  
          try {
            var lookup = FS.lookupPath(path);
            node = lookup.node;
            stat = FS.stat(path);
          } catch (e) {
            return callback(e);
          }
  
          if (FS.isDir(stat.mode)) {
            check.push.apply(check, FS.readdir(path)
              .filter(isRealDir)
              .map(toAbsolute(path)));
  
            files[path] = { mode: stat.mode, timestamp: stat.mtime };
          } else if (FS.isFile(stat.mode)) {
            files[path] = { contents: node.contents, mode: stat.mode, timestamp: stat.mtime };
          } else {
            return callback(new Error('node type not supported'));
          }
        }
  
        return callback(null, { type: 'local', files: files });
      },getDB:function (name, callback) {
        // look it up in the cache
        var db = IDBFS.dbs[name];
        if (db) {
          return callback(null, db);
        }
        var req;
        try {
          req = IDBFS.indexedDB().open(name, IDBFS.DB_VERSION);
        } catch (e) {
          return onerror(e);
        }
        req.onupgradeneeded = function req_onupgradeneeded() {
          db = req.result;
          db.createObjectStore(IDBFS.DB_STORE_NAME);
        };
        req.onsuccess = function req_onsuccess() {
          db = req.result;
          // add to the cache
          IDBFS.dbs[name] = db;
          callback(null, db);
        };
        req.onerror = function req_onerror() {
          callback(this.error);
        };
      },getRemoteSet:function (mount, callback) {
        var files = {};
  
        IDBFS.getDB(mount.mountpoint, function(err, db) {
          if (err) return callback(err);
  
          var transaction = db.transaction([IDBFS.DB_STORE_NAME], 'readonly');
          transaction.onerror = function transaction_onerror() { callback(this.error); };
  
          var store = transaction.objectStore(IDBFS.DB_STORE_NAME);
          store.openCursor().onsuccess = function store_openCursor_onsuccess(event) {
            var cursor = event.target.result;
            if (!cursor) {
              return callback(null, { type: 'remote', db: db, files: files });
            }
  
            files[cursor.key] = cursor.value;
            cursor.continue();
          };
        });
      }};
  
  var NODEFS={isWindows:false,staticInit:function () {
        NODEFS.isWindows = !!process.platform.match(/^win/);
      },mount:function (mount) {
        assert(ENVIRONMENT_IS_NODE);
        return NODEFS.createNode(null, '/', NODEFS.getMode(mount.opts.root), 0);
      },createNode:function (parent, name, mode, dev) {
        if (!FS.isDir(mode) && !FS.isFile(mode) && !FS.isLink(mode)) {
          throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
        }
        var node = FS.createNode(parent, name, mode);
        node.node_ops = NODEFS.node_ops;
        node.stream_ops = NODEFS.stream_ops;
        return node;
      },getMode:function (path) {
        var stat;
        try {
          stat = fs.lstatSync(path);
          if (NODEFS.isWindows) {
            // On Windows, directories return permission bits 'rw-rw-rw-', even though they have 'rwxrwxrwx', so 
            // propagate write bits to execute bits.
            stat.mode = stat.mode | ((stat.mode & 146) >> 1);
          }
        } catch (e) {
          if (!e.code) throw e;
          throw new FS.ErrnoError(ERRNO_CODES[e.code]);
        }
        return stat.mode;
      },realPath:function (node) {
        var parts = [];
        while (node.parent !== node) {
          parts.push(node.name);
          node = node.parent;
        }
        parts.push(node.mount.opts.root);
        parts.reverse();
        return PATH.join.apply(null, parts);
      },flagsToPermissionStringMap:{0:"r",1:"r+",2:"r+",64:"r",65:"r+",66:"r+",129:"rx+",193:"rx+",514:"w+",577:"w",578:"w+",705:"wx",706:"wx+",1024:"a",1025:"a",1026:"a+",1089:"a",1090:"a+",1153:"ax",1154:"ax+",1217:"ax",1218:"ax+",4096:"rs",4098:"rs+"},flagsToPermissionString:function (flags) {
        if (flags in NODEFS.flagsToPermissionStringMap) {
          return NODEFS.flagsToPermissionStringMap[flags];
        } else {
          return flags;
        }
      },node_ops:{getattr:function (node) {
          var path = NODEFS.realPath(node);
          var stat;
          try {
            stat = fs.lstatSync(path);
          } catch (e) {
            if (!e.code) throw e;
            throw new FS.ErrnoError(ERRNO_CODES[e.code]);
          }
          // node.js v0.10.20 doesn't report blksize and blocks on Windows. Fake them with default blksize of 4096.
          // See http://support.microsoft.com/kb/140365
          if (NODEFS.isWindows && !stat.blksize) {
            stat.blksize = 4096;
          }
          if (NODEFS.isWindows && !stat.blocks) {
            stat.blocks = (stat.size+stat.blksize-1)/stat.blksize|0;
          }
          return {
            dev: stat.dev,
            ino: stat.ino,
            mode: stat.mode,
            nlink: stat.nlink,
            uid: stat.uid,
            gid: stat.gid,
            rdev: stat.rdev,
            size: stat.size,
            atime: stat.atime,
            mtime: stat.mtime,
            ctime: stat.ctime,
            blksize: stat.blksize,
            blocks: stat.blocks
          };
        },setattr:function (node, attr) {
          var path = NODEFS.realPath(node);
          try {
            if (attr.mode !== undefined) {
              fs.chmodSync(path, attr.mode);
              // update the common node structure mode as well
              node.mode = attr.mode;
            }
            if (attr.timestamp !== undefined) {
              var date = new Date(attr.timestamp);
              fs.utimesSync(path, date, date);
            }
            if (attr.size !== undefined) {
              fs.truncateSync(path, attr.size);
            }
          } catch (e) {
            if (!e.code) throw e;
            throw new FS.ErrnoError(ERRNO_CODES[e.code]);
          }
        },lookup:function (parent, name) {
          var path = PATH.join2(NODEFS.realPath(parent), name);
          var mode = NODEFS.getMode(path);
          return NODEFS.createNode(parent, name, mode);
        },mknod:function (parent, name, mode, dev) {
          var node = NODEFS.createNode(parent, name, mode, dev);
          // create the backing node for this in the fs root as well
          var path = NODEFS.realPath(node);
          try {
            if (FS.isDir(node.mode)) {
              fs.mkdirSync(path, node.mode);
            } else {
              fs.writeFileSync(path, '', { mode: node.mode });
            }
          } catch (e) {
            if (!e.code) throw e;
            throw new FS.ErrnoError(ERRNO_CODES[e.code]);
          }
          return node;
        },rename:function (oldNode, newDir, newName) {
          var oldPath = NODEFS.realPath(oldNode);
          var newPath = PATH.join2(NODEFS.realPath(newDir), newName);
          try {
            fs.renameSync(oldPath, newPath);
          } catch (e) {
            if (!e.code) throw e;
            throw new FS.ErrnoError(ERRNO_CODES[e.code]);
          }
        },unlink:function (parent, name) {
          var path = PATH.join2(NODEFS.realPath(parent), name);
          try {
            fs.unlinkSync(path);
          } catch (e) {
            if (!e.code) throw e;
            throw new FS.ErrnoError(ERRNO_CODES[e.code]);
          }
        },rmdir:function (parent, name) {
          var path = PATH.join2(NODEFS.realPath(parent), name);
          try {
            fs.rmdirSync(path);
          } catch (e) {
            if (!e.code) throw e;
            throw new FS.ErrnoError(ERRNO_CODES[e.code]);
          }
        },readdir:function (node) {
          var path = NODEFS.realPath(node);
          try {
            return fs.readdirSync(path);
          } catch (e) {
            if (!e.code) throw e;
            throw new FS.ErrnoError(ERRNO_CODES[e.code]);
          }
        },symlink:function (parent, newName, oldPath) {
          var newPath = PATH.join2(NODEFS.realPath(parent), newName);
          try {
            fs.symlinkSync(oldPath, newPath);
          } catch (e) {
            if (!e.code) throw e;
            throw new FS.ErrnoError(ERRNO_CODES[e.code]);
          }
        },readlink:function (node) {
          var path = NODEFS.realPath(node);
          try {
            return fs.readlinkSync(path);
          } catch (e) {
            if (!e.code) throw e;
            throw new FS.ErrnoError(ERRNO_CODES[e.code]);
          }
        }},stream_ops:{open:function (stream) {
          var path = NODEFS.realPath(stream.node);
          try {
            if (FS.isFile(stream.node.mode)) {
              stream.nfd = fs.openSync(path, NODEFS.flagsToPermissionString(stream.flags));
            }
          } catch (e) {
            if (!e.code) throw e;
            throw new FS.ErrnoError(ERRNO_CODES[e.code]);
          }
        },close:function (stream) {
          try {
            if (FS.isFile(stream.node.mode) && stream.nfd) {
              fs.closeSync(stream.nfd);
            }
          } catch (e) {
            if (!e.code) throw e;
            throw new FS.ErrnoError(ERRNO_CODES[e.code]);
          }
        },read:function (stream, buffer, offset, length, position) {
          // FIXME this is terrible.
          var nbuffer = new Buffer(length);
          var res;
          try {
            res = fs.readSync(stream.nfd, nbuffer, 0, length, position);
          } catch (e) {
            throw new FS.ErrnoError(ERRNO_CODES[e.code]);
          }
          if (res > 0) {
            for (var i = 0; i < res; i++) {
              buffer[offset + i] = nbuffer[i];
            }
          }
          return res;
        },write:function (stream, buffer, offset, length, position) {
          // FIXME this is terrible.
          var nbuffer = new Buffer(buffer.subarray(offset, offset + length));
          var res;
          try {
            res = fs.writeSync(stream.nfd, nbuffer, 0, length, position);
          } catch (e) {
            throw new FS.ErrnoError(ERRNO_CODES[e.code]);
          }
          return res;
        },llseek:function (stream, offset, whence) {
          var position = offset;
          if (whence === 1) {  // SEEK_CUR.
            position += stream.position;
          } else if (whence === 2) {  // SEEK_END.
            if (FS.isFile(stream.node.mode)) {
              try {
                var stat = fs.fstatSync(stream.nfd);
                position += stat.size;
              } catch (e) {
                throw new FS.ErrnoError(ERRNO_CODES[e.code]);
              }
            }
          }
  
          if (position < 0) {
            throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
          }
  
          stream.position = position;
          return position;
        }}};
  
  var _stdin=allocate(1, "i32*", ALLOC_STATIC);
  
  var _stdout=allocate(1, "i32*", ALLOC_STATIC);
  
  var _stderr=allocate(1, "i32*", ALLOC_STATIC);
  
  function _fflush(stream) {
      // int fflush(FILE *stream);
      // http://pubs.opengroup.org/onlinepubs/000095399/functions/fflush.html
      // we don't currently perform any user-space buffering of data
    }var FS={root:null,mounts:[],devices:[null],streams:[null],nextInode:1,nameTable:null,currentPath:"/",initialized:false,ignorePermissions:true,ErrnoError:null,genericErrors:{},handleFSError:function (e) {
        if (!(e instanceof FS.ErrnoError)) throw e + ' : ' + stackTrace();
        return ___setErrNo(e.errno);
      },lookupPath:function (path, opts) {
        path = PATH.resolve(FS.cwd(), path);
        opts = opts || { recurse_count: 0 };
  
        if (opts.recurse_count > 8) {  // max recursive lookup of 8
          throw new FS.ErrnoError(ERRNO_CODES.ELOOP);
        }
  
        // split the path
        var parts = PATH.normalizeArray(path.split('/').filter(function(p) {
          return !!p;
        }), false);
  
        // start at the root
        var current = FS.root;
        var current_path = '/';
  
        for (var i = 0; i < parts.length; i++) {
          var islast = (i === parts.length-1);
          if (islast && opts.parent) {
            // stop resolving
            break;
          }
  
          current = FS.lookupNode(current, parts[i]);
          current_path = PATH.join2(current_path, parts[i]);
  
          // jump to the mount's root node if this is a mountpoint
          if (FS.isMountpoint(current)) {
            current = current.mount.root;
          }
  
          // follow symlinks
          // by default, lookupPath will not follow a symlink if it is the final path component.
          // setting opts.follow = true will override this behavior.
          if (!islast || opts.follow) {
            var count = 0;
            while (FS.isLink(current.mode)) {
              var link = FS.readlink(current_path);
              current_path = PATH.resolve(PATH.dirname(current_path), link);
              
              var lookup = FS.lookupPath(current_path, { recurse_count: opts.recurse_count });
              current = lookup.node;
  
              if (count++ > 40) {  // limit max consecutive symlinks to 40 (SYMLOOP_MAX).
                throw new FS.ErrnoError(ERRNO_CODES.ELOOP);
              }
            }
          }
        }
  
        return { path: current_path, node: current };
      },getPath:function (node) {
        var path;
        while (true) {
          if (FS.isRoot(node)) {
            var mount = node.mount.mountpoint;
            if (!path) return mount;
            return mount[mount.length-1] !== '/' ? mount + '/' + path : mount + path;
          }
          path = path ? node.name + '/' + path : node.name;
          node = node.parent;
        }
      },hashName:function (parentid, name) {
        var hash = 0;
  
  
        for (var i = 0; i < name.length; i++) {
          hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
        }
        return ((parentid + hash) >>> 0) % FS.nameTable.length;
      },hashAddNode:function (node) {
        var hash = FS.hashName(node.parent.id, node.name);
        node.name_next = FS.nameTable[hash];
        FS.nameTable[hash] = node;
      },hashRemoveNode:function (node) {
        var hash = FS.hashName(node.parent.id, node.name);
        if (FS.nameTable[hash] === node) {
          FS.nameTable[hash] = node.name_next;
        } else {
          var current = FS.nameTable[hash];
          while (current) {
            if (current.name_next === node) {
              current.name_next = node.name_next;
              break;
            }
            current = current.name_next;
          }
        }
      },lookupNode:function (parent, name) {
        var err = FS.mayLookup(parent);
        if (err) {
          throw new FS.ErrnoError(err);
        }
        var hash = FS.hashName(parent.id, name);
        for (var node = FS.nameTable[hash]; node; node = node.name_next) {
          var nodeName = node.name;
          if (node.parent.id === parent.id && nodeName === name) {
            return node;
          }
        }
        // if we failed to find it in the cache, call into the VFS
        return FS.lookup(parent, name);
      },createNode:function (parent, name, mode, rdev) {
        if (!FS.FSNode) {
          FS.FSNode = function(parent, name, mode, rdev) {
            this.id = FS.nextInode++;
            this.name = name;
            this.mode = mode;
            this.node_ops = {};
            this.stream_ops = {};
            this.rdev = rdev;
            this.parent = null;
            this.mount = null;
            if (!parent) {
              parent = this;  // root node sets parent to itself
            }
            this.parent = parent;
            this.mount = parent.mount;
            FS.hashAddNode(this);
          };
  
          // compatibility
          var readMode = 292 | 73;
          var writeMode = 146;
  
          FS.FSNode.prototype = {};
  
          // NOTE we must use Object.defineProperties instead of individual calls to
          // Object.defineProperty in order to make closure compiler happy
          Object.defineProperties(FS.FSNode.prototype, {
            read: {
              get: function() { return (this.mode & readMode) === readMode; },
              set: function(val) { val ? this.mode |= readMode : this.mode &= ~readMode; }
            },
            write: {
              get: function() { return (this.mode & writeMode) === writeMode; },
              set: function(val) { val ? this.mode |= writeMode : this.mode &= ~writeMode; }
            },
            isFolder: {
              get: function() { return FS.isDir(this.mode); },
            },
            isDevice: {
              get: function() { return FS.isChrdev(this.mode); },
            },
          });
        }
        return new FS.FSNode(parent, name, mode, rdev);
      },destroyNode:function (node) {
        FS.hashRemoveNode(node);
      },isRoot:function (node) {
        return node === node.parent;
      },isMountpoint:function (node) {
        return node.mounted;
      },isFile:function (mode) {
        return (mode & 61440) === 32768;
      },isDir:function (mode) {
        return (mode & 61440) === 16384;
      },isLink:function (mode) {
        return (mode & 61440) === 40960;
      },isChrdev:function (mode) {
        return (mode & 61440) === 8192;
      },isBlkdev:function (mode) {
        return (mode & 61440) === 24576;
      },isFIFO:function (mode) {
        return (mode & 61440) === 4096;
      },isSocket:function (mode) {
        return (mode & 49152) === 49152;
      },flagModes:{"r":0,"rs":1052672,"r+":2,"w":577,"wx":705,"xw":705,"w+":578,"wx+":706,"xw+":706,"a":1089,"ax":1217,"xa":1217,"a+":1090,"ax+":1218,"xa+":1218},modeStringToFlags:function (str) {
        var flags = FS.flagModes[str];
        if (typeof flags === 'undefined') {
          throw new Error('Unknown file open mode: ' + str);
        }
        return flags;
      },flagsToPermissionString:function (flag) {
        var accmode = flag & 2097155;
        var perms = ['r', 'w', 'rw'][accmode];
        if ((flag & 512)) {
          perms += 'w';
        }
        return perms;
      },nodePermissions:function (node, perms) {
        if (FS.ignorePermissions) {
          return 0;
        }
        // return 0 if any user, group or owner bits are set.
        if (perms.indexOf('r') !== -1 && !(node.mode & 292)) {
          return ERRNO_CODES.EACCES;
        } else if (perms.indexOf('w') !== -1 && !(node.mode & 146)) {
          return ERRNO_CODES.EACCES;
        } else if (perms.indexOf('x') !== -1 && !(node.mode & 73)) {
          return ERRNO_CODES.EACCES;
        }
        return 0;
      },mayLookup:function (dir) {
        return FS.nodePermissions(dir, 'x');
      },mayCreate:function (dir, name) {
        try {
          var node = FS.lookupNode(dir, name);
          return ERRNO_CODES.EEXIST;
        } catch (e) {
        }
        return FS.nodePermissions(dir, 'wx');
      },mayDelete:function (dir, name, isdir) {
        var node;
        try {
          node = FS.lookupNode(dir, name);
        } catch (e) {
          return e.errno;
        }
        var err = FS.nodePermissions(dir, 'wx');
        if (err) {
          return err;
        }
        if (isdir) {
          if (!FS.isDir(node.mode)) {
            return ERRNO_CODES.ENOTDIR;
          }
          if (FS.isRoot(node) || FS.getPath(node) === FS.cwd()) {
            return ERRNO_CODES.EBUSY;
          }
        } else {
          if (FS.isDir(node.mode)) {
            return ERRNO_CODES.EISDIR;
          }
        }
        return 0;
      },mayOpen:function (node, flags) {
        if (!node) {
          return ERRNO_CODES.ENOENT;
        }
        if (FS.isLink(node.mode)) {
          return ERRNO_CODES.ELOOP;
        } else if (FS.isDir(node.mode)) {
          if ((flags & 2097155) !== 0 ||  // opening for write
              (flags & 512)) {
            return ERRNO_CODES.EISDIR;
          }
        }
        return FS.nodePermissions(node, FS.flagsToPermissionString(flags));
      },MAX_OPEN_FDS:4096,nextfd:function (fd_start, fd_end) {
        fd_start = fd_start || 1;
        fd_end = fd_end || FS.MAX_OPEN_FDS;
        for (var fd = fd_start; fd <= fd_end; fd++) {
          if (!FS.streams[fd]) {
            return fd;
          }
        }
        throw new FS.ErrnoError(ERRNO_CODES.EMFILE);
      },getStream:function (fd) {
        return FS.streams[fd];
      },createStream:function (stream, fd_start, fd_end) {
        if (!FS.FSStream) {
          FS.FSStream = function(){};
          FS.FSStream.prototype = {};
          // compatibility
          Object.defineProperties(FS.FSStream.prototype, {
            object: {
              get: function() { return this.node; },
              set: function(val) { this.node = val; }
            },
            isRead: {
              get: function() { return (this.flags & 2097155) !== 1; }
            },
            isWrite: {
              get: function() { return (this.flags & 2097155) !== 0; }
            },
            isAppend: {
              get: function() { return (this.flags & 1024); }
            }
          });
        }
        if (stream.__proto__) {
          // reuse the object
          stream.__proto__ = FS.FSStream.prototype;
        } else {
          var newStream = new FS.FSStream();
          for (var p in stream) {
            newStream[p] = stream[p];
          }
          stream = newStream;
        }
        var fd = FS.nextfd(fd_start, fd_end);
        stream.fd = fd;
        FS.streams[fd] = stream;
        return stream;
      },closeStream:function (fd) {
        FS.streams[fd] = null;
      },chrdev_stream_ops:{open:function (stream) {
          var device = FS.getDevice(stream.node.rdev);
          // override node's stream ops with the device's
          stream.stream_ops = device.stream_ops;
          // forward the open call
          if (stream.stream_ops.open) {
            stream.stream_ops.open(stream);
          }
        },llseek:function () {
          throw new FS.ErrnoError(ERRNO_CODES.ESPIPE);
        }},major:function (dev) {
        return ((dev) >> 8);
      },minor:function (dev) {
        return ((dev) & 0xff);
      },makedev:function (ma, mi) {
        return ((ma) << 8 | (mi));
      },registerDevice:function (dev, ops) {
        FS.devices[dev] = { stream_ops: ops };
      },getDevice:function (dev) {
        return FS.devices[dev];
      },syncfs:function (populate, callback) {
        if (typeof(populate) === 'function') {
          callback = populate;
          populate = false;
        }
  
        var completed = 0;
        var total = FS.mounts.length;
        function done(err) {
          if (err) {
            return callback(err);
          }
          if (++completed >= total) {
            callback(null);
          }
        };
  
        // sync all mounts
        for (var i = 0; i < FS.mounts.length; i++) {
          var mount = FS.mounts[i];
          if (!mount.type.syncfs) {
            done(null);
            continue;
          }
          mount.type.syncfs(mount, populate, done);
        }
      },mount:function (type, opts, mountpoint) {
        var lookup;
        if (mountpoint) {
          lookup = FS.lookupPath(mountpoint, { follow: false });
          mountpoint = lookup.path;  // use the absolute path
        }
        var mount = {
          type: type,
          opts: opts,
          mountpoint: mountpoint,
          root: null
        };
        // create a root node for the fs
        var root = type.mount(mount);
        root.mount = mount;
        mount.root = root;
        // assign the mount info to the mountpoint's node
        if (lookup) {
          lookup.node.mount = mount;
          lookup.node.mounted = true;
          // compatibility update FS.root if we mount to /
          if (mountpoint === '/') {
            FS.root = mount.root;
          }
        }
        // add to our cached list of mounts
        FS.mounts.push(mount);
        return root;
      },lookup:function (parent, name) {
        return parent.node_ops.lookup(parent, name);
      },mknod:function (path, mode, dev) {
        var lookup = FS.lookupPath(path, { parent: true });
        var parent = lookup.node;
        var name = PATH.basename(path);
        var err = FS.mayCreate(parent, name);
        if (err) {
          throw new FS.ErrnoError(err);
        }
        if (!parent.node_ops.mknod) {
          throw new FS.ErrnoError(ERRNO_CODES.EPERM);
        }
        return parent.node_ops.mknod(parent, name, mode, dev);
      },create:function (path, mode) {
        mode = mode !== undefined ? mode : 0666;
        mode &= 4095;
        mode |= 32768;
        return FS.mknod(path, mode, 0);
      },mkdir:function (path, mode) {
        mode = mode !== undefined ? mode : 0777;
        mode &= 511 | 512;
        mode |= 16384;
        return FS.mknod(path, mode, 0);
      },mkdev:function (path, mode, dev) {
        if (typeof(dev) === 'undefined') {
          dev = mode;
          mode = 0666;
        }
        mode |= 8192;
        return FS.mknod(path, mode, dev);
      },symlink:function (oldpath, newpath) {
        var lookup = FS.lookupPath(newpath, { parent: true });
        var parent = lookup.node;
        var newname = PATH.basename(newpath);
        var err = FS.mayCreate(parent, newname);
        if (err) {
          throw new FS.ErrnoError(err);
        }
        if (!parent.node_ops.symlink) {
          throw new FS.ErrnoError(ERRNO_CODES.EPERM);
        }
        return parent.node_ops.symlink(parent, newname, oldpath);
      },rename:function (old_path, new_path) {
        var old_dirname = PATH.dirname(old_path);
        var new_dirname = PATH.dirname(new_path);
        var old_name = PATH.basename(old_path);
        var new_name = PATH.basename(new_path);
        // parents must exist
        var lookup, old_dir, new_dir;
        try {
          lookup = FS.lookupPath(old_path, { parent: true });
          old_dir = lookup.node;
          lookup = FS.lookupPath(new_path, { parent: true });
          new_dir = lookup.node;
        } catch (e) {
          throw new FS.ErrnoError(ERRNO_CODES.EBUSY);
        }
        // need to be part of the same mount
        if (old_dir.mount !== new_dir.mount) {
          throw new FS.ErrnoError(ERRNO_CODES.EXDEV);
        }
        // source must exist
        var old_node = FS.lookupNode(old_dir, old_name);
        // old path should not be an ancestor of the new path
        var relative = PATH.relative(old_path, new_dirname);
        if (relative.charAt(0) !== '.') {
          throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
        }
        // new path should not be an ancestor of the old path
        relative = PATH.relative(new_path, old_dirname);
        if (relative.charAt(0) !== '.') {
          throw new FS.ErrnoError(ERRNO_CODES.ENOTEMPTY);
        }
        // see if the new path already exists
        var new_node;
        try {
          new_node = FS.lookupNode(new_dir, new_name);
        } catch (e) {
          // not fatal
        }
        // early out if nothing needs to change
        if (old_node === new_node) {
          return;
        }
        // we'll need to delete the old entry
        var isdir = FS.isDir(old_node.mode);
        var err = FS.mayDelete(old_dir, old_name, isdir);
        if (err) {
          throw new FS.ErrnoError(err);
        }
        // need delete permissions if we'll be overwriting.
        // need create permissions if new doesn't already exist.
        err = new_node ?
          FS.mayDelete(new_dir, new_name, isdir) :
          FS.mayCreate(new_dir, new_name);
        if (err) {
          throw new FS.ErrnoError(err);
        }
        if (!old_dir.node_ops.rename) {
          throw new FS.ErrnoError(ERRNO_CODES.EPERM);
        }
        if (FS.isMountpoint(old_node) || (new_node && FS.isMountpoint(new_node))) {
          throw new FS.ErrnoError(ERRNO_CODES.EBUSY);
        }
        // if we are going to change the parent, check write permissions
        if (new_dir !== old_dir) {
          err = FS.nodePermissions(old_dir, 'w');
          if (err) {
            throw new FS.ErrnoError(err);
          }
        }
        // remove the node from the lookup hash
        FS.hashRemoveNode(old_node);
        // do the underlying fs rename
        try {
          old_dir.node_ops.rename(old_node, new_dir, new_name);
        } catch (e) {
          throw e;
        } finally {
          // add the node back to the hash (in case node_ops.rename
          // changed its name)
          FS.hashAddNode(old_node);
        }
      },rmdir:function (path) {
        var lookup = FS.lookupPath(path, { parent: true });
        var parent = lookup.node;
        var name = PATH.basename(path);
        var node = FS.lookupNode(parent, name);
        var err = FS.mayDelete(parent, name, true);
        if (err) {
          throw new FS.ErrnoError(err);
        }
        if (!parent.node_ops.rmdir) {
          throw new FS.ErrnoError(ERRNO_CODES.EPERM);
        }
        if (FS.isMountpoint(node)) {
          throw new FS.ErrnoError(ERRNO_CODES.EBUSY);
        }
        parent.node_ops.rmdir(parent, name);
        FS.destroyNode(node);
      },readdir:function (path) {
        var lookup = FS.lookupPath(path, { follow: true });
        var node = lookup.node;
        if (!node.node_ops.readdir) {
          throw new FS.ErrnoError(ERRNO_CODES.ENOTDIR);
        }
        return node.node_ops.readdir(node);
      },unlink:function (path) {
        var lookup = FS.lookupPath(path, { parent: true });
        var parent = lookup.node;
        var name = PATH.basename(path);
        var node = FS.lookupNode(parent, name);
        var err = FS.mayDelete(parent, name, false);
        if (err) {
          // POSIX says unlink should set EPERM, not EISDIR
          if (err === ERRNO_CODES.EISDIR) err = ERRNO_CODES.EPERM;
          throw new FS.ErrnoError(err);
        }
        if (!parent.node_ops.unlink) {
          throw new FS.ErrnoError(ERRNO_CODES.EPERM);
        }
        if (FS.isMountpoint(node)) {
          throw new FS.ErrnoError(ERRNO_CODES.EBUSY);
        }
        parent.node_ops.unlink(parent, name);
        FS.destroyNode(node);
      },readlink:function (path) {
        var lookup = FS.lookupPath(path, { follow: false });
        var link = lookup.node;
        if (!link.node_ops.readlink) {
          throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
        }
        return link.node_ops.readlink(link);
      },stat:function (path, dontFollow) {
        var lookup = FS.lookupPath(path, { follow: !dontFollow });
        var node = lookup.node;
        if (!node.node_ops.getattr) {
          throw new FS.ErrnoError(ERRNO_CODES.EPERM);
        }
        return node.node_ops.getattr(node);
      },lstat:function (path) {
        return FS.stat(path, true);
      },chmod:function (path, mode, dontFollow) {
        var node;
        if (typeof path === 'string') {
          var lookup = FS.lookupPath(path, { follow: !dontFollow });
          node = lookup.node;
        } else {
          node = path;
        }
        if (!node.node_ops.setattr) {
          throw new FS.ErrnoError(ERRNO_CODES.EPERM);
        }
        node.node_ops.setattr(node, {
          mode: (mode & 4095) | (node.mode & ~4095),
          timestamp: Date.now()
        });
      },lchmod:function (path, mode) {
        FS.chmod(path, mode, true);
      },fchmod:function (fd, mode) {
        var stream = FS.getStream(fd);
        if (!stream) {
          throw new FS.ErrnoError(ERRNO_CODES.EBADF);
        }
        FS.chmod(stream.node, mode);
      },chown:function (path, uid, gid, dontFollow) {
        var node;
        if (typeof path === 'string') {
          var lookup = FS.lookupPath(path, { follow: !dontFollow });
          node = lookup.node;
        } else {
          node = path;
        }
        if (!node.node_ops.setattr) {
          throw new FS.ErrnoError(ERRNO_CODES.EPERM);
        }
        node.node_ops.setattr(node, {
          timestamp: Date.now()
          // we ignore the uid / gid for now
        });
      },lchown:function (path, uid, gid) {
        FS.chown(path, uid, gid, true);
      },fchown:function (fd, uid, gid) {
        var stream = FS.getStream(fd);
        if (!stream) {
          throw new FS.ErrnoError(ERRNO_CODES.EBADF);
        }
        FS.chown(stream.node, uid, gid);
      },truncate:function (path, len) {
        if (len < 0) {
          throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
        }
        var node;
        if (typeof path === 'string') {
          var lookup = FS.lookupPath(path, { follow: true });
          node = lookup.node;
        } else {
          node = path;
        }
        if (!node.node_ops.setattr) {
          throw new FS.ErrnoError(ERRNO_CODES.EPERM);
        }
        if (FS.isDir(node.mode)) {
          throw new FS.ErrnoError(ERRNO_CODES.EISDIR);
        }
        if (!FS.isFile(node.mode)) {
          throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
        }
        var err = FS.nodePermissions(node, 'w');
        if (err) {
          throw new FS.ErrnoError(err);
        }
        node.node_ops.setattr(node, {
          size: len,
          timestamp: Date.now()
        });
      },ftruncate:function (fd, len) {
        var stream = FS.getStream(fd);
        if (!stream) {
          throw new FS.ErrnoError(ERRNO_CODES.EBADF);
        }
        if ((stream.flags & 2097155) === 0) {
          throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
        }
        FS.truncate(stream.node, len);
      },utime:function (path, atime, mtime) {
        var lookup = FS.lookupPath(path, { follow: true });
        var node = lookup.node;
        node.node_ops.setattr(node, {
          timestamp: Math.max(atime, mtime)
        });
      },open:function (path, flags, mode, fd_start, fd_end) {
        flags = typeof flags === 'string' ? FS.modeStringToFlags(flags) : flags;
        mode = typeof mode === 'undefined' ? 0666 : mode;
        if ((flags & 64)) {
          mode = (mode & 4095) | 32768;
        } else {
          mode = 0;
        }
        var node;
        if (typeof path === 'object') {
          node = path;
        } else {
          path = PATH.normalize(path);
          try {
            var lookup = FS.lookupPath(path, {
              follow: !(flags & 131072)
            });
            node = lookup.node;
          } catch (e) {
            // ignore
          }
        }
        // perhaps we need to create the node
        if ((flags & 64)) {
          if (node) {
            // if O_CREAT and O_EXCL are set, error out if the node already exists
            if ((flags & 128)) {
              throw new FS.ErrnoError(ERRNO_CODES.EEXIST);
            }
          } else {
            // node doesn't exist, try to create it
            node = FS.mknod(path, mode, 0);
          }
        }
        if (!node) {
          throw new FS.ErrnoError(ERRNO_CODES.ENOENT);
        }
        // can't truncate a device
        if (FS.isChrdev(node.mode)) {
          flags &= ~512;
        }
        // check permissions
        var err = FS.mayOpen(node, flags);
        if (err) {
          throw new FS.ErrnoError(err);
        }
        // do truncation if necessary
        if ((flags & 512)) {
          FS.truncate(node, 0);
        }
        // we've already handled these, don't pass down to the underlying vfs
        flags &= ~(128 | 512);
  
        // register the stream with the filesystem
        var stream = FS.createStream({
          node: node,
          path: FS.getPath(node),  // we want the absolute path to the node
          flags: flags,
          seekable: true,
          position: 0,
          stream_ops: node.stream_ops,
          // used by the file family libc calls (fopen, fwrite, ferror, etc.)
          ungotten: [],
          error: false
        }, fd_start, fd_end);
        // call the new stream's open function
        if (stream.stream_ops.open) {
          stream.stream_ops.open(stream);
        }
        if (Module['logReadFiles'] && !(flags & 1)) {
          if (!FS.readFiles) FS.readFiles = {};
          if (!(path in FS.readFiles)) {
            FS.readFiles[path] = 1;
            Module['printErr']('read file: ' + path);
          }
        }
        return stream;
      },close:function (stream) {
        try {
          if (stream.stream_ops.close) {
            stream.stream_ops.close(stream);
          }
        } catch (e) {
          throw e;
        } finally {
          FS.closeStream(stream.fd);
        }
      },llseek:function (stream, offset, whence) {
        if (!stream.seekable || !stream.stream_ops.llseek) {
          throw new FS.ErrnoError(ERRNO_CODES.ESPIPE);
        }
        return stream.stream_ops.llseek(stream, offset, whence);
      },read:function (stream, buffer, offset, length, position) {
        if (length < 0 || position < 0) {
          throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
        }
        if ((stream.flags & 2097155) === 1) {
          throw new FS.ErrnoError(ERRNO_CODES.EBADF);
        }
        if (FS.isDir(stream.node.mode)) {
          throw new FS.ErrnoError(ERRNO_CODES.EISDIR);
        }
        if (!stream.stream_ops.read) {
          throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
        }
        var seeking = true;
        if (typeof position === 'undefined') {
          position = stream.position;
          seeking = false;
        } else if (!stream.seekable) {
          throw new FS.ErrnoError(ERRNO_CODES.ESPIPE);
        }
        var bytesRead = stream.stream_ops.read(stream, buffer, offset, length, position);
        if (!seeking) stream.position += bytesRead;
        return bytesRead;
      },write:function (stream, buffer, offset, length, position, canOwn) {
        if (length < 0 || position < 0) {
          throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
        }
        if ((stream.flags & 2097155) === 0) {
          throw new FS.ErrnoError(ERRNO_CODES.EBADF);
        }
        if (FS.isDir(stream.node.mode)) {
          throw new FS.ErrnoError(ERRNO_CODES.EISDIR);
        }
        if (!stream.stream_ops.write) {
          throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
        }
        var seeking = true;
        if (typeof position === 'undefined') {
          position = stream.position;
          seeking = false;
        } else if (!stream.seekable) {
          throw new FS.ErrnoError(ERRNO_CODES.ESPIPE);
        }
        if (stream.flags & 1024) {
          // seek to the end before writing in append mode
          FS.llseek(stream, 0, 2);
        }
        var bytesWritten = stream.stream_ops.write(stream, buffer, offset, length, position, canOwn);
        if (!seeking) stream.position += bytesWritten;
        return bytesWritten;
      },allocate:function (stream, offset, length) {
        if (offset < 0 || length <= 0) {
          throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
        }
        if ((stream.flags & 2097155) === 0) {
          throw new FS.ErrnoError(ERRNO_CODES.EBADF);
        }
        if (!FS.isFile(stream.node.mode) && !FS.isDir(node.mode)) {
          throw new FS.ErrnoError(ERRNO_CODES.ENODEV);
        }
        if (!stream.stream_ops.allocate) {
          throw new FS.ErrnoError(ERRNO_CODES.EOPNOTSUPP);
        }
        stream.stream_ops.allocate(stream, offset, length);
      },mmap:function (stream, buffer, offset, length, position, prot, flags) {
        // TODO if PROT is PROT_WRITE, make sure we have write access
        if ((stream.flags & 2097155) === 1) {
          throw new FS.ErrnoError(ERRNO_CODES.EACCES);
        }
        if (!stream.stream_ops.mmap) {
          throw new FS.ErrnoError(ERRNO_CODES.ENODEV);
        }
        return stream.stream_ops.mmap(stream, buffer, offset, length, position, prot, flags);
      },ioctl:function (stream, cmd, arg) {
        if (!stream.stream_ops.ioctl) {
          throw new FS.ErrnoError(ERRNO_CODES.ENOTTY);
        }
        return stream.stream_ops.ioctl(stream, cmd, arg);
      },readFile:function (path, opts) {
        opts = opts || {};
        opts.flags = opts.flags || 'r';
        opts.encoding = opts.encoding || 'binary';
        var ret;
        var stream = FS.open(path, opts.flags);
        var stat = FS.stat(path);
        var length = stat.size;
        var buf = new Uint8Array(length);
        FS.read(stream, buf, 0, length, 0);
        if (opts.encoding === 'utf8') {
          ret = '';
          var utf8 = new Runtime.UTF8Processor();
          for (var i = 0; i < length; i++) {
            ret += utf8.processCChar(buf[i]);
          }
        } else if (opts.encoding === 'binary') {
          ret = buf;
        } else {
          throw new Error('Invalid encoding type "' + opts.encoding + '"');
        }
        FS.close(stream);
        return ret;
      },writeFile:function (path, data, opts) {
        opts = opts || {};
        opts.flags = opts.flags || 'w';
        opts.encoding = opts.encoding || 'utf8';
        var stream = FS.open(path, opts.flags, opts.mode);
        if (opts.encoding === 'utf8') {
          var utf8 = new Runtime.UTF8Processor();
          var buf = new Uint8Array(utf8.processJSString(data));
          FS.write(stream, buf, 0, buf.length, 0);
        } else if (opts.encoding === 'binary') {
          FS.write(stream, data, 0, data.length, 0);
        } else {
          throw new Error('Invalid encoding type "' + opts.encoding + '"');
        }
        FS.close(stream);
      },cwd:function () {
        return FS.currentPath;
      },chdir:function (path) {
        var lookup = FS.lookupPath(path, { follow: true });
        if (!FS.isDir(lookup.node.mode)) {
          throw new FS.ErrnoError(ERRNO_CODES.ENOTDIR);
        }
        var err = FS.nodePermissions(lookup.node, 'x');
        if (err) {
          throw new FS.ErrnoError(err);
        }
        FS.currentPath = lookup.path;
      },createDefaultDirectories:function () {
        FS.mkdir('/tmp');
      },createDefaultDevices:function () {
        // create /dev
        FS.mkdir('/dev');
        // setup /dev/null
        FS.registerDevice(FS.makedev(1, 3), {
          read: function() { return 0; },
          write: function() { return 0; }
        });
        FS.mkdev('/dev/null', FS.makedev(1, 3));
        // setup /dev/tty and /dev/tty1
        // stderr needs to print output using Module['printErr']
        // so we register a second tty just for it.
        TTY.register(FS.makedev(5, 0), TTY.default_tty_ops);
        TTY.register(FS.makedev(6, 0), TTY.default_tty1_ops);
        FS.mkdev('/dev/tty', FS.makedev(5, 0));
        FS.mkdev('/dev/tty1', FS.makedev(6, 0));
        // we're not going to emulate the actual shm device,
        // just create the tmp dirs that reside in it commonly
        FS.mkdir('/dev/shm');
        FS.mkdir('/dev/shm/tmp');
      },createStandardStreams:function () {
        // TODO deprecate the old functionality of a single
        // input / output callback and that utilizes FS.createDevice
        // and instead require a unique set of stream ops
  
        // by default, we symlink the standard streams to the
        // default tty devices. however, if the standard streams
        // have been overwritten we create a unique device for
        // them instead.
        if (Module['stdin']) {
          FS.createDevice('/dev', 'stdin', Module['stdin']);
        } else {
          FS.symlink('/dev/tty', '/dev/stdin');
        }
        if (Module['stdout']) {
          FS.createDevice('/dev', 'stdout', null, Module['stdout']);
        } else {
          FS.symlink('/dev/tty', '/dev/stdout');
        }
        if (Module['stderr']) {
          FS.createDevice('/dev', 'stderr', null, Module['stderr']);
        } else {
          FS.symlink('/dev/tty1', '/dev/stderr');
        }
  
        // open default streams for the stdin, stdout and stderr devices
        var stdin = FS.open('/dev/stdin', 'r');
        HEAP32[((_stdin)>>2)]=stdin.fd;
        assert(stdin.fd === 1, 'invalid handle for stdin (' + stdin.fd + ')');
  
        var stdout = FS.open('/dev/stdout', 'w');
        HEAP32[((_stdout)>>2)]=stdout.fd;
        assert(stdout.fd === 2, 'invalid handle for stdout (' + stdout.fd + ')');
  
        var stderr = FS.open('/dev/stderr', 'w');
        HEAP32[((_stderr)>>2)]=stderr.fd;
        assert(stderr.fd === 3, 'invalid handle for stderr (' + stderr.fd + ')');
      },ensureErrnoError:function () {
        if (FS.ErrnoError) return;
        FS.ErrnoError = function ErrnoError(errno) {
          this.errno = errno;
          for (var key in ERRNO_CODES) {
            if (ERRNO_CODES[key] === errno) {
              this.code = key;
              break;
            }
          }
          this.message = ERRNO_MESSAGES[errno];
          if (this.stack) this.stack = demangleAll(this.stack);
        };
        FS.ErrnoError.prototype = new Error();
        FS.ErrnoError.prototype.constructor = FS.ErrnoError;
        // Some errors may happen quite a bit, to avoid overhead we reuse them (and suffer a lack of stack info)
        [ERRNO_CODES.ENOENT].forEach(function(code) {
          FS.genericErrors[code] = new FS.ErrnoError(code);
          FS.genericErrors[code].stack = '<generic error, no stack>';
        });
      },staticInit:function () {
        FS.ensureErrnoError();
  
        FS.nameTable = new Array(4096);
  
        FS.root = FS.createNode(null, '/', 16384 | 0777, 0);
        FS.mount(MEMFS, {}, '/');
  
        FS.createDefaultDirectories();
        FS.createDefaultDevices();
      },init:function (input, output, error) {
        assert(!FS.init.initialized, 'FS.init was previously called. If you want to initialize later with custom parameters, remove any earlier calls (note that one is automatically added to the generated code)');
        FS.init.initialized = true;
  
        FS.ensureErrnoError();
  
        // Allow Module.stdin etc. to provide defaults, if none explicitly passed to us here
        Module['stdin'] = input || Module['stdin'];
        Module['stdout'] = output || Module['stdout'];
        Module['stderr'] = error || Module['stderr'];
  
        FS.createStandardStreams();
      },quit:function () {
        FS.init.initialized = false;
        for (var i = 0; i < FS.streams.length; i++) {
          var stream = FS.streams[i];
          if (!stream) {
            continue;
          }
          FS.close(stream);
        }
      },getMode:function (canRead, canWrite) {
        var mode = 0;
        if (canRead) mode |= 292 | 73;
        if (canWrite) mode |= 146;
        return mode;
      },joinPath:function (parts, forceRelative) {
        var path = PATH.join.apply(null, parts);
        if (forceRelative && path[0] == '/') path = path.substr(1);
        return path;
      },absolutePath:function (relative, base) {
        return PATH.resolve(base, relative);
      },standardizePath:function (path) {
        return PATH.normalize(path);
      },findObject:function (path, dontResolveLastLink) {
        var ret = FS.analyzePath(path, dontResolveLastLink);
        if (ret.exists) {
          return ret.object;
        } else {
          ___setErrNo(ret.error);
          return null;
        }
      },analyzePath:function (path, dontResolveLastLink) {
        // operate from within the context of the symlink's target
        try {
          var lookup = FS.lookupPath(path, { follow: !dontResolveLastLink });
          path = lookup.path;
        } catch (e) {
        }
        var ret = {
          isRoot: false, exists: false, error: 0, name: null, path: null, object: null,
          parentExists: false, parentPath: null, parentObject: null
        };
        try {
          var lookup = FS.lookupPath(path, { parent: true });
          ret.parentExists = true;
          ret.parentPath = lookup.path;
          ret.parentObject = lookup.node;
          ret.name = PATH.basename(path);
          lookup = FS.lookupPath(path, { follow: !dontResolveLastLink });
          ret.exists = true;
          ret.path = lookup.path;
          ret.object = lookup.node;
          ret.name = lookup.node.name;
          ret.isRoot = lookup.path === '/';
        } catch (e) {
          ret.error = e.errno;
        };
        return ret;
      },createFolder:function (parent, name, canRead, canWrite) {
        var path = PATH.join2(typeof parent === 'string' ? parent : FS.getPath(parent), name);
        var mode = FS.getMode(canRead, canWrite);
        return FS.mkdir(path, mode);
      },createPath:function (parent, path, canRead, canWrite) {
        parent = typeof parent === 'string' ? parent : FS.getPath(parent);
        var parts = path.split('/').reverse();
        while (parts.length) {
          var part = parts.pop();
          if (!part) continue;
          var current = PATH.join2(parent, part);
          try {
            FS.mkdir(current);
          } catch (e) {
            // ignore EEXIST
          }
          parent = current;
        }
        return current;
      },createFile:function (parent, name, properties, canRead, canWrite) {
        var path = PATH.join2(typeof parent === 'string' ? parent : FS.getPath(parent), name);
        var mode = FS.getMode(canRead, canWrite);
        return FS.create(path, mode);
      },createDataFile:function (parent, name, data, canRead, canWrite, canOwn) {
        var path = name ? PATH.join2(typeof parent === 'string' ? parent : FS.getPath(parent), name) : parent;
        var mode = FS.getMode(canRead, canWrite);
        var node = FS.create(path, mode);
        if (data) {
          if (typeof data === 'string') {
            var arr = new Array(data.length);
            for (var i = 0, len = data.length; i < len; ++i) arr[i] = data.charCodeAt(i);
            data = arr;
          }
          // make sure we can write to the file
          FS.chmod(node, mode | 146);
          var stream = FS.open(node, 'w');
          FS.write(stream, data, 0, data.length, 0, canOwn);
          FS.close(stream);
          FS.chmod(node, mode);
        }
        return node;
      },createDevice:function (parent, name, input, output) {
        var path = PATH.join2(typeof parent === 'string' ? parent : FS.getPath(parent), name);
        var mode = FS.getMode(!!input, !!output);
        if (!FS.createDevice.major) FS.createDevice.major = 64;
        var dev = FS.makedev(FS.createDevice.major++, 0);
        // Create a fake device that a set of stream ops to emulate
        // the old behavior.
        FS.registerDevice(dev, {
          open: function(stream) {
            stream.seekable = false;
          },
          close: function(stream) {
            // flush any pending line data
            if (output && output.buffer && output.buffer.length) {
              output(10);
            }
          },
          read: function(stream, buffer, offset, length, pos /* ignored */) {
            var bytesRead = 0;
            for (var i = 0; i < length; i++) {
              var result;
              try {
                result = input();
              } catch (e) {
                throw new FS.ErrnoError(ERRNO_CODES.EIO);
              }
              if (result === undefined && bytesRead === 0) {
                throw new FS.ErrnoError(ERRNO_CODES.EAGAIN);
              }
              if (result === null || result === undefined) break;
              bytesRead++;
              buffer[offset+i] = result;
            }
            if (bytesRead) {
              stream.node.timestamp = Date.now();
            }
            return bytesRead;
          },
          write: function(stream, buffer, offset, length, pos) {
            for (var i = 0; i < length; i++) {
              try {
                output(buffer[offset+i]);
              } catch (e) {
                throw new FS.ErrnoError(ERRNO_CODES.EIO);
              }
            }
            if (length) {
              stream.node.timestamp = Date.now();
            }
            return i;
          }
        });
        return FS.mkdev(path, mode, dev);
      },createLink:function (parent, name, target, canRead, canWrite) {
        var path = PATH.join2(typeof parent === 'string' ? parent : FS.getPath(parent), name);
        return FS.symlink(target, path);
      },forceLoadFile:function (obj) {
        if (obj.isDevice || obj.isFolder || obj.link || obj.contents) return true;
        var success = true;
        if (typeof XMLHttpRequest !== 'undefined') {
          throw new Error("Lazy loading should have been performed (contents set) in createLazyFile, but it was not. Lazy loading only works in web workers. Use --embed-file or --preload-file in emcc on the main thread.");
        } else if (Module['read']) {
          // Command-line.
          try {
            // WARNING: Can't read binary files in V8's d8 or tracemonkey's js, as
            //          read() will try to parse UTF8.
            obj.contents = intArrayFromString(Module['read'](obj.url), true);
          } catch (e) {
            success = false;
          }
        } else {
          throw new Error('Cannot load without read() or XMLHttpRequest.');
        }
        if (!success) ___setErrNo(ERRNO_CODES.EIO);
        return success;
      },createLazyFile:function (parent, name, url, canRead, canWrite) {
        if (typeof XMLHttpRequest !== 'undefined') {
          if (!ENVIRONMENT_IS_WORKER) throw 'Cannot do synchronous binary XHRs outside webworkers in modern browsers. Use --embed-file or --preload-file in emcc';
          // Lazy chunked Uint8Array (implements get and length from Uint8Array). Actual getting is abstracted away for eventual reuse.
          function LazyUint8Array() {
            this.lengthKnown = false;
            this.chunks = []; // Loaded chunks. Index is the chunk number
          }
          LazyUint8Array.prototype.get = function LazyUint8Array_get(idx) {
            if (idx > this.length-1 || idx < 0) {
              return undefined;
            }
            var chunkOffset = idx % this.chunkSize;
            var chunkNum = Math.floor(idx / this.chunkSize);
            return this.getter(chunkNum)[chunkOffset];
          }
          LazyUint8Array.prototype.setDataGetter = function LazyUint8Array_setDataGetter(getter) {
            this.getter = getter;
          }
          LazyUint8Array.prototype.cacheLength = function LazyUint8Array_cacheLength() {
              // Find length
              var xhr = new XMLHttpRequest();
              xhr.open('HEAD', url, false);
              xhr.send(null);
              if (!(xhr.status >= 200 && xhr.status < 300 || xhr.status === 304)) throw new Error("Couldn't load " + url + ". Status: " + xhr.status);
              var datalength = Number(xhr.getResponseHeader("Content-length"));
              var header;
              var hasByteServing = (header = xhr.getResponseHeader("Accept-Ranges")) && header === "bytes";
              var chunkSize = 1024*1024; // Chunk size in bytes
  
              if (!hasByteServing) chunkSize = datalength;
  
              // Function to get a range from the remote URL.
              var doXHR = (function(from, to) {
                if (from > to) throw new Error("invalid range (" + from + ", " + to + ") or no bytes requested!");
                if (to > datalength-1) throw new Error("only " + datalength + " bytes available! programmer error!");
  
                // TODO: Use mozResponseArrayBuffer, responseStream, etc. if available.
                var xhr = new XMLHttpRequest();
                xhr.open('GET', url, false);
                if (datalength !== chunkSize) xhr.setRequestHeader("Range", "bytes=" + from + "-" + to);
  
                // Some hints to the browser that we want binary data.
                if (typeof Uint8Array != 'undefined') xhr.responseType = 'arraybuffer';
                if (xhr.overrideMimeType) {
                  xhr.overrideMimeType('text/plain; charset=x-user-defined');
                }
  
                xhr.send(null);
                if (!(xhr.status >= 200 && xhr.status < 300 || xhr.status === 304)) throw new Error("Couldn't load " + url + ". Status: " + xhr.status);
                if (xhr.response !== undefined) {
                  return new Uint8Array(xhr.response || []);
                } else {
                  return intArrayFromString(xhr.responseText || '', true);
                }
              });
              var lazyArray = this;
              lazyArray.setDataGetter(function(chunkNum) {
                var start = chunkNum * chunkSize;
                var end = (chunkNum+1) * chunkSize - 1; // including this byte
                end = Math.min(end, datalength-1); // if datalength-1 is selected, this is the last block
                if (typeof(lazyArray.chunks[chunkNum]) === "undefined") {
                  lazyArray.chunks[chunkNum] = doXHR(start, end);
                }
                if (typeof(lazyArray.chunks[chunkNum]) === "undefined") throw new Error("doXHR failed!");
                return lazyArray.chunks[chunkNum];
              });
  
              this._length = datalength;
              this._chunkSize = chunkSize;
              this.lengthKnown = true;
          }
  
          var lazyArray = new LazyUint8Array();
          Object.defineProperty(lazyArray, "length", {
              get: function() {
                  if(!this.lengthKnown) {
                      this.cacheLength();
                  }
                  return this._length;
              }
          });
          Object.defineProperty(lazyArray, "chunkSize", {
              get: function() {
                  if(!this.lengthKnown) {
                      this.cacheLength();
                  }
                  return this._chunkSize;
              }
          });
  
          var properties = { isDevice: false, contents: lazyArray };
        } else {
          var properties = { isDevice: false, url: url };
        }
  
        var node = FS.createFile(parent, name, properties, canRead, canWrite);
        // This is a total hack, but I want to get this lazy file code out of the
        // core of MEMFS. If we want to keep this lazy file concept I feel it should
        // be its own thin LAZYFS proxying calls to MEMFS.
        if (properties.contents) {
          node.contents = properties.contents;
        } else if (properties.url) {
          node.contents = null;
          node.url = properties.url;
        }
        // override each stream op with one that tries to force load the lazy file first
        var stream_ops = {};
        var keys = Object.keys(node.stream_ops);
        keys.forEach(function(key) {
          var fn = node.stream_ops[key];
          stream_ops[key] = function forceLoadLazyFile() {
            if (!FS.forceLoadFile(node)) {
              throw new FS.ErrnoError(ERRNO_CODES.EIO);
            }
            return fn.apply(null, arguments);
          };
        });
        // use a custom read function
        stream_ops.read = function stream_ops_read(stream, buffer, offset, length, position) {
          if (!FS.forceLoadFile(node)) {
            throw new FS.ErrnoError(ERRNO_CODES.EIO);
          }
          var contents = stream.node.contents;
          if (position >= contents.length)
            return 0;
          var size = Math.min(contents.length - position, length);
          assert(size >= 0);
          if (contents.slice) { // normal array
            for (var i = 0; i < size; i++) {
              buffer[offset + i] = contents[position + i];
            }
          } else {
            for (var i = 0; i < size; i++) { // LazyUint8Array from sync binary XHR
              buffer[offset + i] = contents.get(position + i);
            }
          }
          return size;
        };
        node.stream_ops = stream_ops;
        return node;
      },createPreloadedFile:function (parent, name, url, canRead, canWrite, onload, onerror, dontCreateFile, canOwn) {
        Browser.init();
        // TODO we should allow people to just pass in a complete filename instead
        // of parent and name being that we just join them anyways
        var fullname = name ? PATH.resolve(PATH.join2(parent, name)) : parent;
        function processData(byteArray) {
          function finish(byteArray) {
            if (!dontCreateFile) {
              FS.createDataFile(parent, name, byteArray, canRead, canWrite, canOwn);
            }
            if (onload) onload();
            removeRunDependency('cp ' + fullname);
          }
          var handled = false;
          Module['preloadPlugins'].forEach(function(plugin) {
            if (handled) return;
            if (plugin['canHandle'](fullname)) {
              plugin['handle'](byteArray, fullname, finish, function() {
                if (onerror) onerror();
                removeRunDependency('cp ' + fullname);
              });
              handled = true;
            }
          });
          if (!handled) finish(byteArray);
        }
        addRunDependency('cp ' + fullname);
        if (typeof url == 'string') {
          Browser.asyncLoad(url, function(byteArray) {
            processData(byteArray);
          }, onerror);
        } else {
          processData(url);
        }
      },indexedDB:function () {
        return window.indexedDB || window.mozIndexedDB || window.webkitIndexedDB || window.msIndexedDB;
      },DB_NAME:function () {
        return 'EM_FS_' + window.location.pathname;
      },DB_VERSION:20,DB_STORE_NAME:"FILE_DATA",saveFilesToDB:function (paths, onload, onerror) {
        onload = onload || function(){};
        onerror = onerror || function(){};
        var indexedDB = FS.indexedDB();
        try {
          var openRequest = indexedDB.open(FS.DB_NAME(), FS.DB_VERSION);
        } catch (e) {
          return onerror(e);
        }
        openRequest.onupgradeneeded = function openRequest_onupgradeneeded() {
          console.log('creating db');
          var db = openRequest.result;
          db.createObjectStore(FS.DB_STORE_NAME);
        };
        openRequest.onsuccess = function openRequest_onsuccess() {
          var db = openRequest.result;
          var transaction = db.transaction([FS.DB_STORE_NAME], 'readwrite');
          var files = transaction.objectStore(FS.DB_STORE_NAME);
          var ok = 0, fail = 0, total = paths.length;
          function finish() {
            if (fail == 0) onload(); else onerror();
          }
          paths.forEach(function(path) {
            var putRequest = files.put(FS.analyzePath(path).object.contents, path);
            putRequest.onsuccess = function putRequest_onsuccess() { ok++; if (ok + fail == total) finish() };
            putRequest.onerror = function putRequest_onerror() { fail++; if (ok + fail == total) finish() };
          });
          transaction.onerror = onerror;
        };
        openRequest.onerror = onerror;
      },loadFilesFromDB:function (paths, onload, onerror) {
        onload = onload || function(){};
        onerror = onerror || function(){};
        var indexedDB = FS.indexedDB();
        try {
          var openRequest = indexedDB.open(FS.DB_NAME(), FS.DB_VERSION);
        } catch (e) {
          return onerror(e);
        }
        openRequest.onupgradeneeded = onerror; // no database to load from
        openRequest.onsuccess = function openRequest_onsuccess() {
          var db = openRequest.result;
          try {
            var transaction = db.transaction([FS.DB_STORE_NAME], 'readonly');
          } catch(e) {
            onerror(e);
            return;
          }
          var files = transaction.objectStore(FS.DB_STORE_NAME);
          var ok = 0, fail = 0, total = paths.length;
          function finish() {
            if (fail == 0) onload(); else onerror();
          }
          paths.forEach(function(path) {
            var getRequest = files.get(path);
            getRequest.onsuccess = function getRequest_onsuccess() {
              if (FS.analyzePath(path).exists) {
                FS.unlink(path);
              }
              FS.createDataFile(PATH.dirname(path), PATH.basename(path), getRequest.result, true, true, true);
              ok++;
              if (ok + fail == total) finish();
            };
            getRequest.onerror = function getRequest_onerror() { fail++; if (ok + fail == total) finish() };
          });
          transaction.onerror = onerror;
        };
        openRequest.onerror = onerror;
      }};var PATH={splitPath:function (filename) {
        var splitPathRe = /^(\/?|)([\s\S]*?)((?:\.{1,2}|[^\/]+?|)(\.[^.\/]*|))(?:[\/]*)$/;
        return splitPathRe.exec(filename).slice(1);
      },normalizeArray:function (parts, allowAboveRoot) {
        // if the path tries to go above the root, `up` ends up > 0
        var up = 0;
        for (var i = parts.length - 1; i >= 0; i--) {
          var last = parts[i];
          if (last === '.') {
            parts.splice(i, 1);
          } else if (last === '..') {
            parts.splice(i, 1);
            up++;
          } else if (up) {
            parts.splice(i, 1);
            up--;
          }
        }
        // if the path is allowed to go above the root, restore leading ..s
        if (allowAboveRoot) {
          for (; up--; up) {
            parts.unshift('..');
          }
        }
        return parts;
      },normalize:function (path) {
        var isAbsolute = path.charAt(0) === '/',
            trailingSlash = path.substr(-1) === '/';
        // Normalize the path
        path = PATH.normalizeArray(path.split('/').filter(function(p) {
          return !!p;
        }), !isAbsolute).join('/');
        if (!path && !isAbsolute) {
          path = '.';
        }
        if (path && trailingSlash) {
          path += '/';
        }
        return (isAbsolute ? '/' : '') + path;
      },dirname:function (path) {
        var result = PATH.splitPath(path),
            root = result[0],
            dir = result[1];
        if (!root && !dir) {
          // No dirname whatsoever
          return '.';
        }
        if (dir) {
          // It has a dirname, strip trailing slash
          dir = dir.substr(0, dir.length - 1);
        }
        return root + dir;
      },basename:function (path) {
        // EMSCRIPTEN return '/'' for '/', not an empty string
        if (path === '/') return '/';
        var lastSlash = path.lastIndexOf('/');
        if (lastSlash === -1) return path;
        return path.substr(lastSlash+1);
      },extname:function (path) {
        return PATH.splitPath(path)[3];
      },join:function () {
        var paths = Array.prototype.slice.call(arguments, 0);
        return PATH.normalize(paths.join('/'));
      },join2:function (l, r) {
        return PATH.normalize(l + '/' + r);
      },resolve:function () {
        var resolvedPath = '',
          resolvedAbsolute = false;
        for (var i = arguments.length - 1; i >= -1 && !resolvedAbsolute; i--) {
          var path = (i >= 0) ? arguments[i] : FS.cwd();
          // Skip empty and invalid entries
          if (typeof path !== 'string') {
            throw new TypeError('Arguments to path.resolve must be strings');
          } else if (!path) {
            continue;
          }
          resolvedPath = path + '/' + resolvedPath;
          resolvedAbsolute = path.charAt(0) === '/';
        }
        // At this point the path should be resolved to a full absolute path, but
        // handle relative paths to be safe (might happen when process.cwd() fails)
        resolvedPath = PATH.normalizeArray(resolvedPath.split('/').filter(function(p) {
          return !!p;
        }), !resolvedAbsolute).join('/');
        return ((resolvedAbsolute ? '/' : '') + resolvedPath) || '.';
      },relative:function (from, to) {
        from = PATH.resolve(from).substr(1);
        to = PATH.resolve(to).substr(1);
        function trim(arr) {
          var start = 0;
          for (; start < arr.length; start++) {
            if (arr[start] !== '') break;
          }
          var end = arr.length - 1;
          for (; end >= 0; end--) {
            if (arr[end] !== '') break;
          }
          if (start > end) return [];
          return arr.slice(start, end - start + 1);
        }
        var fromParts = trim(from.split('/'));
        var toParts = trim(to.split('/'));
        var length = Math.min(fromParts.length, toParts.length);
        var samePartsLength = length;
        for (var i = 0; i < length; i++) {
          if (fromParts[i] !== toParts[i]) {
            samePartsLength = i;
            break;
          }
        }
        var outputParts = [];
        for (var i = samePartsLength; i < fromParts.length; i++) {
          outputParts.push('..');
        }
        outputParts = outputParts.concat(toParts.slice(samePartsLength));
        return outputParts.join('/');
      }};var Browser={mainLoop:{scheduler:null,shouldPause:false,paused:false,queue:[],pause:function () {
          Browser.mainLoop.shouldPause = true;
        },resume:function () {
          if (Browser.mainLoop.paused) {
            Browser.mainLoop.paused = false;
            Browser.mainLoop.scheduler();
          }
          Browser.mainLoop.shouldPause = false;
        },updateStatus:function () {
          if (Module['setStatus']) {
            var message = Module['statusMessage'] || 'Please wait...';
            var remaining = Browser.mainLoop.remainingBlockers;
            var expected = Browser.mainLoop.expectedBlockers;
            if (remaining) {
              if (remaining < expected) {
                Module['setStatus'](message + ' (' + (expected - remaining) + '/' + expected + ')');
              } else {
                Module['setStatus'](message);
              }
            } else {
              Module['setStatus']('');
            }
          }
        }},isFullScreen:false,pointerLock:false,moduleContextCreatedCallbacks:[],workers:[],init:function () {
        if (!Module["preloadPlugins"]) Module["preloadPlugins"] = []; // needs to exist even in workers
  
        if (Browser.initted || ENVIRONMENT_IS_WORKER) return;
        Browser.initted = true;
  
        try {
          new Blob();
          Browser.hasBlobConstructor = true;
        } catch(e) {
          Browser.hasBlobConstructor = false;
          console.log("warning: no blob constructor, cannot create blobs with mimetypes");
        }
        Browser.BlobBuilder = typeof MozBlobBuilder != "undefined" ? MozBlobBuilder : (typeof WebKitBlobBuilder != "undefined" ? WebKitBlobBuilder : (!Browser.hasBlobConstructor ? console.log("warning: no BlobBuilder") : null));
        Browser.URLObject = typeof window != "undefined" ? (window.URL ? window.URL : window.webkitURL) : undefined;
        if (!Module.noImageDecoding && typeof Browser.URLObject === 'undefined') {
          console.log("warning: Browser does not support creating object URLs. Built-in browser image decoding will not be available.");
          Module.noImageDecoding = true;
        }
  
        // Support for plugins that can process preloaded files. You can add more of these to
        // your app by creating and appending to Module.preloadPlugins.
        //
        // Each plugin is asked if it can handle a file based on the file's name. If it can,
        // it is given the file's raw data. When it is done, it calls a callback with the file's
        // (possibly modified) data. For example, a plugin might decompress a file, or it
        // might create some side data structure for use later (like an Image element, etc.).
  
        var imagePlugin = {};
        imagePlugin['canHandle'] = function imagePlugin_canHandle(name) {
          return !Module.noImageDecoding && /\.(jpg|jpeg|png|bmp)$/i.test(name);
        };
        imagePlugin['handle'] = function imagePlugin_handle(byteArray, name, onload, onerror) {
          var b = null;
          if (Browser.hasBlobConstructor) {
            try {
              b = new Blob([byteArray], { type: Browser.getMimetype(name) });
              if (b.size !== byteArray.length) { // Safari bug #118630
                // Safari's Blob can only take an ArrayBuffer
                b = new Blob([(new Uint8Array(byteArray)).buffer], { type: Browser.getMimetype(name) });
              }
            } catch(e) {
              Runtime.warnOnce('Blob constructor present but fails: ' + e + '; falling back to blob builder');
            }
          }
          if (!b) {
            var bb = new Browser.BlobBuilder();
            bb.append((new Uint8Array(byteArray)).buffer); // we need to pass a buffer, and must copy the array to get the right data range
            b = bb.getBlob();
          }
          var url = Browser.URLObject.createObjectURL(b);
          assert(typeof url == 'string', 'createObjectURL must return a url as a string');
          var img = new Image();
          img.onload = function img_onload() {
            assert(img.complete, 'Image ' + name + ' could not be decoded');
            var canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            var ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            Module["preloadedImages"][name] = canvas;
            Browser.URLObject.revokeObjectURL(url);
            if (onload) onload(byteArray);
          };
          img.onerror = function img_onerror(event) {
            console.log('Image ' + url + ' could not be decoded');
            if (onerror) onerror();
          };
          img.src = url;
        };
        Module['preloadPlugins'].push(imagePlugin);
  
        var audioPlugin = {};
        audioPlugin['canHandle'] = function audioPlugin_canHandle(name) {
          return !Module.noAudioDecoding && name.substr(-4) in { '.ogg': 1, '.wav': 1, '.mp3': 1 };
        };
        audioPlugin['handle'] = function audioPlugin_handle(byteArray, name, onload, onerror) {
          var done = false;
          function finish(audio) {
            if (done) return;
            done = true;
            Module["preloadedAudios"][name] = audio;
            if (onload) onload(byteArray);
          }
          function fail() {
            if (done) return;
            done = true;
            Module["preloadedAudios"][name] = new Audio(); // empty shim
            if (onerror) onerror();
          }
          if (Browser.hasBlobConstructor) {
            try {
              var b = new Blob([byteArray], { type: Browser.getMimetype(name) });
            } catch(e) {
              return fail();
            }
            var url = Browser.URLObject.createObjectURL(b); // XXX we never revoke this!
            assert(typeof url == 'string', 'createObjectURL must return a url as a string');
            var audio = new Audio();
            audio.addEventListener('canplaythrough', function() { finish(audio) }, false); // use addEventListener due to chromium bug 124926
            audio.onerror = function audio_onerror(event) {
              if (done) return;
              console.log('warning: browser could not fully decode audio ' + name + ', trying slower base64 approach');
              function encode64(data) {
                var BASE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
                var PAD = '=';
                var ret = '';
                var leftchar = 0;
                var leftbits = 0;
                for (var i = 0; i < data.length; i++) {
                  leftchar = (leftchar << 8) | data[i];
                  leftbits += 8;
                  while (leftbits >= 6) {
                    var curr = (leftchar >> (leftbits-6)) & 0x3f;
                    leftbits -= 6;
                    ret += BASE[curr];
                  }
                }
                if (leftbits == 2) {
                  ret += BASE[(leftchar&3) << 4];
                  ret += PAD + PAD;
                } else if (leftbits == 4) {
                  ret += BASE[(leftchar&0xf) << 2];
                  ret += PAD;
                }
                return ret;
              }
              audio.src = 'data:audio/x-' + name.substr(-3) + ';base64,' + encode64(byteArray);
              finish(audio); // we don't wait for confirmation this worked - but it's worth trying
            };
            audio.src = url;
            // workaround for chrome bug 124926 - we do not always get oncanplaythrough or onerror
            Browser.safeSetTimeout(function() {
              finish(audio); // try to use it even though it is not necessarily ready to play
            }, 10000);
          } else {
            return fail();
          }
        };
        Module['preloadPlugins'].push(audioPlugin);
  
        // Canvas event setup
  
        var canvas = Module['canvas'];
        canvas.requestPointerLock = canvas['requestPointerLock'] ||
                                    canvas['mozRequestPointerLock'] ||
                                    canvas['webkitRequestPointerLock'];
        canvas.exitPointerLock = document['exitPointerLock'] ||
                                 document['mozExitPointerLock'] ||
                                 document['webkitExitPointerLock'] ||
                                 function(){}; // no-op if function does not exist
        canvas.exitPointerLock = canvas.exitPointerLock.bind(document);
  
        function pointerLockChange() {
          Browser.pointerLock = document['pointerLockElement'] === canvas ||
                                document['mozPointerLockElement'] === canvas ||
                                document['webkitPointerLockElement'] === canvas;
        }
  
        document.addEventListener('pointerlockchange', pointerLockChange, false);
        document.addEventListener('mozpointerlockchange', pointerLockChange, false);
        document.addEventListener('webkitpointerlockchange', pointerLockChange, false);
  
        if (Module['elementPointerLock']) {
          canvas.addEventListener("click", function(ev) {
            if (!Browser.pointerLock && canvas.requestPointerLock) {
              canvas.requestPointerLock();
              ev.preventDefault();
            }
          }, false);
        }
      },createContext:function (canvas, useWebGL, setInModule, webGLContextAttributes) {
        var ctx;
        try {
          if (useWebGL) {
            var contextAttributes = {
              antialias: false,
              alpha: false
            };
  
            if (webGLContextAttributes) {
              for (var attribute in webGLContextAttributes) {
                contextAttributes[attribute] = webGLContextAttributes[attribute];
              }
            }
  
  
            var errorInfo = '?';
            function onContextCreationError(event) {
              errorInfo = event.statusMessage || errorInfo;
            }
            canvas.addEventListener('webglcontextcreationerror', onContextCreationError, false);
            try {
              ['experimental-webgl', 'webgl'].some(function(webglId) {
                return ctx = canvas.getContext(webglId, contextAttributes);
              });
            } finally {
              canvas.removeEventListener('webglcontextcreationerror', onContextCreationError, false);
            }
          } else {
            ctx = canvas.getContext('2d');
          }
          if (!ctx) throw ':(';
        } catch (e) {
          Module.print('Could not create canvas: ' + [errorInfo, e]);
          return null;
        }
        if (useWebGL) {
          // Set the background of the WebGL canvas to black
          canvas.style.backgroundColor = "black";
  
          // Warn on context loss
          canvas.addEventListener('webglcontextlost', function(event) {
            alert('WebGL context lost. You will need to reload the page.');
          }, false);
        }
        if (setInModule) {
          GLctx = Module.ctx = ctx;
          Module.useWebGL = useWebGL;
          Browser.moduleContextCreatedCallbacks.forEach(function(callback) { callback() });
          Browser.init();
        }
        return ctx;
      },destroyContext:function (canvas, useWebGL, setInModule) {},fullScreenHandlersInstalled:false,lockPointer:undefined,resizeCanvas:undefined,requestFullScreen:function (lockPointer, resizeCanvas) {
        Browser.lockPointer = lockPointer;
        Browser.resizeCanvas = resizeCanvas;
        if (typeof Browser.lockPointer === 'undefined') Browser.lockPointer = true;
        if (typeof Browser.resizeCanvas === 'undefined') Browser.resizeCanvas = false;
  
        var canvas = Module['canvas'];
        function fullScreenChange() {
          Browser.isFullScreen = false;
          if ((document['webkitFullScreenElement'] || document['webkitFullscreenElement'] ||
               document['mozFullScreenElement'] || document['mozFullscreenElement'] ||
               document['fullScreenElement'] || document['fullscreenElement']) === canvas) {
            canvas.cancelFullScreen = document['cancelFullScreen'] ||
                                      document['mozCancelFullScreen'] ||
                                      document['webkitCancelFullScreen'];
            canvas.cancelFullScreen = canvas.cancelFullScreen.bind(document);
            if (Browser.lockPointer) canvas.requestPointerLock();
            Browser.isFullScreen = true;
            if (Browser.resizeCanvas) Browser.setFullScreenCanvasSize();
          } else if (Browser.resizeCanvas){
            Browser.setWindowedCanvasSize();
          }
          if (Module['onFullScreen']) Module['onFullScreen'](Browser.isFullScreen);
        }
  
        if (!Browser.fullScreenHandlersInstalled) {
          Browser.fullScreenHandlersInstalled = true;
          document.addEventListener('fullscreenchange', fullScreenChange, false);
          document.addEventListener('mozfullscreenchange', fullScreenChange, false);
          document.addEventListener('webkitfullscreenchange', fullScreenChange, false);
        }
  
        canvas.requestFullScreen = canvas['requestFullScreen'] ||
                                   canvas['mozRequestFullScreen'] ||
                                   (canvas['webkitRequestFullScreen'] ? function() { canvas['webkitRequestFullScreen'](Element['ALLOW_KEYBOARD_INPUT']) } : null);
        canvas.requestFullScreen();
      },requestAnimationFrame:function requestAnimationFrame(func) {
        if (typeof window === 'undefined') { // Provide fallback to setTimeout if window is undefined (e.g. in Node.js)
          setTimeout(func, 1000/60);
        } else {
          if (!window.requestAnimationFrame) {
            window.requestAnimationFrame = window['requestAnimationFrame'] ||
                                           window['mozRequestAnimationFrame'] ||
                                           window['webkitRequestAnimationFrame'] ||
                                           window['msRequestAnimationFrame'] ||
                                           window['oRequestAnimationFrame'] ||
                                           window['setTimeout'];
          }
          window.requestAnimationFrame(func);
        }
      },safeCallback:function (func) {
        return function() {
          if (!ABORT) return func.apply(null, arguments);
        };
      },safeRequestAnimationFrame:function (func) {
        return Browser.requestAnimationFrame(function() {
          if (!ABORT) func();
        });
      },safeSetTimeout:function (func, timeout) {
        return setTimeout(function() {
          if (!ABORT) func();
        }, timeout);
      },safeSetInterval:function (func, timeout) {
        return setInterval(function() {
          if (!ABORT) func();
        }, timeout);
      },getMimetype:function (name) {
        return {
          'jpg': 'image/jpeg',
          'jpeg': 'image/jpeg',
          'png': 'image/png',
          'bmp': 'image/bmp',
          'ogg': 'audio/ogg',
          'wav': 'audio/wav',
          'mp3': 'audio/mpeg'
        }[name.substr(name.lastIndexOf('.')+1)];
      },getUserMedia:function (func) {
        if(!window.getUserMedia) {
          window.getUserMedia = navigator['getUserMedia'] ||
                                navigator['mozGetUserMedia'];
        }
        window.getUserMedia(func);
      },getMovementX:function (event) {
        return event['movementX'] ||
               event['mozMovementX'] ||
               event['webkitMovementX'] ||
               0;
      },getMovementY:function (event) {
        return event['movementY'] ||
               event['mozMovementY'] ||
               event['webkitMovementY'] ||
               0;
      },mouseX:0,mouseY:0,mouseMovementX:0,mouseMovementY:0,calculateMouseEvent:function (event) { // event should be mousemove, mousedown or mouseup
        if (Browser.pointerLock) {
          // When the pointer is locked, calculate the coordinates
          // based on the movement of the mouse.
          // Workaround for Firefox bug 764498
          if (event.type != 'mousemove' &&
              ('mozMovementX' in event)) {
            Browser.mouseMovementX = Browser.mouseMovementY = 0;
          } else {
            Browser.mouseMovementX = Browser.getMovementX(event);
            Browser.mouseMovementY = Browser.getMovementY(event);
          }
          
          // check if SDL is available
          if (typeof SDL != "undefined") {
          	Browser.mouseX = SDL.mouseX + Browser.mouseMovementX;
          	Browser.mouseY = SDL.mouseY + Browser.mouseMovementY;
          } else {
          	// just add the mouse delta to the current absolut mouse position
          	// FIXME: ideally this should be clamped against the canvas size and zero
          	Browser.mouseX += Browser.mouseMovementX;
          	Browser.mouseY += Browser.mouseMovementY;
          }        
        } else {
          // Otherwise, calculate the movement based on the changes
          // in the coordinates.
          var rect = Module["canvas"].getBoundingClientRect();
          var x, y;
          
          // Neither .scrollX or .pageXOffset are defined in a spec, but
          // we prefer .scrollX because it is currently in a spec draft.
          // (see: http://www.w3.org/TR/2013/WD-cssom-view-20131217/)
          var scrollX = ((typeof window.scrollX !== 'undefined') ? window.scrollX : window.pageXOffset);
          var scrollY = ((typeof window.scrollY !== 'undefined') ? window.scrollY : window.pageYOffset);
          // If this assert lands, it's likely because the browser doesn't support scrollX or pageXOffset
          // and we have no viable fallback.
          assert((typeof scrollX !== 'undefined') && (typeof scrollY !== 'undefined'), 'Unable to retrieve scroll position, mouse positions likely broken.');
          if (event.type == 'touchstart' ||
              event.type == 'touchend' ||
              event.type == 'touchmove') {
            var t = event.touches.item(0);
            if (t) {
              x = t.pageX - (scrollX + rect.left);
              y = t.pageY - (scrollY + rect.top);
            } else {
              return;
            }
          } else {
            x = event.pageX - (scrollX + rect.left);
            y = event.pageY - (scrollY + rect.top);
          }
  
          // the canvas might be CSS-scaled compared to its backbuffer;
          // SDL-using content will want mouse coordinates in terms
          // of backbuffer units.
          var cw = Module["canvas"].width;
          var ch = Module["canvas"].height;
          x = x * (cw / rect.width);
          y = y * (ch / rect.height);
  
          Browser.mouseMovementX = x - Browser.mouseX;
          Browser.mouseMovementY = y - Browser.mouseY;
          Browser.mouseX = x;
          Browser.mouseY = y;
        }
      },xhrLoad:function (url, onload, onerror) {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', url, true);
        xhr.responseType = 'arraybuffer';
        xhr.onload = function xhr_onload() {
          if (xhr.status == 200 || (xhr.status == 0 && xhr.response)) { // file URLs can return 0
            onload(xhr.response);
          } else {
            onerror();
          }
        };
        xhr.onerror = onerror;
        xhr.send(null);
      },asyncLoad:function (url, onload, onerror, noRunDep) {
        Browser.xhrLoad(url, function(arrayBuffer) {
          assert(arrayBuffer, 'Loading data file "' + url + '" failed (no arrayBuffer).');
          onload(new Uint8Array(arrayBuffer));
          if (!noRunDep) removeRunDependency('al ' + url);
        }, function(event) {
          if (onerror) {
            onerror();
          } else {
            throw 'Loading data file "' + url + '" failed.';
          }
        });
        if (!noRunDep) addRunDependency('al ' + url);
      },resizeListeners:[],updateResizeListeners:function () {
        var canvas = Module['canvas'];
        Browser.resizeListeners.forEach(function(listener) {
          listener(canvas.width, canvas.height);
        });
      },setCanvasSize:function (width, height, noUpdates) {
        var canvas = Module['canvas'];
        canvas.width = width;
        canvas.height = height;
        if (!noUpdates) Browser.updateResizeListeners();
      },windowedWidth:0,windowedHeight:0,setFullScreenCanvasSize:function () {
        var canvas = Module['canvas'];
        this.windowedWidth = canvas.width;
        this.windowedHeight = canvas.height;
        canvas.width = screen.width;
        canvas.height = screen.height;
        // check if SDL is available   
        if (typeof SDL != "undefined") {
        	var flags = HEAPU32[((SDL.screen+Runtime.QUANTUM_SIZE*0)>>2)];
        	flags = flags | 0x00800000; // set SDL_FULLSCREEN flag
        	HEAP32[((SDL.screen+Runtime.QUANTUM_SIZE*0)>>2)]=flags
        }
        Browser.updateResizeListeners();
      },setWindowedCanvasSize:function () {
        var canvas = Module['canvas'];
        canvas.width = this.windowedWidth;
        canvas.height = this.windowedHeight;
        // check if SDL is available       
        if (typeof SDL != "undefined") {
        	var flags = HEAPU32[((SDL.screen+Runtime.QUANTUM_SIZE*0)>>2)];
        	flags = flags & ~0x00800000; // clear SDL_FULLSCREEN flag
        	HEAP32[((SDL.screen+Runtime.QUANTUM_SIZE*0)>>2)]=flags
        }
        Browser.updateResizeListeners();
      }};
___errno_state = Runtime.staticAlloc(4); HEAP32[((___errno_state)>>2)]=0;
Module["requestFullScreen"] = function Module_requestFullScreen(lockPointer, resizeCanvas) { Browser.requestFullScreen(lockPointer, resizeCanvas) };
  Module["requestAnimationFrame"] = function Module_requestAnimationFrame(func) { Browser.requestAnimationFrame(func) };
  Module["setCanvasSize"] = function Module_setCanvasSize(width, height, noUpdates) { Browser.setCanvasSize(width, height, noUpdates) };
  Module["pauseMainLoop"] = function Module_pauseMainLoop() { Browser.mainLoop.pause() };
  Module["resumeMainLoop"] = function Module_resumeMainLoop() { Browser.mainLoop.resume() };
  Module["getUserMedia"] = function Module_getUserMedia() { Browser.getUserMedia() }
FS.staticInit();__ATINIT__.unshift({ func: function() { if (!Module["noFSInit"] && !FS.init.initialized) FS.init() } });__ATMAIN__.push({ func: function() { FS.ignorePermissions = false } });__ATEXIT__.push({ func: function() { FS.quit() } });Module["FS_createFolder"] = FS.createFolder;Module["FS_createPath"] = FS.createPath;Module["FS_createDataFile"] = FS.createDataFile;Module["FS_createPreloadedFile"] = FS.createPreloadedFile;Module["FS_createLazyFile"] = FS.createLazyFile;Module["FS_createLink"] = FS.createLink;Module["FS_createDevice"] = FS.createDevice;
__ATINIT__.unshift({ func: function() { TTY.init() } });__ATEXIT__.push({ func: function() { TTY.shutdown() } });TTY.utf8 = new Runtime.UTF8Processor();
if (ENVIRONMENT_IS_NODE) { var fs = require("fs"); NODEFS.staticInit(); }
STACK_BASE = STACKTOP = Runtime.alignMemory(STATICTOP);

staticSealed = true; // seal the static portion of memory

STACK_MAX = STACK_BASE + 5242880;

DYNAMIC_BASE = DYNAMICTOP = Runtime.alignMemory(STACK_MAX);

assert(DYNAMIC_BASE < TOTAL_MEMORY, "TOTAL_MEMORY not big enough for stack");



var FUNCTION_TABLE = [0, 0];

// EMSCRIPTEN_START_FUNCS

function _bitmap_decompress_15($output,$output_width,$output_height,$input_width,$input_height,$input,$size){
 var label=0;
 var sp=STACKTOP; (assert((STACKTOP|0) < (STACK_MAX|0))|0);
 label = 1; 
 while(1)switch(label){
 case 1: 
 var $1;
 var $2;
 var $3;
 var $4;
 var $5;
 var $6;
 var $7;
 var $temp;
 var $rv;
 var $y;
 var $x;
 var $a;
 var $r;
 var $g;
 var $b;
 $1=$output;
 $2=$output_width;
 $3=$output_height;
 $4=$input_width;
 $5=$input_height;
 $6=$input;
 $7=$size;
 var $8=$4;
 var $9=$5;
 var $10=(Math_imul($8,$9)|0);
 var $11=($10<<1);
 var $12=_malloc($11);
 $temp=$12;
 var $13=$temp;
 var $14=$4;
 var $15=$5;
 var $16=$6;
 var $17=$7;
 var $18=_bitmap_decompress2($13,$14,$15,$16,$17);
 $rv=$18;
 $y=0;
 label=2;break;
 case 2: 
 var $20=$y;
 var $21=$3;
 var $22=($20|0)<($21|0);
 if($22){label=3;break;}else{label=9;break;}
 case 3: 
 $x=0;
 label=4;break;
 case 4: 
 var $25=$x;
 var $26=$2;
 var $27=($25|0)<($26|0);
 if($27){label=5;break;}else{label=7;break;}
 case 5: 
 var $29=$y;
 var $30=$4;
 var $31=(Math_imul($29,$30)|0);
 var $32=$x;
 var $33=((($31)+($32))|0);
 var $34=$temp;
 var $35=$34;
 var $36=(($35+($33<<1))|0);
 var $37=HEAP16[(($36)>>1)];
 $a=$37;
 var $38=$a;
 var $39=($38&65535);
 var $40=$39&31744;
 var $41=$40>>10;
 var $42=(($41)&255);
 $r=$42;
 var $43=$a;
 var $44=($43&65535);
 var $45=$44&992;
 var $46=$45>>5;
 var $47=(($46)&255);
 $g=$47;
 var $48=$a;
 var $49=($48&65535);
 var $50=$49&31;
 var $51=(($50)&255);
 $b=$51;
 var $52=$r;
 var $53=($52&255);
 var $54=((($53)*(255))&-1);
 var $55=(((($54|0))/(31))&-1);
 var $56=(($55)&255);
 $r=$56;
 var $57=$g;
 var $58=($57&255);
 var $59=((($58)*(255))&-1);
 var $60=(((($59|0))/(31))&-1);
 var $61=(($60)&255);
 $g=$61;
 var $62=$b;
 var $63=($62&255);
 var $64=((($63)*(255))&-1);
 var $65=(((($64|0))/(31))&-1);
 var $66=(($65)&255);
 $b=$66;
 var $67=$b;
 var $68=($67&255);
 var $69=$68<<16;
 var $70=-16777216|$69;
 var $71=$g;
 var $72=($71&255);
 var $73=$72<<8;
 var $74=$70|$73;
 var $75=$r;
 var $76=($75&255);
 var $77=$74|$76;
 var $78=$y;
 var $79=$2;
 var $80=(Math_imul($78,$79)|0);
 var $81=$x;
 var $82=((($80)+($81))|0);
 var $83=$1;
 var $84=$83;
 var $85=(($84+($82<<2))|0);
 HEAP32[(($85)>>2)]=$77;
 label=6;break;
 case 6: 
 var $87=$x;
 var $88=((($87)+(1))|0);
 $x=$88;
 label=4;break;
 case 7: 
 label=8;break;
 case 8: 
 var $91=$y;
 var $92=((($91)+(1))|0);
 $y=$92;
 label=2;break;
 case 9: 
 var $94=$temp;
 _free($94);
 var $95=$rv;
 STACKTOP=sp;return $95;
  default: assert(0, "bad label: " + label);
 }

}
Module["_bitmap_decompress_15"] = _bitmap_decompress_15;

function _bitmap_decompress2($output,$width,$height,$input,$size){
 var label=0;
 var sp=STACKTOP; (assert((STACKTOP|0) < (STACK_MAX|0))|0);
 label = 1; 
 while(1)switch(label){
 case 1: 
 var $1;
 var $2;
 var $3;
 var $4;
 var $5;
 var $6;
 var $end;
 var $prevline;
 var $line;
 var $opcode;
 var $count;
 var $offset;
 var $isfillormix;
 var $x;
 var $lastopcode;
 var $insertmix;
 var $bicolour;
 var $code;
 var $colour1;
 var $colour2;
 var $mixmask;
 var $mask;
 var $mix;
 var $fom_mask;
 $2=$output;
 $3=$width;
 $4=$height;
 $5=$input;
 $6=$size;
 var $7=$5;
 var $8=$6;
 var $9=(($7+$8)|0);
 $end=$9;
 $prevline=0;
 $line=0;
 var $10=$3;
 $x=$10;
 $lastopcode=-1;
 $insertmix=0;
 $bicolour=0;
 $colour1=0;
 $colour2=0;
 $mask=0;
 $mix=-1;
 $fom_mask=0;
 label=2;break;
 case 2: 
 var $12=$5;
 var $13=$end;
 var $14=($12>>>0)<($13>>>0);
 if($14){label=3;break;}else{label=346;break;}
 case 3: 
 $fom_mask=0;
 var $16=$5;
 var $17=(($16+1)|0);
 $5=$17;
 var $18=HEAP8[($16)];
 $code=$18;
 var $19=$code;
 var $20=($19&255);
 var $21=$20>>4;
 $opcode=$21;
 var $22=$opcode;
 if(($22|0)==12|($22|0)==13|($22|0)==14){ label=4;break;}else if(($22|0)==15){ label=5;break;}else{label=9;break;}
 case 4: 
 var $24=$opcode;
 var $25=((($24)-(6))|0);
 $opcode=$25;
 var $26=$code;
 var $27=($26&255);
 var $28=$27&15;
 $count=$28;
 $offset=16;
 label=10;break;
 case 5: 
 var $30=$code;
 var $31=($30&255);
 var $32=$31&15;
 $opcode=$32;
 var $33=$opcode;
 var $34=($33|0)<9;
 if($34){label=6;break;}else{label=7;break;}
 case 6: 
 var $36=$5;
 var $37=(($36+1)|0);
 $5=$37;
 var $38=HEAP8[($36)];
 var $39=($38&255);
 $count=$39;
 var $40=$5;
 var $41=(($40+1)|0);
 $5=$41;
 var $42=HEAP8[($40)];
 var $43=($42&255);
 var $44=$43<<8;
 var $45=$count;
 var $46=$45|$44;
 $count=$46;
 label=8;break;
 case 7: 
 var $48=$opcode;
 var $49=($48|0)<11;
 var $50=($49?8:1);
 $count=$50;
 label=8;break;
 case 8: 
 $offset=0;
 label=10;break;
 case 9: 
 var $53=$opcode;
 var $54=$53>>1;
 $opcode=$54;
 var $55=$code;
 var $56=($55&255);
 var $57=$56&31;
 $count=$57;
 $offset=32;
 label=10;break;
 case 10: 
 var $59=$offset;
 var $60=($59|0)!=0;
 if($60){label=11;break;}else{label=22;break;}
 case 11: 
 var $62=$opcode;
 var $63=($62|0)==2;
 if($63){var $68=1;label=13;break;}else{label=12;break;}
 case 12: 
 var $65=$opcode;
 var $66=($65|0)==7;
 var $68=$66;label=13;break;
 case 13: 
 var $68;
 var $69=($68&1);
 $isfillormix=$69;
 var $70=$count;
 var $71=($70|0)==0;
 if($71){label=14;break;}else{label=18;break;}
 case 14: 
 var $73=$isfillormix;
 var $74=($73|0)!=0;
 if($74){label=15;break;}else{label=16;break;}
 case 15: 
 var $76=$5;
 var $77=(($76+1)|0);
 $5=$77;
 var $78=HEAP8[($76)];
 var $79=($78&255);
 var $80=((($79)+(1))|0);
 $count=$80;
 label=17;break;
 case 16: 
 var $82=$5;
 var $83=(($82+1)|0);
 $5=$83;
 var $84=HEAP8[($82)];
 var $85=($84&255);
 var $86=$offset;
 var $87=((($85)+($86))|0);
 $count=$87;
 label=17;break;
 case 17: 
 label=21;break;
 case 18: 
 var $90=$isfillormix;
 var $91=($90|0)!=0;
 if($91){label=19;break;}else{label=20;break;}
 case 19: 
 var $93=$count;
 var $94=$93<<3;
 $count=$94;
 label=20;break;
 case 20: 
 label=21;break;
 case 21: 
 label=22;break;
 case 22: 
 var $98=$opcode;
 switch(($98|0)){case 0:{ label=23;break;}case 8:{ label=28;break;}case 3:{ label=29;break;}case 6:case 7:{ label=30;break;}case 9:{ label=31;break;}case 10:{ label=32;break;}default:{label=33;break;}}break;
 case 23: 
 var $100=$lastopcode;
 var $101=$opcode;
 var $102=($100|0)==($101|0);
 if($102){label=24;break;}else{label=27;break;}
 case 24: 
 var $104=$x;
 var $105=$3;
 var $106=($104|0)==($105|0);
 if($106){label=25;break;}else{label=26;break;}
 case 25: 
 var $108=$prevline;
 var $109=($108|0)==0;
 if($109){label=27;break;}else{label=26;break;}
 case 26: 
 $insertmix=1;
 label=27;break;
 case 27: 
 label=33;break;
 case 28: 
 var $113=$5;
 var $114=(($113+1)|0);
 $5=$114;
 var $115=HEAP8[($113)];
 var $116=($115&255);
 $colour1=$116;
 var $117=$5;
 var $118=(($117+1)|0);
 $5=$118;
 var $119=HEAP8[($117)];
 var $120=($119&255);
 var $121=$120<<8;
 var $122=$colour1;
 var $123=($122&65535);
 var $124=$123|$121;
 var $125=(($124)&65535);
 $colour1=$125;
 label=29;break;
 case 29: 
 var $127=$5;
 var $128=(($127+1)|0);
 $5=$128;
 var $129=HEAP8[($127)];
 var $130=($129&255);
 $colour2=$130;
 var $131=$5;
 var $132=(($131+1)|0);
 $5=$132;
 var $133=HEAP8[($131)];
 var $134=($133&255);
 var $135=$134<<8;
 var $136=$colour2;
 var $137=($136&65535);
 var $138=$137|$135;
 var $139=(($138)&65535);
 $colour2=$139;
 label=33;break;
 case 30: 
 var $141=$5;
 var $142=(($141+1)|0);
 $5=$142;
 var $143=HEAP8[($141)];
 var $144=($143&255);
 $mix=$144;
 var $145=$5;
 var $146=(($145+1)|0);
 $5=$146;
 var $147=HEAP8[($145)];
 var $148=($147&255);
 var $149=$148<<8;
 var $150=$mix;
 var $151=($150&65535);
 var $152=$151|$149;
 var $153=(($152)&65535);
 $mix=$153;
 var $154=$opcode;
 var $155=((($154)-(5))|0);
 $opcode=$155;
 label=33;break;
 case 31: 
 $mask=3;
 $opcode=2;
 $fom_mask=3;
 label=33;break;
 case 32: 
 $mask=5;
 $opcode=2;
 $fom_mask=5;
 label=33;break;
 case 33: 
 var $159=$opcode;
 $lastopcode=$159;
 $mixmask=0;
 label=34;break;
 case 34: 
 var $161=$count;
 var $162=($161|0)>0;
 if($162){label=35;break;}else{label=345;break;}
 case 35: 
 var $164=$x;
 var $165=$3;
 var $166=($164|0)>=($165|0);
 if($166){label=36;break;}else{label=39;break;}
 case 36: 
 var $168=$4;
 var $169=($168|0)<=0;
 if($169){label=37;break;}else{label=38;break;}
 case 37: 
 $1=0;
 label=347;break;
 case 38: 
 $x=0;
 var $172=$4;
 var $173=((($172)-(1))|0);
 $4=$173;
 var $174=$line;
 $prevline=$174;
 var $175=$2;
 var $176=$175;
 var $177=$4;
 var $178=$3;
 var $179=(Math_imul($177,$178)|0);
 var $180=(($176+($179<<1))|0);
 $line=$180;
 label=39;break;
 case 39: 
 var $182=$opcode;
 switch(($182|0)){case 3:{ label=261;break;}case 4:{ label=272;break;}case 8:{ label=283;break;}case 13:{ label=321;break;}case 14:{ label=332;break;}case 0:{ label=40;break;}case 1:{ label=69;break;}case 2:{ label=93;break;}default:{label=343;break;}}break;
 case 40: 
 var $184=$insertmix;
 var $185=($184|0)!=0;
 if($185){label=41;break;}else{label=45;break;}
 case 41: 
 var $187=$prevline;
 var $188=($187|0)==0;
 if($188){label=42;break;}else{label=43;break;}
 case 42: 
 var $190=$mix;
 var $191=$x;
 var $192=$line;
 var $193=(($192+($191<<1))|0);
 HEAP16[(($193)>>1)]=$190;
 label=44;break;
 case 43: 
 var $195=$x;
 var $196=$prevline;
 var $197=(($196+($195<<1))|0);
 var $198=HEAP16[(($197)>>1)];
 var $199=($198&65535);
 var $200=$mix;
 var $201=($200&65535);
 var $202=$199^$201;
 var $203=(($202)&65535);
 var $204=$x;
 var $205=$line;
 var $206=(($205+($204<<1))|0);
 HEAP16[(($206)>>1)]=$203;
 label=44;break;
 case 44: 
 $insertmix=0;
 var $208=$count;
 var $209=((($208)-(1))|0);
 $count=$209;
 var $210=$x;
 var $211=((($210)+(1))|0);
 $x=$211;
 label=45;break;
 case 45: 
 var $213=$prevline;
 var $214=($213|0)==0;
 if($214){label=46;break;}else{label=57;break;}
 case 46: 
 label=47;break;
 case 47: 
 var $217=$count;
 var $218=$217&-8;
 var $219=($218|0)!=0;
 if($219){label=48;break;}else{var $226=0;label=49;break;}
 case 48: 
 var $221=$x;
 var $222=((($221)+(8))|0);
 var $223=$3;
 var $224=($222|0)<($223|0);
 var $226=$224;label=49;break;
 case 49: 
 var $226;
 if($226){label=50;break;}else{label=51;break;}
 case 50: 
 var $228=$x;
 var $229=$line;
 var $230=(($229+($228<<1))|0);
 HEAP16[(($230)>>1)]=0;
 var $231=$count;
 var $232=((($231)-(1))|0);
 $count=$232;
 var $233=$x;
 var $234=((($233)+(1))|0);
 $x=$234;
 var $235=$x;
 var $236=$line;
 var $237=(($236+($235<<1))|0);
 HEAP16[(($237)>>1)]=0;
 var $238=$count;
 var $239=((($238)-(1))|0);
 $count=$239;
 var $240=$x;
 var $241=((($240)+(1))|0);
 $x=$241;
 var $242=$x;
 var $243=$line;
 var $244=(($243+($242<<1))|0);
 HEAP16[(($244)>>1)]=0;
 var $245=$count;
 var $246=((($245)-(1))|0);
 $count=$246;
 var $247=$x;
 var $248=((($247)+(1))|0);
 $x=$248;
 var $249=$x;
 var $250=$line;
 var $251=(($250+($249<<1))|0);
 HEAP16[(($251)>>1)]=0;
 var $252=$count;
 var $253=((($252)-(1))|0);
 $count=$253;
 var $254=$x;
 var $255=((($254)+(1))|0);
 $x=$255;
 var $256=$x;
 var $257=$line;
 var $258=(($257+($256<<1))|0);
 HEAP16[(($258)>>1)]=0;
 var $259=$count;
 var $260=((($259)-(1))|0);
 $count=$260;
 var $261=$x;
 var $262=((($261)+(1))|0);
 $x=$262;
 var $263=$x;
 var $264=$line;
 var $265=(($264+($263<<1))|0);
 HEAP16[(($265)>>1)]=0;
 var $266=$count;
 var $267=((($266)-(1))|0);
 $count=$267;
 var $268=$x;
 var $269=((($268)+(1))|0);
 $x=$269;
 var $270=$x;
 var $271=$line;
 var $272=(($271+($270<<1))|0);
 HEAP16[(($272)>>1)]=0;
 var $273=$count;
 var $274=((($273)-(1))|0);
 $count=$274;
 var $275=$x;
 var $276=((($275)+(1))|0);
 $x=$276;
 var $277=$x;
 var $278=$line;
 var $279=(($278+($277<<1))|0);
 HEAP16[(($279)>>1)]=0;
 var $280=$count;
 var $281=((($280)-(1))|0);
 $count=$281;
 var $282=$x;
 var $283=((($282)+(1))|0);
 $x=$283;
 label=47;break;
 case 51: 
 label=52;break;
 case 52: 
 var $286=$count;
 var $287=($286|0)>0;
 if($287){label=53;break;}else{var $293=0;label=54;break;}
 case 53: 
 var $289=$x;
 var $290=$3;
 var $291=($289|0)<($290|0);
 var $293=$291;label=54;break;
 case 54: 
 var $293;
 if($293){label=55;break;}else{label=56;break;}
 case 55: 
 var $295=$x;
 var $296=$line;
 var $297=(($296+($295<<1))|0);
 HEAP16[(($297)>>1)]=0;
 var $298=$count;
 var $299=((($298)-(1))|0);
 $count=$299;
 var $300=$x;
 var $301=((($300)+(1))|0);
 $x=$301;
 label=52;break;
 case 56: 
 label=68;break;
 case 57: 
 label=58;break;
 case 58: 
 var $305=$count;
 var $306=$305&-8;
 var $307=($306|0)!=0;
 if($307){label=59;break;}else{var $314=0;label=60;break;}
 case 59: 
 var $309=$x;
 var $310=((($309)+(8))|0);
 var $311=$3;
 var $312=($310|0)<($311|0);
 var $314=$312;label=60;break;
 case 60: 
 var $314;
 if($314){label=61;break;}else{label=62;break;}
 case 61: 
 var $316=$x;
 var $317=$prevline;
 var $318=(($317+($316<<1))|0);
 var $319=HEAP16[(($318)>>1)];
 var $320=$x;
 var $321=$line;
 var $322=(($321+($320<<1))|0);
 HEAP16[(($322)>>1)]=$319;
 var $323=$count;
 var $324=((($323)-(1))|0);
 $count=$324;
 var $325=$x;
 var $326=((($325)+(1))|0);
 $x=$326;
 var $327=$x;
 var $328=$prevline;
 var $329=(($328+($327<<1))|0);
 var $330=HEAP16[(($329)>>1)];
 var $331=$x;
 var $332=$line;
 var $333=(($332+($331<<1))|0);
 HEAP16[(($333)>>1)]=$330;
 var $334=$count;
 var $335=((($334)-(1))|0);
 $count=$335;
 var $336=$x;
 var $337=((($336)+(1))|0);
 $x=$337;
 var $338=$x;
 var $339=$prevline;
 var $340=(($339+($338<<1))|0);
 var $341=HEAP16[(($340)>>1)];
 var $342=$x;
 var $343=$line;
 var $344=(($343+($342<<1))|0);
 HEAP16[(($344)>>1)]=$341;
 var $345=$count;
 var $346=((($345)-(1))|0);
 $count=$346;
 var $347=$x;
 var $348=((($347)+(1))|0);
 $x=$348;
 var $349=$x;
 var $350=$prevline;
 var $351=(($350+($349<<1))|0);
 var $352=HEAP16[(($351)>>1)];
 var $353=$x;
 var $354=$line;
 var $355=(($354+($353<<1))|0);
 HEAP16[(($355)>>1)]=$352;
 var $356=$count;
 var $357=((($356)-(1))|0);
 $count=$357;
 var $358=$x;
 var $359=((($358)+(1))|0);
 $x=$359;
 var $360=$x;
 var $361=$prevline;
 var $362=(($361+($360<<1))|0);
 var $363=HEAP16[(($362)>>1)];
 var $364=$x;
 var $365=$line;
 var $366=(($365+($364<<1))|0);
 HEAP16[(($366)>>1)]=$363;
 var $367=$count;
 var $368=((($367)-(1))|0);
 $count=$368;
 var $369=$x;
 var $370=((($369)+(1))|0);
 $x=$370;
 var $371=$x;
 var $372=$prevline;
 var $373=(($372+($371<<1))|0);
 var $374=HEAP16[(($373)>>1)];
 var $375=$x;
 var $376=$line;
 var $377=(($376+($375<<1))|0);
 HEAP16[(($377)>>1)]=$374;
 var $378=$count;
 var $379=((($378)-(1))|0);
 $count=$379;
 var $380=$x;
 var $381=((($380)+(1))|0);
 $x=$381;
 var $382=$x;
 var $383=$prevline;
 var $384=(($383+($382<<1))|0);
 var $385=HEAP16[(($384)>>1)];
 var $386=$x;
 var $387=$line;
 var $388=(($387+($386<<1))|0);
 HEAP16[(($388)>>1)]=$385;
 var $389=$count;
 var $390=((($389)-(1))|0);
 $count=$390;
 var $391=$x;
 var $392=((($391)+(1))|0);
 $x=$392;
 var $393=$x;
 var $394=$prevline;
 var $395=(($394+($393<<1))|0);
 var $396=HEAP16[(($395)>>1)];
 var $397=$x;
 var $398=$line;
 var $399=(($398+($397<<1))|0);
 HEAP16[(($399)>>1)]=$396;
 var $400=$count;
 var $401=((($400)-(1))|0);
 $count=$401;
 var $402=$x;
 var $403=((($402)+(1))|0);
 $x=$403;
 label=58;break;
 case 62: 
 label=63;break;
 case 63: 
 var $406=$count;
 var $407=($406|0)>0;
 if($407){label=64;break;}else{var $413=0;label=65;break;}
 case 64: 
 var $409=$x;
 var $410=$3;
 var $411=($409|0)<($410|0);
 var $413=$411;label=65;break;
 case 65: 
 var $413;
 if($413){label=66;break;}else{label=67;break;}
 case 66: 
 var $415=$x;
 var $416=$prevline;
 var $417=(($416+($415<<1))|0);
 var $418=HEAP16[(($417)>>1)];
 var $419=$x;
 var $420=$line;
 var $421=(($420+($419<<1))|0);
 HEAP16[(($421)>>1)]=$418;
 var $422=$count;
 var $423=((($422)-(1))|0);
 $count=$423;
 var $424=$x;
 var $425=((($424)+(1))|0);
 $x=$425;
 label=63;break;
 case 67: 
 label=68;break;
 case 68: 
 label=344;break;
 case 69: 
 var $429=$prevline;
 var $430=($429|0)==0;
 if($430){label=70;break;}else{label=81;break;}
 case 70: 
 label=71;break;
 case 71: 
 var $433=$count;
 var $434=$433&-8;
 var $435=($434|0)!=0;
 if($435){label=72;break;}else{var $442=0;label=73;break;}
 case 72: 
 var $437=$x;
 var $438=((($437)+(8))|0);
 var $439=$3;
 var $440=($438|0)<($439|0);
 var $442=$440;label=73;break;
 case 73: 
 var $442;
 if($442){label=74;break;}else{label=75;break;}
 case 74: 
 var $444=$mix;
 var $445=$x;
 var $446=$line;
 var $447=(($446+($445<<1))|0);
 HEAP16[(($447)>>1)]=$444;
 var $448=$count;
 var $449=((($448)-(1))|0);
 $count=$449;
 var $450=$x;
 var $451=((($450)+(1))|0);
 $x=$451;
 var $452=$mix;
 var $453=$x;
 var $454=$line;
 var $455=(($454+($453<<1))|0);
 HEAP16[(($455)>>1)]=$452;
 var $456=$count;
 var $457=((($456)-(1))|0);
 $count=$457;
 var $458=$x;
 var $459=((($458)+(1))|0);
 $x=$459;
 var $460=$mix;
 var $461=$x;
 var $462=$line;
 var $463=(($462+($461<<1))|0);
 HEAP16[(($463)>>1)]=$460;
 var $464=$count;
 var $465=((($464)-(1))|0);
 $count=$465;
 var $466=$x;
 var $467=((($466)+(1))|0);
 $x=$467;
 var $468=$mix;
 var $469=$x;
 var $470=$line;
 var $471=(($470+($469<<1))|0);
 HEAP16[(($471)>>1)]=$468;
 var $472=$count;
 var $473=((($472)-(1))|0);
 $count=$473;
 var $474=$x;
 var $475=((($474)+(1))|0);
 $x=$475;
 var $476=$mix;
 var $477=$x;
 var $478=$line;
 var $479=(($478+($477<<1))|0);
 HEAP16[(($479)>>1)]=$476;
 var $480=$count;
 var $481=((($480)-(1))|0);
 $count=$481;
 var $482=$x;
 var $483=((($482)+(1))|0);
 $x=$483;
 var $484=$mix;
 var $485=$x;
 var $486=$line;
 var $487=(($486+($485<<1))|0);
 HEAP16[(($487)>>1)]=$484;
 var $488=$count;
 var $489=((($488)-(1))|0);
 $count=$489;
 var $490=$x;
 var $491=((($490)+(1))|0);
 $x=$491;
 var $492=$mix;
 var $493=$x;
 var $494=$line;
 var $495=(($494+($493<<1))|0);
 HEAP16[(($495)>>1)]=$492;
 var $496=$count;
 var $497=((($496)-(1))|0);
 $count=$497;
 var $498=$x;
 var $499=((($498)+(1))|0);
 $x=$499;
 var $500=$mix;
 var $501=$x;
 var $502=$line;
 var $503=(($502+($501<<1))|0);
 HEAP16[(($503)>>1)]=$500;
 var $504=$count;
 var $505=((($504)-(1))|0);
 $count=$505;
 var $506=$x;
 var $507=((($506)+(1))|0);
 $x=$507;
 label=71;break;
 case 75: 
 label=76;break;
 case 76: 
 var $510=$count;
 var $511=($510|0)>0;
 if($511){label=77;break;}else{var $517=0;label=78;break;}
 case 77: 
 var $513=$x;
 var $514=$3;
 var $515=($513|0)<($514|0);
 var $517=$515;label=78;break;
 case 78: 
 var $517;
 if($517){label=79;break;}else{label=80;break;}
 case 79: 
 var $519=$mix;
 var $520=$x;
 var $521=$line;
 var $522=(($521+($520<<1))|0);
 HEAP16[(($522)>>1)]=$519;
 var $523=$count;
 var $524=((($523)-(1))|0);
 $count=$524;
 var $525=$x;
 var $526=((($525)+(1))|0);
 $x=$526;
 label=76;break;
 case 80: 
 label=92;break;
 case 81: 
 label=82;break;
 case 82: 
 var $530=$count;
 var $531=$530&-8;
 var $532=($531|0)!=0;
 if($532){label=83;break;}else{var $539=0;label=84;break;}
 case 83: 
 var $534=$x;
 var $535=((($534)+(8))|0);
 var $536=$3;
 var $537=($535|0)<($536|0);
 var $539=$537;label=84;break;
 case 84: 
 var $539;
 if($539){label=85;break;}else{label=86;break;}
 case 85: 
 var $541=$x;
 var $542=$prevline;
 var $543=(($542+($541<<1))|0);
 var $544=HEAP16[(($543)>>1)];
 var $545=($544&65535);
 var $546=$mix;
 var $547=($546&65535);
 var $548=$545^$547;
 var $549=(($548)&65535);
 var $550=$x;
 var $551=$line;
 var $552=(($551+($550<<1))|0);
 HEAP16[(($552)>>1)]=$549;
 var $553=$count;
 var $554=((($553)-(1))|0);
 $count=$554;
 var $555=$x;
 var $556=((($555)+(1))|0);
 $x=$556;
 var $557=$x;
 var $558=$prevline;
 var $559=(($558+($557<<1))|0);
 var $560=HEAP16[(($559)>>1)];
 var $561=($560&65535);
 var $562=$mix;
 var $563=($562&65535);
 var $564=$561^$563;
 var $565=(($564)&65535);
 var $566=$x;
 var $567=$line;
 var $568=(($567+($566<<1))|0);
 HEAP16[(($568)>>1)]=$565;
 var $569=$count;
 var $570=((($569)-(1))|0);
 $count=$570;
 var $571=$x;
 var $572=((($571)+(1))|0);
 $x=$572;
 var $573=$x;
 var $574=$prevline;
 var $575=(($574+($573<<1))|0);
 var $576=HEAP16[(($575)>>1)];
 var $577=($576&65535);
 var $578=$mix;
 var $579=($578&65535);
 var $580=$577^$579;
 var $581=(($580)&65535);
 var $582=$x;
 var $583=$line;
 var $584=(($583+($582<<1))|0);
 HEAP16[(($584)>>1)]=$581;
 var $585=$count;
 var $586=((($585)-(1))|0);
 $count=$586;
 var $587=$x;
 var $588=((($587)+(1))|0);
 $x=$588;
 var $589=$x;
 var $590=$prevline;
 var $591=(($590+($589<<1))|0);
 var $592=HEAP16[(($591)>>1)];
 var $593=($592&65535);
 var $594=$mix;
 var $595=($594&65535);
 var $596=$593^$595;
 var $597=(($596)&65535);
 var $598=$x;
 var $599=$line;
 var $600=(($599+($598<<1))|0);
 HEAP16[(($600)>>1)]=$597;
 var $601=$count;
 var $602=((($601)-(1))|0);
 $count=$602;
 var $603=$x;
 var $604=((($603)+(1))|0);
 $x=$604;
 var $605=$x;
 var $606=$prevline;
 var $607=(($606+($605<<1))|0);
 var $608=HEAP16[(($607)>>1)];
 var $609=($608&65535);
 var $610=$mix;
 var $611=($610&65535);
 var $612=$609^$611;
 var $613=(($612)&65535);
 var $614=$x;
 var $615=$line;
 var $616=(($615+($614<<1))|0);
 HEAP16[(($616)>>1)]=$613;
 var $617=$count;
 var $618=((($617)-(1))|0);
 $count=$618;
 var $619=$x;
 var $620=((($619)+(1))|0);
 $x=$620;
 var $621=$x;
 var $622=$prevline;
 var $623=(($622+($621<<1))|0);
 var $624=HEAP16[(($623)>>1)];
 var $625=($624&65535);
 var $626=$mix;
 var $627=($626&65535);
 var $628=$625^$627;
 var $629=(($628)&65535);
 var $630=$x;
 var $631=$line;
 var $632=(($631+($630<<1))|0);
 HEAP16[(($632)>>1)]=$629;
 var $633=$count;
 var $634=((($633)-(1))|0);
 $count=$634;
 var $635=$x;
 var $636=((($635)+(1))|0);
 $x=$636;
 var $637=$x;
 var $638=$prevline;
 var $639=(($638+($637<<1))|0);
 var $640=HEAP16[(($639)>>1)];
 var $641=($640&65535);
 var $642=$mix;
 var $643=($642&65535);
 var $644=$641^$643;
 var $645=(($644)&65535);
 var $646=$x;
 var $647=$line;
 var $648=(($647+($646<<1))|0);
 HEAP16[(($648)>>1)]=$645;
 var $649=$count;
 var $650=((($649)-(1))|0);
 $count=$650;
 var $651=$x;
 var $652=((($651)+(1))|0);
 $x=$652;
 var $653=$x;
 var $654=$prevline;
 var $655=(($654+($653<<1))|0);
 var $656=HEAP16[(($655)>>1)];
 var $657=($656&65535);
 var $658=$mix;
 var $659=($658&65535);
 var $660=$657^$659;
 var $661=(($660)&65535);
 var $662=$x;
 var $663=$line;
 var $664=(($663+($662<<1))|0);
 HEAP16[(($664)>>1)]=$661;
 var $665=$count;
 var $666=((($665)-(1))|0);
 $count=$666;
 var $667=$x;
 var $668=((($667)+(1))|0);
 $x=$668;
 label=82;break;
 case 86: 
 label=87;break;
 case 87: 
 var $671=$count;
 var $672=($671|0)>0;
 if($672){label=88;break;}else{var $678=0;label=89;break;}
 case 88: 
 var $674=$x;
 var $675=$3;
 var $676=($674|0)<($675|0);
 var $678=$676;label=89;break;
 case 89: 
 var $678;
 if($678){label=90;break;}else{label=91;break;}
 case 90: 
 var $680=$x;
 var $681=$prevline;
 var $682=(($681+($680<<1))|0);
 var $683=HEAP16[(($682)>>1)];
 var $684=($683&65535);
 var $685=$mix;
 var $686=($685&65535);
 var $687=$684^$686;
 var $688=(($687)&65535);
 var $689=$x;
 var $690=$line;
 var $691=(($690+($689<<1))|0);
 HEAP16[(($691)>>1)]=$688;
 var $692=$count;
 var $693=((($692)-(1))|0);
 $count=$693;
 var $694=$x;
 var $695=((($694)+(1))|0);
 $x=$695;
 label=87;break;
 case 91: 
 label=92;break;
 case 92: 
 label=344;break;
 case 93: 
 var $699=$prevline;
 var $700=($699|0)==0;
 if($700){label=94;break;}else{label=177;break;}
 case 94: 
 label=95;break;
 case 95: 
 var $703=$count;
 var $704=$703&-8;
 var $705=($704|0)!=0;
 if($705){label=96;break;}else{var $712=0;label=97;break;}
 case 96: 
 var $707=$x;
 var $708=((($707)+(8))|0);
 var $709=$3;
 var $710=($708|0)<($709|0);
 var $712=$710;label=97;break;
 case 97: 
 var $712;
 if($712){label=98;break;}else{label=163;break;}
 case 98: 
 var $714=$mixmask;
 var $715=($714&255);
 var $716=$715<<1;
 var $717=(($716)&255);
 $mixmask=$717;
 var $718=$mixmask;
 var $719=($718&255);
 var $720=($719|0)==0;
 if($720){label=99;break;}else{label=103;break;}
 case 99: 
 var $722=$fom_mask;
 var $723=($722|0)!=0;
 if($723){label=100;break;}else{label=101;break;}
 case 100: 
 var $725=$fom_mask;
 var $732=$725;label=102;break;
 case 101: 
 var $727=$5;
 var $728=(($727+1)|0);
 $5=$728;
 var $729=HEAP8[($727)];
 var $730=($729&255);
 var $732=$730;label=102;break;
 case 102: 
 var $732;
 var $733=(($732)&255);
 $mask=$733;
 $mixmask=1;
 label=103;break;
 case 103: 
 var $735=$mask;
 var $736=($735&255);
 var $737=$mixmask;
 var $738=($737&255);
 var $739=$736&$738;
 var $740=($739|0)!=0;
 if($740){label=104;break;}else{label=105;break;}
 case 104: 
 var $742=$mix;
 var $743=$x;
 var $744=$line;
 var $745=(($744+($743<<1))|0);
 HEAP16[(($745)>>1)]=$742;
 label=106;break;
 case 105: 
 var $747=$x;
 var $748=$line;
 var $749=(($748+($747<<1))|0);
 HEAP16[(($749)>>1)]=0;
 label=106;break;
 case 106: 
 var $751=$count;
 var $752=((($751)-(1))|0);
 $count=$752;
 var $753=$x;
 var $754=((($753)+(1))|0);
 $x=$754;
 var $755=$mixmask;
 var $756=($755&255);
 var $757=$756<<1;
 var $758=(($757)&255);
 $mixmask=$758;
 var $759=$mixmask;
 var $760=($759&255);
 var $761=($760|0)==0;
 if($761){label=107;break;}else{label=111;break;}
 case 107: 
 var $763=$fom_mask;
 var $764=($763|0)!=0;
 if($764){label=108;break;}else{label=109;break;}
 case 108: 
 var $766=$fom_mask;
 var $773=$766;label=110;break;
 case 109: 
 var $768=$5;
 var $769=(($768+1)|0);
 $5=$769;
 var $770=HEAP8[($768)];
 var $771=($770&255);
 var $773=$771;label=110;break;
 case 110: 
 var $773;
 var $774=(($773)&255);
 $mask=$774;
 $mixmask=1;
 label=111;break;
 case 111: 
 var $776=$mask;
 var $777=($776&255);
 var $778=$mixmask;
 var $779=($778&255);
 var $780=$777&$779;
 var $781=($780|0)!=0;
 if($781){label=112;break;}else{label=113;break;}
 case 112: 
 var $783=$mix;
 var $784=$x;
 var $785=$line;
 var $786=(($785+($784<<1))|0);
 HEAP16[(($786)>>1)]=$783;
 label=114;break;
 case 113: 
 var $788=$x;
 var $789=$line;
 var $790=(($789+($788<<1))|0);
 HEAP16[(($790)>>1)]=0;
 label=114;break;
 case 114: 
 var $792=$count;
 var $793=((($792)-(1))|0);
 $count=$793;
 var $794=$x;
 var $795=((($794)+(1))|0);
 $x=$795;
 var $796=$mixmask;
 var $797=($796&255);
 var $798=$797<<1;
 var $799=(($798)&255);
 $mixmask=$799;
 var $800=$mixmask;
 var $801=($800&255);
 var $802=($801|0)==0;
 if($802){label=115;break;}else{label=119;break;}
 case 115: 
 var $804=$fom_mask;
 var $805=($804|0)!=0;
 if($805){label=116;break;}else{label=117;break;}
 case 116: 
 var $807=$fom_mask;
 var $814=$807;label=118;break;
 case 117: 
 var $809=$5;
 var $810=(($809+1)|0);
 $5=$810;
 var $811=HEAP8[($809)];
 var $812=($811&255);
 var $814=$812;label=118;break;
 case 118: 
 var $814;
 var $815=(($814)&255);
 $mask=$815;
 $mixmask=1;
 label=119;break;
 case 119: 
 var $817=$mask;
 var $818=($817&255);
 var $819=$mixmask;
 var $820=($819&255);
 var $821=$818&$820;
 var $822=($821|0)!=0;
 if($822){label=120;break;}else{label=121;break;}
 case 120: 
 var $824=$mix;
 var $825=$x;
 var $826=$line;
 var $827=(($826+($825<<1))|0);
 HEAP16[(($827)>>1)]=$824;
 label=122;break;
 case 121: 
 var $829=$x;
 var $830=$line;
 var $831=(($830+($829<<1))|0);
 HEAP16[(($831)>>1)]=0;
 label=122;break;
 case 122: 
 var $833=$count;
 var $834=((($833)-(1))|0);
 $count=$834;
 var $835=$x;
 var $836=((($835)+(1))|0);
 $x=$836;
 var $837=$mixmask;
 var $838=($837&255);
 var $839=$838<<1;
 var $840=(($839)&255);
 $mixmask=$840;
 var $841=$mixmask;
 var $842=($841&255);
 var $843=($842|0)==0;
 if($843){label=123;break;}else{label=127;break;}
 case 123: 
 var $845=$fom_mask;
 var $846=($845|0)!=0;
 if($846){label=124;break;}else{label=125;break;}
 case 124: 
 var $848=$fom_mask;
 var $855=$848;label=126;break;
 case 125: 
 var $850=$5;
 var $851=(($850+1)|0);
 $5=$851;
 var $852=HEAP8[($850)];
 var $853=($852&255);
 var $855=$853;label=126;break;
 case 126: 
 var $855;
 var $856=(($855)&255);
 $mask=$856;
 $mixmask=1;
 label=127;break;
 case 127: 
 var $858=$mask;
 var $859=($858&255);
 var $860=$mixmask;
 var $861=($860&255);
 var $862=$859&$861;
 var $863=($862|0)!=0;
 if($863){label=128;break;}else{label=129;break;}
 case 128: 
 var $865=$mix;
 var $866=$x;
 var $867=$line;
 var $868=(($867+($866<<1))|0);
 HEAP16[(($868)>>1)]=$865;
 label=130;break;
 case 129: 
 var $870=$x;
 var $871=$line;
 var $872=(($871+($870<<1))|0);
 HEAP16[(($872)>>1)]=0;
 label=130;break;
 case 130: 
 var $874=$count;
 var $875=((($874)-(1))|0);
 $count=$875;
 var $876=$x;
 var $877=((($876)+(1))|0);
 $x=$877;
 var $878=$mixmask;
 var $879=($878&255);
 var $880=$879<<1;
 var $881=(($880)&255);
 $mixmask=$881;
 var $882=$mixmask;
 var $883=($882&255);
 var $884=($883|0)==0;
 if($884){label=131;break;}else{label=135;break;}
 case 131: 
 var $886=$fom_mask;
 var $887=($886|0)!=0;
 if($887){label=132;break;}else{label=133;break;}
 case 132: 
 var $889=$fom_mask;
 var $896=$889;label=134;break;
 case 133: 
 var $891=$5;
 var $892=(($891+1)|0);
 $5=$892;
 var $893=HEAP8[($891)];
 var $894=($893&255);
 var $896=$894;label=134;break;
 case 134: 
 var $896;
 var $897=(($896)&255);
 $mask=$897;
 $mixmask=1;
 label=135;break;
 case 135: 
 var $899=$mask;
 var $900=($899&255);
 var $901=$mixmask;
 var $902=($901&255);
 var $903=$900&$902;
 var $904=($903|0)!=0;
 if($904){label=136;break;}else{label=137;break;}
 case 136: 
 var $906=$mix;
 var $907=$x;
 var $908=$line;
 var $909=(($908+($907<<1))|0);
 HEAP16[(($909)>>1)]=$906;
 label=138;break;
 case 137: 
 var $911=$x;
 var $912=$line;
 var $913=(($912+($911<<1))|0);
 HEAP16[(($913)>>1)]=0;
 label=138;break;
 case 138: 
 var $915=$count;
 var $916=((($915)-(1))|0);
 $count=$916;
 var $917=$x;
 var $918=((($917)+(1))|0);
 $x=$918;
 var $919=$mixmask;
 var $920=($919&255);
 var $921=$920<<1;
 var $922=(($921)&255);
 $mixmask=$922;
 var $923=$mixmask;
 var $924=($923&255);
 var $925=($924|0)==0;
 if($925){label=139;break;}else{label=143;break;}
 case 139: 
 var $927=$fom_mask;
 var $928=($927|0)!=0;
 if($928){label=140;break;}else{label=141;break;}
 case 140: 
 var $930=$fom_mask;
 var $937=$930;label=142;break;
 case 141: 
 var $932=$5;
 var $933=(($932+1)|0);
 $5=$933;
 var $934=HEAP8[($932)];
 var $935=($934&255);
 var $937=$935;label=142;break;
 case 142: 
 var $937;
 var $938=(($937)&255);
 $mask=$938;
 $mixmask=1;
 label=143;break;
 case 143: 
 var $940=$mask;
 var $941=($940&255);
 var $942=$mixmask;
 var $943=($942&255);
 var $944=$941&$943;
 var $945=($944|0)!=0;
 if($945){label=144;break;}else{label=145;break;}
 case 144: 
 var $947=$mix;
 var $948=$x;
 var $949=$line;
 var $950=(($949+($948<<1))|0);
 HEAP16[(($950)>>1)]=$947;
 label=146;break;
 case 145: 
 var $952=$x;
 var $953=$line;
 var $954=(($953+($952<<1))|0);
 HEAP16[(($954)>>1)]=0;
 label=146;break;
 case 146: 
 var $956=$count;
 var $957=((($956)-(1))|0);
 $count=$957;
 var $958=$x;
 var $959=((($958)+(1))|0);
 $x=$959;
 var $960=$mixmask;
 var $961=($960&255);
 var $962=$961<<1;
 var $963=(($962)&255);
 $mixmask=$963;
 var $964=$mixmask;
 var $965=($964&255);
 var $966=($965|0)==0;
 if($966){label=147;break;}else{label=151;break;}
 case 147: 
 var $968=$fom_mask;
 var $969=($968|0)!=0;
 if($969){label=148;break;}else{label=149;break;}
 case 148: 
 var $971=$fom_mask;
 var $978=$971;label=150;break;
 case 149: 
 var $973=$5;
 var $974=(($973+1)|0);
 $5=$974;
 var $975=HEAP8[($973)];
 var $976=($975&255);
 var $978=$976;label=150;break;
 case 150: 
 var $978;
 var $979=(($978)&255);
 $mask=$979;
 $mixmask=1;
 label=151;break;
 case 151: 
 var $981=$mask;
 var $982=($981&255);
 var $983=$mixmask;
 var $984=($983&255);
 var $985=$982&$984;
 var $986=($985|0)!=0;
 if($986){label=152;break;}else{label=153;break;}
 case 152: 
 var $988=$mix;
 var $989=$x;
 var $990=$line;
 var $991=(($990+($989<<1))|0);
 HEAP16[(($991)>>1)]=$988;
 label=154;break;
 case 153: 
 var $993=$x;
 var $994=$line;
 var $995=(($994+($993<<1))|0);
 HEAP16[(($995)>>1)]=0;
 label=154;break;
 case 154: 
 var $997=$count;
 var $998=((($997)-(1))|0);
 $count=$998;
 var $999=$x;
 var $1000=((($999)+(1))|0);
 $x=$1000;
 var $1001=$mixmask;
 var $1002=($1001&255);
 var $1003=$1002<<1;
 var $1004=(($1003)&255);
 $mixmask=$1004;
 var $1005=$mixmask;
 var $1006=($1005&255);
 var $1007=($1006|0)==0;
 if($1007){label=155;break;}else{label=159;break;}
 case 155: 
 var $1009=$fom_mask;
 var $1010=($1009|0)!=0;
 if($1010){label=156;break;}else{label=157;break;}
 case 156: 
 var $1012=$fom_mask;
 var $1019=$1012;label=158;break;
 case 157: 
 var $1014=$5;
 var $1015=(($1014+1)|0);
 $5=$1015;
 var $1016=HEAP8[($1014)];
 var $1017=($1016&255);
 var $1019=$1017;label=158;break;
 case 158: 
 var $1019;
 var $1020=(($1019)&255);
 $mask=$1020;
 $mixmask=1;
 label=159;break;
 case 159: 
 var $1022=$mask;
 var $1023=($1022&255);
 var $1024=$mixmask;
 var $1025=($1024&255);
 var $1026=$1023&$1025;
 var $1027=($1026|0)!=0;
 if($1027){label=160;break;}else{label=161;break;}
 case 160: 
 var $1029=$mix;
 var $1030=$x;
 var $1031=$line;
 var $1032=(($1031+($1030<<1))|0);
 HEAP16[(($1032)>>1)]=$1029;
 label=162;break;
 case 161: 
 var $1034=$x;
 var $1035=$line;
 var $1036=(($1035+($1034<<1))|0);
 HEAP16[(($1036)>>1)]=0;
 label=162;break;
 case 162: 
 var $1038=$count;
 var $1039=((($1038)-(1))|0);
 $count=$1039;
 var $1040=$x;
 var $1041=((($1040)+(1))|0);
 $x=$1041;
 label=95;break;
 case 163: 
 label=164;break;
 case 164: 
 var $1044=$count;
 var $1045=($1044|0)>0;
 if($1045){label=165;break;}else{var $1051=0;label=166;break;}
 case 165: 
 var $1047=$x;
 var $1048=$3;
 var $1049=($1047|0)<($1048|0);
 var $1051=$1049;label=166;break;
 case 166: 
 var $1051;
 if($1051){label=167;break;}else{label=176;break;}
 case 167: 
 var $1053=$mixmask;
 var $1054=($1053&255);
 var $1055=$1054<<1;
 var $1056=(($1055)&255);
 $mixmask=$1056;
 var $1057=$mixmask;
 var $1058=($1057&255);
 var $1059=($1058|0)==0;
 if($1059){label=168;break;}else{label=172;break;}
 case 168: 
 var $1061=$fom_mask;
 var $1062=($1061|0)!=0;
 if($1062){label=169;break;}else{label=170;break;}
 case 169: 
 var $1064=$fom_mask;
 var $1071=$1064;label=171;break;
 case 170: 
 var $1066=$5;
 var $1067=(($1066+1)|0);
 $5=$1067;
 var $1068=HEAP8[($1066)];
 var $1069=($1068&255);
 var $1071=$1069;label=171;break;
 case 171: 
 var $1071;
 var $1072=(($1071)&255);
 $mask=$1072;
 $mixmask=1;
 label=172;break;
 case 172: 
 var $1074=$mask;
 var $1075=($1074&255);
 var $1076=$mixmask;
 var $1077=($1076&255);
 var $1078=$1075&$1077;
 var $1079=($1078|0)!=0;
 if($1079){label=173;break;}else{label=174;break;}
 case 173: 
 var $1081=$mix;
 var $1082=$x;
 var $1083=$line;
 var $1084=(($1083+($1082<<1))|0);
 HEAP16[(($1084)>>1)]=$1081;
 label=175;break;
 case 174: 
 var $1086=$x;
 var $1087=$line;
 var $1088=(($1087+($1086<<1))|0);
 HEAP16[(($1088)>>1)]=0;
 label=175;break;
 case 175: 
 var $1090=$count;
 var $1091=((($1090)-(1))|0);
 $count=$1091;
 var $1092=$x;
 var $1093=((($1092)+(1))|0);
 $x=$1093;
 label=164;break;
 case 176: 
 label=260;break;
 case 177: 
 label=178;break;
 case 178: 
 var $1097=$count;
 var $1098=$1097&-8;
 var $1099=($1098|0)!=0;
 if($1099){label=179;break;}else{var $1106=0;label=180;break;}
 case 179: 
 var $1101=$x;
 var $1102=((($1101)+(8))|0);
 var $1103=$3;
 var $1104=($1102|0)<($1103|0);
 var $1106=$1104;label=180;break;
 case 180: 
 var $1106;
 if($1106){label=181;break;}else{label=246;break;}
 case 181: 
 var $1108=$mixmask;
 var $1109=($1108&255);
 var $1110=$1109<<1;
 var $1111=(($1110)&255);
 $mixmask=$1111;
 var $1112=$mixmask;
 var $1113=($1112&255);
 var $1114=($1113|0)==0;
 if($1114){label=182;break;}else{label=186;break;}
 case 182: 
 var $1116=$fom_mask;
 var $1117=($1116|0)!=0;
 if($1117){label=183;break;}else{label=184;break;}
 case 183: 
 var $1119=$fom_mask;
 var $1126=$1119;label=185;break;
 case 184: 
 var $1121=$5;
 var $1122=(($1121+1)|0);
 $5=$1122;
 var $1123=HEAP8[($1121)];
 var $1124=($1123&255);
 var $1126=$1124;label=185;break;
 case 185: 
 var $1126;
 var $1127=(($1126)&255);
 $mask=$1127;
 $mixmask=1;
 label=186;break;
 case 186: 
 var $1129=$mask;
 var $1130=($1129&255);
 var $1131=$mixmask;
 var $1132=($1131&255);
 var $1133=$1130&$1132;
 var $1134=($1133|0)!=0;
 if($1134){label=187;break;}else{label=188;break;}
 case 187: 
 var $1136=$x;
 var $1137=$prevline;
 var $1138=(($1137+($1136<<1))|0);
 var $1139=HEAP16[(($1138)>>1)];
 var $1140=($1139&65535);
 var $1141=$mix;
 var $1142=($1141&65535);
 var $1143=$1140^$1142;
 var $1144=(($1143)&65535);
 var $1145=$x;
 var $1146=$line;
 var $1147=(($1146+($1145<<1))|0);
 HEAP16[(($1147)>>1)]=$1144;
 label=189;break;
 case 188: 
 var $1149=$x;
 var $1150=$prevline;
 var $1151=(($1150+($1149<<1))|0);
 var $1152=HEAP16[(($1151)>>1)];
 var $1153=$x;
 var $1154=$line;
 var $1155=(($1154+($1153<<1))|0);
 HEAP16[(($1155)>>1)]=$1152;
 label=189;break;
 case 189: 
 var $1157=$count;
 var $1158=((($1157)-(1))|0);
 $count=$1158;
 var $1159=$x;
 var $1160=((($1159)+(1))|0);
 $x=$1160;
 var $1161=$mixmask;
 var $1162=($1161&255);
 var $1163=$1162<<1;
 var $1164=(($1163)&255);
 $mixmask=$1164;
 var $1165=$mixmask;
 var $1166=($1165&255);
 var $1167=($1166|0)==0;
 if($1167){label=190;break;}else{label=194;break;}
 case 190: 
 var $1169=$fom_mask;
 var $1170=($1169|0)!=0;
 if($1170){label=191;break;}else{label=192;break;}
 case 191: 
 var $1172=$fom_mask;
 var $1179=$1172;label=193;break;
 case 192: 
 var $1174=$5;
 var $1175=(($1174+1)|0);
 $5=$1175;
 var $1176=HEAP8[($1174)];
 var $1177=($1176&255);
 var $1179=$1177;label=193;break;
 case 193: 
 var $1179;
 var $1180=(($1179)&255);
 $mask=$1180;
 $mixmask=1;
 label=194;break;
 case 194: 
 var $1182=$mask;
 var $1183=($1182&255);
 var $1184=$mixmask;
 var $1185=($1184&255);
 var $1186=$1183&$1185;
 var $1187=($1186|0)!=0;
 if($1187){label=195;break;}else{label=196;break;}
 case 195: 
 var $1189=$x;
 var $1190=$prevline;
 var $1191=(($1190+($1189<<1))|0);
 var $1192=HEAP16[(($1191)>>1)];
 var $1193=($1192&65535);
 var $1194=$mix;
 var $1195=($1194&65535);
 var $1196=$1193^$1195;
 var $1197=(($1196)&65535);
 var $1198=$x;
 var $1199=$line;
 var $1200=(($1199+($1198<<1))|0);
 HEAP16[(($1200)>>1)]=$1197;
 label=197;break;
 case 196: 
 var $1202=$x;
 var $1203=$prevline;
 var $1204=(($1203+($1202<<1))|0);
 var $1205=HEAP16[(($1204)>>1)];
 var $1206=$x;
 var $1207=$line;
 var $1208=(($1207+($1206<<1))|0);
 HEAP16[(($1208)>>1)]=$1205;
 label=197;break;
 case 197: 
 var $1210=$count;
 var $1211=((($1210)-(1))|0);
 $count=$1211;
 var $1212=$x;
 var $1213=((($1212)+(1))|0);
 $x=$1213;
 var $1214=$mixmask;
 var $1215=($1214&255);
 var $1216=$1215<<1;
 var $1217=(($1216)&255);
 $mixmask=$1217;
 var $1218=$mixmask;
 var $1219=($1218&255);
 var $1220=($1219|0)==0;
 if($1220){label=198;break;}else{label=202;break;}
 case 198: 
 var $1222=$fom_mask;
 var $1223=($1222|0)!=0;
 if($1223){label=199;break;}else{label=200;break;}
 case 199: 
 var $1225=$fom_mask;
 var $1232=$1225;label=201;break;
 case 200: 
 var $1227=$5;
 var $1228=(($1227+1)|0);
 $5=$1228;
 var $1229=HEAP8[($1227)];
 var $1230=($1229&255);
 var $1232=$1230;label=201;break;
 case 201: 
 var $1232;
 var $1233=(($1232)&255);
 $mask=$1233;
 $mixmask=1;
 label=202;break;
 case 202: 
 var $1235=$mask;
 var $1236=($1235&255);
 var $1237=$mixmask;
 var $1238=($1237&255);
 var $1239=$1236&$1238;
 var $1240=($1239|0)!=0;
 if($1240){label=203;break;}else{label=204;break;}
 case 203: 
 var $1242=$x;
 var $1243=$prevline;
 var $1244=(($1243+($1242<<1))|0);
 var $1245=HEAP16[(($1244)>>1)];
 var $1246=($1245&65535);
 var $1247=$mix;
 var $1248=($1247&65535);
 var $1249=$1246^$1248;
 var $1250=(($1249)&65535);
 var $1251=$x;
 var $1252=$line;
 var $1253=(($1252+($1251<<1))|0);
 HEAP16[(($1253)>>1)]=$1250;
 label=205;break;
 case 204: 
 var $1255=$x;
 var $1256=$prevline;
 var $1257=(($1256+($1255<<1))|0);
 var $1258=HEAP16[(($1257)>>1)];
 var $1259=$x;
 var $1260=$line;
 var $1261=(($1260+($1259<<1))|0);
 HEAP16[(($1261)>>1)]=$1258;
 label=205;break;
 case 205: 
 var $1263=$count;
 var $1264=((($1263)-(1))|0);
 $count=$1264;
 var $1265=$x;
 var $1266=((($1265)+(1))|0);
 $x=$1266;
 var $1267=$mixmask;
 var $1268=($1267&255);
 var $1269=$1268<<1;
 var $1270=(($1269)&255);
 $mixmask=$1270;
 var $1271=$mixmask;
 var $1272=($1271&255);
 var $1273=($1272|0)==0;
 if($1273){label=206;break;}else{label=210;break;}
 case 206: 
 var $1275=$fom_mask;
 var $1276=($1275|0)!=0;
 if($1276){label=207;break;}else{label=208;break;}
 case 207: 
 var $1278=$fom_mask;
 var $1285=$1278;label=209;break;
 case 208: 
 var $1280=$5;
 var $1281=(($1280+1)|0);
 $5=$1281;
 var $1282=HEAP8[($1280)];
 var $1283=($1282&255);
 var $1285=$1283;label=209;break;
 case 209: 
 var $1285;
 var $1286=(($1285)&255);
 $mask=$1286;
 $mixmask=1;
 label=210;break;
 case 210: 
 var $1288=$mask;
 var $1289=($1288&255);
 var $1290=$mixmask;
 var $1291=($1290&255);
 var $1292=$1289&$1291;
 var $1293=($1292|0)!=0;
 if($1293){label=211;break;}else{label=212;break;}
 case 211: 
 var $1295=$x;
 var $1296=$prevline;
 var $1297=(($1296+($1295<<1))|0);
 var $1298=HEAP16[(($1297)>>1)];
 var $1299=($1298&65535);
 var $1300=$mix;
 var $1301=($1300&65535);
 var $1302=$1299^$1301;
 var $1303=(($1302)&65535);
 var $1304=$x;
 var $1305=$line;
 var $1306=(($1305+($1304<<1))|0);
 HEAP16[(($1306)>>1)]=$1303;
 label=213;break;
 case 212: 
 var $1308=$x;
 var $1309=$prevline;
 var $1310=(($1309+($1308<<1))|0);
 var $1311=HEAP16[(($1310)>>1)];
 var $1312=$x;
 var $1313=$line;
 var $1314=(($1313+($1312<<1))|0);
 HEAP16[(($1314)>>1)]=$1311;
 label=213;break;
 case 213: 
 var $1316=$count;
 var $1317=((($1316)-(1))|0);
 $count=$1317;
 var $1318=$x;
 var $1319=((($1318)+(1))|0);
 $x=$1319;
 var $1320=$mixmask;
 var $1321=($1320&255);
 var $1322=$1321<<1;
 var $1323=(($1322)&255);
 $mixmask=$1323;
 var $1324=$mixmask;
 var $1325=($1324&255);
 var $1326=($1325|0)==0;
 if($1326){label=214;break;}else{label=218;break;}
 case 214: 
 var $1328=$fom_mask;
 var $1329=($1328|0)!=0;
 if($1329){label=215;break;}else{label=216;break;}
 case 215: 
 var $1331=$fom_mask;
 var $1338=$1331;label=217;break;
 case 216: 
 var $1333=$5;
 var $1334=(($1333+1)|0);
 $5=$1334;
 var $1335=HEAP8[($1333)];
 var $1336=($1335&255);
 var $1338=$1336;label=217;break;
 case 217: 
 var $1338;
 var $1339=(($1338)&255);
 $mask=$1339;
 $mixmask=1;
 label=218;break;
 case 218: 
 var $1341=$mask;
 var $1342=($1341&255);
 var $1343=$mixmask;
 var $1344=($1343&255);
 var $1345=$1342&$1344;
 var $1346=($1345|0)!=0;
 if($1346){label=219;break;}else{label=220;break;}
 case 219: 
 var $1348=$x;
 var $1349=$prevline;
 var $1350=(($1349+($1348<<1))|0);
 var $1351=HEAP16[(($1350)>>1)];
 var $1352=($1351&65535);
 var $1353=$mix;
 var $1354=($1353&65535);
 var $1355=$1352^$1354;
 var $1356=(($1355)&65535);
 var $1357=$x;
 var $1358=$line;
 var $1359=(($1358+($1357<<1))|0);
 HEAP16[(($1359)>>1)]=$1356;
 label=221;break;
 case 220: 
 var $1361=$x;
 var $1362=$prevline;
 var $1363=(($1362+($1361<<1))|0);
 var $1364=HEAP16[(($1363)>>1)];
 var $1365=$x;
 var $1366=$line;
 var $1367=(($1366+($1365<<1))|0);
 HEAP16[(($1367)>>1)]=$1364;
 label=221;break;
 case 221: 
 var $1369=$count;
 var $1370=((($1369)-(1))|0);
 $count=$1370;
 var $1371=$x;
 var $1372=((($1371)+(1))|0);
 $x=$1372;
 var $1373=$mixmask;
 var $1374=($1373&255);
 var $1375=$1374<<1;
 var $1376=(($1375)&255);
 $mixmask=$1376;
 var $1377=$mixmask;
 var $1378=($1377&255);
 var $1379=($1378|0)==0;
 if($1379){label=222;break;}else{label=226;break;}
 case 222: 
 var $1381=$fom_mask;
 var $1382=($1381|0)!=0;
 if($1382){label=223;break;}else{label=224;break;}
 case 223: 
 var $1384=$fom_mask;
 var $1391=$1384;label=225;break;
 case 224: 
 var $1386=$5;
 var $1387=(($1386+1)|0);
 $5=$1387;
 var $1388=HEAP8[($1386)];
 var $1389=($1388&255);
 var $1391=$1389;label=225;break;
 case 225: 
 var $1391;
 var $1392=(($1391)&255);
 $mask=$1392;
 $mixmask=1;
 label=226;break;
 case 226: 
 var $1394=$mask;
 var $1395=($1394&255);
 var $1396=$mixmask;
 var $1397=($1396&255);
 var $1398=$1395&$1397;
 var $1399=($1398|0)!=0;
 if($1399){label=227;break;}else{label=228;break;}
 case 227: 
 var $1401=$x;
 var $1402=$prevline;
 var $1403=(($1402+($1401<<1))|0);
 var $1404=HEAP16[(($1403)>>1)];
 var $1405=($1404&65535);
 var $1406=$mix;
 var $1407=($1406&65535);
 var $1408=$1405^$1407;
 var $1409=(($1408)&65535);
 var $1410=$x;
 var $1411=$line;
 var $1412=(($1411+($1410<<1))|0);
 HEAP16[(($1412)>>1)]=$1409;
 label=229;break;
 case 228: 
 var $1414=$x;
 var $1415=$prevline;
 var $1416=(($1415+($1414<<1))|0);
 var $1417=HEAP16[(($1416)>>1)];
 var $1418=$x;
 var $1419=$line;
 var $1420=(($1419+($1418<<1))|0);
 HEAP16[(($1420)>>1)]=$1417;
 label=229;break;
 case 229: 
 var $1422=$count;
 var $1423=((($1422)-(1))|0);
 $count=$1423;
 var $1424=$x;
 var $1425=((($1424)+(1))|0);
 $x=$1425;
 var $1426=$mixmask;
 var $1427=($1426&255);
 var $1428=$1427<<1;
 var $1429=(($1428)&255);
 $mixmask=$1429;
 var $1430=$mixmask;
 var $1431=($1430&255);
 var $1432=($1431|0)==0;
 if($1432){label=230;break;}else{label=234;break;}
 case 230: 
 var $1434=$fom_mask;
 var $1435=($1434|0)!=0;
 if($1435){label=231;break;}else{label=232;break;}
 case 231: 
 var $1437=$fom_mask;
 var $1444=$1437;label=233;break;
 case 232: 
 var $1439=$5;
 var $1440=(($1439+1)|0);
 $5=$1440;
 var $1441=HEAP8[($1439)];
 var $1442=($1441&255);
 var $1444=$1442;label=233;break;
 case 233: 
 var $1444;
 var $1445=(($1444)&255);
 $mask=$1445;
 $mixmask=1;
 label=234;break;
 case 234: 
 var $1447=$mask;
 var $1448=($1447&255);
 var $1449=$mixmask;
 var $1450=($1449&255);
 var $1451=$1448&$1450;
 var $1452=($1451|0)!=0;
 if($1452){label=235;break;}else{label=236;break;}
 case 235: 
 var $1454=$x;
 var $1455=$prevline;
 var $1456=(($1455+($1454<<1))|0);
 var $1457=HEAP16[(($1456)>>1)];
 var $1458=($1457&65535);
 var $1459=$mix;
 var $1460=($1459&65535);
 var $1461=$1458^$1460;
 var $1462=(($1461)&65535);
 var $1463=$x;
 var $1464=$line;
 var $1465=(($1464+($1463<<1))|0);
 HEAP16[(($1465)>>1)]=$1462;
 label=237;break;
 case 236: 
 var $1467=$x;
 var $1468=$prevline;
 var $1469=(($1468+($1467<<1))|0);
 var $1470=HEAP16[(($1469)>>1)];
 var $1471=$x;
 var $1472=$line;
 var $1473=(($1472+($1471<<1))|0);
 HEAP16[(($1473)>>1)]=$1470;
 label=237;break;
 case 237: 
 var $1475=$count;
 var $1476=((($1475)-(1))|0);
 $count=$1476;
 var $1477=$x;
 var $1478=((($1477)+(1))|0);
 $x=$1478;
 var $1479=$mixmask;
 var $1480=($1479&255);
 var $1481=$1480<<1;
 var $1482=(($1481)&255);
 $mixmask=$1482;
 var $1483=$mixmask;
 var $1484=($1483&255);
 var $1485=($1484|0)==0;
 if($1485){label=238;break;}else{label=242;break;}
 case 238: 
 var $1487=$fom_mask;
 var $1488=($1487|0)!=0;
 if($1488){label=239;break;}else{label=240;break;}
 case 239: 
 var $1490=$fom_mask;
 var $1497=$1490;label=241;break;
 case 240: 
 var $1492=$5;
 var $1493=(($1492+1)|0);
 $5=$1493;
 var $1494=HEAP8[($1492)];
 var $1495=($1494&255);
 var $1497=$1495;label=241;break;
 case 241: 
 var $1497;
 var $1498=(($1497)&255);
 $mask=$1498;
 $mixmask=1;
 label=242;break;
 case 242: 
 var $1500=$mask;
 var $1501=($1500&255);
 var $1502=$mixmask;
 var $1503=($1502&255);
 var $1504=$1501&$1503;
 var $1505=($1504|0)!=0;
 if($1505){label=243;break;}else{label=244;break;}
 case 243: 
 var $1507=$x;
 var $1508=$prevline;
 var $1509=(($1508+($1507<<1))|0);
 var $1510=HEAP16[(($1509)>>1)];
 var $1511=($1510&65535);
 var $1512=$mix;
 var $1513=($1512&65535);
 var $1514=$1511^$1513;
 var $1515=(($1514)&65535);
 var $1516=$x;
 var $1517=$line;
 var $1518=(($1517+($1516<<1))|0);
 HEAP16[(($1518)>>1)]=$1515;
 label=245;break;
 case 244: 
 var $1520=$x;
 var $1521=$prevline;
 var $1522=(($1521+($1520<<1))|0);
 var $1523=HEAP16[(($1522)>>1)];
 var $1524=$x;
 var $1525=$line;
 var $1526=(($1525+($1524<<1))|0);
 HEAP16[(($1526)>>1)]=$1523;
 label=245;break;
 case 245: 
 var $1528=$count;
 var $1529=((($1528)-(1))|0);
 $count=$1529;
 var $1530=$x;
 var $1531=((($1530)+(1))|0);
 $x=$1531;
 label=178;break;
 case 246: 
 label=247;break;
 case 247: 
 var $1534=$count;
 var $1535=($1534|0)>0;
 if($1535){label=248;break;}else{var $1541=0;label=249;break;}
 case 248: 
 var $1537=$x;
 var $1538=$3;
 var $1539=($1537|0)<($1538|0);
 var $1541=$1539;label=249;break;
 case 249: 
 var $1541;
 if($1541){label=250;break;}else{label=259;break;}
 case 250: 
 var $1543=$mixmask;
 var $1544=($1543&255);
 var $1545=$1544<<1;
 var $1546=(($1545)&255);
 $mixmask=$1546;
 var $1547=$mixmask;
 var $1548=($1547&255);
 var $1549=($1548|0)==0;
 if($1549){label=251;break;}else{label=255;break;}
 case 251: 
 var $1551=$fom_mask;
 var $1552=($1551|0)!=0;
 if($1552){label=252;break;}else{label=253;break;}
 case 252: 
 var $1554=$fom_mask;
 var $1561=$1554;label=254;break;
 case 253: 
 var $1556=$5;
 var $1557=(($1556+1)|0);
 $5=$1557;
 var $1558=HEAP8[($1556)];
 var $1559=($1558&255);
 var $1561=$1559;label=254;break;
 case 254: 
 var $1561;
 var $1562=(($1561)&255);
 $mask=$1562;
 $mixmask=1;
 label=255;break;
 case 255: 
 var $1564=$mask;
 var $1565=($1564&255);
 var $1566=$mixmask;
 var $1567=($1566&255);
 var $1568=$1565&$1567;
 var $1569=($1568|0)!=0;
 if($1569){label=256;break;}else{label=257;break;}
 case 256: 
 var $1571=$x;
 var $1572=$prevline;
 var $1573=(($1572+($1571<<1))|0);
 var $1574=HEAP16[(($1573)>>1)];
 var $1575=($1574&65535);
 var $1576=$mix;
 var $1577=($1576&65535);
 var $1578=$1575^$1577;
 var $1579=(($1578)&65535);
 var $1580=$x;
 var $1581=$line;
 var $1582=(($1581+($1580<<1))|0);
 HEAP16[(($1582)>>1)]=$1579;
 label=258;break;
 case 257: 
 var $1584=$x;
 var $1585=$prevline;
 var $1586=(($1585+($1584<<1))|0);
 var $1587=HEAP16[(($1586)>>1)];
 var $1588=$x;
 var $1589=$line;
 var $1590=(($1589+($1588<<1))|0);
 HEAP16[(($1590)>>1)]=$1587;
 label=258;break;
 case 258: 
 var $1592=$count;
 var $1593=((($1592)-(1))|0);
 $count=$1593;
 var $1594=$x;
 var $1595=((($1594)+(1))|0);
 $x=$1595;
 label=247;break;
 case 259: 
 label=260;break;
 case 260: 
 label=344;break;
 case 261: 
 label=262;break;
 case 262: 
 var $1600=$count;
 var $1601=$1600&-8;
 var $1602=($1601|0)!=0;
 if($1602){label=263;break;}else{var $1609=0;label=264;break;}
 case 263: 
 var $1604=$x;
 var $1605=((($1604)+(8))|0);
 var $1606=$3;
 var $1607=($1605|0)<($1606|0);
 var $1609=$1607;label=264;break;
 case 264: 
 var $1609;
 if($1609){label=265;break;}else{label=266;break;}
 case 265: 
 var $1611=$colour2;
 var $1612=$x;
 var $1613=$line;
 var $1614=(($1613+($1612<<1))|0);
 HEAP16[(($1614)>>1)]=$1611;
 var $1615=$count;
 var $1616=((($1615)-(1))|0);
 $count=$1616;
 var $1617=$x;
 var $1618=((($1617)+(1))|0);
 $x=$1618;
 var $1619=$colour2;
 var $1620=$x;
 var $1621=$line;
 var $1622=(($1621+($1620<<1))|0);
 HEAP16[(($1622)>>1)]=$1619;
 var $1623=$count;
 var $1624=((($1623)-(1))|0);
 $count=$1624;
 var $1625=$x;
 var $1626=((($1625)+(1))|0);
 $x=$1626;
 var $1627=$colour2;
 var $1628=$x;
 var $1629=$line;
 var $1630=(($1629+($1628<<1))|0);
 HEAP16[(($1630)>>1)]=$1627;
 var $1631=$count;
 var $1632=((($1631)-(1))|0);
 $count=$1632;
 var $1633=$x;
 var $1634=((($1633)+(1))|0);
 $x=$1634;
 var $1635=$colour2;
 var $1636=$x;
 var $1637=$line;
 var $1638=(($1637+($1636<<1))|0);
 HEAP16[(($1638)>>1)]=$1635;
 var $1639=$count;
 var $1640=((($1639)-(1))|0);
 $count=$1640;
 var $1641=$x;
 var $1642=((($1641)+(1))|0);
 $x=$1642;
 var $1643=$colour2;
 var $1644=$x;
 var $1645=$line;
 var $1646=(($1645+($1644<<1))|0);
 HEAP16[(($1646)>>1)]=$1643;
 var $1647=$count;
 var $1648=((($1647)-(1))|0);
 $count=$1648;
 var $1649=$x;
 var $1650=((($1649)+(1))|0);
 $x=$1650;
 var $1651=$colour2;
 var $1652=$x;
 var $1653=$line;
 var $1654=(($1653+($1652<<1))|0);
 HEAP16[(($1654)>>1)]=$1651;
 var $1655=$count;
 var $1656=((($1655)-(1))|0);
 $count=$1656;
 var $1657=$x;
 var $1658=((($1657)+(1))|0);
 $x=$1658;
 var $1659=$colour2;
 var $1660=$x;
 var $1661=$line;
 var $1662=(($1661+($1660<<1))|0);
 HEAP16[(($1662)>>1)]=$1659;
 var $1663=$count;
 var $1664=((($1663)-(1))|0);
 $count=$1664;
 var $1665=$x;
 var $1666=((($1665)+(1))|0);
 $x=$1666;
 var $1667=$colour2;
 var $1668=$x;
 var $1669=$line;
 var $1670=(($1669+($1668<<1))|0);
 HEAP16[(($1670)>>1)]=$1667;
 var $1671=$count;
 var $1672=((($1671)-(1))|0);
 $count=$1672;
 var $1673=$x;
 var $1674=((($1673)+(1))|0);
 $x=$1674;
 label=262;break;
 case 266: 
 label=267;break;
 case 267: 
 var $1677=$count;
 var $1678=($1677|0)>0;
 if($1678){label=268;break;}else{var $1684=0;label=269;break;}
 case 268: 
 var $1680=$x;
 var $1681=$3;
 var $1682=($1680|0)<($1681|0);
 var $1684=$1682;label=269;break;
 case 269: 
 var $1684;
 if($1684){label=270;break;}else{label=271;break;}
 case 270: 
 var $1686=$colour2;
 var $1687=$x;
 var $1688=$line;
 var $1689=(($1688+($1687<<1))|0);
 HEAP16[(($1689)>>1)]=$1686;
 var $1690=$count;
 var $1691=((($1690)-(1))|0);
 $count=$1691;
 var $1692=$x;
 var $1693=((($1692)+(1))|0);
 $x=$1693;
 label=267;break;
 case 271: 
 label=344;break;
 case 272: 
 label=273;break;
 case 273: 
 var $1697=$count;
 var $1698=$1697&-8;
 var $1699=($1698|0)!=0;
 if($1699){label=274;break;}else{var $1706=0;label=275;break;}
 case 274: 
 var $1701=$x;
 var $1702=((($1701)+(8))|0);
 var $1703=$3;
 var $1704=($1702|0)<($1703|0);
 var $1706=$1704;label=275;break;
 case 275: 
 var $1706;
 if($1706){label=276;break;}else{label=277;break;}
 case 276: 
 var $1708=$5;
 var $1709=(($1708+1)|0);
 $5=$1709;
 var $1710=HEAP8[($1708)];
 var $1711=($1710&255);
 var $1712=$x;
 var $1713=$line;
 var $1714=(($1713+($1712<<1))|0);
 HEAP16[(($1714)>>1)]=$1711;
 var $1715=$5;
 var $1716=(($1715+1)|0);
 $5=$1716;
 var $1717=HEAP8[($1715)];
 var $1718=($1717&255);
 var $1719=$1718<<8;
 var $1720=$x;
 var $1721=$line;
 var $1722=(($1721+($1720<<1))|0);
 var $1723=HEAP16[(($1722)>>1)];
 var $1724=($1723&65535);
 var $1725=$1724|$1719;
 var $1726=(($1725)&65535);
 HEAP16[(($1722)>>1)]=$1726;
 var $1727=$count;
 var $1728=((($1727)-(1))|0);
 $count=$1728;
 var $1729=$x;
 var $1730=((($1729)+(1))|0);
 $x=$1730;
 var $1731=$5;
 var $1732=(($1731+1)|0);
 $5=$1732;
 var $1733=HEAP8[($1731)];
 var $1734=($1733&255);
 var $1735=$x;
 var $1736=$line;
 var $1737=(($1736+($1735<<1))|0);
 HEAP16[(($1737)>>1)]=$1734;
 var $1738=$5;
 var $1739=(($1738+1)|0);
 $5=$1739;
 var $1740=HEAP8[($1738)];
 var $1741=($1740&255);
 var $1742=$1741<<8;
 var $1743=$x;
 var $1744=$line;
 var $1745=(($1744+($1743<<1))|0);
 var $1746=HEAP16[(($1745)>>1)];
 var $1747=($1746&65535);
 var $1748=$1747|$1742;
 var $1749=(($1748)&65535);
 HEAP16[(($1745)>>1)]=$1749;
 var $1750=$count;
 var $1751=((($1750)-(1))|0);
 $count=$1751;
 var $1752=$x;
 var $1753=((($1752)+(1))|0);
 $x=$1753;
 var $1754=$5;
 var $1755=(($1754+1)|0);
 $5=$1755;
 var $1756=HEAP8[($1754)];
 var $1757=($1756&255);
 var $1758=$x;
 var $1759=$line;
 var $1760=(($1759+($1758<<1))|0);
 HEAP16[(($1760)>>1)]=$1757;
 var $1761=$5;
 var $1762=(($1761+1)|0);
 $5=$1762;
 var $1763=HEAP8[($1761)];
 var $1764=($1763&255);
 var $1765=$1764<<8;
 var $1766=$x;
 var $1767=$line;
 var $1768=(($1767+($1766<<1))|0);
 var $1769=HEAP16[(($1768)>>1)];
 var $1770=($1769&65535);
 var $1771=$1770|$1765;
 var $1772=(($1771)&65535);
 HEAP16[(($1768)>>1)]=$1772;
 var $1773=$count;
 var $1774=((($1773)-(1))|0);
 $count=$1774;
 var $1775=$x;
 var $1776=((($1775)+(1))|0);
 $x=$1776;
 var $1777=$5;
 var $1778=(($1777+1)|0);
 $5=$1778;
 var $1779=HEAP8[($1777)];
 var $1780=($1779&255);
 var $1781=$x;
 var $1782=$line;
 var $1783=(($1782+($1781<<1))|0);
 HEAP16[(($1783)>>1)]=$1780;
 var $1784=$5;
 var $1785=(($1784+1)|0);
 $5=$1785;
 var $1786=HEAP8[($1784)];
 var $1787=($1786&255);
 var $1788=$1787<<8;
 var $1789=$x;
 var $1790=$line;
 var $1791=(($1790+($1789<<1))|0);
 var $1792=HEAP16[(($1791)>>1)];
 var $1793=($1792&65535);
 var $1794=$1793|$1788;
 var $1795=(($1794)&65535);
 HEAP16[(($1791)>>1)]=$1795;
 var $1796=$count;
 var $1797=((($1796)-(1))|0);
 $count=$1797;
 var $1798=$x;
 var $1799=((($1798)+(1))|0);
 $x=$1799;
 var $1800=$5;
 var $1801=(($1800+1)|0);
 $5=$1801;
 var $1802=HEAP8[($1800)];
 var $1803=($1802&255);
 var $1804=$x;
 var $1805=$line;
 var $1806=(($1805+($1804<<1))|0);
 HEAP16[(($1806)>>1)]=$1803;
 var $1807=$5;
 var $1808=(($1807+1)|0);
 $5=$1808;
 var $1809=HEAP8[($1807)];
 var $1810=($1809&255);
 var $1811=$1810<<8;
 var $1812=$x;
 var $1813=$line;
 var $1814=(($1813+($1812<<1))|0);
 var $1815=HEAP16[(($1814)>>1)];
 var $1816=($1815&65535);
 var $1817=$1816|$1811;
 var $1818=(($1817)&65535);
 HEAP16[(($1814)>>1)]=$1818;
 var $1819=$count;
 var $1820=((($1819)-(1))|0);
 $count=$1820;
 var $1821=$x;
 var $1822=((($1821)+(1))|0);
 $x=$1822;
 var $1823=$5;
 var $1824=(($1823+1)|0);
 $5=$1824;
 var $1825=HEAP8[($1823)];
 var $1826=($1825&255);
 var $1827=$x;
 var $1828=$line;
 var $1829=(($1828+($1827<<1))|0);
 HEAP16[(($1829)>>1)]=$1826;
 var $1830=$5;
 var $1831=(($1830+1)|0);
 $5=$1831;
 var $1832=HEAP8[($1830)];
 var $1833=($1832&255);
 var $1834=$1833<<8;
 var $1835=$x;
 var $1836=$line;
 var $1837=(($1836+($1835<<1))|0);
 var $1838=HEAP16[(($1837)>>1)];
 var $1839=($1838&65535);
 var $1840=$1839|$1834;
 var $1841=(($1840)&65535);
 HEAP16[(($1837)>>1)]=$1841;
 var $1842=$count;
 var $1843=((($1842)-(1))|0);
 $count=$1843;
 var $1844=$x;
 var $1845=((($1844)+(1))|0);
 $x=$1845;
 var $1846=$5;
 var $1847=(($1846+1)|0);
 $5=$1847;
 var $1848=HEAP8[($1846)];
 var $1849=($1848&255);
 var $1850=$x;
 var $1851=$line;
 var $1852=(($1851+($1850<<1))|0);
 HEAP16[(($1852)>>1)]=$1849;
 var $1853=$5;
 var $1854=(($1853+1)|0);
 $5=$1854;
 var $1855=HEAP8[($1853)];
 var $1856=($1855&255);
 var $1857=$1856<<8;
 var $1858=$x;
 var $1859=$line;
 var $1860=(($1859+($1858<<1))|0);
 var $1861=HEAP16[(($1860)>>1)];
 var $1862=($1861&65535);
 var $1863=$1862|$1857;
 var $1864=(($1863)&65535);
 HEAP16[(($1860)>>1)]=$1864;
 var $1865=$count;
 var $1866=((($1865)-(1))|0);
 $count=$1866;
 var $1867=$x;
 var $1868=((($1867)+(1))|0);
 $x=$1868;
 var $1869=$5;
 var $1870=(($1869+1)|0);
 $5=$1870;
 var $1871=HEAP8[($1869)];
 var $1872=($1871&255);
 var $1873=$x;
 var $1874=$line;
 var $1875=(($1874+($1873<<1))|0);
 HEAP16[(($1875)>>1)]=$1872;
 var $1876=$5;
 var $1877=(($1876+1)|0);
 $5=$1877;
 var $1878=HEAP8[($1876)];
 var $1879=($1878&255);
 var $1880=$1879<<8;
 var $1881=$x;
 var $1882=$line;
 var $1883=(($1882+($1881<<1))|0);
 var $1884=HEAP16[(($1883)>>1)];
 var $1885=($1884&65535);
 var $1886=$1885|$1880;
 var $1887=(($1886)&65535);
 HEAP16[(($1883)>>1)]=$1887;
 var $1888=$count;
 var $1889=((($1888)-(1))|0);
 $count=$1889;
 var $1890=$x;
 var $1891=((($1890)+(1))|0);
 $x=$1891;
 label=273;break;
 case 277: 
 label=278;break;
 case 278: 
 var $1894=$count;
 var $1895=($1894|0)>0;
 if($1895){label=279;break;}else{var $1901=0;label=280;break;}
 case 279: 
 var $1897=$x;
 var $1898=$3;
 var $1899=($1897|0)<($1898|0);
 var $1901=$1899;label=280;break;
 case 280: 
 var $1901;
 if($1901){label=281;break;}else{label=282;break;}
 case 281: 
 var $1903=$5;
 var $1904=(($1903+1)|0);
 $5=$1904;
 var $1905=HEAP8[($1903)];
 var $1906=($1905&255);
 var $1907=$x;
 var $1908=$line;
 var $1909=(($1908+($1907<<1))|0);
 HEAP16[(($1909)>>1)]=$1906;
 var $1910=$5;
 var $1911=(($1910+1)|0);
 $5=$1911;
 var $1912=HEAP8[($1910)];
 var $1913=($1912&255);
 var $1914=$1913<<8;
 var $1915=$x;
 var $1916=$line;
 var $1917=(($1916+($1915<<1))|0);
 var $1918=HEAP16[(($1917)>>1)];
 var $1919=($1918&65535);
 var $1920=$1919|$1914;
 var $1921=(($1920)&65535);
 HEAP16[(($1917)>>1)]=$1921;
 var $1922=$count;
 var $1923=((($1922)-(1))|0);
 $count=$1923;
 var $1924=$x;
 var $1925=((($1924)+(1))|0);
 $x=$1925;
 label=278;break;
 case 282: 
 label=344;break;
 case 283: 
 label=284;break;
 case 284: 
 var $1929=$count;
 var $1930=$1929&-8;
 var $1931=($1930|0)!=0;
 if($1931){label=285;break;}else{var $1938=0;label=286;break;}
 case 285: 
 var $1933=$x;
 var $1934=((($1933)+(8))|0);
 var $1935=$3;
 var $1936=($1934|0)<($1935|0);
 var $1938=$1936;label=286;break;
 case 286: 
 var $1938;
 if($1938){label=287;break;}else{label=312;break;}
 case 287: 
 var $1940=$bicolour;
 var $1941=($1940|0)!=0;
 if($1941){label=288;break;}else{label=289;break;}
 case 288: 
 var $1943=$colour2;
 var $1944=$x;
 var $1945=$line;
 var $1946=(($1945+($1944<<1))|0);
 HEAP16[(($1946)>>1)]=$1943;
 $bicolour=0;
 label=290;break;
 case 289: 
 var $1948=$colour1;
 var $1949=$x;
 var $1950=$line;
 var $1951=(($1950+($1949<<1))|0);
 HEAP16[(($1951)>>1)]=$1948;
 $bicolour=1;
 var $1952=$count;
 var $1953=((($1952)+(1))|0);
 $count=$1953;
 label=290;break;
 case 290: 
 var $1955=$count;
 var $1956=((($1955)-(1))|0);
 $count=$1956;
 var $1957=$x;
 var $1958=((($1957)+(1))|0);
 $x=$1958;
 var $1959=$bicolour;
 var $1960=($1959|0)!=0;
 if($1960){label=291;break;}else{label=292;break;}
 case 291: 
 var $1962=$colour2;
 var $1963=$x;
 var $1964=$line;
 var $1965=(($1964+($1963<<1))|0);
 HEAP16[(($1965)>>1)]=$1962;
 $bicolour=0;
 label=293;break;
 case 292: 
 var $1967=$colour1;
 var $1968=$x;
 var $1969=$line;
 var $1970=(($1969+($1968<<1))|0);
 HEAP16[(($1970)>>1)]=$1967;
 $bicolour=1;
 var $1971=$count;
 var $1972=((($1971)+(1))|0);
 $count=$1972;
 label=293;break;
 case 293: 
 var $1974=$count;
 var $1975=((($1974)-(1))|0);
 $count=$1975;
 var $1976=$x;
 var $1977=((($1976)+(1))|0);
 $x=$1977;
 var $1978=$bicolour;
 var $1979=($1978|0)!=0;
 if($1979){label=294;break;}else{label=295;break;}
 case 294: 
 var $1981=$colour2;
 var $1982=$x;
 var $1983=$line;
 var $1984=(($1983+($1982<<1))|0);
 HEAP16[(($1984)>>1)]=$1981;
 $bicolour=0;
 label=296;break;
 case 295: 
 var $1986=$colour1;
 var $1987=$x;
 var $1988=$line;
 var $1989=(($1988+($1987<<1))|0);
 HEAP16[(($1989)>>1)]=$1986;
 $bicolour=1;
 var $1990=$count;
 var $1991=((($1990)+(1))|0);
 $count=$1991;
 label=296;break;
 case 296: 
 var $1993=$count;
 var $1994=((($1993)-(1))|0);
 $count=$1994;
 var $1995=$x;
 var $1996=((($1995)+(1))|0);
 $x=$1996;
 var $1997=$bicolour;
 var $1998=($1997|0)!=0;
 if($1998){label=297;break;}else{label=298;break;}
 case 297: 
 var $2000=$colour2;
 var $2001=$x;
 var $2002=$line;
 var $2003=(($2002+($2001<<1))|0);
 HEAP16[(($2003)>>1)]=$2000;
 $bicolour=0;
 label=299;break;
 case 298: 
 var $2005=$colour1;
 var $2006=$x;
 var $2007=$line;
 var $2008=(($2007+($2006<<1))|0);
 HEAP16[(($2008)>>1)]=$2005;
 $bicolour=1;
 var $2009=$count;
 var $2010=((($2009)+(1))|0);
 $count=$2010;
 label=299;break;
 case 299: 
 var $2012=$count;
 var $2013=((($2012)-(1))|0);
 $count=$2013;
 var $2014=$x;
 var $2015=((($2014)+(1))|0);
 $x=$2015;
 var $2016=$bicolour;
 var $2017=($2016|0)!=0;
 if($2017){label=300;break;}else{label=301;break;}
 case 300: 
 var $2019=$colour2;
 var $2020=$x;
 var $2021=$line;
 var $2022=(($2021+($2020<<1))|0);
 HEAP16[(($2022)>>1)]=$2019;
 $bicolour=0;
 label=302;break;
 case 301: 
 var $2024=$colour1;
 var $2025=$x;
 var $2026=$line;
 var $2027=(($2026+($2025<<1))|0);
 HEAP16[(($2027)>>1)]=$2024;
 $bicolour=1;
 var $2028=$count;
 var $2029=((($2028)+(1))|0);
 $count=$2029;
 label=302;break;
 case 302: 
 var $2031=$count;
 var $2032=((($2031)-(1))|0);
 $count=$2032;
 var $2033=$x;
 var $2034=((($2033)+(1))|0);
 $x=$2034;
 var $2035=$bicolour;
 var $2036=($2035|0)!=0;
 if($2036){label=303;break;}else{label=304;break;}
 case 303: 
 var $2038=$colour2;
 var $2039=$x;
 var $2040=$line;
 var $2041=(($2040+($2039<<1))|0);
 HEAP16[(($2041)>>1)]=$2038;
 $bicolour=0;
 label=305;break;
 case 304: 
 var $2043=$colour1;
 var $2044=$x;
 var $2045=$line;
 var $2046=(($2045+($2044<<1))|0);
 HEAP16[(($2046)>>1)]=$2043;
 $bicolour=1;
 var $2047=$count;
 var $2048=((($2047)+(1))|0);
 $count=$2048;
 label=305;break;
 case 305: 
 var $2050=$count;
 var $2051=((($2050)-(1))|0);
 $count=$2051;
 var $2052=$x;
 var $2053=((($2052)+(1))|0);
 $x=$2053;
 var $2054=$bicolour;
 var $2055=($2054|0)!=0;
 if($2055){label=306;break;}else{label=307;break;}
 case 306: 
 var $2057=$colour2;
 var $2058=$x;
 var $2059=$line;
 var $2060=(($2059+($2058<<1))|0);
 HEAP16[(($2060)>>1)]=$2057;
 $bicolour=0;
 label=308;break;
 case 307: 
 var $2062=$colour1;
 var $2063=$x;
 var $2064=$line;
 var $2065=(($2064+($2063<<1))|0);
 HEAP16[(($2065)>>1)]=$2062;
 $bicolour=1;
 var $2066=$count;
 var $2067=((($2066)+(1))|0);
 $count=$2067;
 label=308;break;
 case 308: 
 var $2069=$count;
 var $2070=((($2069)-(1))|0);
 $count=$2070;
 var $2071=$x;
 var $2072=((($2071)+(1))|0);
 $x=$2072;
 var $2073=$bicolour;
 var $2074=($2073|0)!=0;
 if($2074){label=309;break;}else{label=310;break;}
 case 309: 
 var $2076=$colour2;
 var $2077=$x;
 var $2078=$line;
 var $2079=(($2078+($2077<<1))|0);
 HEAP16[(($2079)>>1)]=$2076;
 $bicolour=0;
 label=311;break;
 case 310: 
 var $2081=$colour1;
 var $2082=$x;
 var $2083=$line;
 var $2084=(($2083+($2082<<1))|0);
 HEAP16[(($2084)>>1)]=$2081;
 $bicolour=1;
 var $2085=$count;
 var $2086=((($2085)+(1))|0);
 $count=$2086;
 label=311;break;
 case 311: 
 var $2088=$count;
 var $2089=((($2088)-(1))|0);
 $count=$2089;
 var $2090=$x;
 var $2091=((($2090)+(1))|0);
 $x=$2091;
 label=284;break;
 case 312: 
 label=313;break;
 case 313: 
 var $2094=$count;
 var $2095=($2094|0)>0;
 if($2095){label=314;break;}else{var $2101=0;label=315;break;}
 case 314: 
 var $2097=$x;
 var $2098=$3;
 var $2099=($2097|0)<($2098|0);
 var $2101=$2099;label=315;break;
 case 315: 
 var $2101;
 if($2101){label=316;break;}else{label=320;break;}
 case 316: 
 var $2103=$bicolour;
 var $2104=($2103|0)!=0;
 if($2104){label=317;break;}else{label=318;break;}
 case 317: 
 var $2106=$colour2;
 var $2107=$x;
 var $2108=$line;
 var $2109=(($2108+($2107<<1))|0);
 HEAP16[(($2109)>>1)]=$2106;
 $bicolour=0;
 label=319;break;
 case 318: 
 var $2111=$colour1;
 var $2112=$x;
 var $2113=$line;
 var $2114=(($2113+($2112<<1))|0);
 HEAP16[(($2114)>>1)]=$2111;
 $bicolour=1;
 var $2115=$count;
 var $2116=((($2115)+(1))|0);
 $count=$2116;
 label=319;break;
 case 319: 
 var $2118=$count;
 var $2119=((($2118)-(1))|0);
 $count=$2119;
 var $2120=$x;
 var $2121=((($2120)+(1))|0);
 $x=$2121;
 label=313;break;
 case 320: 
 label=344;break;
 case 321: 
 label=322;break;
 case 322: 
 var $2125=$count;
 var $2126=$2125&-8;
 var $2127=($2126|0)!=0;
 if($2127){label=323;break;}else{var $2134=0;label=324;break;}
 case 323: 
 var $2129=$x;
 var $2130=((($2129)+(8))|0);
 var $2131=$3;
 var $2132=($2130|0)<($2131|0);
 var $2134=$2132;label=324;break;
 case 324: 
 var $2134;
 if($2134){label=325;break;}else{label=326;break;}
 case 325: 
 var $2136=$x;
 var $2137=$line;
 var $2138=(($2137+($2136<<1))|0);
 HEAP16[(($2138)>>1)]=-1;
 var $2139=$count;
 var $2140=((($2139)-(1))|0);
 $count=$2140;
 var $2141=$x;
 var $2142=((($2141)+(1))|0);
 $x=$2142;
 var $2143=$x;
 var $2144=$line;
 var $2145=(($2144+($2143<<1))|0);
 HEAP16[(($2145)>>1)]=-1;
 var $2146=$count;
 var $2147=((($2146)-(1))|0);
 $count=$2147;
 var $2148=$x;
 var $2149=((($2148)+(1))|0);
 $x=$2149;
 var $2150=$x;
 var $2151=$line;
 var $2152=(($2151+($2150<<1))|0);
 HEAP16[(($2152)>>1)]=-1;
 var $2153=$count;
 var $2154=((($2153)-(1))|0);
 $count=$2154;
 var $2155=$x;
 var $2156=((($2155)+(1))|0);
 $x=$2156;
 var $2157=$x;
 var $2158=$line;
 var $2159=(($2158+($2157<<1))|0);
 HEAP16[(($2159)>>1)]=-1;
 var $2160=$count;
 var $2161=((($2160)-(1))|0);
 $count=$2161;
 var $2162=$x;
 var $2163=((($2162)+(1))|0);
 $x=$2163;
 var $2164=$x;
 var $2165=$line;
 var $2166=(($2165+($2164<<1))|0);
 HEAP16[(($2166)>>1)]=-1;
 var $2167=$count;
 var $2168=((($2167)-(1))|0);
 $count=$2168;
 var $2169=$x;
 var $2170=((($2169)+(1))|0);
 $x=$2170;
 var $2171=$x;
 var $2172=$line;
 var $2173=(($2172+($2171<<1))|0);
 HEAP16[(($2173)>>1)]=-1;
 var $2174=$count;
 var $2175=((($2174)-(1))|0);
 $count=$2175;
 var $2176=$x;
 var $2177=((($2176)+(1))|0);
 $x=$2177;
 var $2178=$x;
 var $2179=$line;
 var $2180=(($2179+($2178<<1))|0);
 HEAP16[(($2180)>>1)]=-1;
 var $2181=$count;
 var $2182=((($2181)-(1))|0);
 $count=$2182;
 var $2183=$x;
 var $2184=((($2183)+(1))|0);
 $x=$2184;
 var $2185=$x;
 var $2186=$line;
 var $2187=(($2186+($2185<<1))|0);
 HEAP16[(($2187)>>1)]=-1;
 var $2188=$count;
 var $2189=((($2188)-(1))|0);
 $count=$2189;
 var $2190=$x;
 var $2191=((($2190)+(1))|0);
 $x=$2191;
 label=322;break;
 case 326: 
 label=327;break;
 case 327: 
 var $2194=$count;
 var $2195=($2194|0)>0;
 if($2195){label=328;break;}else{var $2201=0;label=329;break;}
 case 328: 
 var $2197=$x;
 var $2198=$3;
 var $2199=($2197|0)<($2198|0);
 var $2201=$2199;label=329;break;
 case 329: 
 var $2201;
 if($2201){label=330;break;}else{label=331;break;}
 case 330: 
 var $2203=$x;
 var $2204=$line;
 var $2205=(($2204+($2203<<1))|0);
 HEAP16[(($2205)>>1)]=-1;
 var $2206=$count;
 var $2207=((($2206)-(1))|0);
 $count=$2207;
 var $2208=$x;
 var $2209=((($2208)+(1))|0);
 $x=$2209;
 label=327;break;
 case 331: 
 label=344;break;
 case 332: 
 label=333;break;
 case 333: 
 var $2213=$count;
 var $2214=$2213&-8;
 var $2215=($2214|0)!=0;
 if($2215){label=334;break;}else{var $2222=0;label=335;break;}
 case 334: 
 var $2217=$x;
 var $2218=((($2217)+(8))|0);
 var $2219=$3;
 var $2220=($2218|0)<($2219|0);
 var $2222=$2220;label=335;break;
 case 335: 
 var $2222;
 if($2222){label=336;break;}else{label=337;break;}
 case 336: 
 var $2224=$x;
 var $2225=$line;
 var $2226=(($2225+($2224<<1))|0);
 HEAP16[(($2226)>>1)]=0;
 var $2227=$count;
 var $2228=((($2227)-(1))|0);
 $count=$2228;
 var $2229=$x;
 var $2230=((($2229)+(1))|0);
 $x=$2230;
 var $2231=$x;
 var $2232=$line;
 var $2233=(($2232+($2231<<1))|0);
 HEAP16[(($2233)>>1)]=0;
 var $2234=$count;
 var $2235=((($2234)-(1))|0);
 $count=$2235;
 var $2236=$x;
 var $2237=((($2236)+(1))|0);
 $x=$2237;
 var $2238=$x;
 var $2239=$line;
 var $2240=(($2239+($2238<<1))|0);
 HEAP16[(($2240)>>1)]=0;
 var $2241=$count;
 var $2242=((($2241)-(1))|0);
 $count=$2242;
 var $2243=$x;
 var $2244=((($2243)+(1))|0);
 $x=$2244;
 var $2245=$x;
 var $2246=$line;
 var $2247=(($2246+($2245<<1))|0);
 HEAP16[(($2247)>>1)]=0;
 var $2248=$count;
 var $2249=((($2248)-(1))|0);
 $count=$2249;
 var $2250=$x;
 var $2251=((($2250)+(1))|0);
 $x=$2251;
 var $2252=$x;
 var $2253=$line;
 var $2254=(($2253+($2252<<1))|0);
 HEAP16[(($2254)>>1)]=0;
 var $2255=$count;
 var $2256=((($2255)-(1))|0);
 $count=$2256;
 var $2257=$x;
 var $2258=((($2257)+(1))|0);
 $x=$2258;
 var $2259=$x;
 var $2260=$line;
 var $2261=(($2260+($2259<<1))|0);
 HEAP16[(($2261)>>1)]=0;
 var $2262=$count;
 var $2263=((($2262)-(1))|0);
 $count=$2263;
 var $2264=$x;
 var $2265=((($2264)+(1))|0);
 $x=$2265;
 var $2266=$x;
 var $2267=$line;
 var $2268=(($2267+($2266<<1))|0);
 HEAP16[(($2268)>>1)]=0;
 var $2269=$count;
 var $2270=((($2269)-(1))|0);
 $count=$2270;
 var $2271=$x;
 var $2272=((($2271)+(1))|0);
 $x=$2272;
 var $2273=$x;
 var $2274=$line;
 var $2275=(($2274+($2273<<1))|0);
 HEAP16[(($2275)>>1)]=0;
 var $2276=$count;
 var $2277=((($2276)-(1))|0);
 $count=$2277;
 var $2278=$x;
 var $2279=((($2278)+(1))|0);
 $x=$2279;
 label=333;break;
 case 337: 
 label=338;break;
 case 338: 
 var $2282=$count;
 var $2283=($2282|0)>0;
 if($2283){label=339;break;}else{var $2289=0;label=340;break;}
 case 339: 
 var $2285=$x;
 var $2286=$3;
 var $2287=($2285|0)<($2286|0);
 var $2289=$2287;label=340;break;
 case 340: 
 var $2289;
 if($2289){label=341;break;}else{label=342;break;}
 case 341: 
 var $2291=$x;
 var $2292=$line;
 var $2293=(($2292+($2291<<1))|0);
 HEAP16[(($2293)>>1)]=0;
 var $2294=$count;
 var $2295=((($2294)-(1))|0);
 $count=$2295;
 var $2296=$x;
 var $2297=((($2296)+(1))|0);
 $x=$2297;
 label=338;break;
 case 342: 
 label=344;break;
 case 343: 
 $1=0;
 label=347;break;
 case 344: 
 label=34;break;
 case 345: 
 label=2;break;
 case 346: 
 $1=1;
 label=347;break;
 case 347: 
 var $2304=$1;
 STACKTOP=sp;return $2304;
  default: assert(0, "bad label: " + label);
 }

}


function _bitmap_decompress_16($output,$output_width,$output_height,$input_width,$input_height,$input,$size){
 var label=0;
 var sp=STACKTOP; (assert((STACKTOP|0) < (STACK_MAX|0))|0);
 label = 1; 
 while(1)switch(label){
 case 1: 
 var $1;
 var $2;
 var $3;
 var $4;
 var $5;
 var $6;
 var $7;
 var $temp;
 var $rv;
 var $y;
 var $x;
 var $a;
 var $r;
 var $g;
 var $b;
 $1=$output;
 $2=$output_width;
 $3=$output_height;
 $4=$input_width;
 $5=$input_height;
 $6=$input;
 $7=$size;
 var $8=$4;
 var $9=$5;
 var $10=(Math_imul($8,$9)|0);
 var $11=($10<<1);
 var $12=_malloc($11);
 $temp=$12;
 var $13=$temp;
 var $14=$4;
 var $15=$5;
 var $16=$6;
 var $17=$7;
 var $18=_bitmap_decompress2($13,$14,$15,$16,$17);
 $rv=$18;
 $y=0;
 label=2;break;
 case 2: 
 var $20=$y;
 var $21=$3;
 var $22=($20|0)<($21|0);
 if($22){label=3;break;}else{label=9;break;}
 case 3: 
 $x=0;
 label=4;break;
 case 4: 
 var $25=$x;
 var $26=$2;
 var $27=($25|0)<($26|0);
 if($27){label=5;break;}else{label=7;break;}
 case 5: 
 var $29=$y;
 var $30=$4;
 var $31=(Math_imul($29,$30)|0);
 var $32=$x;
 var $33=((($31)+($32))|0);
 var $34=$temp;
 var $35=$34;
 var $36=(($35+($33<<1))|0);
 var $37=HEAP16[(($36)>>1)];
 $a=$37;
 var $38=$a;
 var $39=($38&65535);
 var $40=$39&63488;
 var $41=$40>>11;
 var $42=(($41)&255);
 $r=$42;
 var $43=$a;
 var $44=($43&65535);
 var $45=$44&2016;
 var $46=$45>>5;
 var $47=(($46)&255);
 $g=$47;
 var $48=$a;
 var $49=($48&65535);
 var $50=$49&31;
 var $51=(($50)&255);
 $b=$51;
 var $52=$r;
 var $53=($52&255);
 var $54=((($53)*(255))&-1);
 var $55=(((($54|0))/(31))&-1);
 var $56=(($55)&255);
 $r=$56;
 var $57=$g;
 var $58=($57&255);
 var $59=((($58)*(255))&-1);
 var $60=(((($59|0))/(63))&-1);
 var $61=(($60)&255);
 $g=$61;
 var $62=$b;
 var $63=($62&255);
 var $64=((($63)*(255))&-1);
 var $65=(((($64|0))/(31))&-1);
 var $66=(($65)&255);
 $b=$66;
 var $67=$b;
 var $68=($67&255);
 var $69=$68<<16;
 var $70=-16777216|$69;
 var $71=$g;
 var $72=($71&255);
 var $73=$72<<8;
 var $74=$70|$73;
 var $75=$r;
 var $76=($75&255);
 var $77=$74|$76;
 var $78=$y;
 var $79=$2;
 var $80=(Math_imul($78,$79)|0);
 var $81=$x;
 var $82=((($80)+($81))|0);
 var $83=$1;
 var $84=$83;
 var $85=(($84+($82<<2))|0);
 HEAP32[(($85)>>2)]=$77;
 label=6;break;
 case 6: 
 var $87=$x;
 var $88=((($87)+(1))|0);
 $x=$88;
 label=4;break;
 case 7: 
 label=8;break;
 case 8: 
 var $91=$y;
 var $92=((($91)+(1))|0);
 $y=$92;
 label=2;break;
 case 9: 
 var $94=$temp;
 _free($94);
 var $95=$rv;
 STACKTOP=sp;return $95;
  default: assert(0, "bad label: " + label);
 }

}
Module["_bitmap_decompress_16"] = _bitmap_decompress_16;

function _bitmap_decompress_24($output,$output_width,$output_height,$input_width,$input_height,$input,$size){
 var label=0;
 var sp=STACKTOP; (assert((STACKTOP|0) < (STACK_MAX|0))|0);
 label = 1; 
 while(1)switch(label){
 case 1: 
 var $1;
 var $2;
 var $3;
 var $4;
 var $5;
 var $6;
 var $7;
 var $temp;
 var $rv;
 var $y;
 var $x;
 var $r;
 var $g;
 var $b;
 $1=$output;
 $2=$output_width;
 $3=$output_height;
 $4=$input_width;
 $5=$input_height;
 $6=$input;
 $7=$size;
 var $8=$4;
 var $9=$5;
 var $10=(Math_imul($8,$9)|0);
 var $11=((($10)*(3))&-1);
 var $12=_malloc($11);
 $temp=$12;
 var $13=$temp;
 var $14=$4;
 var $15=$5;
 var $16=$6;
 var $17=$7;
 var $18=_bitmap_decompress3($13,$14,$15,$16,$17);
 $rv=$18;
 $y=0;
 label=2;break;
 case 2: 
 var $20=$y;
 var $21=$3;
 var $22=($20|0)<($21|0);
 if($22){label=3;break;}else{label=9;break;}
 case 3: 
 $x=0;
 label=4;break;
 case 4: 
 var $25=$x;
 var $26=$2;
 var $27=($25|0)<($26|0);
 if($27){label=5;break;}else{label=7;break;}
 case 5: 
 var $29=$y;
 var $30=$4;
 var $31=(Math_imul($29,$30)|0);
 var $32=$x;
 var $33=((($31)+($32))|0);
 var $34=((($33)*(3))&-1);
 var $35=$temp;
 var $36=(($35+$34)|0);
 var $37=HEAP8[($36)];
 $r=$37;
 var $38=$y;
 var $39=$4;
 var $40=(Math_imul($38,$39)|0);
 var $41=$x;
 var $42=((($40)+($41))|0);
 var $43=((($42)*(3))&-1);
 var $44=((($43)+(1))|0);
 var $45=$temp;
 var $46=(($45+$44)|0);
 var $47=HEAP8[($46)];
 $g=$47;
 var $48=$y;
 var $49=$4;
 var $50=(Math_imul($48,$49)|0);
 var $51=$x;
 var $52=((($50)+($51))|0);
 var $53=((($52)*(3))&-1);
 var $54=((($53)+(2))|0);
 var $55=$temp;
 var $56=(($55+$54)|0);
 var $57=HEAP8[($56)];
 $b=$57;
 var $58=$b;
 var $59=($58&255);
 var $60=$59<<16;
 var $61=-16777216|$60;
 var $62=$g;
 var $63=($62&255);
 var $64=$63<<8;
 var $65=$61|$64;
 var $66=$r;
 var $67=($66&255);
 var $68=$65|$67;
 var $69=$y;
 var $70=$2;
 var $71=(Math_imul($69,$70)|0);
 var $72=$x;
 var $73=((($71)+($72))|0);
 var $74=$1;
 var $75=$74;
 var $76=(($75+($73<<2))|0);
 HEAP32[(($76)>>2)]=$68;
 label=6;break;
 case 6: 
 var $78=$x;
 var $79=((($78)+(1))|0);
 $x=$79;
 label=4;break;
 case 7: 
 label=8;break;
 case 8: 
 var $82=$y;
 var $83=((($82)+(1))|0);
 $y=$83;
 label=2;break;
 case 9: 
 var $85=$temp;
 _free($85);
 var $86=$rv;
 STACKTOP=sp;return $86;
  default: assert(0, "bad label: " + label);
 }

}
Module["_bitmap_decompress_24"] = _bitmap_decompress_24;

function _bitmap_decompress3($output,$width,$height,$input,$size){
 var label=0;
 var sp=STACKTOP;STACKTOP=(STACKTOP+24)|0; (assert((STACKTOP|0) < (STACK_MAX|0))|0);
 label = 1; 
 while(1)switch(label){
 case 1: 
 var $1;
 var $2;
 var $3;
 var $4;
 var $5;
 var $6;
 var $end;
 var $prevline;
 var $line;
 var $opcode;
 var $count;
 var $offset;
 var $isfillormix;
 var $x;
 var $lastopcode;
 var $insertmix;
 var $bicolour;
 var $code;
 var $colour1=sp;
 var $colour2=(sp)+(8);
 var $mixmask;
 var $mask;
 var $mix=(sp)+(16);
 var $fom_mask;
 $2=$output;
 $3=$width;
 $4=$height;
 $5=$input;
 $6=$size;
 var $7=$5;
 var $8=$6;
 var $9=(($7+$8)|0);
 $end=$9;
 $prevline=0;
 $line=0;
 var $10=$3;
 $x=$10;
 $lastopcode=-1;
 $insertmix=0;
 $bicolour=0;
 var $11=$colour1;
 HEAP8[($11)]=0; HEAP8[((($11)+(1))|0)]=0; HEAP8[((($11)+(2))|0)]=0;
 var $12=$colour2;
 HEAP8[($12)]=0; HEAP8[((($12)+(1))|0)]=0; HEAP8[((($12)+(2))|0)]=0;
 $mask=0;
 var $13=$mix;
 assert(3 % 1 === 0);HEAP8[($13)]=HEAP8[(8)];HEAP8[((($13)+(1))|0)]=HEAP8[(9)];HEAP8[((($13)+(2))|0)]=HEAP8[(10)];
 $fom_mask=0;
 label=2;break;
 case 2: 
 var $15=$5;
 var $16=$end;
 var $17=($15>>>0)<($16>>>0);
 if($17){label=3;break;}else{label=346;break;}
 case 3: 
 $fom_mask=0;
 var $19=$5;
 var $20=(($19+1)|0);
 $5=$20;
 var $21=HEAP8[($19)];
 $code=$21;
 var $22=$code;
 var $23=($22&255);
 var $24=$23>>4;
 $opcode=$24;
 var $25=$opcode;
 if(($25|0)==12|($25|0)==13|($25|0)==14){ label=4;break;}else if(($25|0)==15){ label=5;break;}else{label=9;break;}
 case 4: 
 var $27=$opcode;
 var $28=((($27)-(6))|0);
 $opcode=$28;
 var $29=$code;
 var $30=($29&255);
 var $31=$30&15;
 $count=$31;
 $offset=16;
 label=10;break;
 case 5: 
 var $33=$code;
 var $34=($33&255);
 var $35=$34&15;
 $opcode=$35;
 var $36=$opcode;
 var $37=($36|0)<9;
 if($37){label=6;break;}else{label=7;break;}
 case 6: 
 var $39=$5;
 var $40=(($39+1)|0);
 $5=$40;
 var $41=HEAP8[($39)];
 var $42=($41&255);
 $count=$42;
 var $43=$5;
 var $44=(($43+1)|0);
 $5=$44;
 var $45=HEAP8[($43)];
 var $46=($45&255);
 var $47=$46<<8;
 var $48=$count;
 var $49=$48|$47;
 $count=$49;
 label=8;break;
 case 7: 
 var $51=$opcode;
 var $52=($51|0)<11;
 var $53=($52?8:1);
 $count=$53;
 label=8;break;
 case 8: 
 $offset=0;
 label=10;break;
 case 9: 
 var $56=$opcode;
 var $57=$56>>1;
 $opcode=$57;
 var $58=$code;
 var $59=($58&255);
 var $60=$59&31;
 $count=$60;
 $offset=32;
 label=10;break;
 case 10: 
 var $62=$offset;
 var $63=($62|0)!=0;
 if($63){label=11;break;}else{label=22;break;}
 case 11: 
 var $65=$opcode;
 var $66=($65|0)==2;
 if($66){var $71=1;label=13;break;}else{label=12;break;}
 case 12: 
 var $68=$opcode;
 var $69=($68|0)==7;
 var $71=$69;label=13;break;
 case 13: 
 var $71;
 var $72=($71&1);
 $isfillormix=$72;
 var $73=$count;
 var $74=($73|0)==0;
 if($74){label=14;break;}else{label=18;break;}
 case 14: 
 var $76=$isfillormix;
 var $77=($76|0)!=0;
 if($77){label=15;break;}else{label=16;break;}
 case 15: 
 var $79=$5;
 var $80=(($79+1)|0);
 $5=$80;
 var $81=HEAP8[($79)];
 var $82=($81&255);
 var $83=((($82)+(1))|0);
 $count=$83;
 label=17;break;
 case 16: 
 var $85=$5;
 var $86=(($85+1)|0);
 $5=$86;
 var $87=HEAP8[($85)];
 var $88=($87&255);
 var $89=$offset;
 var $90=((($88)+($89))|0);
 $count=$90;
 label=17;break;
 case 17: 
 label=21;break;
 case 18: 
 var $93=$isfillormix;
 var $94=($93|0)!=0;
 if($94){label=19;break;}else{label=20;break;}
 case 19: 
 var $96=$count;
 var $97=$96<<3;
 $count=$97;
 label=20;break;
 case 20: 
 label=21;break;
 case 21: 
 label=22;break;
 case 22: 
 var $101=$opcode;
 switch(($101|0)){case 0:{ label=23;break;}case 8:{ label=28;break;}case 3:{ label=29;break;}case 6:case 7:{ label=30;break;}case 9:{ label=31;break;}case 10:{ label=32;break;}default:{label=33;break;}}break;
 case 23: 
 var $103=$lastopcode;
 var $104=$opcode;
 var $105=($103|0)==($104|0);
 if($105){label=24;break;}else{label=27;break;}
 case 24: 
 var $107=$x;
 var $108=$3;
 var $109=($107|0)==($108|0);
 if($109){label=25;break;}else{label=26;break;}
 case 25: 
 var $111=$prevline;
 var $112=($111|0)==0;
 if($112){label=27;break;}else{label=26;break;}
 case 26: 
 $insertmix=1;
 label=27;break;
 case 27: 
 label=33;break;
 case 28: 
 var $116=$5;
 var $117=(($116+1)|0);
 $5=$117;
 var $118=HEAP8[($116)];
 var $119=(($colour1)|0);
 HEAP8[($119)]=$118;
 var $120=$5;
 var $121=(($120+1)|0);
 $5=$121;
 var $122=HEAP8[($120)];
 var $123=(($colour1+1)|0);
 HEAP8[($123)]=$122;
 var $124=$5;
 var $125=(($124+1)|0);
 $5=$125;
 var $126=HEAP8[($124)];
 var $127=(($colour1+2)|0);
 HEAP8[($127)]=$126;
 label=29;break;
 case 29: 
 var $129=$5;
 var $130=(($129+1)|0);
 $5=$130;
 var $131=HEAP8[($129)];
 var $132=(($colour2)|0);
 HEAP8[($132)]=$131;
 var $133=$5;
 var $134=(($133+1)|0);
 $5=$134;
 var $135=HEAP8[($133)];
 var $136=(($colour2+1)|0);
 HEAP8[($136)]=$135;
 var $137=$5;
 var $138=(($137+1)|0);
 $5=$138;
 var $139=HEAP8[($137)];
 var $140=(($colour2+2)|0);
 HEAP8[($140)]=$139;
 label=33;break;
 case 30: 
 var $142=$5;
 var $143=(($142+1)|0);
 $5=$143;
 var $144=HEAP8[($142)];
 var $145=(($mix)|0);
 HEAP8[($145)]=$144;
 var $146=$5;
 var $147=(($146+1)|0);
 $5=$147;
 var $148=HEAP8[($146)];
 var $149=(($mix+1)|0);
 HEAP8[($149)]=$148;
 var $150=$5;
 var $151=(($150+1)|0);
 $5=$151;
 var $152=HEAP8[($150)];
 var $153=(($mix+2)|0);
 HEAP8[($153)]=$152;
 var $154=$opcode;
 var $155=((($154)-(5))|0);
 $opcode=$155;
 label=33;break;
 case 31: 
 $mask=3;
 $opcode=2;
 $fom_mask=3;
 label=33;break;
 case 32: 
 $mask=5;
 $opcode=2;
 $fom_mask=5;
 label=33;break;
 case 33: 
 var $159=$opcode;
 $lastopcode=$159;
 $mixmask=0;
 label=34;break;
 case 34: 
 var $161=$count;
 var $162=($161|0)>0;
 if($162){label=35;break;}else{label=345;break;}
 case 35: 
 var $164=$x;
 var $165=$3;
 var $166=($164|0)>=($165|0);
 if($166){label=36;break;}else{label=39;break;}
 case 36: 
 var $168=$4;
 var $169=($168|0)<=0;
 if($169){label=37;break;}else{label=38;break;}
 case 37: 
 $1=0;
 label=347;break;
 case 38: 
 $x=0;
 var $172=$4;
 var $173=((($172)-(1))|0);
 $4=$173;
 var $174=$line;
 $prevline=$174;
 var $175=$2;
 var $176=$4;
 var $177=$3;
 var $178=((($177)*(3))&-1);
 var $179=(Math_imul($176,$178)|0);
 var $180=(($175+$179)|0);
 $line=$180;
 label=39;break;
 case 39: 
 var $182=$opcode;
 switch(($182|0)){case 3:{ label=261;break;}case 4:{ label=272;break;}case 8:{ label=283;break;}case 13:{ label=321;break;}case 14:{ label=332;break;}case 0:{ label=40;break;}case 1:{ label=69;break;}case 2:{ label=93;break;}default:{label=343;break;}}break;
 case 40: 
 var $184=$insertmix;
 var $185=($184|0)!=0;
 if($185){label=41;break;}else{label=45;break;}
 case 41: 
 var $187=$prevline;
 var $188=($187|0)==0;
 if($188){label=42;break;}else{label=43;break;}
 case 42: 
 var $190=(($mix)|0);
 var $191=HEAP8[($190)];
 var $192=$x;
 var $193=((($192)*(3))&-1);
 var $194=$line;
 var $195=(($194+$193)|0);
 HEAP8[($195)]=$191;
 var $196=(($mix+1)|0);
 var $197=HEAP8[($196)];
 var $198=$x;
 var $199=((($198)*(3))&-1);
 var $200=((($199)+(1))|0);
 var $201=$line;
 var $202=(($201+$200)|0);
 HEAP8[($202)]=$197;
 var $203=(($mix+2)|0);
 var $204=HEAP8[($203)];
 var $205=$x;
 var $206=((($205)*(3))&-1);
 var $207=((($206)+(2))|0);
 var $208=$line;
 var $209=(($208+$207)|0);
 HEAP8[($209)]=$204;
 label=44;break;
 case 43: 
 var $211=$x;
 var $212=((($211)*(3))&-1);
 var $213=$prevline;
 var $214=(($213+$212)|0);
 var $215=HEAP8[($214)];
 var $216=($215&255);
 var $217=(($mix)|0);
 var $218=HEAP8[($217)];
 var $219=($218&255);
 var $220=$216^$219;
 var $221=(($220)&255);
 var $222=$x;
 var $223=((($222)*(3))&-1);
 var $224=$line;
 var $225=(($224+$223)|0);
 HEAP8[($225)]=$221;
 var $226=$x;
 var $227=((($226)*(3))&-1);
 var $228=((($227)+(1))|0);
 var $229=$prevline;
 var $230=(($229+$228)|0);
 var $231=HEAP8[($230)];
 var $232=($231&255);
 var $233=(($mix+1)|0);
 var $234=HEAP8[($233)];
 var $235=($234&255);
 var $236=$232^$235;
 var $237=(($236)&255);
 var $238=$x;
 var $239=((($238)*(3))&-1);
 var $240=((($239)+(1))|0);
 var $241=$line;
 var $242=(($241+$240)|0);
 HEAP8[($242)]=$237;
 var $243=$x;
 var $244=((($243)*(3))&-1);
 var $245=((($244)+(2))|0);
 var $246=$prevline;
 var $247=(($246+$245)|0);
 var $248=HEAP8[($247)];
 var $249=($248&255);
 var $250=(($mix+2)|0);
 var $251=HEAP8[($250)];
 var $252=($251&255);
 var $253=$249^$252;
 var $254=(($253)&255);
 var $255=$x;
 var $256=((($255)*(3))&-1);
 var $257=((($256)+(2))|0);
 var $258=$line;
 var $259=(($258+$257)|0);
 HEAP8[($259)]=$254;
 label=44;break;
 case 44: 
 $insertmix=0;
 var $261=$count;
 var $262=((($261)-(1))|0);
 $count=$262;
 var $263=$x;
 var $264=((($263)+(1))|0);
 $x=$264;
 label=45;break;
 case 45: 
 var $266=$prevline;
 var $267=($266|0)==0;
 if($267){label=46;break;}else{label=57;break;}
 case 46: 
 label=47;break;
 case 47: 
 var $270=$count;
 var $271=$270&-8;
 var $272=($271|0)!=0;
 if($272){label=48;break;}else{var $279=0;label=49;break;}
 case 48: 
 var $274=$x;
 var $275=((($274)+(8))|0);
 var $276=$3;
 var $277=($275|0)<($276|0);
 var $279=$277;label=49;break;
 case 49: 
 var $279;
 if($279){label=50;break;}else{label=51;break;}
 case 50: 
 var $281=$x;
 var $282=((($281)*(3))&-1);
 var $283=$line;
 var $284=(($283+$282)|0);
 HEAP8[($284)]=0;
 var $285=$x;
 var $286=((($285)*(3))&-1);
 var $287=((($286)+(1))|0);
 var $288=$line;
 var $289=(($288+$287)|0);
 HEAP8[($289)]=0;
 var $290=$x;
 var $291=((($290)*(3))&-1);
 var $292=((($291)+(2))|0);
 var $293=$line;
 var $294=(($293+$292)|0);
 HEAP8[($294)]=0;
 var $295=$count;
 var $296=((($295)-(1))|0);
 $count=$296;
 var $297=$x;
 var $298=((($297)+(1))|0);
 $x=$298;
 var $299=$x;
 var $300=((($299)*(3))&-1);
 var $301=$line;
 var $302=(($301+$300)|0);
 HEAP8[($302)]=0;
 var $303=$x;
 var $304=((($303)*(3))&-1);
 var $305=((($304)+(1))|0);
 var $306=$line;
 var $307=(($306+$305)|0);
 HEAP8[($307)]=0;
 var $308=$x;
 var $309=((($308)*(3))&-1);
 var $310=((($309)+(2))|0);
 var $311=$line;
 var $312=(($311+$310)|0);
 HEAP8[($312)]=0;
 var $313=$count;
 var $314=((($313)-(1))|0);
 $count=$314;
 var $315=$x;
 var $316=((($315)+(1))|0);
 $x=$316;
 var $317=$x;
 var $318=((($317)*(3))&-1);
 var $319=$line;
 var $320=(($319+$318)|0);
 HEAP8[($320)]=0;
 var $321=$x;
 var $322=((($321)*(3))&-1);
 var $323=((($322)+(1))|0);
 var $324=$line;
 var $325=(($324+$323)|0);
 HEAP8[($325)]=0;
 var $326=$x;
 var $327=((($326)*(3))&-1);
 var $328=((($327)+(2))|0);
 var $329=$line;
 var $330=(($329+$328)|0);
 HEAP8[($330)]=0;
 var $331=$count;
 var $332=((($331)-(1))|0);
 $count=$332;
 var $333=$x;
 var $334=((($333)+(1))|0);
 $x=$334;
 var $335=$x;
 var $336=((($335)*(3))&-1);
 var $337=$line;
 var $338=(($337+$336)|0);
 HEAP8[($338)]=0;
 var $339=$x;
 var $340=((($339)*(3))&-1);
 var $341=((($340)+(1))|0);
 var $342=$line;
 var $343=(($342+$341)|0);
 HEAP8[($343)]=0;
 var $344=$x;
 var $345=((($344)*(3))&-1);
 var $346=((($345)+(2))|0);
 var $347=$line;
 var $348=(($347+$346)|0);
 HEAP8[($348)]=0;
 var $349=$count;
 var $350=((($349)-(1))|0);
 $count=$350;
 var $351=$x;
 var $352=((($351)+(1))|0);
 $x=$352;
 var $353=$x;
 var $354=((($353)*(3))&-1);
 var $355=$line;
 var $356=(($355+$354)|0);
 HEAP8[($356)]=0;
 var $357=$x;
 var $358=((($357)*(3))&-1);
 var $359=((($358)+(1))|0);
 var $360=$line;
 var $361=(($360+$359)|0);
 HEAP8[($361)]=0;
 var $362=$x;
 var $363=((($362)*(3))&-1);
 var $364=((($363)+(2))|0);
 var $365=$line;
 var $366=(($365+$364)|0);
 HEAP8[($366)]=0;
 var $367=$count;
 var $368=((($367)-(1))|0);
 $count=$368;
 var $369=$x;
 var $370=((($369)+(1))|0);
 $x=$370;
 var $371=$x;
 var $372=((($371)*(3))&-1);
 var $373=$line;
 var $374=(($373+$372)|0);
 HEAP8[($374)]=0;
 var $375=$x;
 var $376=((($375)*(3))&-1);
 var $377=((($376)+(1))|0);
 var $378=$line;
 var $379=(($378+$377)|0);
 HEAP8[($379)]=0;
 var $380=$x;
 var $381=((($380)*(3))&-1);
 var $382=((($381)+(2))|0);
 var $383=$line;
 var $384=(($383+$382)|0);
 HEAP8[($384)]=0;
 var $385=$count;
 var $386=((($385)-(1))|0);
 $count=$386;
 var $387=$x;
 var $388=((($387)+(1))|0);
 $x=$388;
 var $389=$x;
 var $390=((($389)*(3))&-1);
 var $391=$line;
 var $392=(($391+$390)|0);
 HEAP8[($392)]=0;
 var $393=$x;
 var $394=((($393)*(3))&-1);
 var $395=((($394)+(1))|0);
 var $396=$line;
 var $397=(($396+$395)|0);
 HEAP8[($397)]=0;
 var $398=$x;
 var $399=((($398)*(3))&-1);
 var $400=((($399)+(2))|0);
 var $401=$line;
 var $402=(($401+$400)|0);
 HEAP8[($402)]=0;
 var $403=$count;
 var $404=((($403)-(1))|0);
 $count=$404;
 var $405=$x;
 var $406=((($405)+(1))|0);
 $x=$406;
 var $407=$x;
 var $408=((($407)*(3))&-1);
 var $409=$line;
 var $410=(($409+$408)|0);
 HEAP8[($410)]=0;
 var $411=$x;
 var $412=((($411)*(3))&-1);
 var $413=((($412)+(1))|0);
 var $414=$line;
 var $415=(($414+$413)|0);
 HEAP8[($415)]=0;
 var $416=$x;
 var $417=((($416)*(3))&-1);
 var $418=((($417)+(2))|0);
 var $419=$line;
 var $420=(($419+$418)|0);
 HEAP8[($420)]=0;
 var $421=$count;
 var $422=((($421)-(1))|0);
 $count=$422;
 var $423=$x;
 var $424=((($423)+(1))|0);
 $x=$424;
 label=47;break;
 case 51: 
 label=52;break;
 case 52: 
 var $427=$count;
 var $428=($427|0)>0;
 if($428){label=53;break;}else{var $434=0;label=54;break;}
 case 53: 
 var $430=$x;
 var $431=$3;
 var $432=($430|0)<($431|0);
 var $434=$432;label=54;break;
 case 54: 
 var $434;
 if($434){label=55;break;}else{label=56;break;}
 case 55: 
 var $436=$x;
 var $437=((($436)*(3))&-1);
 var $438=$line;
 var $439=(($438+$437)|0);
 HEAP8[($439)]=0;
 var $440=$x;
 var $441=((($440)*(3))&-1);
 var $442=((($441)+(1))|0);
 var $443=$line;
 var $444=(($443+$442)|0);
 HEAP8[($444)]=0;
 var $445=$x;
 var $446=((($445)*(3))&-1);
 var $447=((($446)+(2))|0);
 var $448=$line;
 var $449=(($448+$447)|0);
 HEAP8[($449)]=0;
 var $450=$count;
 var $451=((($450)-(1))|0);
 $count=$451;
 var $452=$x;
 var $453=((($452)+(1))|0);
 $x=$453;
 label=52;break;
 case 56: 
 label=68;break;
 case 57: 
 label=58;break;
 case 58: 
 var $457=$count;
 var $458=$457&-8;
 var $459=($458|0)!=0;
 if($459){label=59;break;}else{var $466=0;label=60;break;}
 case 59: 
 var $461=$x;
 var $462=((($461)+(8))|0);
 var $463=$3;
 var $464=($462|0)<($463|0);
 var $466=$464;label=60;break;
 case 60: 
 var $466;
 if($466){label=61;break;}else{label=62;break;}
 case 61: 
 var $468=$x;
 var $469=((($468)*(3))&-1);
 var $470=$prevline;
 var $471=(($470+$469)|0);
 var $472=HEAP8[($471)];
 var $473=$x;
 var $474=((($473)*(3))&-1);
 var $475=$line;
 var $476=(($475+$474)|0);
 HEAP8[($476)]=$472;
 var $477=$x;
 var $478=((($477)*(3))&-1);
 var $479=((($478)+(1))|0);
 var $480=$prevline;
 var $481=(($480+$479)|0);
 var $482=HEAP8[($481)];
 var $483=$x;
 var $484=((($483)*(3))&-1);
 var $485=((($484)+(1))|0);
 var $486=$line;
 var $487=(($486+$485)|0);
 HEAP8[($487)]=$482;
 var $488=$x;
 var $489=((($488)*(3))&-1);
 var $490=((($489)+(2))|0);
 var $491=$prevline;
 var $492=(($491+$490)|0);
 var $493=HEAP8[($492)];
 var $494=$x;
 var $495=((($494)*(3))&-1);
 var $496=((($495)+(2))|0);
 var $497=$line;
 var $498=(($497+$496)|0);
 HEAP8[($498)]=$493;
 var $499=$count;
 var $500=((($499)-(1))|0);
 $count=$500;
 var $501=$x;
 var $502=((($501)+(1))|0);
 $x=$502;
 var $503=$x;
 var $504=((($503)*(3))&-1);
 var $505=$prevline;
 var $506=(($505+$504)|0);
 var $507=HEAP8[($506)];
 var $508=$x;
 var $509=((($508)*(3))&-1);
 var $510=$line;
 var $511=(($510+$509)|0);
 HEAP8[($511)]=$507;
 var $512=$x;
 var $513=((($512)*(3))&-1);
 var $514=((($513)+(1))|0);
 var $515=$prevline;
 var $516=(($515+$514)|0);
 var $517=HEAP8[($516)];
 var $518=$x;
 var $519=((($518)*(3))&-1);
 var $520=((($519)+(1))|0);
 var $521=$line;
 var $522=(($521+$520)|0);
 HEAP8[($522)]=$517;
 var $523=$x;
 var $524=((($523)*(3))&-1);
 var $525=((($524)+(2))|0);
 var $526=$prevline;
 var $527=(($526+$525)|0);
 var $528=HEAP8[($527)];
 var $529=$x;
 var $530=((($529)*(3))&-1);
 var $531=((($530)+(2))|0);
 var $532=$line;
 var $533=(($532+$531)|0);
 HEAP8[($533)]=$528;
 var $534=$count;
 var $535=((($534)-(1))|0);
 $count=$535;
 var $536=$x;
 var $537=((($536)+(1))|0);
 $x=$537;
 var $538=$x;
 var $539=((($538)*(3))&-1);
 var $540=$prevline;
 var $541=(($540+$539)|0);
 var $542=HEAP8[($541)];
 var $543=$x;
 var $544=((($543)*(3))&-1);
 var $545=$line;
 var $546=(($545+$544)|0);
 HEAP8[($546)]=$542;
 var $547=$x;
 var $548=((($547)*(3))&-1);
 var $549=((($548)+(1))|0);
 var $550=$prevline;
 var $551=(($550+$549)|0);
 var $552=HEAP8[($551)];
 var $553=$x;
 var $554=((($553)*(3))&-1);
 var $555=((($554)+(1))|0);
 var $556=$line;
 var $557=(($556+$555)|0);
 HEAP8[($557)]=$552;
 var $558=$x;
 var $559=((($558)*(3))&-1);
 var $560=((($559)+(2))|0);
 var $561=$prevline;
 var $562=(($561+$560)|0);
 var $563=HEAP8[($562)];
 var $564=$x;
 var $565=((($564)*(3))&-1);
 var $566=((($565)+(2))|0);
 var $567=$line;
 var $568=(($567+$566)|0);
 HEAP8[($568)]=$563;
 var $569=$count;
 var $570=((($569)-(1))|0);
 $count=$570;
 var $571=$x;
 var $572=((($571)+(1))|0);
 $x=$572;
 var $573=$x;
 var $574=((($573)*(3))&-1);
 var $575=$prevline;
 var $576=(($575+$574)|0);
 var $577=HEAP8[($576)];
 var $578=$x;
 var $579=((($578)*(3))&-1);
 var $580=$line;
 var $581=(($580+$579)|0);
 HEAP8[($581)]=$577;
 var $582=$x;
 var $583=((($582)*(3))&-1);
 var $584=((($583)+(1))|0);
 var $585=$prevline;
 var $586=(($585+$584)|0);
 var $587=HEAP8[($586)];
 var $588=$x;
 var $589=((($588)*(3))&-1);
 var $590=((($589)+(1))|0);
 var $591=$line;
 var $592=(($591+$590)|0);
 HEAP8[($592)]=$587;
 var $593=$x;
 var $594=((($593)*(3))&-1);
 var $595=((($594)+(2))|0);
 var $596=$prevline;
 var $597=(($596+$595)|0);
 var $598=HEAP8[($597)];
 var $599=$x;
 var $600=((($599)*(3))&-1);
 var $601=((($600)+(2))|0);
 var $602=$line;
 var $603=(($602+$601)|0);
 HEAP8[($603)]=$598;
 var $604=$count;
 var $605=((($604)-(1))|0);
 $count=$605;
 var $606=$x;
 var $607=((($606)+(1))|0);
 $x=$607;
 var $608=$x;
 var $609=((($608)*(3))&-1);
 var $610=$prevline;
 var $611=(($610+$609)|0);
 var $612=HEAP8[($611)];
 var $613=$x;
 var $614=((($613)*(3))&-1);
 var $615=$line;
 var $616=(($615+$614)|0);
 HEAP8[($616)]=$612;
 var $617=$x;
 var $618=((($617)*(3))&-1);
 var $619=((($618)+(1))|0);
 var $620=$prevline;
 var $621=(($620+$619)|0);
 var $622=HEAP8[($621)];
 var $623=$x;
 var $624=((($623)*(3))&-1);
 var $625=((($624)+(1))|0);
 var $626=$line;
 var $627=(($626+$625)|0);
 HEAP8[($627)]=$622;
 var $628=$x;
 var $629=((($628)*(3))&-1);
 var $630=((($629)+(2))|0);
 var $631=$prevline;
 var $632=(($631+$630)|0);
 var $633=HEAP8[($632)];
 var $634=$x;
 var $635=((($634)*(3))&-1);
 var $636=((($635)+(2))|0);
 var $637=$line;
 var $638=(($637+$636)|0);
 HEAP8[($638)]=$633;
 var $639=$count;
 var $640=((($639)-(1))|0);
 $count=$640;
 var $641=$x;
 var $642=((($641)+(1))|0);
 $x=$642;
 var $643=$x;
 var $644=((($643)*(3))&-1);
 var $645=$prevline;
 var $646=(($645+$644)|0);
 var $647=HEAP8[($646)];
 var $648=$x;
 var $649=((($648)*(3))&-1);
 var $650=$line;
 var $651=(($650+$649)|0);
 HEAP8[($651)]=$647;
 var $652=$x;
 var $653=((($652)*(3))&-1);
 var $654=((($653)+(1))|0);
 var $655=$prevline;
 var $656=(($655+$654)|0);
 var $657=HEAP8[($656)];
 var $658=$x;
 var $659=((($658)*(3))&-1);
 var $660=((($659)+(1))|0);
 var $661=$line;
 var $662=(($661+$660)|0);
 HEAP8[($662)]=$657;
 var $663=$x;
 var $664=((($663)*(3))&-1);
 var $665=((($664)+(2))|0);
 var $666=$prevline;
 var $667=(($666+$665)|0);
 var $668=HEAP8[($667)];
 var $669=$x;
 var $670=((($669)*(3))&-1);
 var $671=((($670)+(2))|0);
 var $672=$line;
 var $673=(($672+$671)|0);
 HEAP8[($673)]=$668;
 var $674=$count;
 var $675=((($674)-(1))|0);
 $count=$675;
 var $676=$x;
 var $677=((($676)+(1))|0);
 $x=$677;
 var $678=$x;
 var $679=((($678)*(3))&-1);
 var $680=$prevline;
 var $681=(($680+$679)|0);
 var $682=HEAP8[($681)];
 var $683=$x;
 var $684=((($683)*(3))&-1);
 var $685=$line;
 var $686=(($685+$684)|0);
 HEAP8[($686)]=$682;
 var $687=$x;
 var $688=((($687)*(3))&-1);
 var $689=((($688)+(1))|0);
 var $690=$prevline;
 var $691=(($690+$689)|0);
 var $692=HEAP8[($691)];
 var $693=$x;
 var $694=((($693)*(3))&-1);
 var $695=((($694)+(1))|0);
 var $696=$line;
 var $697=(($696+$695)|0);
 HEAP8[($697)]=$692;
 var $698=$x;
 var $699=((($698)*(3))&-1);
 var $700=((($699)+(2))|0);
 var $701=$prevline;
 var $702=(($701+$700)|0);
 var $703=HEAP8[($702)];
 var $704=$x;
 var $705=((($704)*(3))&-1);
 var $706=((($705)+(2))|0);
 var $707=$line;
 var $708=(($707+$706)|0);
 HEAP8[($708)]=$703;
 var $709=$count;
 var $710=((($709)-(1))|0);
 $count=$710;
 var $711=$x;
 var $712=((($711)+(1))|0);
 $x=$712;
 var $713=$x;
 var $714=((($713)*(3))&-1);
 var $715=$prevline;
 var $716=(($715+$714)|0);
 var $717=HEAP8[($716)];
 var $718=$x;
 var $719=((($718)*(3))&-1);
 var $720=$line;
 var $721=(($720+$719)|0);
 HEAP8[($721)]=$717;
 var $722=$x;
 var $723=((($722)*(3))&-1);
 var $724=((($723)+(1))|0);
 var $725=$prevline;
 var $726=(($725+$724)|0);
 var $727=HEAP8[($726)];
 var $728=$x;
 var $729=((($728)*(3))&-1);
 var $730=((($729)+(1))|0);
 var $731=$line;
 var $732=(($731+$730)|0);
 HEAP8[($732)]=$727;
 var $733=$x;
 var $734=((($733)*(3))&-1);
 var $735=((($734)+(2))|0);
 var $736=$prevline;
 var $737=(($736+$735)|0);
 var $738=HEAP8[($737)];
 var $739=$x;
 var $740=((($739)*(3))&-1);
 var $741=((($740)+(2))|0);
 var $742=$line;
 var $743=(($742+$741)|0);
 HEAP8[($743)]=$738;
 var $744=$count;
 var $745=((($744)-(1))|0);
 $count=$745;
 var $746=$x;
 var $747=((($746)+(1))|0);
 $x=$747;
 label=58;break;
 case 62: 
 label=63;break;
 case 63: 
 var $750=$count;
 var $751=($750|0)>0;
 if($751){label=64;break;}else{var $757=0;label=65;break;}
 case 64: 
 var $753=$x;
 var $754=$3;
 var $755=($753|0)<($754|0);
 var $757=$755;label=65;break;
 case 65: 
 var $757;
 if($757){label=66;break;}else{label=67;break;}
 case 66: 
 var $759=$x;
 var $760=((($759)*(3))&-1);
 var $761=$prevline;
 var $762=(($761+$760)|0);
 var $763=HEAP8[($762)];
 var $764=$x;
 var $765=((($764)*(3))&-1);
 var $766=$line;
 var $767=(($766+$765)|0);
 HEAP8[($767)]=$763;
 var $768=$x;
 var $769=((($768)*(3))&-1);
 var $770=((($769)+(1))|0);
 var $771=$prevline;
 var $772=(($771+$770)|0);
 var $773=HEAP8[($772)];
 var $774=$x;
 var $775=((($774)*(3))&-1);
 var $776=((($775)+(1))|0);
 var $777=$line;
 var $778=(($777+$776)|0);
 HEAP8[($778)]=$773;
 var $779=$x;
 var $780=((($779)*(3))&-1);
 var $781=((($780)+(2))|0);
 var $782=$prevline;
 var $783=(($782+$781)|0);
 var $784=HEAP8[($783)];
 var $785=$x;
 var $786=((($785)*(3))&-1);
 var $787=((($786)+(2))|0);
 var $788=$line;
 var $789=(($788+$787)|0);
 HEAP8[($789)]=$784;
 var $790=$count;
 var $791=((($790)-(1))|0);
 $count=$791;
 var $792=$x;
 var $793=((($792)+(1))|0);
 $x=$793;
 label=63;break;
 case 67: 
 label=68;break;
 case 68: 
 label=344;break;
 case 69: 
 var $797=$prevline;
 var $798=($797|0)==0;
 if($798){label=70;break;}else{label=81;break;}
 case 70: 
 label=71;break;
 case 71: 
 var $801=$count;
 var $802=$801&-8;
 var $803=($802|0)!=0;
 if($803){label=72;break;}else{var $810=0;label=73;break;}
 case 72: 
 var $805=$x;
 var $806=((($805)+(8))|0);
 var $807=$3;
 var $808=($806|0)<($807|0);
 var $810=$808;label=73;break;
 case 73: 
 var $810;
 if($810){label=74;break;}else{label=75;break;}
 case 74: 
 var $812=(($mix)|0);
 var $813=HEAP8[($812)];
 var $814=$x;
 var $815=((($814)*(3))&-1);
 var $816=$line;
 var $817=(($816+$815)|0);
 HEAP8[($817)]=$813;
 var $818=(($mix+1)|0);
 var $819=HEAP8[($818)];
 var $820=$x;
 var $821=((($820)*(3))&-1);
 var $822=((($821)+(1))|0);
 var $823=$line;
 var $824=(($823+$822)|0);
 HEAP8[($824)]=$819;
 var $825=(($mix+2)|0);
 var $826=HEAP8[($825)];
 var $827=$x;
 var $828=((($827)*(3))&-1);
 var $829=((($828)+(2))|0);
 var $830=$line;
 var $831=(($830+$829)|0);
 HEAP8[($831)]=$826;
 var $832=$count;
 var $833=((($832)-(1))|0);
 $count=$833;
 var $834=$x;
 var $835=((($834)+(1))|0);
 $x=$835;
 var $836=(($mix)|0);
 var $837=HEAP8[($836)];
 var $838=$x;
 var $839=((($838)*(3))&-1);
 var $840=$line;
 var $841=(($840+$839)|0);
 HEAP8[($841)]=$837;
 var $842=(($mix+1)|0);
 var $843=HEAP8[($842)];
 var $844=$x;
 var $845=((($844)*(3))&-1);
 var $846=((($845)+(1))|0);
 var $847=$line;
 var $848=(($847+$846)|0);
 HEAP8[($848)]=$843;
 var $849=(($mix+2)|0);
 var $850=HEAP8[($849)];
 var $851=$x;
 var $852=((($851)*(3))&-1);
 var $853=((($852)+(2))|0);
 var $854=$line;
 var $855=(($854+$853)|0);
 HEAP8[($855)]=$850;
 var $856=$count;
 var $857=((($856)-(1))|0);
 $count=$857;
 var $858=$x;
 var $859=((($858)+(1))|0);
 $x=$859;
 var $860=(($mix)|0);
 var $861=HEAP8[($860)];
 var $862=$x;
 var $863=((($862)*(3))&-1);
 var $864=$line;
 var $865=(($864+$863)|0);
 HEAP8[($865)]=$861;
 var $866=(($mix+1)|0);
 var $867=HEAP8[($866)];
 var $868=$x;
 var $869=((($868)*(3))&-1);
 var $870=((($869)+(1))|0);
 var $871=$line;
 var $872=(($871+$870)|0);
 HEAP8[($872)]=$867;
 var $873=(($mix+2)|0);
 var $874=HEAP8[($873)];
 var $875=$x;
 var $876=((($875)*(3))&-1);
 var $877=((($876)+(2))|0);
 var $878=$line;
 var $879=(($878+$877)|0);
 HEAP8[($879)]=$874;
 var $880=$count;
 var $881=((($880)-(1))|0);
 $count=$881;
 var $882=$x;
 var $883=((($882)+(1))|0);
 $x=$883;
 var $884=(($mix)|0);
 var $885=HEAP8[($884)];
 var $886=$x;
 var $887=((($886)*(3))&-1);
 var $888=$line;
 var $889=(($888+$887)|0);
 HEAP8[($889)]=$885;
 var $890=(($mix+1)|0);
 var $891=HEAP8[($890)];
 var $892=$x;
 var $893=((($892)*(3))&-1);
 var $894=((($893)+(1))|0);
 var $895=$line;
 var $896=(($895+$894)|0);
 HEAP8[($896)]=$891;
 var $897=(($mix+2)|0);
 var $898=HEAP8[($897)];
 var $899=$x;
 var $900=((($899)*(3))&-1);
 var $901=((($900)+(2))|0);
 var $902=$line;
 var $903=(($902+$901)|0);
 HEAP8[($903)]=$898;
 var $904=$count;
 var $905=((($904)-(1))|0);
 $count=$905;
 var $906=$x;
 var $907=((($906)+(1))|0);
 $x=$907;
 var $908=(($mix)|0);
 var $909=HEAP8[($908)];
 var $910=$x;
 var $911=((($910)*(3))&-1);
 var $912=$line;
 var $913=(($912+$911)|0);
 HEAP8[($913)]=$909;
 var $914=(($mix+1)|0);
 var $915=HEAP8[($914)];
 var $916=$x;
 var $917=((($916)*(3))&-1);
 var $918=((($917)+(1))|0);
 var $919=$line;
 var $920=(($919+$918)|0);
 HEAP8[($920)]=$915;
 var $921=(($mix+2)|0);
 var $922=HEAP8[($921)];
 var $923=$x;
 var $924=((($923)*(3))&-1);
 var $925=((($924)+(2))|0);
 var $926=$line;
 var $927=(($926+$925)|0);
 HEAP8[($927)]=$922;
 var $928=$count;
 var $929=((($928)-(1))|0);
 $count=$929;
 var $930=$x;
 var $931=((($930)+(1))|0);
 $x=$931;
 var $932=(($mix)|0);
 var $933=HEAP8[($932)];
 var $934=$x;
 var $935=((($934)*(3))&-1);
 var $936=$line;
 var $937=(($936+$935)|0);
 HEAP8[($937)]=$933;
 var $938=(($mix+1)|0);
 var $939=HEAP8[($938)];
 var $940=$x;
 var $941=((($940)*(3))&-1);
 var $942=((($941)+(1))|0);
 var $943=$line;
 var $944=(($943+$942)|0);
 HEAP8[($944)]=$939;
 var $945=(($mix+2)|0);
 var $946=HEAP8[($945)];
 var $947=$x;
 var $948=((($947)*(3))&-1);
 var $949=((($948)+(2))|0);
 var $950=$line;
 var $951=(($950+$949)|0);
 HEAP8[($951)]=$946;
 var $952=$count;
 var $953=((($952)-(1))|0);
 $count=$953;
 var $954=$x;
 var $955=((($954)+(1))|0);
 $x=$955;
 var $956=(($mix)|0);
 var $957=HEAP8[($956)];
 var $958=$x;
 var $959=((($958)*(3))&-1);
 var $960=$line;
 var $961=(($960+$959)|0);
 HEAP8[($961)]=$957;
 var $962=(($mix+1)|0);
 var $963=HEAP8[($962)];
 var $964=$x;
 var $965=((($964)*(3))&-1);
 var $966=((($965)+(1))|0);
 var $967=$line;
 var $968=(($967+$966)|0);
 HEAP8[($968)]=$963;
 var $969=(($mix+2)|0);
 var $970=HEAP8[($969)];
 var $971=$x;
 var $972=((($971)*(3))&-1);
 var $973=((($972)+(2))|0);
 var $974=$line;
 var $975=(($974+$973)|0);
 HEAP8[($975)]=$970;
 var $976=$count;
 var $977=((($976)-(1))|0);
 $count=$977;
 var $978=$x;
 var $979=((($978)+(1))|0);
 $x=$979;
 var $980=(($mix)|0);
 var $981=HEAP8[($980)];
 var $982=$x;
 var $983=((($982)*(3))&-1);
 var $984=$line;
 var $985=(($984+$983)|0);
 HEAP8[($985)]=$981;
 var $986=(($mix+1)|0);
 var $987=HEAP8[($986)];
 var $988=$x;
 var $989=((($988)*(3))&-1);
 var $990=((($989)+(1))|0);
 var $991=$line;
 var $992=(($991+$990)|0);
 HEAP8[($992)]=$987;
 var $993=(($mix+2)|0);
 var $994=HEAP8[($993)];
 var $995=$x;
 var $996=((($995)*(3))&-1);
 var $997=((($996)+(2))|0);
 var $998=$line;
 var $999=(($998+$997)|0);
 HEAP8[($999)]=$994;
 var $1000=$count;
 var $1001=((($1000)-(1))|0);
 $count=$1001;
 var $1002=$x;
 var $1003=((($1002)+(1))|0);
 $x=$1003;
 label=71;break;
 case 75: 
 label=76;break;
 case 76: 
 var $1006=$count;
 var $1007=($1006|0)>0;
 if($1007){label=77;break;}else{var $1013=0;label=78;break;}
 case 77: 
 var $1009=$x;
 var $1010=$3;
 var $1011=($1009|0)<($1010|0);
 var $1013=$1011;label=78;break;
 case 78: 
 var $1013;
 if($1013){label=79;break;}else{label=80;break;}
 case 79: 
 var $1015=(($mix)|0);
 var $1016=HEAP8[($1015)];
 var $1017=$x;
 var $1018=((($1017)*(3))&-1);
 var $1019=$line;
 var $1020=(($1019+$1018)|0);
 HEAP8[($1020)]=$1016;
 var $1021=(($mix+1)|0);
 var $1022=HEAP8[($1021)];
 var $1023=$x;
 var $1024=((($1023)*(3))&-1);
 var $1025=((($1024)+(1))|0);
 var $1026=$line;
 var $1027=(($1026+$1025)|0);
 HEAP8[($1027)]=$1022;
 var $1028=(($mix+2)|0);
 var $1029=HEAP8[($1028)];
 var $1030=$x;
 var $1031=((($1030)*(3))&-1);
 var $1032=((($1031)+(2))|0);
 var $1033=$line;
 var $1034=(($1033+$1032)|0);
 HEAP8[($1034)]=$1029;
 var $1035=$count;
 var $1036=((($1035)-(1))|0);
 $count=$1036;
 var $1037=$x;
 var $1038=((($1037)+(1))|0);
 $x=$1038;
 label=76;break;
 case 80: 
 label=92;break;
 case 81: 
 label=82;break;
 case 82: 
 var $1042=$count;
 var $1043=$1042&-8;
 var $1044=($1043|0)!=0;
 if($1044){label=83;break;}else{var $1051=0;label=84;break;}
 case 83: 
 var $1046=$x;
 var $1047=((($1046)+(8))|0);
 var $1048=$3;
 var $1049=($1047|0)<($1048|0);
 var $1051=$1049;label=84;break;
 case 84: 
 var $1051;
 if($1051){label=85;break;}else{label=86;break;}
 case 85: 
 var $1053=$x;
 var $1054=((($1053)*(3))&-1);
 var $1055=$prevline;
 var $1056=(($1055+$1054)|0);
 var $1057=HEAP8[($1056)];
 var $1058=($1057&255);
 var $1059=(($mix)|0);
 var $1060=HEAP8[($1059)];
 var $1061=($1060&255);
 var $1062=$1058^$1061;
 var $1063=(($1062)&255);
 var $1064=$x;
 var $1065=((($1064)*(3))&-1);
 var $1066=$line;
 var $1067=(($1066+$1065)|0);
 HEAP8[($1067)]=$1063;
 var $1068=$x;
 var $1069=((($1068)*(3))&-1);
 var $1070=((($1069)+(1))|0);
 var $1071=$prevline;
 var $1072=(($1071+$1070)|0);
 var $1073=HEAP8[($1072)];
 var $1074=($1073&255);
 var $1075=(($mix+1)|0);
 var $1076=HEAP8[($1075)];
 var $1077=($1076&255);
 var $1078=$1074^$1077;
 var $1079=(($1078)&255);
 var $1080=$x;
 var $1081=((($1080)*(3))&-1);
 var $1082=((($1081)+(1))|0);
 var $1083=$line;
 var $1084=(($1083+$1082)|0);
 HEAP8[($1084)]=$1079;
 var $1085=$x;
 var $1086=((($1085)*(3))&-1);
 var $1087=((($1086)+(2))|0);
 var $1088=$prevline;
 var $1089=(($1088+$1087)|0);
 var $1090=HEAP8[($1089)];
 var $1091=($1090&255);
 var $1092=(($mix+2)|0);
 var $1093=HEAP8[($1092)];
 var $1094=($1093&255);
 var $1095=$1091^$1094;
 var $1096=(($1095)&255);
 var $1097=$x;
 var $1098=((($1097)*(3))&-1);
 var $1099=((($1098)+(2))|0);
 var $1100=$line;
 var $1101=(($1100+$1099)|0);
 HEAP8[($1101)]=$1096;
 var $1102=$count;
 var $1103=((($1102)-(1))|0);
 $count=$1103;
 var $1104=$x;
 var $1105=((($1104)+(1))|0);
 $x=$1105;
 var $1106=$x;
 var $1107=((($1106)*(3))&-1);
 var $1108=$prevline;
 var $1109=(($1108+$1107)|0);
 var $1110=HEAP8[($1109)];
 var $1111=($1110&255);
 var $1112=(($mix)|0);
 var $1113=HEAP8[($1112)];
 var $1114=($1113&255);
 var $1115=$1111^$1114;
 var $1116=(($1115)&255);
 var $1117=$x;
 var $1118=((($1117)*(3))&-1);
 var $1119=$line;
 var $1120=(($1119+$1118)|0);
 HEAP8[($1120)]=$1116;
 var $1121=$x;
 var $1122=((($1121)*(3))&-1);
 var $1123=((($1122)+(1))|0);
 var $1124=$prevline;
 var $1125=(($1124+$1123)|0);
 var $1126=HEAP8[($1125)];
 var $1127=($1126&255);
 var $1128=(($mix+1)|0);
 var $1129=HEAP8[($1128)];
 var $1130=($1129&255);
 var $1131=$1127^$1130;
 var $1132=(($1131)&255);
 var $1133=$x;
 var $1134=((($1133)*(3))&-1);
 var $1135=((($1134)+(1))|0);
 var $1136=$line;
 var $1137=(($1136+$1135)|0);
 HEAP8[($1137)]=$1132;
 var $1138=$x;
 var $1139=((($1138)*(3))&-1);
 var $1140=((($1139)+(2))|0);
 var $1141=$prevline;
 var $1142=(($1141+$1140)|0);
 var $1143=HEAP8[($1142)];
 var $1144=($1143&255);
 var $1145=(($mix+2)|0);
 var $1146=HEAP8[($1145)];
 var $1147=($1146&255);
 var $1148=$1144^$1147;
 var $1149=(($1148)&255);
 var $1150=$x;
 var $1151=((($1150)*(3))&-1);
 var $1152=((($1151)+(2))|0);
 var $1153=$line;
 var $1154=(($1153+$1152)|0);
 HEAP8[($1154)]=$1149;
 var $1155=$count;
 var $1156=((($1155)-(1))|0);
 $count=$1156;
 var $1157=$x;
 var $1158=((($1157)+(1))|0);
 $x=$1158;
 var $1159=$x;
 var $1160=((($1159)*(3))&-1);
 var $1161=$prevline;
 var $1162=(($1161+$1160)|0);
 var $1163=HEAP8[($1162)];
 var $1164=($1163&255);
 var $1165=(($mix)|0);
 var $1166=HEAP8[($1165)];
 var $1167=($1166&255);
 var $1168=$1164^$1167;
 var $1169=(($1168)&255);
 var $1170=$x;
 var $1171=((($1170)*(3))&-1);
 var $1172=$line;
 var $1173=(($1172+$1171)|0);
 HEAP8[($1173)]=$1169;
 var $1174=$x;
 var $1175=((($1174)*(3))&-1);
 var $1176=((($1175)+(1))|0);
 var $1177=$prevline;
 var $1178=(($1177+$1176)|0);
 var $1179=HEAP8[($1178)];
 var $1180=($1179&255);
 var $1181=(($mix+1)|0);
 var $1182=HEAP8[($1181)];
 var $1183=($1182&255);
 var $1184=$1180^$1183;
 var $1185=(($1184)&255);
 var $1186=$x;
 var $1187=((($1186)*(3))&-1);
 var $1188=((($1187)+(1))|0);
 var $1189=$line;
 var $1190=(($1189+$1188)|0);
 HEAP8[($1190)]=$1185;
 var $1191=$x;
 var $1192=((($1191)*(3))&-1);
 var $1193=((($1192)+(2))|0);
 var $1194=$prevline;
 var $1195=(($1194+$1193)|0);
 var $1196=HEAP8[($1195)];
 var $1197=($1196&255);
 var $1198=(($mix+2)|0);
 var $1199=HEAP8[($1198)];
 var $1200=($1199&255);
 var $1201=$1197^$1200;
 var $1202=(($1201)&255);
 var $1203=$x;
 var $1204=((($1203)*(3))&-1);
 var $1205=((($1204)+(2))|0);
 var $1206=$line;
 var $1207=(($1206+$1205)|0);
 HEAP8[($1207)]=$1202;
 var $1208=$count;
 var $1209=((($1208)-(1))|0);
 $count=$1209;
 var $1210=$x;
 var $1211=((($1210)+(1))|0);
 $x=$1211;
 var $1212=$x;
 var $1213=((($1212)*(3))&-1);
 var $1214=$prevline;
 var $1215=(($1214+$1213)|0);
 var $1216=HEAP8[($1215)];
 var $1217=($1216&255);
 var $1218=(($mix)|0);
 var $1219=HEAP8[($1218)];
 var $1220=($1219&255);
 var $1221=$1217^$1220;
 var $1222=(($1221)&255);
 var $1223=$x;
 var $1224=((($1223)*(3))&-1);
 var $1225=$line;
 var $1226=(($1225+$1224)|0);
 HEAP8[($1226)]=$1222;
 var $1227=$x;
 var $1228=((($1227)*(3))&-1);
 var $1229=((($1228)+(1))|0);
 var $1230=$prevline;
 var $1231=(($1230+$1229)|0);
 var $1232=HEAP8[($1231)];
 var $1233=($1232&255);
 var $1234=(($mix+1)|0);
 var $1235=HEAP8[($1234)];
 var $1236=($1235&255);
 var $1237=$1233^$1236;
 var $1238=(($1237)&255);
 var $1239=$x;
 var $1240=((($1239)*(3))&-1);
 var $1241=((($1240)+(1))|0);
 var $1242=$line;
 var $1243=(($1242+$1241)|0);
 HEAP8[($1243)]=$1238;
 var $1244=$x;
 var $1245=((($1244)*(3))&-1);
 var $1246=((($1245)+(2))|0);
 var $1247=$prevline;
 var $1248=(($1247+$1246)|0);
 var $1249=HEAP8[($1248)];
 var $1250=($1249&255);
 var $1251=(($mix+2)|0);
 var $1252=HEAP8[($1251)];
 var $1253=($1252&255);
 var $1254=$1250^$1253;
 var $1255=(($1254)&255);
 var $1256=$x;
 var $1257=((($1256)*(3))&-1);
 var $1258=((($1257)+(2))|0);
 var $1259=$line;
 var $1260=(($1259+$1258)|0);
 HEAP8[($1260)]=$1255;
 var $1261=$count;
 var $1262=((($1261)-(1))|0);
 $count=$1262;
 var $1263=$x;
 var $1264=((($1263)+(1))|0);
 $x=$1264;
 var $1265=$x;
 var $1266=((($1265)*(3))&-1);
 var $1267=$prevline;
 var $1268=(($1267+$1266)|0);
 var $1269=HEAP8[($1268)];
 var $1270=($1269&255);
 var $1271=(($mix)|0);
 var $1272=HEAP8[($1271)];
 var $1273=($1272&255);
 var $1274=$1270^$1273;
 var $1275=(($1274)&255);
 var $1276=$x;
 var $1277=((($1276)*(3))&-1);
 var $1278=$line;
 var $1279=(($1278+$1277)|0);
 HEAP8[($1279)]=$1275;
 var $1280=$x;
 var $1281=((($1280)*(3))&-1);
 var $1282=((($1281)+(1))|0);
 var $1283=$prevline;
 var $1284=(($1283+$1282)|0);
 var $1285=HEAP8[($1284)];
 var $1286=($1285&255);
 var $1287=(($mix+1)|0);
 var $1288=HEAP8[($1287)];
 var $1289=($1288&255);
 var $1290=$1286^$1289;
 var $1291=(($1290)&255);
 var $1292=$x;
 var $1293=((($1292)*(3))&-1);
 var $1294=((($1293)+(1))|0);
 var $1295=$line;
 var $1296=(($1295+$1294)|0);
 HEAP8[($1296)]=$1291;
 var $1297=$x;
 var $1298=((($1297)*(3))&-1);
 var $1299=((($1298)+(2))|0);
 var $1300=$prevline;
 var $1301=(($1300+$1299)|0);
 var $1302=HEAP8[($1301)];
 var $1303=($1302&255);
 var $1304=(($mix+2)|0);
 var $1305=HEAP8[($1304)];
 var $1306=($1305&255);
 var $1307=$1303^$1306;
 var $1308=(($1307)&255);
 var $1309=$x;
 var $1310=((($1309)*(3))&-1);
 var $1311=((($1310)+(2))|0);
 var $1312=$line;
 var $1313=(($1312+$1311)|0);
 HEAP8[($1313)]=$1308;
 var $1314=$count;
 var $1315=((($1314)-(1))|0);
 $count=$1315;
 var $1316=$x;
 var $1317=((($1316)+(1))|0);
 $x=$1317;
 var $1318=$x;
 var $1319=((($1318)*(3))&-1);
 var $1320=$prevline;
 var $1321=(($1320+$1319)|0);
 var $1322=HEAP8[($1321)];
 var $1323=($1322&255);
 var $1324=(($mix)|0);
 var $1325=HEAP8[($1324)];
 var $1326=($1325&255);
 var $1327=$1323^$1326;
 var $1328=(($1327)&255);
 var $1329=$x;
 var $1330=((($1329)*(3))&-1);
 var $1331=$line;
 var $1332=(($1331+$1330)|0);
 HEAP8[($1332)]=$1328;
 var $1333=$x;
 var $1334=((($1333)*(3))&-1);
 var $1335=((($1334)+(1))|0);
 var $1336=$prevline;
 var $1337=(($1336+$1335)|0);
 var $1338=HEAP8[($1337)];
 var $1339=($1338&255);
 var $1340=(($mix+1)|0);
 var $1341=HEAP8[($1340)];
 var $1342=($1341&255);
 var $1343=$1339^$1342;
 var $1344=(($1343)&255);
 var $1345=$x;
 var $1346=((($1345)*(3))&-1);
 var $1347=((($1346)+(1))|0);
 var $1348=$line;
 var $1349=(($1348+$1347)|0);
 HEAP8[($1349)]=$1344;
 var $1350=$x;
 var $1351=((($1350)*(3))&-1);
 var $1352=((($1351)+(2))|0);
 var $1353=$prevline;
 var $1354=(($1353+$1352)|0);
 var $1355=HEAP8[($1354)];
 var $1356=($1355&255);
 var $1357=(($mix+2)|0);
 var $1358=HEAP8[($1357)];
 var $1359=($1358&255);
 var $1360=$1356^$1359;
 var $1361=(($1360)&255);
 var $1362=$x;
 var $1363=((($1362)*(3))&-1);
 var $1364=((($1363)+(2))|0);
 var $1365=$line;
 var $1366=(($1365+$1364)|0);
 HEAP8[($1366)]=$1361;
 var $1367=$count;
 var $1368=((($1367)-(1))|0);
 $count=$1368;
 var $1369=$x;
 var $1370=((($1369)+(1))|0);
 $x=$1370;
 var $1371=$x;
 var $1372=((($1371)*(3))&-1);
 var $1373=$prevline;
 var $1374=(($1373+$1372)|0);
 var $1375=HEAP8[($1374)];
 var $1376=($1375&255);
 var $1377=(($mix)|0);
 var $1378=HEAP8[($1377)];
 var $1379=($1378&255);
 var $1380=$1376^$1379;
 var $1381=(($1380)&255);
 var $1382=$x;
 var $1383=((($1382)*(3))&-1);
 var $1384=$line;
 var $1385=(($1384+$1383)|0);
 HEAP8[($1385)]=$1381;
 var $1386=$x;
 var $1387=((($1386)*(3))&-1);
 var $1388=((($1387)+(1))|0);
 var $1389=$prevline;
 var $1390=(($1389+$1388)|0);
 var $1391=HEAP8[($1390)];
 var $1392=($1391&255);
 var $1393=(($mix+1)|0);
 var $1394=HEAP8[($1393)];
 var $1395=($1394&255);
 var $1396=$1392^$1395;
 var $1397=(($1396)&255);
 var $1398=$x;
 var $1399=((($1398)*(3))&-1);
 var $1400=((($1399)+(1))|0);
 var $1401=$line;
 var $1402=(($1401+$1400)|0);
 HEAP8[($1402)]=$1397;
 var $1403=$x;
 var $1404=((($1403)*(3))&-1);
 var $1405=((($1404)+(2))|0);
 var $1406=$prevline;
 var $1407=(($1406+$1405)|0);
 var $1408=HEAP8[($1407)];
 var $1409=($1408&255);
 var $1410=(($mix+2)|0);
 var $1411=HEAP8[($1410)];
 var $1412=($1411&255);
 var $1413=$1409^$1412;
 var $1414=(($1413)&255);
 var $1415=$x;
 var $1416=((($1415)*(3))&-1);
 var $1417=((($1416)+(2))|0);
 var $1418=$line;
 var $1419=(($1418+$1417)|0);
 HEAP8[($1419)]=$1414;
 var $1420=$count;
 var $1421=((($1420)-(1))|0);
 $count=$1421;
 var $1422=$x;
 var $1423=((($1422)+(1))|0);
 $x=$1423;
 var $1424=$x;
 var $1425=((($1424)*(3))&-1);
 var $1426=$prevline;
 var $1427=(($1426+$1425)|0);
 var $1428=HEAP8[($1427)];
 var $1429=($1428&255);
 var $1430=(($mix)|0);
 var $1431=HEAP8[($1430)];
 var $1432=($1431&255);
 var $1433=$1429^$1432;
 var $1434=(($1433)&255);
 var $1435=$x;
 var $1436=((($1435)*(3))&-1);
 var $1437=$line;
 var $1438=(($1437+$1436)|0);
 HEAP8[($1438)]=$1434;
 var $1439=$x;
 var $1440=((($1439)*(3))&-1);
 var $1441=((($1440)+(1))|0);
 var $1442=$prevline;
 var $1443=(($1442+$1441)|0);
 var $1444=HEAP8[($1443)];
 var $1445=($1444&255);
 var $1446=(($mix+1)|0);
 var $1447=HEAP8[($1446)];
 var $1448=($1447&255);
 var $1449=$1445^$1448;
 var $1450=(($1449)&255);
 var $1451=$x;
 var $1452=((($1451)*(3))&-1);
 var $1453=((($1452)+(1))|0);
 var $1454=$line;
 var $1455=(($1454+$1453)|0);
 HEAP8[($1455)]=$1450;
 var $1456=$x;
 var $1457=((($1456)*(3))&-1);
 var $1458=((($1457)+(2))|0);
 var $1459=$prevline;
 var $1460=(($1459+$1458)|0);
 var $1461=HEAP8[($1460)];
 var $1462=($1461&255);
 var $1463=(($mix+2)|0);
 var $1464=HEAP8[($1463)];
 var $1465=($1464&255);
 var $1466=$1462^$1465;
 var $1467=(($1466)&255);
 var $1468=$x;
 var $1469=((($1468)*(3))&-1);
 var $1470=((($1469)+(2))|0);
 var $1471=$line;
 var $1472=(($1471+$1470)|0);
 HEAP8[($1472)]=$1467;
 var $1473=$count;
 var $1474=((($1473)-(1))|0);
 $count=$1474;
 var $1475=$x;
 var $1476=((($1475)+(1))|0);
 $x=$1476;
 label=82;break;
 case 86: 
 label=87;break;
 case 87: 
 var $1479=$count;
 var $1480=($1479|0)>0;
 if($1480){label=88;break;}else{var $1486=0;label=89;break;}
 case 88: 
 var $1482=$x;
 var $1483=$3;
 var $1484=($1482|0)<($1483|0);
 var $1486=$1484;label=89;break;
 case 89: 
 var $1486;
 if($1486){label=90;break;}else{label=91;break;}
 case 90: 
 var $1488=$x;
 var $1489=((($1488)*(3))&-1);
 var $1490=$prevline;
 var $1491=(($1490+$1489)|0);
 var $1492=HEAP8[($1491)];
 var $1493=($1492&255);
 var $1494=(($mix)|0);
 var $1495=HEAP8[($1494)];
 var $1496=($1495&255);
 var $1497=$1493^$1496;
 var $1498=(($1497)&255);
 var $1499=$x;
 var $1500=((($1499)*(3))&-1);
 var $1501=$line;
 var $1502=(($1501+$1500)|0);
 HEAP8[($1502)]=$1498;
 var $1503=$x;
 var $1504=((($1503)*(3))&-1);
 var $1505=((($1504)+(1))|0);
 var $1506=$prevline;
 var $1507=(($1506+$1505)|0);
 var $1508=HEAP8[($1507)];
 var $1509=($1508&255);
 var $1510=(($mix+1)|0);
 var $1511=HEAP8[($1510)];
 var $1512=($1511&255);
 var $1513=$1509^$1512;
 var $1514=(($1513)&255);
 var $1515=$x;
 var $1516=((($1515)*(3))&-1);
 var $1517=((($1516)+(1))|0);
 var $1518=$line;
 var $1519=(($1518+$1517)|0);
 HEAP8[($1519)]=$1514;
 var $1520=$x;
 var $1521=((($1520)*(3))&-1);
 var $1522=((($1521)+(2))|0);
 var $1523=$prevline;
 var $1524=(($1523+$1522)|0);
 var $1525=HEAP8[($1524)];
 var $1526=($1525&255);
 var $1527=(($mix+2)|0);
 var $1528=HEAP8[($1527)];
 var $1529=($1528&255);
 var $1530=$1526^$1529;
 var $1531=(($1530)&255);
 var $1532=$x;
 var $1533=((($1532)*(3))&-1);
 var $1534=((($1533)+(2))|0);
 var $1535=$line;
 var $1536=(($1535+$1534)|0);
 HEAP8[($1536)]=$1531;
 var $1537=$count;
 var $1538=((($1537)-(1))|0);
 $count=$1538;
 var $1539=$x;
 var $1540=((($1539)+(1))|0);
 $x=$1540;
 label=87;break;
 case 91: 
 label=92;break;
 case 92: 
 label=344;break;
 case 93: 
 var $1544=$prevline;
 var $1545=($1544|0)==0;
 if($1545){label=94;break;}else{label=177;break;}
 case 94: 
 label=95;break;
 case 95: 
 var $1548=$count;
 var $1549=$1548&-8;
 var $1550=($1549|0)!=0;
 if($1550){label=96;break;}else{var $1557=0;label=97;break;}
 case 96: 
 var $1552=$x;
 var $1553=((($1552)+(8))|0);
 var $1554=$3;
 var $1555=($1553|0)<($1554|0);
 var $1557=$1555;label=97;break;
 case 97: 
 var $1557;
 if($1557){label=98;break;}else{label=163;break;}
 case 98: 
 var $1559=$mixmask;
 var $1560=($1559&255);
 var $1561=$1560<<1;
 var $1562=(($1561)&255);
 $mixmask=$1562;
 var $1563=$mixmask;
 var $1564=($1563&255);
 var $1565=($1564|0)==0;
 if($1565){label=99;break;}else{label=103;break;}
 case 99: 
 var $1567=$fom_mask;
 var $1568=($1567|0)!=0;
 if($1568){label=100;break;}else{label=101;break;}
 case 100: 
 var $1570=$fom_mask;
 var $1577=$1570;label=102;break;
 case 101: 
 var $1572=$5;
 var $1573=(($1572+1)|0);
 $5=$1573;
 var $1574=HEAP8[($1572)];
 var $1575=($1574&255);
 var $1577=$1575;label=102;break;
 case 102: 
 var $1577;
 var $1578=(($1577)&255);
 $mask=$1578;
 $mixmask=1;
 label=103;break;
 case 103: 
 var $1580=$mask;
 var $1581=($1580&255);
 var $1582=$mixmask;
 var $1583=($1582&255);
 var $1584=$1581&$1583;
 var $1585=($1584|0)!=0;
 if($1585){label=104;break;}else{label=105;break;}
 case 104: 
 var $1587=(($mix)|0);
 var $1588=HEAP8[($1587)];
 var $1589=$x;
 var $1590=((($1589)*(3))&-1);
 var $1591=$line;
 var $1592=(($1591+$1590)|0);
 HEAP8[($1592)]=$1588;
 var $1593=(($mix+1)|0);
 var $1594=HEAP8[($1593)];
 var $1595=$x;
 var $1596=((($1595)*(3))&-1);
 var $1597=((($1596)+(1))|0);
 var $1598=$line;
 var $1599=(($1598+$1597)|0);
 HEAP8[($1599)]=$1594;
 var $1600=(($mix+2)|0);
 var $1601=HEAP8[($1600)];
 var $1602=$x;
 var $1603=((($1602)*(3))&-1);
 var $1604=((($1603)+(2))|0);
 var $1605=$line;
 var $1606=(($1605+$1604)|0);
 HEAP8[($1606)]=$1601;
 label=106;break;
 case 105: 
 var $1608=$x;
 var $1609=((($1608)*(3))&-1);
 var $1610=$line;
 var $1611=(($1610+$1609)|0);
 HEAP8[($1611)]=0;
 var $1612=$x;
 var $1613=((($1612)*(3))&-1);
 var $1614=((($1613)+(1))|0);
 var $1615=$line;
 var $1616=(($1615+$1614)|0);
 HEAP8[($1616)]=0;
 var $1617=$x;
 var $1618=((($1617)*(3))&-1);
 var $1619=((($1618)+(2))|0);
 var $1620=$line;
 var $1621=(($1620+$1619)|0);
 HEAP8[($1621)]=0;
 label=106;break;
 case 106: 
 var $1623=$count;
 var $1624=((($1623)-(1))|0);
 $count=$1624;
 var $1625=$x;
 var $1626=((($1625)+(1))|0);
 $x=$1626;
 var $1627=$mixmask;
 var $1628=($1627&255);
 var $1629=$1628<<1;
 var $1630=(($1629)&255);
 $mixmask=$1630;
 var $1631=$mixmask;
 var $1632=($1631&255);
 var $1633=($1632|0)==0;
 if($1633){label=107;break;}else{label=111;break;}
 case 107: 
 var $1635=$fom_mask;
 var $1636=($1635|0)!=0;
 if($1636){label=108;break;}else{label=109;break;}
 case 108: 
 var $1638=$fom_mask;
 var $1645=$1638;label=110;break;
 case 109: 
 var $1640=$5;
 var $1641=(($1640+1)|0);
 $5=$1641;
 var $1642=HEAP8[($1640)];
 var $1643=($1642&255);
 var $1645=$1643;label=110;break;
 case 110: 
 var $1645;
 var $1646=(($1645)&255);
 $mask=$1646;
 $mixmask=1;
 label=111;break;
 case 111: 
 var $1648=$mask;
 var $1649=($1648&255);
 var $1650=$mixmask;
 var $1651=($1650&255);
 var $1652=$1649&$1651;
 var $1653=($1652|0)!=0;
 if($1653){label=112;break;}else{label=113;break;}
 case 112: 
 var $1655=(($mix)|0);
 var $1656=HEAP8[($1655)];
 var $1657=$x;
 var $1658=((($1657)*(3))&-1);
 var $1659=$line;
 var $1660=(($1659+$1658)|0);
 HEAP8[($1660)]=$1656;
 var $1661=(($mix+1)|0);
 var $1662=HEAP8[($1661)];
 var $1663=$x;
 var $1664=((($1663)*(3))&-1);
 var $1665=((($1664)+(1))|0);
 var $1666=$line;
 var $1667=(($1666+$1665)|0);
 HEAP8[($1667)]=$1662;
 var $1668=(($mix+2)|0);
 var $1669=HEAP8[($1668)];
 var $1670=$x;
 var $1671=((($1670)*(3))&-1);
 var $1672=((($1671)+(2))|0);
 var $1673=$line;
 var $1674=(($1673+$1672)|0);
 HEAP8[($1674)]=$1669;
 label=114;break;
 case 113: 
 var $1676=$x;
 var $1677=((($1676)*(3))&-1);
 var $1678=$line;
 var $1679=(($1678+$1677)|0);
 HEAP8[($1679)]=0;
 var $1680=$x;
 var $1681=((($1680)*(3))&-1);
 var $1682=((($1681)+(1))|0);
 var $1683=$line;
 var $1684=(($1683+$1682)|0);
 HEAP8[($1684)]=0;
 var $1685=$x;
 var $1686=((($1685)*(3))&-1);
 var $1687=((($1686)+(2))|0);
 var $1688=$line;
 var $1689=(($1688+$1687)|0);
 HEAP8[($1689)]=0;
 label=114;break;
 case 114: 
 var $1691=$count;
 var $1692=((($1691)-(1))|0);
 $count=$1692;
 var $1693=$x;
 var $1694=((($1693)+(1))|0);
 $x=$1694;
 var $1695=$mixmask;
 var $1696=($1695&255);
 var $1697=$1696<<1;
 var $1698=(($1697)&255);
 $mixmask=$1698;
 var $1699=$mixmask;
 var $1700=($1699&255);
 var $1701=($1700|0)==0;
 if($1701){label=115;break;}else{label=119;break;}
 case 115: 
 var $1703=$fom_mask;
 var $1704=($1703|0)!=0;
 if($1704){label=116;break;}else{label=117;break;}
 case 116: 
 var $1706=$fom_mask;
 var $1713=$1706;label=118;break;
 case 117: 
 var $1708=$5;
 var $1709=(($1708+1)|0);
 $5=$1709;
 var $1710=HEAP8[($1708)];
 var $1711=($1710&255);
 var $1713=$1711;label=118;break;
 case 118: 
 var $1713;
 var $1714=(($1713)&255);
 $mask=$1714;
 $mixmask=1;
 label=119;break;
 case 119: 
 var $1716=$mask;
 var $1717=($1716&255);
 var $1718=$mixmask;
 var $1719=($1718&255);
 var $1720=$1717&$1719;
 var $1721=($1720|0)!=0;
 if($1721){label=120;break;}else{label=121;break;}
 case 120: 
 var $1723=(($mix)|0);
 var $1724=HEAP8[($1723)];
 var $1725=$x;
 var $1726=((($1725)*(3))&-1);
 var $1727=$line;
 var $1728=(($1727+$1726)|0);
 HEAP8[($1728)]=$1724;
 var $1729=(($mix+1)|0);
 var $1730=HEAP8[($1729)];
 var $1731=$x;
 var $1732=((($1731)*(3))&-1);
 var $1733=((($1732)+(1))|0);
 var $1734=$line;
 var $1735=(($1734+$1733)|0);
 HEAP8[($1735)]=$1730;
 var $1736=(($mix+2)|0);
 var $1737=HEAP8[($1736)];
 var $1738=$x;
 var $1739=((($1738)*(3))&-1);
 var $1740=((($1739)+(2))|0);
 var $1741=$line;
 var $1742=(($1741+$1740)|0);
 HEAP8[($1742)]=$1737;
 label=122;break;
 case 121: 
 var $1744=$x;
 var $1745=((($1744)*(3))&-1);
 var $1746=$line;
 var $1747=(($1746+$1745)|0);
 HEAP8[($1747)]=0;
 var $1748=$x;
 var $1749=((($1748)*(3))&-1);
 var $1750=((($1749)+(1))|0);
 var $1751=$line;
 var $1752=(($1751+$1750)|0);
 HEAP8[($1752)]=0;
 var $1753=$x;
 var $1754=((($1753)*(3))&-1);
 var $1755=((($1754)+(2))|0);
 var $1756=$line;
 var $1757=(($1756+$1755)|0);
 HEAP8[($1757)]=0;
 label=122;break;
 case 122: 
 var $1759=$count;
 var $1760=((($1759)-(1))|0);
 $count=$1760;
 var $1761=$x;
 var $1762=((($1761)+(1))|0);
 $x=$1762;
 var $1763=$mixmask;
 var $1764=($1763&255);
 var $1765=$1764<<1;
 var $1766=(($1765)&255);
 $mixmask=$1766;
 var $1767=$mixmask;
 var $1768=($1767&255);
 var $1769=($1768|0)==0;
 if($1769){label=123;break;}else{label=127;break;}
 case 123: 
 var $1771=$fom_mask;
 var $1772=($1771|0)!=0;
 if($1772){label=124;break;}else{label=125;break;}
 case 124: 
 var $1774=$fom_mask;
 var $1781=$1774;label=126;break;
 case 125: 
 var $1776=$5;
 var $1777=(($1776+1)|0);
 $5=$1777;
 var $1778=HEAP8[($1776)];
 var $1779=($1778&255);
 var $1781=$1779;label=126;break;
 case 126: 
 var $1781;
 var $1782=(($1781)&255);
 $mask=$1782;
 $mixmask=1;
 label=127;break;
 case 127: 
 var $1784=$mask;
 var $1785=($1784&255);
 var $1786=$mixmask;
 var $1787=($1786&255);
 var $1788=$1785&$1787;
 var $1789=($1788|0)!=0;
 if($1789){label=128;break;}else{label=129;break;}
 case 128: 
 var $1791=(($mix)|0);
 var $1792=HEAP8[($1791)];
 var $1793=$x;
 var $1794=((($1793)*(3))&-1);
 var $1795=$line;
 var $1796=(($1795+$1794)|0);
 HEAP8[($1796)]=$1792;
 var $1797=(($mix+1)|0);
 var $1798=HEAP8[($1797)];
 var $1799=$x;
 var $1800=((($1799)*(3))&-1);
 var $1801=((($1800)+(1))|0);
 var $1802=$line;
 var $1803=(($1802+$1801)|0);
 HEAP8[($1803)]=$1798;
 var $1804=(($mix+2)|0);
 var $1805=HEAP8[($1804)];
 var $1806=$x;
 var $1807=((($1806)*(3))&-1);
 var $1808=((($1807)+(2))|0);
 var $1809=$line;
 var $1810=(($1809+$1808)|0);
 HEAP8[($1810)]=$1805;
 label=130;break;
 case 129: 
 var $1812=$x;
 var $1813=((($1812)*(3))&-1);
 var $1814=$line;
 var $1815=(($1814+$1813)|0);
 HEAP8[($1815)]=0;
 var $1816=$x;
 var $1817=((($1816)*(3))&-1);
 var $1818=((($1817)+(1))|0);
 var $1819=$line;
 var $1820=(($1819+$1818)|0);
 HEAP8[($1820)]=0;
 var $1821=$x;
 var $1822=((($1821)*(3))&-1);
 var $1823=((($1822)+(2))|0);
 var $1824=$line;
 var $1825=(($1824+$1823)|0);
 HEAP8[($1825)]=0;
 label=130;break;
 case 130: 
 var $1827=$count;
 var $1828=((($1827)-(1))|0);
 $count=$1828;
 var $1829=$x;
 var $1830=((($1829)+(1))|0);
 $x=$1830;
 var $1831=$mixmask;
 var $1832=($1831&255);
 var $1833=$1832<<1;
 var $1834=(($1833)&255);
 $mixmask=$1834;
 var $1835=$mixmask;
 var $1836=($1835&255);
 var $1837=($1836|0)==0;
 if($1837){label=131;break;}else{label=135;break;}
 case 131: 
 var $1839=$fom_mask;
 var $1840=($1839|0)!=0;
 if($1840){label=132;break;}else{label=133;break;}
 case 132: 
 var $1842=$fom_mask;
 var $1849=$1842;label=134;break;
 case 133: 
 var $1844=$5;
 var $1845=(($1844+1)|0);
 $5=$1845;
 var $1846=HEAP8[($1844)];
 var $1847=($1846&255);
 var $1849=$1847;label=134;break;
 case 134: 
 var $1849;
 var $1850=(($1849)&255);
 $mask=$1850;
 $mixmask=1;
 label=135;break;
 case 135: 
 var $1852=$mask;
 var $1853=($1852&255);
 var $1854=$mixmask;
 var $1855=($1854&255);
 var $1856=$1853&$1855;
 var $1857=($1856|0)!=0;
 if($1857){label=136;break;}else{label=137;break;}
 case 136: 
 var $1859=(($mix)|0);
 var $1860=HEAP8[($1859)];
 var $1861=$x;
 var $1862=((($1861)*(3))&-1);
 var $1863=$line;
 var $1864=(($1863+$1862)|0);
 HEAP8[($1864)]=$1860;
 var $1865=(($mix+1)|0);
 var $1866=HEAP8[($1865)];
 var $1867=$x;
 var $1868=((($1867)*(3))&-1);
 var $1869=((($1868)+(1))|0);
 var $1870=$line;
 var $1871=(($1870+$1869)|0);
 HEAP8[($1871)]=$1866;
 var $1872=(($mix+2)|0);
 var $1873=HEAP8[($1872)];
 var $1874=$x;
 var $1875=((($1874)*(3))&-1);
 var $1876=((($1875)+(2))|0);
 var $1877=$line;
 var $1878=(($1877+$1876)|0);
 HEAP8[($1878)]=$1873;
 label=138;break;
 case 137: 
 var $1880=$x;
 var $1881=((($1880)*(3))&-1);
 var $1882=$line;
 var $1883=(($1882+$1881)|0);
 HEAP8[($1883)]=0;
 var $1884=$x;
 var $1885=((($1884)*(3))&-1);
 var $1886=((($1885)+(1))|0);
 var $1887=$line;
 var $1888=(($1887+$1886)|0);
 HEAP8[($1888)]=0;
 var $1889=$x;
 var $1890=((($1889)*(3))&-1);
 var $1891=((($1890)+(2))|0);
 var $1892=$line;
 var $1893=(($1892+$1891)|0);
 HEAP8[($1893)]=0;
 label=138;break;
 case 138: 
 var $1895=$count;
 var $1896=((($1895)-(1))|0);
 $count=$1896;
 var $1897=$x;
 var $1898=((($1897)+(1))|0);
 $x=$1898;
 var $1899=$mixmask;
 var $1900=($1899&255);
 var $1901=$1900<<1;
 var $1902=(($1901)&255);
 $mixmask=$1902;
 var $1903=$mixmask;
 var $1904=($1903&255);
 var $1905=($1904|0)==0;
 if($1905){label=139;break;}else{label=143;break;}
 case 139: 
 var $1907=$fom_mask;
 var $1908=($1907|0)!=0;
 if($1908){label=140;break;}else{label=141;break;}
 case 140: 
 var $1910=$fom_mask;
 var $1917=$1910;label=142;break;
 case 141: 
 var $1912=$5;
 var $1913=(($1912+1)|0);
 $5=$1913;
 var $1914=HEAP8[($1912)];
 var $1915=($1914&255);
 var $1917=$1915;label=142;break;
 case 142: 
 var $1917;
 var $1918=(($1917)&255);
 $mask=$1918;
 $mixmask=1;
 label=143;break;
 case 143: 
 var $1920=$mask;
 var $1921=($1920&255);
 var $1922=$mixmask;
 var $1923=($1922&255);
 var $1924=$1921&$1923;
 var $1925=($1924|0)!=0;
 if($1925){label=144;break;}else{label=145;break;}
 case 144: 
 var $1927=(($mix)|0);
 var $1928=HEAP8[($1927)];
 var $1929=$x;
 var $1930=((($1929)*(3))&-1);
 var $1931=$line;
 var $1932=(($1931+$1930)|0);
 HEAP8[($1932)]=$1928;
 var $1933=(($mix+1)|0);
 var $1934=HEAP8[($1933)];
 var $1935=$x;
 var $1936=((($1935)*(3))&-1);
 var $1937=((($1936)+(1))|0);
 var $1938=$line;
 var $1939=(($1938+$1937)|0);
 HEAP8[($1939)]=$1934;
 var $1940=(($mix+2)|0);
 var $1941=HEAP8[($1940)];
 var $1942=$x;
 var $1943=((($1942)*(3))&-1);
 var $1944=((($1943)+(2))|0);
 var $1945=$line;
 var $1946=(($1945+$1944)|0);
 HEAP8[($1946)]=$1941;
 label=146;break;
 case 145: 
 var $1948=$x;
 var $1949=((($1948)*(3))&-1);
 var $1950=$line;
 var $1951=(($1950+$1949)|0);
 HEAP8[($1951)]=0;
 var $1952=$x;
 var $1953=((($1952)*(3))&-1);
 var $1954=((($1953)+(1))|0);
 var $1955=$line;
 var $1956=(($1955+$1954)|0);
 HEAP8[($1956)]=0;
 var $1957=$x;
 var $1958=((($1957)*(3))&-1);
 var $1959=((($1958)+(2))|0);
 var $1960=$line;
 var $1961=(($1960+$1959)|0);
 HEAP8[($1961)]=0;
 label=146;break;
 case 146: 
 var $1963=$count;
 var $1964=((($1963)-(1))|0);
 $count=$1964;
 var $1965=$x;
 var $1966=((($1965)+(1))|0);
 $x=$1966;
 var $1967=$mixmask;
 var $1968=($1967&255);
 var $1969=$1968<<1;
 var $1970=(($1969)&255);
 $mixmask=$1970;
 var $1971=$mixmask;
 var $1972=($1971&255);
 var $1973=($1972|0)==0;
 if($1973){label=147;break;}else{label=151;break;}
 case 147: 
 var $1975=$fom_mask;
 var $1976=($1975|0)!=0;
 if($1976){label=148;break;}else{label=149;break;}
 case 148: 
 var $1978=$fom_mask;
 var $1985=$1978;label=150;break;
 case 149: 
 var $1980=$5;
 var $1981=(($1980+1)|0);
 $5=$1981;
 var $1982=HEAP8[($1980)];
 var $1983=($1982&255);
 var $1985=$1983;label=150;break;
 case 150: 
 var $1985;
 var $1986=(($1985)&255);
 $mask=$1986;
 $mixmask=1;
 label=151;break;
 case 151: 
 var $1988=$mask;
 var $1989=($1988&255);
 var $1990=$mixmask;
 var $1991=($1990&255);
 var $1992=$1989&$1991;
 var $1993=($1992|0)!=0;
 if($1993){label=152;break;}else{label=153;break;}
 case 152: 
 var $1995=(($mix)|0);
 var $1996=HEAP8[($1995)];
 var $1997=$x;
 var $1998=((($1997)*(3))&-1);
 var $1999=$line;
 var $2000=(($1999+$1998)|0);
 HEAP8[($2000)]=$1996;
 var $2001=(($mix+1)|0);
 var $2002=HEAP8[($2001)];
 var $2003=$x;
 var $2004=((($2003)*(3))&-1);
 var $2005=((($2004)+(1))|0);
 var $2006=$line;
 var $2007=(($2006+$2005)|0);
 HEAP8[($2007)]=$2002;
 var $2008=(($mix+2)|0);
 var $2009=HEAP8[($2008)];
 var $2010=$x;
 var $2011=((($2010)*(3))&-1);
 var $2012=((($2011)+(2))|0);
 var $2013=$line;
 var $2014=(($2013+$2012)|0);
 HEAP8[($2014)]=$2009;
 label=154;break;
 case 153: 
 var $2016=$x;
 var $2017=((($2016)*(3))&-1);
 var $2018=$line;
 var $2019=(($2018+$2017)|0);
 HEAP8[($2019)]=0;
 var $2020=$x;
 var $2021=((($2020)*(3))&-1);
 var $2022=((($2021)+(1))|0);
 var $2023=$line;
 var $2024=(($2023+$2022)|0);
 HEAP8[($2024)]=0;
 var $2025=$x;
 var $2026=((($2025)*(3))&-1);
 var $2027=((($2026)+(2))|0);
 var $2028=$line;
 var $2029=(($2028+$2027)|0);
 HEAP8[($2029)]=0;
 label=154;break;
 case 154: 
 var $2031=$count;
 var $2032=((($2031)-(1))|0);
 $count=$2032;
 var $2033=$x;
 var $2034=((($2033)+(1))|0);
 $x=$2034;
 var $2035=$mixmask;
 var $2036=($2035&255);
 var $2037=$2036<<1;
 var $2038=(($2037)&255);
 $mixmask=$2038;
 var $2039=$mixmask;
 var $2040=($2039&255);
 var $2041=($2040|0)==0;
 if($2041){label=155;break;}else{label=159;break;}
 case 155: 
 var $2043=$fom_mask;
 var $2044=($2043|0)!=0;
 if($2044){label=156;break;}else{label=157;break;}
 case 156: 
 var $2046=$fom_mask;
 var $2053=$2046;label=158;break;
 case 157: 
 var $2048=$5;
 var $2049=(($2048+1)|0);
 $5=$2049;
 var $2050=HEAP8[($2048)];
 var $2051=($2050&255);
 var $2053=$2051;label=158;break;
 case 158: 
 var $2053;
 var $2054=(($2053)&255);
 $mask=$2054;
 $mixmask=1;
 label=159;break;
 case 159: 
 var $2056=$mask;
 var $2057=($2056&255);
 var $2058=$mixmask;
 var $2059=($2058&255);
 var $2060=$2057&$2059;
 var $2061=($2060|0)!=0;
 if($2061){label=160;break;}else{label=161;break;}
 case 160: 
 var $2063=(($mix)|0);
 var $2064=HEAP8[($2063)];
 var $2065=$x;
 var $2066=((($2065)*(3))&-1);
 var $2067=$line;
 var $2068=(($2067+$2066)|0);
 HEAP8[($2068)]=$2064;
 var $2069=(($mix+1)|0);
 var $2070=HEAP8[($2069)];
 var $2071=$x;
 var $2072=((($2071)*(3))&-1);
 var $2073=((($2072)+(1))|0);
 var $2074=$line;
 var $2075=(($2074+$2073)|0);
 HEAP8[($2075)]=$2070;
 var $2076=(($mix+2)|0);
 var $2077=HEAP8[($2076)];
 var $2078=$x;
 var $2079=((($2078)*(3))&-1);
 var $2080=((($2079)+(2))|0);
 var $2081=$line;
 var $2082=(($2081+$2080)|0);
 HEAP8[($2082)]=$2077;
 label=162;break;
 case 161: 
 var $2084=$x;
 var $2085=((($2084)*(3))&-1);
 var $2086=$line;
 var $2087=(($2086+$2085)|0);
 HEAP8[($2087)]=0;
 var $2088=$x;
 var $2089=((($2088)*(3))&-1);
 var $2090=((($2089)+(1))|0);
 var $2091=$line;
 var $2092=(($2091+$2090)|0);
 HEAP8[($2092)]=0;
 var $2093=$x;
 var $2094=((($2093)*(3))&-1);
 var $2095=((($2094)+(2))|0);
 var $2096=$line;
 var $2097=(($2096+$2095)|0);
 HEAP8[($2097)]=0;
 label=162;break;
 case 162: 
 var $2099=$count;
 var $2100=((($2099)-(1))|0);
 $count=$2100;
 var $2101=$x;
 var $2102=((($2101)+(1))|0);
 $x=$2102;
 label=95;break;
 case 163: 
 label=164;break;
 case 164: 
 var $2105=$count;
 var $2106=($2105|0)>0;
 if($2106){label=165;break;}else{var $2112=0;label=166;break;}
 case 165: 
 var $2108=$x;
 var $2109=$3;
 var $2110=($2108|0)<($2109|0);
 var $2112=$2110;label=166;break;
 case 166: 
 var $2112;
 if($2112){label=167;break;}else{label=176;break;}
 case 167: 
 var $2114=$mixmask;
 var $2115=($2114&255);
 var $2116=$2115<<1;
 var $2117=(($2116)&255);
 $mixmask=$2117;
 var $2118=$mixmask;
 var $2119=($2118&255);
 var $2120=($2119|0)==0;
 if($2120){label=168;break;}else{label=172;break;}
 case 168: 
 var $2122=$fom_mask;
 var $2123=($2122|0)!=0;
 if($2123){label=169;break;}else{label=170;break;}
 case 169: 
 var $2125=$fom_mask;
 var $2132=$2125;label=171;break;
 case 170: 
 var $2127=$5;
 var $2128=(($2127+1)|0);
 $5=$2128;
 var $2129=HEAP8[($2127)];
 var $2130=($2129&255);
 var $2132=$2130;label=171;break;
 case 171: 
 var $2132;
 var $2133=(($2132)&255);
 $mask=$2133;
 $mixmask=1;
 label=172;break;
 case 172: 
 var $2135=$mask;
 var $2136=($2135&255);
 var $2137=$mixmask;
 var $2138=($2137&255);
 var $2139=$2136&$2138;
 var $2140=($2139|0)!=0;
 if($2140){label=173;break;}else{label=174;break;}
 case 173: 
 var $2142=(($mix)|0);
 var $2143=HEAP8[($2142)];
 var $2144=$x;
 var $2145=((($2144)*(3))&-1);
 var $2146=$line;
 var $2147=(($2146+$2145)|0);
 HEAP8[($2147)]=$2143;
 var $2148=(($mix+1)|0);
 var $2149=HEAP8[($2148)];
 var $2150=$x;
 var $2151=((($2150)*(3))&-1);
 var $2152=((($2151)+(1))|0);
 var $2153=$line;
 var $2154=(($2153+$2152)|0);
 HEAP8[($2154)]=$2149;
 var $2155=(($mix+2)|0);
 var $2156=HEAP8[($2155)];
 var $2157=$x;
 var $2158=((($2157)*(3))&-1);
 var $2159=((($2158)+(2))|0);
 var $2160=$line;
 var $2161=(($2160+$2159)|0);
 HEAP8[($2161)]=$2156;
 label=175;break;
 case 174: 
 var $2163=$x;
 var $2164=((($2163)*(3))&-1);
 var $2165=$line;
 var $2166=(($2165+$2164)|0);
 HEAP8[($2166)]=0;
 var $2167=$x;
 var $2168=((($2167)*(3))&-1);
 var $2169=((($2168)+(1))|0);
 var $2170=$line;
 var $2171=(($2170+$2169)|0);
 HEAP8[($2171)]=0;
 var $2172=$x;
 var $2173=((($2172)*(3))&-1);
 var $2174=((($2173)+(2))|0);
 var $2175=$line;
 var $2176=(($2175+$2174)|0);
 HEAP8[($2176)]=0;
 label=175;break;
 case 175: 
 var $2178=$count;
 var $2179=((($2178)-(1))|0);
 $count=$2179;
 var $2180=$x;
 var $2181=((($2180)+(1))|0);
 $x=$2181;
 label=164;break;
 case 176: 
 label=260;break;
 case 177: 
 label=178;break;
 case 178: 
 var $2185=$count;
 var $2186=$2185&-8;
 var $2187=($2186|0)!=0;
 if($2187){label=179;break;}else{var $2194=0;label=180;break;}
 case 179: 
 var $2189=$x;
 var $2190=((($2189)+(8))|0);
 var $2191=$3;
 var $2192=($2190|0)<($2191|0);
 var $2194=$2192;label=180;break;
 case 180: 
 var $2194;
 if($2194){label=181;break;}else{label=246;break;}
 case 181: 
 var $2196=$mixmask;
 var $2197=($2196&255);
 var $2198=$2197<<1;
 var $2199=(($2198)&255);
 $mixmask=$2199;
 var $2200=$mixmask;
 var $2201=($2200&255);
 var $2202=($2201|0)==0;
 if($2202){label=182;break;}else{label=186;break;}
 case 182: 
 var $2204=$fom_mask;
 var $2205=($2204|0)!=0;
 if($2205){label=183;break;}else{label=184;break;}
 case 183: 
 var $2207=$fom_mask;
 var $2214=$2207;label=185;break;
 case 184: 
 var $2209=$5;
 var $2210=(($2209+1)|0);
 $5=$2210;
 var $2211=HEAP8[($2209)];
 var $2212=($2211&255);
 var $2214=$2212;label=185;break;
 case 185: 
 var $2214;
 var $2215=(($2214)&255);
 $mask=$2215;
 $mixmask=1;
 label=186;break;
 case 186: 
 var $2217=$mask;
 var $2218=($2217&255);
 var $2219=$mixmask;
 var $2220=($2219&255);
 var $2221=$2218&$2220;
 var $2222=($2221|0)!=0;
 if($2222){label=187;break;}else{label=188;break;}
 case 187: 
 var $2224=$x;
 var $2225=((($2224)*(3))&-1);
 var $2226=$prevline;
 var $2227=(($2226+$2225)|0);
 var $2228=HEAP8[($2227)];
 var $2229=($2228&255);
 var $2230=(($mix)|0);
 var $2231=HEAP8[($2230)];
 var $2232=($2231&255);
 var $2233=$2229^$2232;
 var $2234=(($2233)&255);
 var $2235=$x;
 var $2236=((($2235)*(3))&-1);
 var $2237=$line;
 var $2238=(($2237+$2236)|0);
 HEAP8[($2238)]=$2234;
 var $2239=$x;
 var $2240=((($2239)*(3))&-1);
 var $2241=((($2240)+(1))|0);
 var $2242=$prevline;
 var $2243=(($2242+$2241)|0);
 var $2244=HEAP8[($2243)];
 var $2245=($2244&255);
 var $2246=(($mix+1)|0);
 var $2247=HEAP8[($2246)];
 var $2248=($2247&255);
 var $2249=$2245^$2248;
 var $2250=(($2249)&255);
 var $2251=$x;
 var $2252=((($2251)*(3))&-1);
 var $2253=((($2252)+(1))|0);
 var $2254=$line;
 var $2255=(($2254+$2253)|0);
 HEAP8[($2255)]=$2250;
 var $2256=$x;
 var $2257=((($2256)*(3))&-1);
 var $2258=((($2257)+(2))|0);
 var $2259=$prevline;
 var $2260=(($2259+$2258)|0);
 var $2261=HEAP8[($2260)];
 var $2262=($2261&255);
 var $2263=(($mix+2)|0);
 var $2264=HEAP8[($2263)];
 var $2265=($2264&255);
 var $2266=$2262^$2265;
 var $2267=(($2266)&255);
 var $2268=$x;
 var $2269=((($2268)*(3))&-1);
 var $2270=((($2269)+(2))|0);
 var $2271=$line;
 var $2272=(($2271+$2270)|0);
 HEAP8[($2272)]=$2267;
 label=189;break;
 case 188: 
 var $2274=$x;
 var $2275=((($2274)*(3))&-1);
 var $2276=$prevline;
 var $2277=(($2276+$2275)|0);
 var $2278=HEAP8[($2277)];
 var $2279=$x;
 var $2280=((($2279)*(3))&-1);
 var $2281=$line;
 var $2282=(($2281+$2280)|0);
 HEAP8[($2282)]=$2278;
 var $2283=$x;
 var $2284=((($2283)*(3))&-1);
 var $2285=((($2284)+(1))|0);
 var $2286=$prevline;
 var $2287=(($2286+$2285)|0);
 var $2288=HEAP8[($2287)];
 var $2289=$x;
 var $2290=((($2289)*(3))&-1);
 var $2291=((($2290)+(1))|0);
 var $2292=$line;
 var $2293=(($2292+$2291)|0);
 HEAP8[($2293)]=$2288;
 var $2294=$x;
 var $2295=((($2294)*(3))&-1);
 var $2296=((($2295)+(2))|0);
 var $2297=$prevline;
 var $2298=(($2297+$2296)|0);
 var $2299=HEAP8[($2298)];
 var $2300=$x;
 var $2301=((($2300)*(3))&-1);
 var $2302=((($2301)+(2))|0);
 var $2303=$line;
 var $2304=(($2303+$2302)|0);
 HEAP8[($2304)]=$2299;
 label=189;break;
 case 189: 
 var $2306=$count;
 var $2307=((($2306)-(1))|0);
 $count=$2307;
 var $2308=$x;
 var $2309=((($2308)+(1))|0);
 $x=$2309;
 var $2310=$mixmask;
 var $2311=($2310&255);
 var $2312=$2311<<1;
 var $2313=(($2312)&255);
 $mixmask=$2313;
 var $2314=$mixmask;
 var $2315=($2314&255);
 var $2316=($2315|0)==0;
 if($2316){label=190;break;}else{label=194;break;}
 case 190: 
 var $2318=$fom_mask;
 var $2319=($2318|0)!=0;
 if($2319){label=191;break;}else{label=192;break;}
 case 191: 
 var $2321=$fom_mask;
 var $2328=$2321;label=193;break;
 case 192: 
 var $2323=$5;
 var $2324=(($2323+1)|0);
 $5=$2324;
 var $2325=HEAP8[($2323)];
 var $2326=($2325&255);
 var $2328=$2326;label=193;break;
 case 193: 
 var $2328;
 var $2329=(($2328)&255);
 $mask=$2329;
 $mixmask=1;
 label=194;break;
 case 194: 
 var $2331=$mask;
 var $2332=($2331&255);
 var $2333=$mixmask;
 var $2334=($2333&255);
 var $2335=$2332&$2334;
 var $2336=($2335|0)!=0;
 if($2336){label=195;break;}else{label=196;break;}
 case 195: 
 var $2338=$x;
 var $2339=((($2338)*(3))&-1);
 var $2340=$prevline;
 var $2341=(($2340+$2339)|0);
 var $2342=HEAP8[($2341)];
 var $2343=($2342&255);
 var $2344=(($mix)|0);
 var $2345=HEAP8[($2344)];
 var $2346=($2345&255);
 var $2347=$2343^$2346;
 var $2348=(($2347)&255);
 var $2349=$x;
 var $2350=((($2349)*(3))&-1);
 var $2351=$line;
 var $2352=(($2351+$2350)|0);
 HEAP8[($2352)]=$2348;
 var $2353=$x;
 var $2354=((($2353)*(3))&-1);
 var $2355=((($2354)+(1))|0);
 var $2356=$prevline;
 var $2357=(($2356+$2355)|0);
 var $2358=HEAP8[($2357)];
 var $2359=($2358&255);
 var $2360=(($mix+1)|0);
 var $2361=HEAP8[($2360)];
 var $2362=($2361&255);
 var $2363=$2359^$2362;
 var $2364=(($2363)&255);
 var $2365=$x;
 var $2366=((($2365)*(3))&-1);
 var $2367=((($2366)+(1))|0);
 var $2368=$line;
 var $2369=(($2368+$2367)|0);
 HEAP8[($2369)]=$2364;
 var $2370=$x;
 var $2371=((($2370)*(3))&-1);
 var $2372=((($2371)+(2))|0);
 var $2373=$prevline;
 var $2374=(($2373+$2372)|0);
 var $2375=HEAP8[($2374)];
 var $2376=($2375&255);
 var $2377=(($mix+2)|0);
 var $2378=HEAP8[($2377)];
 var $2379=($2378&255);
 var $2380=$2376^$2379;
 var $2381=(($2380)&255);
 var $2382=$x;
 var $2383=((($2382)*(3))&-1);
 var $2384=((($2383)+(2))|0);
 var $2385=$line;
 var $2386=(($2385+$2384)|0);
 HEAP8[($2386)]=$2381;
 label=197;break;
 case 196: 
 var $2388=$x;
 var $2389=((($2388)*(3))&-1);
 var $2390=$prevline;
 var $2391=(($2390+$2389)|0);
 var $2392=HEAP8[($2391)];
 var $2393=$x;
 var $2394=((($2393)*(3))&-1);
 var $2395=$line;
 var $2396=(($2395+$2394)|0);
 HEAP8[($2396)]=$2392;
 var $2397=$x;
 var $2398=((($2397)*(3))&-1);
 var $2399=((($2398)+(1))|0);
 var $2400=$prevline;
 var $2401=(($2400+$2399)|0);
 var $2402=HEAP8[($2401)];
 var $2403=$x;
 var $2404=((($2403)*(3))&-1);
 var $2405=((($2404)+(1))|0);
 var $2406=$line;
 var $2407=(($2406+$2405)|0);
 HEAP8[($2407)]=$2402;
 var $2408=$x;
 var $2409=((($2408)*(3))&-1);
 var $2410=((($2409)+(2))|0);
 var $2411=$prevline;
 var $2412=(($2411+$2410)|0);
 var $2413=HEAP8[($2412)];
 var $2414=$x;
 var $2415=((($2414)*(3))&-1);
 var $2416=((($2415)+(2))|0);
 var $2417=$line;
 var $2418=(($2417+$2416)|0);
 HEAP8[($2418)]=$2413;
 label=197;break;
 case 197: 
 var $2420=$count;
 var $2421=((($2420)-(1))|0);
 $count=$2421;
 var $2422=$x;
 var $2423=((($2422)+(1))|0);
 $x=$2423;
 var $2424=$mixmask;
 var $2425=($2424&255);
 var $2426=$2425<<1;
 var $2427=(($2426)&255);
 $mixmask=$2427;
 var $2428=$mixmask;
 var $2429=($2428&255);
 var $2430=($2429|0)==0;
 if($2430){label=198;break;}else{label=202;break;}
 case 198: 
 var $2432=$fom_mask;
 var $2433=($2432|0)!=0;
 if($2433){label=199;break;}else{label=200;break;}
 case 199: 
 var $2435=$fom_mask;
 var $2442=$2435;label=201;break;
 case 200: 
 var $2437=$5;
 var $2438=(($2437+1)|0);
 $5=$2438;
 var $2439=HEAP8[($2437)];
 var $2440=($2439&255);
 var $2442=$2440;label=201;break;
 case 201: 
 var $2442;
 var $2443=(($2442)&255);
 $mask=$2443;
 $mixmask=1;
 label=202;break;
 case 202: 
 var $2445=$mask;
 var $2446=($2445&255);
 var $2447=$mixmask;
 var $2448=($2447&255);
 var $2449=$2446&$2448;
 var $2450=($2449|0)!=0;
 if($2450){label=203;break;}else{label=204;break;}
 case 203: 
 var $2452=$x;
 var $2453=((($2452)*(3))&-1);
 var $2454=$prevline;
 var $2455=(($2454+$2453)|0);
 var $2456=HEAP8[($2455)];
 var $2457=($2456&255);
 var $2458=(($mix)|0);
 var $2459=HEAP8[($2458)];
 var $2460=($2459&255);
 var $2461=$2457^$2460;
 var $2462=(($2461)&255);
 var $2463=$x;
 var $2464=((($2463)*(3))&-1);
 var $2465=$line;
 var $2466=(($2465+$2464)|0);
 HEAP8[($2466)]=$2462;
 var $2467=$x;
 var $2468=((($2467)*(3))&-1);
 var $2469=((($2468)+(1))|0);
 var $2470=$prevline;
 var $2471=(($2470+$2469)|0);
 var $2472=HEAP8[($2471)];
 var $2473=($2472&255);
 var $2474=(($mix+1)|0);
 var $2475=HEAP8[($2474)];
 var $2476=($2475&255);
 var $2477=$2473^$2476;
 var $2478=(($2477)&255);
 var $2479=$x;
 var $2480=((($2479)*(3))&-1);
 var $2481=((($2480)+(1))|0);
 var $2482=$line;
 var $2483=(($2482+$2481)|0);
 HEAP8[($2483)]=$2478;
 var $2484=$x;
 var $2485=((($2484)*(3))&-1);
 var $2486=((($2485)+(2))|0);
 var $2487=$prevline;
 var $2488=(($2487+$2486)|0);
 var $2489=HEAP8[($2488)];
 var $2490=($2489&255);
 var $2491=(($mix+2)|0);
 var $2492=HEAP8[($2491)];
 var $2493=($2492&255);
 var $2494=$2490^$2493;
 var $2495=(($2494)&255);
 var $2496=$x;
 var $2497=((($2496)*(3))&-1);
 var $2498=((($2497)+(2))|0);
 var $2499=$line;
 var $2500=(($2499+$2498)|0);
 HEAP8[($2500)]=$2495;
 label=205;break;
 case 204: 
 var $2502=$x;
 var $2503=((($2502)*(3))&-1);
 var $2504=$prevline;
 var $2505=(($2504+$2503)|0);
 var $2506=HEAP8[($2505)];
 var $2507=$x;
 var $2508=((($2507)*(3))&-1);
 var $2509=$line;
 var $2510=(($2509+$2508)|0);
 HEAP8[($2510)]=$2506;
 var $2511=$x;
 var $2512=((($2511)*(3))&-1);
 var $2513=((($2512)+(1))|0);
 var $2514=$prevline;
 var $2515=(($2514+$2513)|0);
 var $2516=HEAP8[($2515)];
 var $2517=$x;
 var $2518=((($2517)*(3))&-1);
 var $2519=((($2518)+(1))|0);
 var $2520=$line;
 var $2521=(($2520+$2519)|0);
 HEAP8[($2521)]=$2516;
 var $2522=$x;
 var $2523=((($2522)*(3))&-1);
 var $2524=((($2523)+(2))|0);
 var $2525=$prevline;
 var $2526=(($2525+$2524)|0);
 var $2527=HEAP8[($2526)];
 var $2528=$x;
 var $2529=((($2528)*(3))&-1);
 var $2530=((($2529)+(2))|0);
 var $2531=$line;
 var $2532=(($2531+$2530)|0);
 HEAP8[($2532)]=$2527;
 label=205;break;
 case 205: 
 var $2534=$count;
 var $2535=((($2534)-(1))|0);
 $count=$2535;
 var $2536=$x;
 var $2537=((($2536)+(1))|0);
 $x=$2537;
 var $2538=$mixmask;
 var $2539=($2538&255);
 var $2540=$2539<<1;
 var $2541=(($2540)&255);
 $mixmask=$2541;
 var $2542=$mixmask;
 var $2543=($2542&255);
 var $2544=($2543|0)==0;
 if($2544){label=206;break;}else{label=210;break;}
 case 206: 
 var $2546=$fom_mask;
 var $2547=($2546|0)!=0;
 if($2547){label=207;break;}else{label=208;break;}
 case 207: 
 var $2549=$fom_mask;
 var $2556=$2549;label=209;break;
 case 208: 
 var $2551=$5;
 var $2552=(($2551+1)|0);
 $5=$2552;
 var $2553=HEAP8[($2551)];
 var $2554=($2553&255);
 var $2556=$2554;label=209;break;
 case 209: 
 var $2556;
 var $2557=(($2556)&255);
 $mask=$2557;
 $mixmask=1;
 label=210;break;
 case 210: 
 var $2559=$mask;
 var $2560=($2559&255);
 var $2561=$mixmask;
 var $2562=($2561&255);
 var $2563=$2560&$2562;
 var $2564=($2563|0)!=0;
 if($2564){label=211;break;}else{label=212;break;}
 case 211: 
 var $2566=$x;
 var $2567=((($2566)*(3))&-1);
 var $2568=$prevline;
 var $2569=(($2568+$2567)|0);
 var $2570=HEAP8[($2569)];
 var $2571=($2570&255);
 var $2572=(($mix)|0);
 var $2573=HEAP8[($2572)];
 var $2574=($2573&255);
 var $2575=$2571^$2574;
 var $2576=(($2575)&255);
 var $2577=$x;
 var $2578=((($2577)*(3))&-1);
 var $2579=$line;
 var $2580=(($2579+$2578)|0);
 HEAP8[($2580)]=$2576;
 var $2581=$x;
 var $2582=((($2581)*(3))&-1);
 var $2583=((($2582)+(1))|0);
 var $2584=$prevline;
 var $2585=(($2584+$2583)|0);
 var $2586=HEAP8[($2585)];
 var $2587=($2586&255);
 var $2588=(($mix+1)|0);
 var $2589=HEAP8[($2588)];
 var $2590=($2589&255);
 var $2591=$2587^$2590;
 var $2592=(($2591)&255);
 var $2593=$x;
 var $2594=((($2593)*(3))&-1);
 var $2595=((($2594)+(1))|0);
 var $2596=$line;
 var $2597=(($2596+$2595)|0);
 HEAP8[($2597)]=$2592;
 var $2598=$x;
 var $2599=((($2598)*(3))&-1);
 var $2600=((($2599)+(2))|0);
 var $2601=$prevline;
 var $2602=(($2601+$2600)|0);
 var $2603=HEAP8[($2602)];
 var $2604=($2603&255);
 var $2605=(($mix+2)|0);
 var $2606=HEAP8[($2605)];
 var $2607=($2606&255);
 var $2608=$2604^$2607;
 var $2609=(($2608)&255);
 var $2610=$x;
 var $2611=((($2610)*(3))&-1);
 var $2612=((($2611)+(2))|0);
 var $2613=$line;
 var $2614=(($2613+$2612)|0);
 HEAP8[($2614)]=$2609;
 label=213;break;
 case 212: 
 var $2616=$x;
 var $2617=((($2616)*(3))&-1);
 var $2618=$prevline;
 var $2619=(($2618+$2617)|0);
 var $2620=HEAP8[($2619)];
 var $2621=$x;
 var $2622=((($2621)*(3))&-1);
 var $2623=$line;
 var $2624=(($2623+$2622)|0);
 HEAP8[($2624)]=$2620;
 var $2625=$x;
 var $2626=((($2625)*(3))&-1);
 var $2627=((($2626)+(1))|0);
 var $2628=$prevline;
 var $2629=(($2628+$2627)|0);
 var $2630=HEAP8[($2629)];
 var $2631=$x;
 var $2632=((($2631)*(3))&-1);
 var $2633=((($2632)+(1))|0);
 var $2634=$line;
 var $2635=(($2634+$2633)|0);
 HEAP8[($2635)]=$2630;
 var $2636=$x;
 var $2637=((($2636)*(3))&-1);
 var $2638=((($2637)+(2))|0);
 var $2639=$prevline;
 var $2640=(($2639+$2638)|0);
 var $2641=HEAP8[($2640)];
 var $2642=$x;
 var $2643=((($2642)*(3))&-1);
 var $2644=((($2643)+(2))|0);
 var $2645=$line;
 var $2646=(($2645+$2644)|0);
 HEAP8[($2646)]=$2641;
 label=213;break;
 case 213: 
 var $2648=$count;
 var $2649=((($2648)-(1))|0);
 $count=$2649;
 var $2650=$x;
 var $2651=((($2650)+(1))|0);
 $x=$2651;
 var $2652=$mixmask;
 var $2653=($2652&255);
 var $2654=$2653<<1;
 var $2655=(($2654)&255);
 $mixmask=$2655;
 var $2656=$mixmask;
 var $2657=($2656&255);
 var $2658=($2657|0)==0;
 if($2658){label=214;break;}else{label=218;break;}
 case 214: 
 var $2660=$fom_mask;
 var $2661=($2660|0)!=0;
 if($2661){label=215;break;}else{label=216;break;}
 case 215: 
 var $2663=$fom_mask;
 var $2670=$2663;label=217;break;
 case 216: 
 var $2665=$5;
 var $2666=(($2665+1)|0);
 $5=$2666;
 var $2667=HEAP8[($2665)];
 var $2668=($2667&255);
 var $2670=$2668;label=217;break;
 case 217: 
 var $2670;
 var $2671=(($2670)&255);
 $mask=$2671;
 $mixmask=1;
 label=218;break;
 case 218: 
 var $2673=$mask;
 var $2674=($2673&255);
 var $2675=$mixmask;
 var $2676=($2675&255);
 var $2677=$2674&$2676;
 var $2678=($2677|0)!=0;
 if($2678){label=219;break;}else{label=220;break;}
 case 219: 
 var $2680=$x;
 var $2681=((($2680)*(3))&-1);
 var $2682=$prevline;
 var $2683=(($2682+$2681)|0);
 var $2684=HEAP8[($2683)];
 var $2685=($2684&255);
 var $2686=(($mix)|0);
 var $2687=HEAP8[($2686)];
 var $2688=($2687&255);
 var $2689=$2685^$2688;
 var $2690=(($2689)&255);
 var $2691=$x;
 var $2692=((($2691)*(3))&-1);
 var $2693=$line;
 var $2694=(($2693+$2692)|0);
 HEAP8[($2694)]=$2690;
 var $2695=$x;
 var $2696=((($2695)*(3))&-1);
 var $2697=((($2696)+(1))|0);
 var $2698=$prevline;
 var $2699=(($2698+$2697)|0);
 var $2700=HEAP8[($2699)];
 var $2701=($2700&255);
 var $2702=(($mix+1)|0);
 var $2703=HEAP8[($2702)];
 var $2704=($2703&255);
 var $2705=$2701^$2704;
 var $2706=(($2705)&255);
 var $2707=$x;
 var $2708=((($2707)*(3))&-1);
 var $2709=((($2708)+(1))|0);
 var $2710=$line;
 var $2711=(($2710+$2709)|0);
 HEAP8[($2711)]=$2706;
 var $2712=$x;
 var $2713=((($2712)*(3))&-1);
 var $2714=((($2713)+(2))|0);
 var $2715=$prevline;
 var $2716=(($2715+$2714)|0);
 var $2717=HEAP8[($2716)];
 var $2718=($2717&255);
 var $2719=(($mix+2)|0);
 var $2720=HEAP8[($2719)];
 var $2721=($2720&255);
 var $2722=$2718^$2721;
 var $2723=(($2722)&255);
 var $2724=$x;
 var $2725=((($2724)*(3))&-1);
 var $2726=((($2725)+(2))|0);
 var $2727=$line;
 var $2728=(($2727+$2726)|0);
 HEAP8[($2728)]=$2723;
 label=221;break;
 case 220: 
 var $2730=$x;
 var $2731=((($2730)*(3))&-1);
 var $2732=$prevline;
 var $2733=(($2732+$2731)|0);
 var $2734=HEAP8[($2733)];
 var $2735=$x;
 var $2736=((($2735)*(3))&-1);
 var $2737=$line;
 var $2738=(($2737+$2736)|0);
 HEAP8[($2738)]=$2734;
 var $2739=$x;
 var $2740=((($2739)*(3))&-1);
 var $2741=((($2740)+(1))|0);
 var $2742=$prevline;
 var $2743=(($2742+$2741)|0);
 var $2744=HEAP8[($2743)];
 var $2745=$x;
 var $2746=((($2745)*(3))&-1);
 var $2747=((($2746)+(1))|0);
 var $2748=$line;
 var $2749=(($2748+$2747)|0);
 HEAP8[($2749)]=$2744;
 var $2750=$x;
 var $2751=((($2750)*(3))&-1);
 var $2752=((($2751)+(2))|0);
 var $2753=$prevline;
 var $2754=(($2753+$2752)|0);
 var $2755=HEAP8[($2754)];
 var $2756=$x;
 var $2757=((($2756)*(3))&-1);
 var $2758=((($2757)+(2))|0);
 var $2759=$line;
 var $2760=(($2759+$2758)|0);
 HEAP8[($2760)]=$2755;
 label=221;break;
 case 221: 
 var $2762=$count;
 var $2763=((($2762)-(1))|0);
 $count=$2763;
 var $2764=$x;
 var $2765=((($2764)+(1))|0);
 $x=$2765;
 var $2766=$mixmask;
 var $2767=($2766&255);
 var $2768=$2767<<1;
 var $2769=(($2768)&255);
 $mixmask=$2769;
 var $2770=$mixmask;
 var $2771=($2770&255);
 var $2772=($2771|0)==0;
 if($2772){label=222;break;}else{label=226;break;}
 case 222: 
 var $2774=$fom_mask;
 var $2775=($2774|0)!=0;
 if($2775){label=223;break;}else{label=224;break;}
 case 223: 
 var $2777=$fom_mask;
 var $2784=$2777;label=225;break;
 case 224: 
 var $2779=$5;
 var $2780=(($2779+1)|0);
 $5=$2780;
 var $2781=HEAP8[($2779)];
 var $2782=($2781&255);
 var $2784=$2782;label=225;break;
 case 225: 
 var $2784;
 var $2785=(($2784)&255);
 $mask=$2785;
 $mixmask=1;
 label=226;break;
 case 226: 
 var $2787=$mask;
 var $2788=($2787&255);
 var $2789=$mixmask;
 var $2790=($2789&255);
 var $2791=$2788&$2790;
 var $2792=($2791|0)!=0;
 if($2792){label=227;break;}else{label=228;break;}
 case 227: 
 var $2794=$x;
 var $2795=((($2794)*(3))&-1);
 var $2796=$prevline;
 var $2797=(($2796+$2795)|0);
 var $2798=HEAP8[($2797)];
 var $2799=($2798&255);
 var $2800=(($mix)|0);
 var $2801=HEAP8[($2800)];
 var $2802=($2801&255);
 var $2803=$2799^$2802;
 var $2804=(($2803)&255);
 var $2805=$x;
 var $2806=((($2805)*(3))&-1);
 var $2807=$line;
 var $2808=(($2807+$2806)|0);
 HEAP8[($2808)]=$2804;
 var $2809=$x;
 var $2810=((($2809)*(3))&-1);
 var $2811=((($2810)+(1))|0);
 var $2812=$prevline;
 var $2813=(($2812+$2811)|0);
 var $2814=HEAP8[($2813)];
 var $2815=($2814&255);
 var $2816=(($mix+1)|0);
 var $2817=HEAP8[($2816)];
 var $2818=($2817&255);
 var $2819=$2815^$2818;
 var $2820=(($2819)&255);
 var $2821=$x;
 var $2822=((($2821)*(3))&-1);
 var $2823=((($2822)+(1))|0);
 var $2824=$line;
 var $2825=(($2824+$2823)|0);
 HEAP8[($2825)]=$2820;
 var $2826=$x;
 var $2827=((($2826)*(3))&-1);
 var $2828=((($2827)+(2))|0);
 var $2829=$prevline;
 var $2830=(($2829+$2828)|0);
 var $2831=HEAP8[($2830)];
 var $2832=($2831&255);
 var $2833=(($mix+2)|0);
 var $2834=HEAP8[($2833)];
 var $2835=($2834&255);
 var $2836=$2832^$2835;
 var $2837=(($2836)&255);
 var $2838=$x;
 var $2839=((($2838)*(3))&-1);
 var $2840=((($2839)+(2))|0);
 var $2841=$line;
 var $2842=(($2841+$2840)|0);
 HEAP8[($2842)]=$2837;
 label=229;break;
 case 228: 
 var $2844=$x;
 var $2845=((($2844)*(3))&-1);
 var $2846=$prevline;
 var $2847=(($2846+$2845)|0);
 var $2848=HEAP8[($2847)];
 var $2849=$x;
 var $2850=((($2849)*(3))&-1);
 var $2851=$line;
 var $2852=(($2851+$2850)|0);
 HEAP8[($2852)]=$2848;
 var $2853=$x;
 var $2854=((($2853)*(3))&-1);
 var $2855=((($2854)+(1))|0);
 var $2856=$prevline;
 var $2857=(($2856+$2855)|0);
 var $2858=HEAP8[($2857)];
 var $2859=$x;
 var $2860=((($2859)*(3))&-1);
 var $2861=((($2860)+(1))|0);
 var $2862=$line;
 var $2863=(($2862+$2861)|0);
 HEAP8[($2863)]=$2858;
 var $2864=$x;
 var $2865=((($2864)*(3))&-1);
 var $2866=((($2865)+(2))|0);
 var $2867=$prevline;
 var $2868=(($2867+$2866)|0);
 var $2869=HEAP8[($2868)];
 var $2870=$x;
 var $2871=((($2870)*(3))&-1);
 var $2872=((($2871)+(2))|0);
 var $2873=$line;
 var $2874=(($2873+$2872)|0);
 HEAP8[($2874)]=$2869;
 label=229;break;
 case 229: 
 var $2876=$count;
 var $2877=((($2876)-(1))|0);
 $count=$2877;
 var $2878=$x;
 var $2879=((($2878)+(1))|0);
 $x=$2879;
 var $2880=$mixmask;
 var $2881=($2880&255);
 var $2882=$2881<<1;
 var $2883=(($2882)&255);
 $mixmask=$2883;
 var $2884=$mixmask;
 var $2885=($2884&255);
 var $2886=($2885|0)==0;
 if($2886){label=230;break;}else{label=234;break;}
 case 230: 
 var $2888=$fom_mask;
 var $2889=($2888|0)!=0;
 if($2889){label=231;break;}else{label=232;break;}
 case 231: 
 var $2891=$fom_mask;
 var $2898=$2891;label=233;break;
 case 232: 
 var $2893=$5;
 var $2894=(($2893+1)|0);
 $5=$2894;
 var $2895=HEAP8[($2893)];
 var $2896=($2895&255);
 var $2898=$2896;label=233;break;
 case 233: 
 var $2898;
 var $2899=(($2898)&255);
 $mask=$2899;
 $mixmask=1;
 label=234;break;
 case 234: 
 var $2901=$mask;
 var $2902=($2901&255);
 var $2903=$mixmask;
 var $2904=($2903&255);
 var $2905=$2902&$2904;
 var $2906=($2905|0)!=0;
 if($2906){label=235;break;}else{label=236;break;}
 case 235: 
 var $2908=$x;
 var $2909=((($2908)*(3))&-1);
 var $2910=$prevline;
 var $2911=(($2910+$2909)|0);
 var $2912=HEAP8[($2911)];
 var $2913=($2912&255);
 var $2914=(($mix)|0);
 var $2915=HEAP8[($2914)];
 var $2916=($2915&255);
 var $2917=$2913^$2916;
 var $2918=(($2917)&255);
 var $2919=$x;
 var $2920=((($2919)*(3))&-1);
 var $2921=$line;
 var $2922=(($2921+$2920)|0);
 HEAP8[($2922)]=$2918;
 var $2923=$x;
 var $2924=((($2923)*(3))&-1);
 var $2925=((($2924)+(1))|0);
 var $2926=$prevline;
 var $2927=(($2926+$2925)|0);
 var $2928=HEAP8[($2927)];
 var $2929=($2928&255);
 var $2930=(($mix+1)|0);
 var $2931=HEAP8[($2930)];
 var $2932=($2931&255);
 var $2933=$2929^$2932;
 var $2934=(($2933)&255);
 var $2935=$x;
 var $2936=((($2935)*(3))&-1);
 var $2937=((($2936)+(1))|0);
 var $2938=$line;
 var $2939=(($2938+$2937)|0);
 HEAP8[($2939)]=$2934;
 var $2940=$x;
 var $2941=((($2940)*(3))&-1);
 var $2942=((($2941)+(2))|0);
 var $2943=$prevline;
 var $2944=(($2943+$2942)|0);
 var $2945=HEAP8[($2944)];
 var $2946=($2945&255);
 var $2947=(($mix+2)|0);
 var $2948=HEAP8[($2947)];
 var $2949=($2948&255);
 var $2950=$2946^$2949;
 var $2951=(($2950)&255);
 var $2952=$x;
 var $2953=((($2952)*(3))&-1);
 var $2954=((($2953)+(2))|0);
 var $2955=$line;
 var $2956=(($2955+$2954)|0);
 HEAP8[($2956)]=$2951;
 label=237;break;
 case 236: 
 var $2958=$x;
 var $2959=((($2958)*(3))&-1);
 var $2960=$prevline;
 var $2961=(($2960+$2959)|0);
 var $2962=HEAP8[($2961)];
 var $2963=$x;
 var $2964=((($2963)*(3))&-1);
 var $2965=$line;
 var $2966=(($2965+$2964)|0);
 HEAP8[($2966)]=$2962;
 var $2967=$x;
 var $2968=((($2967)*(3))&-1);
 var $2969=((($2968)+(1))|0);
 var $2970=$prevline;
 var $2971=(($2970+$2969)|0);
 var $2972=HEAP8[($2971)];
 var $2973=$x;
 var $2974=((($2973)*(3))&-1);
 var $2975=((($2974)+(1))|0);
 var $2976=$line;
 var $2977=(($2976+$2975)|0);
 HEAP8[($2977)]=$2972;
 var $2978=$x;
 var $2979=((($2978)*(3))&-1);
 var $2980=((($2979)+(2))|0);
 var $2981=$prevline;
 var $2982=(($2981+$2980)|0);
 var $2983=HEAP8[($2982)];
 var $2984=$x;
 var $2985=((($2984)*(3))&-1);
 var $2986=((($2985)+(2))|0);
 var $2987=$line;
 var $2988=(($2987+$2986)|0);
 HEAP8[($2988)]=$2983;
 label=237;break;
 case 237: 
 var $2990=$count;
 var $2991=((($2990)-(1))|0);
 $count=$2991;
 var $2992=$x;
 var $2993=((($2992)+(1))|0);
 $x=$2993;
 var $2994=$mixmask;
 var $2995=($2994&255);
 var $2996=$2995<<1;
 var $2997=(($2996)&255);
 $mixmask=$2997;
 var $2998=$mixmask;
 var $2999=($2998&255);
 var $3000=($2999|0)==0;
 if($3000){label=238;break;}else{label=242;break;}
 case 238: 
 var $3002=$fom_mask;
 var $3003=($3002|0)!=0;
 if($3003){label=239;break;}else{label=240;break;}
 case 239: 
 var $3005=$fom_mask;
 var $3012=$3005;label=241;break;
 case 240: 
 var $3007=$5;
 var $3008=(($3007+1)|0);
 $5=$3008;
 var $3009=HEAP8[($3007)];
 var $3010=($3009&255);
 var $3012=$3010;label=241;break;
 case 241: 
 var $3012;
 var $3013=(($3012)&255);
 $mask=$3013;
 $mixmask=1;
 label=242;break;
 case 242: 
 var $3015=$mask;
 var $3016=($3015&255);
 var $3017=$mixmask;
 var $3018=($3017&255);
 var $3019=$3016&$3018;
 var $3020=($3019|0)!=0;
 if($3020){label=243;break;}else{label=244;break;}
 case 243: 
 var $3022=$x;
 var $3023=((($3022)*(3))&-1);
 var $3024=$prevline;
 var $3025=(($3024+$3023)|0);
 var $3026=HEAP8[($3025)];
 var $3027=($3026&255);
 var $3028=(($mix)|0);
 var $3029=HEAP8[($3028)];
 var $3030=($3029&255);
 var $3031=$3027^$3030;
 var $3032=(($3031)&255);
 var $3033=$x;
 var $3034=((($3033)*(3))&-1);
 var $3035=$line;
 var $3036=(($3035+$3034)|0);
 HEAP8[($3036)]=$3032;
 var $3037=$x;
 var $3038=((($3037)*(3))&-1);
 var $3039=((($3038)+(1))|0);
 var $3040=$prevline;
 var $3041=(($3040+$3039)|0);
 var $3042=HEAP8[($3041)];
 var $3043=($3042&255);
 var $3044=(($mix+1)|0);
 var $3045=HEAP8[($3044)];
 var $3046=($3045&255);
 var $3047=$3043^$3046;
 var $3048=(($3047)&255);
 var $3049=$x;
 var $3050=((($3049)*(3))&-1);
 var $3051=((($3050)+(1))|0);
 var $3052=$line;
 var $3053=(($3052+$3051)|0);
 HEAP8[($3053)]=$3048;
 var $3054=$x;
 var $3055=((($3054)*(3))&-1);
 var $3056=((($3055)+(2))|0);
 var $3057=$prevline;
 var $3058=(($3057+$3056)|0);
 var $3059=HEAP8[($3058)];
 var $3060=($3059&255);
 var $3061=(($mix+2)|0);
 var $3062=HEAP8[($3061)];
 var $3063=($3062&255);
 var $3064=$3060^$3063;
 var $3065=(($3064)&255);
 var $3066=$x;
 var $3067=((($3066)*(3))&-1);
 var $3068=((($3067)+(2))|0);
 var $3069=$line;
 var $3070=(($3069+$3068)|0);
 HEAP8[($3070)]=$3065;
 label=245;break;
 case 244: 
 var $3072=$x;
 var $3073=((($3072)*(3))&-1);
 var $3074=$prevline;
 var $3075=(($3074+$3073)|0);
 var $3076=HEAP8[($3075)];
 var $3077=$x;
 var $3078=((($3077)*(3))&-1);
 var $3079=$line;
 var $3080=(($3079+$3078)|0);
 HEAP8[($3080)]=$3076;
 var $3081=$x;
 var $3082=((($3081)*(3))&-1);
 var $3083=((($3082)+(1))|0);
 var $3084=$prevline;
 var $3085=(($3084+$3083)|0);
 var $3086=HEAP8[($3085)];
 var $3087=$x;
 var $3088=((($3087)*(3))&-1);
 var $3089=((($3088)+(1))|0);
 var $3090=$line;
 var $3091=(($3090+$3089)|0);
 HEAP8[($3091)]=$3086;
 var $3092=$x;
 var $3093=((($3092)*(3))&-1);
 var $3094=((($3093)+(2))|0);
 var $3095=$prevline;
 var $3096=(($3095+$3094)|0);
 var $3097=HEAP8[($3096)];
 var $3098=$x;
 var $3099=((($3098)*(3))&-1);
 var $3100=((($3099)+(2))|0);
 var $3101=$line;
 var $3102=(($3101+$3100)|0);
 HEAP8[($3102)]=$3097;
 label=245;break;
 case 245: 
 var $3104=$count;
 var $3105=((($3104)-(1))|0);
 $count=$3105;
 var $3106=$x;
 var $3107=((($3106)+(1))|0);
 $x=$3107;
 label=178;break;
 case 246: 
 label=247;break;
 case 247: 
 var $3110=$count;
 var $3111=($3110|0)>0;
 if($3111){label=248;break;}else{var $3117=0;label=249;break;}
 case 248: 
 var $3113=$x;
 var $3114=$3;
 var $3115=($3113|0)<($3114|0);
 var $3117=$3115;label=249;break;
 case 249: 
 var $3117;
 if($3117){label=250;break;}else{label=259;break;}
 case 250: 
 var $3119=$mixmask;
 var $3120=($3119&255);
 var $3121=$3120<<1;
 var $3122=(($3121)&255);
 $mixmask=$3122;
 var $3123=$mixmask;
 var $3124=($3123&255);
 var $3125=($3124|0)==0;
 if($3125){label=251;break;}else{label=255;break;}
 case 251: 
 var $3127=$fom_mask;
 var $3128=($3127|0)!=0;
 if($3128){label=252;break;}else{label=253;break;}
 case 252: 
 var $3130=$fom_mask;
 var $3137=$3130;label=254;break;
 case 253: 
 var $3132=$5;
 var $3133=(($3132+1)|0);
 $5=$3133;
 var $3134=HEAP8[($3132)];
 var $3135=($3134&255);
 var $3137=$3135;label=254;break;
 case 254: 
 var $3137;
 var $3138=(($3137)&255);
 $mask=$3138;
 $mixmask=1;
 label=255;break;
 case 255: 
 var $3140=$mask;
 var $3141=($3140&255);
 var $3142=$mixmask;
 var $3143=($3142&255);
 var $3144=$3141&$3143;
 var $3145=($3144|0)!=0;
 if($3145){label=256;break;}else{label=257;break;}
 case 256: 
 var $3147=$x;
 var $3148=((($3147)*(3))&-1);
 var $3149=$prevline;
 var $3150=(($3149+$3148)|0);
 var $3151=HEAP8[($3150)];
 var $3152=($3151&255);
 var $3153=(($mix)|0);
 var $3154=HEAP8[($3153)];
 var $3155=($3154&255);
 var $3156=$3152^$3155;
 var $3157=(($3156)&255);
 var $3158=$x;
 var $3159=((($3158)*(3))&-1);
 var $3160=$line;
 var $3161=(($3160+$3159)|0);
 HEAP8[($3161)]=$3157;
 var $3162=$x;
 var $3163=((($3162)*(3))&-1);
 var $3164=((($3163)+(1))|0);
 var $3165=$prevline;
 var $3166=(($3165+$3164)|0);
 var $3167=HEAP8[($3166)];
 var $3168=($3167&255);
 var $3169=(($mix+1)|0);
 var $3170=HEAP8[($3169)];
 var $3171=($3170&255);
 var $3172=$3168^$3171;
 var $3173=(($3172)&255);
 var $3174=$x;
 var $3175=((($3174)*(3))&-1);
 var $3176=((($3175)+(1))|0);
 var $3177=$line;
 var $3178=(($3177+$3176)|0);
 HEAP8[($3178)]=$3173;
 var $3179=$x;
 var $3180=((($3179)*(3))&-1);
 var $3181=((($3180)+(2))|0);
 var $3182=$prevline;
 var $3183=(($3182+$3181)|0);
 var $3184=HEAP8[($3183)];
 var $3185=($3184&255);
 var $3186=(($mix+2)|0);
 var $3187=HEAP8[($3186)];
 var $3188=($3187&255);
 var $3189=$3185^$3188;
 var $3190=(($3189)&255);
 var $3191=$x;
 var $3192=((($3191)*(3))&-1);
 var $3193=((($3192)+(2))|0);
 var $3194=$line;
 var $3195=(($3194+$3193)|0);
 HEAP8[($3195)]=$3190;
 label=258;break;
 case 257: 
 var $3197=$x;
 var $3198=((($3197)*(3))&-1);
 var $3199=$prevline;
 var $3200=(($3199+$3198)|0);
 var $3201=HEAP8[($3200)];
 var $3202=$x;
 var $3203=((($3202)*(3))&-1);
 var $3204=$line;
 var $3205=(($3204+$3203)|0);
 HEAP8[($3205)]=$3201;
 var $3206=$x;
 var $3207=((($3206)*(3))&-1);
 var $3208=((($3207)+(1))|0);
 var $3209=$prevline;
 var $3210=(($3209+$3208)|0);
 var $3211=HEAP8[($3210)];
 var $3212=$x;
 var $3213=((($3212)*(3))&-1);
 var $3214=((($3213)+(1))|0);
 var $3215=$line;
 var $3216=(($3215+$3214)|0);
 HEAP8[($3216)]=$3211;
 var $3217=$x;
 var $3218=((($3217)*(3))&-1);
 var $3219=((($3218)+(2))|0);
 var $3220=$prevline;
 var $3221=(($3220+$3219)|0);
 var $3222=HEAP8[($3221)];
 var $3223=$x;
 var $3224=((($3223)*(3))&-1);
 var $3225=((($3224)+(2))|0);
 var $3226=$line;
 var $3227=(($3226+$3225)|0);
 HEAP8[($3227)]=$3222;
 label=258;break;
 case 258: 
 var $3229=$count;
 var $3230=((($3229)-(1))|0);
 $count=$3230;
 var $3231=$x;
 var $3232=((($3231)+(1))|0);
 $x=$3232;
 label=247;break;
 case 259: 
 label=260;break;
 case 260: 
 label=344;break;
 case 261: 
 label=262;break;
 case 262: 
 var $3237=$count;
 var $3238=$3237&-8;
 var $3239=($3238|0)!=0;
 if($3239){label=263;break;}else{var $3246=0;label=264;break;}
 case 263: 
 var $3241=$x;
 var $3242=((($3241)+(8))|0);
 var $3243=$3;
 var $3244=($3242|0)<($3243|0);
 var $3246=$3244;label=264;break;
 case 264: 
 var $3246;
 if($3246){label=265;break;}else{label=266;break;}
 case 265: 
 var $3248=(($colour2)|0);
 var $3249=HEAP8[($3248)];
 var $3250=$x;
 var $3251=((($3250)*(3))&-1);
 var $3252=$line;
 var $3253=(($3252+$3251)|0);
 HEAP8[($3253)]=$3249;
 var $3254=(($colour2+1)|0);
 var $3255=HEAP8[($3254)];
 var $3256=$x;
 var $3257=((($3256)*(3))&-1);
 var $3258=((($3257)+(1))|0);
 var $3259=$line;
 var $3260=(($3259+$3258)|0);
 HEAP8[($3260)]=$3255;
 var $3261=(($colour2+2)|0);
 var $3262=HEAP8[($3261)];
 var $3263=$x;
 var $3264=((($3263)*(3))&-1);
 var $3265=((($3264)+(2))|0);
 var $3266=$line;
 var $3267=(($3266+$3265)|0);
 HEAP8[($3267)]=$3262;
 var $3268=$count;
 var $3269=((($3268)-(1))|0);
 $count=$3269;
 var $3270=$x;
 var $3271=((($3270)+(1))|0);
 $x=$3271;
 var $3272=(($colour2)|0);
 var $3273=HEAP8[($3272)];
 var $3274=$x;
 var $3275=((($3274)*(3))&-1);
 var $3276=$line;
 var $3277=(($3276+$3275)|0);
 HEAP8[($3277)]=$3273;
 var $3278=(($colour2+1)|0);
 var $3279=HEAP8[($3278)];
 var $3280=$x;
 var $3281=((($3280)*(3))&-1);
 var $3282=((($3281)+(1))|0);
 var $3283=$line;
 var $3284=(($3283+$3282)|0);
 HEAP8[($3284)]=$3279;
 var $3285=(($colour2+2)|0);
 var $3286=HEAP8[($3285)];
 var $3287=$x;
 var $3288=((($3287)*(3))&-1);
 var $3289=((($3288)+(2))|0);
 var $3290=$line;
 var $3291=(($3290+$3289)|0);
 HEAP8[($3291)]=$3286;
 var $3292=$count;
 var $3293=((($3292)-(1))|0);
 $count=$3293;
 var $3294=$x;
 var $3295=((($3294)+(1))|0);
 $x=$3295;
 var $3296=(($colour2)|0);
 var $3297=HEAP8[($3296)];
 var $3298=$x;
 var $3299=((($3298)*(3))&-1);
 var $3300=$line;
 var $3301=(($3300+$3299)|0);
 HEAP8[($3301)]=$3297;
 var $3302=(($colour2+1)|0);
 var $3303=HEAP8[($3302)];
 var $3304=$x;
 var $3305=((($3304)*(3))&-1);
 var $3306=((($3305)+(1))|0);
 var $3307=$line;
 var $3308=(($3307+$3306)|0);
 HEAP8[($3308)]=$3303;
 var $3309=(($colour2+2)|0);
 var $3310=HEAP8[($3309)];
 var $3311=$x;
 var $3312=((($3311)*(3))&-1);
 var $3313=((($3312)+(2))|0);
 var $3314=$line;
 var $3315=(($3314+$3313)|0);
 HEAP8[($3315)]=$3310;
 var $3316=$count;
 var $3317=((($3316)-(1))|0);
 $count=$3317;
 var $3318=$x;
 var $3319=((($3318)+(1))|0);
 $x=$3319;
 var $3320=(($colour2)|0);
 var $3321=HEAP8[($3320)];
 var $3322=$x;
 var $3323=((($3322)*(3))&-1);
 var $3324=$line;
 var $3325=(($3324+$3323)|0);
 HEAP8[($3325)]=$3321;
 var $3326=(($colour2+1)|0);
 var $3327=HEAP8[($3326)];
 var $3328=$x;
 var $3329=((($3328)*(3))&-1);
 var $3330=((($3329)+(1))|0);
 var $3331=$line;
 var $3332=(($3331+$3330)|0);
 HEAP8[($3332)]=$3327;
 var $3333=(($colour2+2)|0);
 var $3334=HEAP8[($3333)];
 var $3335=$x;
 var $3336=((($3335)*(3))&-1);
 var $3337=((($3336)+(2))|0);
 var $3338=$line;
 var $3339=(($3338+$3337)|0);
 HEAP8[($3339)]=$3334;
 var $3340=$count;
 var $3341=((($3340)-(1))|0);
 $count=$3341;
 var $3342=$x;
 var $3343=((($3342)+(1))|0);
 $x=$3343;
 var $3344=(($colour2)|0);
 var $3345=HEAP8[($3344)];
 var $3346=$x;
 var $3347=((($3346)*(3))&-1);
 var $3348=$line;
 var $3349=(($3348+$3347)|0);
 HEAP8[($3349)]=$3345;
 var $3350=(($colour2+1)|0);
 var $3351=HEAP8[($3350)];
 var $3352=$x;
 var $3353=((($3352)*(3))&-1);
 var $3354=((($3353)+(1))|0);
 var $3355=$line;
 var $3356=(($3355+$3354)|0);
 HEAP8[($3356)]=$3351;
 var $3357=(($colour2+2)|0);
 var $3358=HEAP8[($3357)];
 var $3359=$x;
 var $3360=((($3359)*(3))&-1);
 var $3361=((($3360)+(2))|0);
 var $3362=$line;
 var $3363=(($3362+$3361)|0);
 HEAP8[($3363)]=$3358;
 var $3364=$count;
 var $3365=((($3364)-(1))|0);
 $count=$3365;
 var $3366=$x;
 var $3367=((($3366)+(1))|0);
 $x=$3367;
 var $3368=(($colour2)|0);
 var $3369=HEAP8[($3368)];
 var $3370=$x;
 var $3371=((($3370)*(3))&-1);
 var $3372=$line;
 var $3373=(($3372+$3371)|0);
 HEAP8[($3373)]=$3369;
 var $3374=(($colour2+1)|0);
 var $3375=HEAP8[($3374)];
 var $3376=$x;
 var $3377=((($3376)*(3))&-1);
 var $3378=((($3377)+(1))|0);
 var $3379=$line;
 var $3380=(($3379+$3378)|0);
 HEAP8[($3380)]=$3375;
 var $3381=(($colour2+2)|0);
 var $3382=HEAP8[($3381)];
 var $3383=$x;
 var $3384=((($3383)*(3))&-1);
 var $3385=((($3384)+(2))|0);
 var $3386=$line;
 var $3387=(($3386+$3385)|0);
 HEAP8[($3387)]=$3382;
 var $3388=$count;
 var $3389=((($3388)-(1))|0);
 $count=$3389;
 var $3390=$x;
 var $3391=((($3390)+(1))|0);
 $x=$3391;
 var $3392=(($colour2)|0);
 var $3393=HEAP8[($3392)];
 var $3394=$x;
 var $3395=((($3394)*(3))&-1);
 var $3396=$line;
 var $3397=(($3396+$3395)|0);
 HEAP8[($3397)]=$3393;
 var $3398=(($colour2+1)|0);
 var $3399=HEAP8[($3398)];
 var $3400=$x;
 var $3401=((($3400)*(3))&-1);
 var $3402=((($3401)+(1))|0);
 var $3403=$line;
 var $3404=(($3403+$3402)|0);
 HEAP8[($3404)]=$3399;
 var $3405=(($colour2+2)|0);
 var $3406=HEAP8[($3405)];
 var $3407=$x;
 var $3408=((($3407)*(3))&-1);
 var $3409=((($3408)+(2))|0);
 var $3410=$line;
 var $3411=(($3410+$3409)|0);
 HEAP8[($3411)]=$3406;
 var $3412=$count;
 var $3413=((($3412)-(1))|0);
 $count=$3413;
 var $3414=$x;
 var $3415=((($3414)+(1))|0);
 $x=$3415;
 var $3416=(($colour2)|0);
 var $3417=HEAP8[($3416)];
 var $3418=$x;
 var $3419=((($3418)*(3))&-1);
 var $3420=$line;
 var $3421=(($3420+$3419)|0);
 HEAP8[($3421)]=$3417;
 var $3422=(($colour2+1)|0);
 var $3423=HEAP8[($3422)];
 var $3424=$x;
 var $3425=((($3424)*(3))&-1);
 var $3426=((($3425)+(1))|0);
 var $3427=$line;
 var $3428=(($3427+$3426)|0);
 HEAP8[($3428)]=$3423;
 var $3429=(($colour2+2)|0);
 var $3430=HEAP8[($3429)];
 var $3431=$x;
 var $3432=((($3431)*(3))&-1);
 var $3433=((($3432)+(2))|0);
 var $3434=$line;
 var $3435=(($3434+$3433)|0);
 HEAP8[($3435)]=$3430;
 var $3436=$count;
 var $3437=((($3436)-(1))|0);
 $count=$3437;
 var $3438=$x;
 var $3439=((($3438)+(1))|0);
 $x=$3439;
 label=262;break;
 case 266: 
 label=267;break;
 case 267: 
 var $3442=$count;
 var $3443=($3442|0)>0;
 if($3443){label=268;break;}else{var $3449=0;label=269;break;}
 case 268: 
 var $3445=$x;
 var $3446=$3;
 var $3447=($3445|0)<($3446|0);
 var $3449=$3447;label=269;break;
 case 269: 
 var $3449;
 if($3449){label=270;break;}else{label=271;break;}
 case 270: 
 var $3451=(($colour2)|0);
 var $3452=HEAP8[($3451)];
 var $3453=$x;
 var $3454=((($3453)*(3))&-1);
 var $3455=$line;
 var $3456=(($3455+$3454)|0);
 HEAP8[($3456)]=$3452;
 var $3457=(($colour2+1)|0);
 var $3458=HEAP8[($3457)];
 var $3459=$x;
 var $3460=((($3459)*(3))&-1);
 var $3461=((($3460)+(1))|0);
 var $3462=$line;
 var $3463=(($3462+$3461)|0);
 HEAP8[($3463)]=$3458;
 var $3464=(($colour2+2)|0);
 var $3465=HEAP8[($3464)];
 var $3466=$x;
 var $3467=((($3466)*(3))&-1);
 var $3468=((($3467)+(2))|0);
 var $3469=$line;
 var $3470=(($3469+$3468)|0);
 HEAP8[($3470)]=$3465;
 var $3471=$count;
 var $3472=((($3471)-(1))|0);
 $count=$3472;
 var $3473=$x;
 var $3474=((($3473)+(1))|0);
 $x=$3474;
 label=267;break;
 case 271: 
 label=344;break;
 case 272: 
 label=273;break;
 case 273: 
 var $3478=$count;
 var $3479=$3478&-8;
 var $3480=($3479|0)!=0;
 if($3480){label=274;break;}else{var $3487=0;label=275;break;}
 case 274: 
 var $3482=$x;
 var $3483=((($3482)+(8))|0);
 var $3484=$3;
 var $3485=($3483|0)<($3484|0);
 var $3487=$3485;label=275;break;
 case 275: 
 var $3487;
 if($3487){label=276;break;}else{label=277;break;}
 case 276: 
 var $3489=$5;
 var $3490=(($3489+1)|0);
 $5=$3490;
 var $3491=HEAP8[($3489)];
 var $3492=$x;
 var $3493=((($3492)*(3))&-1);
 var $3494=$line;
 var $3495=(($3494+$3493)|0);
 HEAP8[($3495)]=$3491;
 var $3496=$5;
 var $3497=(($3496+1)|0);
 $5=$3497;
 var $3498=HEAP8[($3496)];
 var $3499=$x;
 var $3500=((($3499)*(3))&-1);
 var $3501=((($3500)+(1))|0);
 var $3502=$line;
 var $3503=(($3502+$3501)|0);
 HEAP8[($3503)]=$3498;
 var $3504=$5;
 var $3505=(($3504+1)|0);
 $5=$3505;
 var $3506=HEAP8[($3504)];
 var $3507=$x;
 var $3508=((($3507)*(3))&-1);
 var $3509=((($3508)+(2))|0);
 var $3510=$line;
 var $3511=(($3510+$3509)|0);
 HEAP8[($3511)]=$3506;
 var $3512=$count;
 var $3513=((($3512)-(1))|0);
 $count=$3513;
 var $3514=$x;
 var $3515=((($3514)+(1))|0);
 $x=$3515;
 var $3516=$5;
 var $3517=(($3516+1)|0);
 $5=$3517;
 var $3518=HEAP8[($3516)];
 var $3519=$x;
 var $3520=((($3519)*(3))&-1);
 var $3521=$line;
 var $3522=(($3521+$3520)|0);
 HEAP8[($3522)]=$3518;
 var $3523=$5;
 var $3524=(($3523+1)|0);
 $5=$3524;
 var $3525=HEAP8[($3523)];
 var $3526=$x;
 var $3527=((($3526)*(3))&-1);
 var $3528=((($3527)+(1))|0);
 var $3529=$line;
 var $3530=(($3529+$3528)|0);
 HEAP8[($3530)]=$3525;
 var $3531=$5;
 var $3532=(($3531+1)|0);
 $5=$3532;
 var $3533=HEAP8[($3531)];
 var $3534=$x;
 var $3535=((($3534)*(3))&-1);
 var $3536=((($3535)+(2))|0);
 var $3537=$line;
 var $3538=(($3537+$3536)|0);
 HEAP8[($3538)]=$3533;
 var $3539=$count;
 var $3540=((($3539)-(1))|0);
 $count=$3540;
 var $3541=$x;
 var $3542=((($3541)+(1))|0);
 $x=$3542;
 var $3543=$5;
 var $3544=(($3543+1)|0);
 $5=$3544;
 var $3545=HEAP8[($3543)];
 var $3546=$x;
 var $3547=((($3546)*(3))&-1);
 var $3548=$line;
 var $3549=(($3548+$3547)|0);
 HEAP8[($3549)]=$3545;
 var $3550=$5;
 var $3551=(($3550+1)|0);
 $5=$3551;
 var $3552=HEAP8[($3550)];
 var $3553=$x;
 var $3554=((($3553)*(3))&-1);
 var $3555=((($3554)+(1))|0);
 var $3556=$line;
 var $3557=(($3556+$3555)|0);
 HEAP8[($3557)]=$3552;
 var $3558=$5;
 var $3559=(($3558+1)|0);
 $5=$3559;
 var $3560=HEAP8[($3558)];
 var $3561=$x;
 var $3562=((($3561)*(3))&-1);
 var $3563=((($3562)+(2))|0);
 var $3564=$line;
 var $3565=(($3564+$3563)|0);
 HEAP8[($3565)]=$3560;
 var $3566=$count;
 var $3567=((($3566)-(1))|0);
 $count=$3567;
 var $3568=$x;
 var $3569=((($3568)+(1))|0);
 $x=$3569;
 var $3570=$5;
 var $3571=(($3570+1)|0);
 $5=$3571;
 var $3572=HEAP8[($3570)];
 var $3573=$x;
 var $3574=((($3573)*(3))&-1);
 var $3575=$line;
 var $3576=(($3575+$3574)|0);
 HEAP8[($3576)]=$3572;
 var $3577=$5;
 var $3578=(($3577+1)|0);
 $5=$3578;
 var $3579=HEAP8[($3577)];
 var $3580=$x;
 var $3581=((($3580)*(3))&-1);
 var $3582=((($3581)+(1))|0);
 var $3583=$line;
 var $3584=(($3583+$3582)|0);
 HEAP8[($3584)]=$3579;
 var $3585=$5;
 var $3586=(($3585+1)|0);
 $5=$3586;
 var $3587=HEAP8[($3585)];
 var $3588=$x;
 var $3589=((($3588)*(3))&-1);
 var $3590=((($3589)+(2))|0);
 var $3591=$line;
 var $3592=(($3591+$3590)|0);
 HEAP8[($3592)]=$3587;
 var $3593=$count;
 var $3594=((($3593)-(1))|0);
 $count=$3594;
 var $3595=$x;
 var $3596=((($3595)+(1))|0);
 $x=$3596;
 var $3597=$5;
 var $3598=(($3597+1)|0);
 $5=$3598;
 var $3599=HEAP8[($3597)];
 var $3600=$x;
 var $3601=((($3600)*(3))&-1);
 var $3602=$line;
 var $3603=(($3602+$3601)|0);
 HEAP8[($3603)]=$3599;
 var $3604=$5;
 var $3605=(($3604+1)|0);
 $5=$3605;
 var $3606=HEAP8[($3604)];
 var $3607=$x;
 var $3608=((($3607)*(3))&-1);
 var $3609=((($3608)+(1))|0);
 var $3610=$line;
 var $3611=(($3610+$3609)|0);
 HEAP8[($3611)]=$3606;
 var $3612=$5;
 var $3613=(($3612+1)|0);
 $5=$3613;
 var $3614=HEAP8[($3612)];
 var $3615=$x;
 var $3616=((($3615)*(3))&-1);
 var $3617=((($3616)+(2))|0);
 var $3618=$line;
 var $3619=(($3618+$3617)|0);
 HEAP8[($3619)]=$3614;
 var $3620=$count;
 var $3621=((($3620)-(1))|0);
 $count=$3621;
 var $3622=$x;
 var $3623=((($3622)+(1))|0);
 $x=$3623;
 var $3624=$5;
 var $3625=(($3624+1)|0);
 $5=$3625;
 var $3626=HEAP8[($3624)];
 var $3627=$x;
 var $3628=((($3627)*(3))&-1);
 var $3629=$line;
 var $3630=(($3629+$3628)|0);
 HEAP8[($3630)]=$3626;
 var $3631=$5;
 var $3632=(($3631+1)|0);
 $5=$3632;
 var $3633=HEAP8[($3631)];
 var $3634=$x;
 var $3635=((($3634)*(3))&-1);
 var $3636=((($3635)+(1))|0);
 var $3637=$line;
 var $3638=(($3637+$3636)|0);
 HEAP8[($3638)]=$3633;
 var $3639=$5;
 var $3640=(($3639+1)|0);
 $5=$3640;
 var $3641=HEAP8[($3639)];
 var $3642=$x;
 var $3643=((($3642)*(3))&-1);
 var $3644=((($3643)+(2))|0);
 var $3645=$line;
 var $3646=(($3645+$3644)|0);
 HEAP8[($3646)]=$3641;
 var $3647=$count;
 var $3648=((($3647)-(1))|0);
 $count=$3648;
 var $3649=$x;
 var $3650=((($3649)+(1))|0);
 $x=$3650;
 var $3651=$5;
 var $3652=(($3651+1)|0);
 $5=$3652;
 var $3653=HEAP8[($3651)];
 var $3654=$x;
 var $3655=((($3654)*(3))&-1);
 var $3656=$line;
 var $3657=(($3656+$3655)|0);
 HEAP8[($3657)]=$3653;
 var $3658=$5;
 var $3659=(($3658+1)|0);
 $5=$3659;
 var $3660=HEAP8[($3658)];
 var $3661=$x;
 var $3662=((($3661)*(3))&-1);
 var $3663=((($3662)+(1))|0);
 var $3664=$line;
 var $3665=(($3664+$3663)|0);
 HEAP8[($3665)]=$3660;
 var $3666=$5;
 var $3667=(($3666+1)|0);
 $5=$3667;
 var $3668=HEAP8[($3666)];
 var $3669=$x;
 var $3670=((($3669)*(3))&-1);
 var $3671=((($3670)+(2))|0);
 var $3672=$line;
 var $3673=(($3672+$3671)|0);
 HEAP8[($3673)]=$3668;
 var $3674=$count;
 var $3675=((($3674)-(1))|0);
 $count=$3675;
 var $3676=$x;
 var $3677=((($3676)+(1))|0);
 $x=$3677;
 var $3678=$5;
 var $3679=(($3678+1)|0);
 $5=$3679;
 var $3680=HEAP8[($3678)];
 var $3681=$x;
 var $3682=((($3681)*(3))&-1);
 var $3683=$line;
 var $3684=(($3683+$3682)|0);
 HEAP8[($3684)]=$3680;
 var $3685=$5;
 var $3686=(($3685+1)|0);
 $5=$3686;
 var $3687=HEAP8[($3685)];
 var $3688=$x;
 var $3689=((($3688)*(3))&-1);
 var $3690=((($3689)+(1))|0);
 var $3691=$line;
 var $3692=(($3691+$3690)|0);
 HEAP8[($3692)]=$3687;
 var $3693=$5;
 var $3694=(($3693+1)|0);
 $5=$3694;
 var $3695=HEAP8[($3693)];
 var $3696=$x;
 var $3697=((($3696)*(3))&-1);
 var $3698=((($3697)+(2))|0);
 var $3699=$line;
 var $3700=(($3699+$3698)|0);
 HEAP8[($3700)]=$3695;
 var $3701=$count;
 var $3702=((($3701)-(1))|0);
 $count=$3702;
 var $3703=$x;
 var $3704=((($3703)+(1))|0);
 $x=$3704;
 label=273;break;
 case 277: 
 label=278;break;
 case 278: 
 var $3707=$count;
 var $3708=($3707|0)>0;
 if($3708){label=279;break;}else{var $3714=0;label=280;break;}
 case 279: 
 var $3710=$x;
 var $3711=$3;
 var $3712=($3710|0)<($3711|0);
 var $3714=$3712;label=280;break;
 case 280: 
 var $3714;
 if($3714){label=281;break;}else{label=282;break;}
 case 281: 
 var $3716=$5;
 var $3717=(($3716+1)|0);
 $5=$3717;
 var $3718=HEAP8[($3716)];
 var $3719=$x;
 var $3720=((($3719)*(3))&-1);
 var $3721=$line;
 var $3722=(($3721+$3720)|0);
 HEAP8[($3722)]=$3718;
 var $3723=$5;
 var $3724=(($3723+1)|0);
 $5=$3724;
 var $3725=HEAP8[($3723)];
 var $3726=$x;
 var $3727=((($3726)*(3))&-1);
 var $3728=((($3727)+(1))|0);
 var $3729=$line;
 var $3730=(($3729+$3728)|0);
 HEAP8[($3730)]=$3725;
 var $3731=$5;
 var $3732=(($3731+1)|0);
 $5=$3732;
 var $3733=HEAP8[($3731)];
 var $3734=$x;
 var $3735=((($3734)*(3))&-1);
 var $3736=((($3735)+(2))|0);
 var $3737=$line;
 var $3738=(($3737+$3736)|0);
 HEAP8[($3738)]=$3733;
 var $3739=$count;
 var $3740=((($3739)-(1))|0);
 $count=$3740;
 var $3741=$x;
 var $3742=((($3741)+(1))|0);
 $x=$3742;
 label=278;break;
 case 282: 
 label=344;break;
 case 283: 
 label=284;break;
 case 284: 
 var $3746=$count;
 var $3747=$3746&-8;
 var $3748=($3747|0)!=0;
 if($3748){label=285;break;}else{var $3755=0;label=286;break;}
 case 285: 
 var $3750=$x;
 var $3751=((($3750)+(8))|0);
 var $3752=$3;
 var $3753=($3751|0)<($3752|0);
 var $3755=$3753;label=286;break;
 case 286: 
 var $3755;
 if($3755){label=287;break;}else{label=312;break;}
 case 287: 
 var $3757=$bicolour;
 var $3758=($3757|0)!=0;
 if($3758){label=288;break;}else{label=289;break;}
 case 288: 
 var $3760=(($colour2)|0);
 var $3761=HEAP8[($3760)];
 var $3762=$x;
 var $3763=((($3762)*(3))&-1);
 var $3764=$line;
 var $3765=(($3764+$3763)|0);
 HEAP8[($3765)]=$3761;
 var $3766=(($colour2+1)|0);
 var $3767=HEAP8[($3766)];
 var $3768=$x;
 var $3769=((($3768)*(3))&-1);
 var $3770=((($3769)+(1))|0);
 var $3771=$line;
 var $3772=(($3771+$3770)|0);
 HEAP8[($3772)]=$3767;
 var $3773=(($colour2+2)|0);
 var $3774=HEAP8[($3773)];
 var $3775=$x;
 var $3776=((($3775)*(3))&-1);
 var $3777=((($3776)+(2))|0);
 var $3778=$line;
 var $3779=(($3778+$3777)|0);
 HEAP8[($3779)]=$3774;
 $bicolour=0;
 label=290;break;
 case 289: 
 var $3781=(($colour1)|0);
 var $3782=HEAP8[($3781)];
 var $3783=$x;
 var $3784=((($3783)*(3))&-1);
 var $3785=$line;
 var $3786=(($3785+$3784)|0);
 HEAP8[($3786)]=$3782;
 var $3787=(($colour1+1)|0);
 var $3788=HEAP8[($3787)];
 var $3789=$x;
 var $3790=((($3789)*(3))&-1);
 var $3791=((($3790)+(1))|0);
 var $3792=$line;
 var $3793=(($3792+$3791)|0);
 HEAP8[($3793)]=$3788;
 var $3794=(($colour1+2)|0);
 var $3795=HEAP8[($3794)];
 var $3796=$x;
 var $3797=((($3796)*(3))&-1);
 var $3798=((($3797)+(2))|0);
 var $3799=$line;
 var $3800=(($3799+$3798)|0);
 HEAP8[($3800)]=$3795;
 $bicolour=1;
 var $3801=$count;
 var $3802=((($3801)+(1))|0);
 $count=$3802;
 label=290;break;
 case 290: 
 var $3804=$count;
 var $3805=((($3804)-(1))|0);
 $count=$3805;
 var $3806=$x;
 var $3807=((($3806)+(1))|0);
 $x=$3807;
 var $3808=$bicolour;
 var $3809=($3808|0)!=0;
 if($3809){label=291;break;}else{label=292;break;}
 case 291: 
 var $3811=(($colour2)|0);
 var $3812=HEAP8[($3811)];
 var $3813=$x;
 var $3814=((($3813)*(3))&-1);
 var $3815=$line;
 var $3816=(($3815+$3814)|0);
 HEAP8[($3816)]=$3812;
 var $3817=(($colour2+1)|0);
 var $3818=HEAP8[($3817)];
 var $3819=$x;
 var $3820=((($3819)*(3))&-1);
 var $3821=((($3820)+(1))|0);
 var $3822=$line;
 var $3823=(($3822+$3821)|0);
 HEAP8[($3823)]=$3818;
 var $3824=(($colour2+2)|0);
 var $3825=HEAP8[($3824)];
 var $3826=$x;
 var $3827=((($3826)*(3))&-1);
 var $3828=((($3827)+(2))|0);
 var $3829=$line;
 var $3830=(($3829+$3828)|0);
 HEAP8[($3830)]=$3825;
 $bicolour=0;
 label=293;break;
 case 292: 
 var $3832=(($colour1)|0);
 var $3833=HEAP8[($3832)];
 var $3834=$x;
 var $3835=((($3834)*(3))&-1);
 var $3836=$line;
 var $3837=(($3836+$3835)|0);
 HEAP8[($3837)]=$3833;
 var $3838=(($colour1+1)|0);
 var $3839=HEAP8[($3838)];
 var $3840=$x;
 var $3841=((($3840)*(3))&-1);
 var $3842=((($3841)+(1))|0);
 var $3843=$line;
 var $3844=(($3843+$3842)|0);
 HEAP8[($3844)]=$3839;
 var $3845=(($colour1+2)|0);
 var $3846=HEAP8[($3845)];
 var $3847=$x;
 var $3848=((($3847)*(3))&-1);
 var $3849=((($3848)+(2))|0);
 var $3850=$line;
 var $3851=(($3850+$3849)|0);
 HEAP8[($3851)]=$3846;
 $bicolour=1;
 var $3852=$count;
 var $3853=((($3852)+(1))|0);
 $count=$3853;
 label=293;break;
 case 293: 
 var $3855=$count;
 var $3856=((($3855)-(1))|0);
 $count=$3856;
 var $3857=$x;
 var $3858=((($3857)+(1))|0);
 $x=$3858;
 var $3859=$bicolour;
 var $3860=($3859|0)!=0;
 if($3860){label=294;break;}else{label=295;break;}
 case 294: 
 var $3862=(($colour2)|0);
 var $3863=HEAP8[($3862)];
 var $3864=$x;
 var $3865=((($3864)*(3))&-1);
 var $3866=$line;
 var $3867=(($3866+$3865)|0);
 HEAP8[($3867)]=$3863;
 var $3868=(($colour2+1)|0);
 var $3869=HEAP8[($3868)];
 var $3870=$x;
 var $3871=((($3870)*(3))&-1);
 var $3872=((($3871)+(1))|0);
 var $3873=$line;
 var $3874=(($3873+$3872)|0);
 HEAP8[($3874)]=$3869;
 var $3875=(($colour2+2)|0);
 var $3876=HEAP8[($3875)];
 var $3877=$x;
 var $3878=((($3877)*(3))&-1);
 var $3879=((($3878)+(2))|0);
 var $3880=$line;
 var $3881=(($3880+$3879)|0);
 HEAP8[($3881)]=$3876;
 $bicolour=0;
 label=296;break;
 case 295: 
 var $3883=(($colour1)|0);
 var $3884=HEAP8[($3883)];
 var $3885=$x;
 var $3886=((($3885)*(3))&-1);
 var $3887=$line;
 var $3888=(($3887+$3886)|0);
 HEAP8[($3888)]=$3884;
 var $3889=(($colour1+1)|0);
 var $3890=HEAP8[($3889)];
 var $3891=$x;
 var $3892=((($3891)*(3))&-1);
 var $3893=((($3892)+(1))|0);
 var $3894=$line;
 var $3895=(($3894+$3893)|0);
 HEAP8[($3895)]=$3890;
 var $3896=(($colour1+2)|0);
 var $3897=HEAP8[($3896)];
 var $3898=$x;
 var $3899=((($3898)*(3))&-1);
 var $3900=((($3899)+(2))|0);
 var $3901=$line;
 var $3902=(($3901+$3900)|0);
 HEAP8[($3902)]=$3897;
 $bicolour=1;
 var $3903=$count;
 var $3904=((($3903)+(1))|0);
 $count=$3904;
 label=296;break;
 case 296: 
 var $3906=$count;
 var $3907=((($3906)-(1))|0);
 $count=$3907;
 var $3908=$x;
 var $3909=((($3908)+(1))|0);
 $x=$3909;
 var $3910=$bicolour;
 var $3911=($3910|0)!=0;
 if($3911){label=297;break;}else{label=298;break;}
 case 297: 
 var $3913=(($colour2)|0);
 var $3914=HEAP8[($3913)];
 var $3915=$x;
 var $3916=((($3915)*(3))&-1);
 var $3917=$line;
 var $3918=(($3917+$3916)|0);
 HEAP8[($3918)]=$3914;
 var $3919=(($colour2+1)|0);
 var $3920=HEAP8[($3919)];
 var $3921=$x;
 var $3922=((($3921)*(3))&-1);
 var $3923=((($3922)+(1))|0);
 var $3924=$line;
 var $3925=(($3924+$3923)|0);
 HEAP8[($3925)]=$3920;
 var $3926=(($colour2+2)|0);
 var $3927=HEAP8[($3926)];
 var $3928=$x;
 var $3929=((($3928)*(3))&-1);
 var $3930=((($3929)+(2))|0);
 var $3931=$line;
 var $3932=(($3931+$3930)|0);
 HEAP8[($3932)]=$3927;
 $bicolour=0;
 label=299;break;
 case 298: 
 var $3934=(($colour1)|0);
 var $3935=HEAP8[($3934)];
 var $3936=$x;
 var $3937=((($3936)*(3))&-1);
 var $3938=$line;
 var $3939=(($3938+$3937)|0);
 HEAP8[($3939)]=$3935;
 var $3940=(($colour1+1)|0);
 var $3941=HEAP8[($3940)];
 var $3942=$x;
 var $3943=((($3942)*(3))&-1);
 var $3944=((($3943)+(1))|0);
 var $3945=$line;
 var $3946=(($3945+$3944)|0);
 HEAP8[($3946)]=$3941;
 var $3947=(($colour1+2)|0);
 var $3948=HEAP8[($3947)];
 var $3949=$x;
 var $3950=((($3949)*(3))&-1);
 var $3951=((($3950)+(2))|0);
 var $3952=$line;
 var $3953=(($3952+$3951)|0);
 HEAP8[($3953)]=$3948;
 $bicolour=1;
 var $3954=$count;
 var $3955=((($3954)+(1))|0);
 $count=$3955;
 label=299;break;
 case 299: 
 var $3957=$count;
 var $3958=((($3957)-(1))|0);
 $count=$3958;
 var $3959=$x;
 var $3960=((($3959)+(1))|0);
 $x=$3960;
 var $3961=$bicolour;
 var $3962=($3961|0)!=0;
 if($3962){label=300;break;}else{label=301;break;}
 case 300: 
 var $3964=(($colour2)|0);
 var $3965=HEAP8[($3964)];
 var $3966=$x;
 var $3967=((($3966)*(3))&-1);
 var $3968=$line;
 var $3969=(($3968+$3967)|0);
 HEAP8[($3969)]=$3965;
 var $3970=(($colour2+1)|0);
 var $3971=HEAP8[($3970)];
 var $3972=$x;
 var $3973=((($3972)*(3))&-1);
 var $3974=((($3973)+(1))|0);
 var $3975=$line;
 var $3976=(($3975+$3974)|0);
 HEAP8[($3976)]=$3971;
 var $3977=(($colour2+2)|0);
 var $3978=HEAP8[($3977)];
 var $3979=$x;
 var $3980=((($3979)*(3))&-1);
 var $3981=((($3980)+(2))|0);
 var $3982=$line;
 var $3983=(($3982+$3981)|0);
 HEAP8[($3983)]=$3978;
 $bicolour=0;
 label=302;break;
 case 301: 
 var $3985=(($colour1)|0);
 var $3986=HEAP8[($3985)];
 var $3987=$x;
 var $3988=((($3987)*(3))&-1);
 var $3989=$line;
 var $3990=(($3989+$3988)|0);
 HEAP8[($3990)]=$3986;
 var $3991=(($colour1+1)|0);
 var $3992=HEAP8[($3991)];
 var $3993=$x;
 var $3994=((($3993)*(3))&-1);
 var $3995=((($3994)+(1))|0);
 var $3996=$line;
 var $3997=(($3996+$3995)|0);
 HEAP8[($3997)]=$3992;
 var $3998=(($colour1+2)|0);
 var $3999=HEAP8[($3998)];
 var $4000=$x;
 var $4001=((($4000)*(3))&-1);
 var $4002=((($4001)+(2))|0);
 var $4003=$line;
 var $4004=(($4003+$4002)|0);
 HEAP8[($4004)]=$3999;
 $bicolour=1;
 var $4005=$count;
 var $4006=((($4005)+(1))|0);
 $count=$4006;
 label=302;break;
 case 302: 
 var $4008=$count;
 var $4009=((($4008)-(1))|0);
 $count=$4009;
 var $4010=$x;
 var $4011=((($4010)+(1))|0);
 $x=$4011;
 var $4012=$bicolour;
 var $4013=($4012|0)!=0;
 if($4013){label=303;break;}else{label=304;break;}
 case 303: 
 var $4015=(($colour2)|0);
 var $4016=HEAP8[($4015)];
 var $4017=$x;
 var $4018=((($4017)*(3))&-1);
 var $4019=$line;
 var $4020=(($4019+$4018)|0);
 HEAP8[($4020)]=$4016;
 var $4021=(($colour2+1)|0);
 var $4022=HEAP8[($4021)];
 var $4023=$x;
 var $4024=((($4023)*(3))&-1);
 var $4025=((($4024)+(1))|0);
 var $4026=$line;
 var $4027=(($4026+$4025)|0);
 HEAP8[($4027)]=$4022;
 var $4028=(($colour2+2)|0);
 var $4029=HEAP8[($4028)];
 var $4030=$x;
 var $4031=((($4030)*(3))&-1);
 var $4032=((($4031)+(2))|0);
 var $4033=$line;
 var $4034=(($4033+$4032)|0);
 HEAP8[($4034)]=$4029;
 $bicolour=0;
 label=305;break;
 case 304: 
 var $4036=(($colour1)|0);
 var $4037=HEAP8[($4036)];
 var $4038=$x;
 var $4039=((($4038)*(3))&-1);
 var $4040=$line;
 var $4041=(($4040+$4039)|0);
 HEAP8[($4041)]=$4037;
 var $4042=(($colour1+1)|0);
 var $4043=HEAP8[($4042)];
 var $4044=$x;
 var $4045=((($4044)*(3))&-1);
 var $4046=((($4045)+(1))|0);
 var $4047=$line;
 var $4048=(($4047+$4046)|0);
 HEAP8[($4048)]=$4043;
 var $4049=(($colour1+2)|0);
 var $4050=HEAP8[($4049)];
 var $4051=$x;
 var $4052=((($4051)*(3))&-1);
 var $4053=((($4052)+(2))|0);
 var $4054=$line;
 var $4055=(($4054+$4053)|0);
 HEAP8[($4055)]=$4050;
 $bicolour=1;
 var $4056=$count;
 var $4057=((($4056)+(1))|0);
 $count=$4057;
 label=305;break;
 case 305: 
 var $4059=$count;
 var $4060=((($4059)-(1))|0);
 $count=$4060;
 var $4061=$x;
 var $4062=((($4061)+(1))|0);
 $x=$4062;
 var $4063=$bicolour;
 var $4064=($4063|0)!=0;
 if($4064){label=306;break;}else{label=307;break;}
 case 306: 
 var $4066=(($colour2)|0);
 var $4067=HEAP8[($4066)];
 var $4068=$x;
 var $4069=((($4068)*(3))&-1);
 var $4070=$line;
 var $4071=(($4070+$4069)|0);
 HEAP8[($4071)]=$4067;
 var $4072=(($colour2+1)|0);
 var $4073=HEAP8[($4072)];
 var $4074=$x;
 var $4075=((($4074)*(3))&-1);
 var $4076=((($4075)+(1))|0);
 var $4077=$line;
 var $4078=(($4077+$4076)|0);
 HEAP8[($4078)]=$4073;
 var $4079=(($colour2+2)|0);
 var $4080=HEAP8[($4079)];
 var $4081=$x;
 var $4082=((($4081)*(3))&-1);
 var $4083=((($4082)+(2))|0);
 var $4084=$line;
 var $4085=(($4084+$4083)|0);
 HEAP8[($4085)]=$4080;
 $bicolour=0;
 label=308;break;
 case 307: 
 var $4087=(($colour1)|0);
 var $4088=HEAP8[($4087)];
 var $4089=$x;
 var $4090=((($4089)*(3))&-1);
 var $4091=$line;
 var $4092=(($4091+$4090)|0);
 HEAP8[($4092)]=$4088;
 var $4093=(($colour1+1)|0);
 var $4094=HEAP8[($4093)];
 var $4095=$x;
 var $4096=((($4095)*(3))&-1);
 var $4097=((($4096)+(1))|0);
 var $4098=$line;
 var $4099=(($4098+$4097)|0);
 HEAP8[($4099)]=$4094;
 var $4100=(($colour1+2)|0);
 var $4101=HEAP8[($4100)];
 var $4102=$x;
 var $4103=((($4102)*(3))&-1);
 var $4104=((($4103)+(2))|0);
 var $4105=$line;
 var $4106=(($4105+$4104)|0);
 HEAP8[($4106)]=$4101;
 $bicolour=1;
 var $4107=$count;
 var $4108=((($4107)+(1))|0);
 $count=$4108;
 label=308;break;
 case 308: 
 var $4110=$count;
 var $4111=((($4110)-(1))|0);
 $count=$4111;
 var $4112=$x;
 var $4113=((($4112)+(1))|0);
 $x=$4113;
 var $4114=$bicolour;
 var $4115=($4114|0)!=0;
 if($4115){label=309;break;}else{label=310;break;}
 case 309: 
 var $4117=(($colour2)|0);
 var $4118=HEAP8[($4117)];
 var $4119=$x;
 var $4120=((($4119)*(3))&-1);
 var $4121=$line;
 var $4122=(($4121+$4120)|0);
 HEAP8[($4122)]=$4118;
 var $4123=(($colour2+1)|0);
 var $4124=HEAP8[($4123)];
 var $4125=$x;
 var $4126=((($4125)*(3))&-1);
 var $4127=((($4126)+(1))|0);
 var $4128=$line;
 var $4129=(($4128+$4127)|0);
 HEAP8[($4129)]=$4124;
 var $4130=(($colour2+2)|0);
 var $4131=HEAP8[($4130)];
 var $4132=$x;
 var $4133=((($4132)*(3))&-1);
 var $4134=((($4133)+(2))|0);
 var $4135=$line;
 var $4136=(($4135+$4134)|0);
 HEAP8[($4136)]=$4131;
 $bicolour=0;
 label=311;break;
 case 310: 
 var $4138=(($colour1)|0);
 var $4139=HEAP8[($4138)];
 var $4140=$x;
 var $4141=((($4140)*(3))&-1);
 var $4142=$line;
 var $4143=(($4142+$4141)|0);
 HEAP8[($4143)]=$4139;
 var $4144=(($colour1+1)|0);
 var $4145=HEAP8[($4144)];
 var $4146=$x;
 var $4147=((($4146)*(3))&-1);
 var $4148=((($4147)+(1))|0);
 var $4149=$line;
 var $4150=(($4149+$4148)|0);
 HEAP8[($4150)]=$4145;
 var $4151=(($colour1+2)|0);
 var $4152=HEAP8[($4151)];
 var $4153=$x;
 var $4154=((($4153)*(3))&-1);
 var $4155=((($4154)+(2))|0);
 var $4156=$line;
 var $4157=(($4156+$4155)|0);
 HEAP8[($4157)]=$4152;
 $bicolour=1;
 var $4158=$count;
 var $4159=((($4158)+(1))|0);
 $count=$4159;
 label=311;break;
 case 311: 
 var $4161=$count;
 var $4162=((($4161)-(1))|0);
 $count=$4162;
 var $4163=$x;
 var $4164=((($4163)+(1))|0);
 $x=$4164;
 label=284;break;
 case 312: 
 label=313;break;
 case 313: 
 var $4167=$count;
 var $4168=($4167|0)>0;
 if($4168){label=314;break;}else{var $4174=0;label=315;break;}
 case 314: 
 var $4170=$x;
 var $4171=$3;
 var $4172=($4170|0)<($4171|0);
 var $4174=$4172;label=315;break;
 case 315: 
 var $4174;
 if($4174){label=316;break;}else{label=320;break;}
 case 316: 
 var $4176=$bicolour;
 var $4177=($4176|0)!=0;
 if($4177){label=317;break;}else{label=318;break;}
 case 317: 
 var $4179=(($colour2)|0);
 var $4180=HEAP8[($4179)];
 var $4181=$x;
 var $4182=((($4181)*(3))&-1);
 var $4183=$line;
 var $4184=(($4183+$4182)|0);
 HEAP8[($4184)]=$4180;
 var $4185=(($colour2+1)|0);
 var $4186=HEAP8[($4185)];
 var $4187=$x;
 var $4188=((($4187)*(3))&-1);
 var $4189=((($4188)+(1))|0);
 var $4190=$line;
 var $4191=(($4190+$4189)|0);
 HEAP8[($4191)]=$4186;
 var $4192=(($colour2+2)|0);
 var $4193=HEAP8[($4192)];
 var $4194=$x;
 var $4195=((($4194)*(3))&-1);
 var $4196=((($4195)+(2))|0);
 var $4197=$line;
 var $4198=(($4197+$4196)|0);
 HEAP8[($4198)]=$4193;
 $bicolour=0;
 label=319;break;
 case 318: 
 var $4200=(($colour1)|0);
 var $4201=HEAP8[($4200)];
 var $4202=$x;
 var $4203=((($4202)*(3))&-1);
 var $4204=$line;
 var $4205=(($4204+$4203)|0);
 HEAP8[($4205)]=$4201;
 var $4206=(($colour1+1)|0);
 var $4207=HEAP8[($4206)];
 var $4208=$x;
 var $4209=((($4208)*(3))&-1);
 var $4210=((($4209)+(1))|0);
 var $4211=$line;
 var $4212=(($4211+$4210)|0);
 HEAP8[($4212)]=$4207;
 var $4213=(($colour1+2)|0);
 var $4214=HEAP8[($4213)];
 var $4215=$x;
 var $4216=((($4215)*(3))&-1);
 var $4217=((($4216)+(2))|0);
 var $4218=$line;
 var $4219=(($4218+$4217)|0);
 HEAP8[($4219)]=$4214;
 $bicolour=1;
 var $4220=$count;
 var $4221=((($4220)+(1))|0);
 $count=$4221;
 label=319;break;
 case 319: 
 var $4223=$count;
 var $4224=((($4223)-(1))|0);
 $count=$4224;
 var $4225=$x;
 var $4226=((($4225)+(1))|0);
 $x=$4226;
 label=313;break;
 case 320: 
 label=344;break;
 case 321: 
 label=322;break;
 case 322: 
 var $4230=$count;
 var $4231=$4230&-8;
 var $4232=($4231|0)!=0;
 if($4232){label=323;break;}else{var $4239=0;label=324;break;}
 case 323: 
 var $4234=$x;
 var $4235=((($4234)+(8))|0);
 var $4236=$3;
 var $4237=($4235|0)<($4236|0);
 var $4239=$4237;label=324;break;
 case 324: 
 var $4239;
 if($4239){label=325;break;}else{label=326;break;}
 case 325: 
 var $4241=$x;
 var $4242=((($4241)*(3))&-1);
 var $4243=$line;
 var $4244=(($4243+$4242)|0);
 HEAP8[($4244)]=-1;
 var $4245=$x;
 var $4246=((($4245)*(3))&-1);
 var $4247=((($4246)+(1))|0);
 var $4248=$line;
 var $4249=(($4248+$4247)|0);
 HEAP8[($4249)]=-1;
 var $4250=$x;
 var $4251=((($4250)*(3))&-1);
 var $4252=((($4251)+(2))|0);
 var $4253=$line;
 var $4254=(($4253+$4252)|0);
 HEAP8[($4254)]=-1;
 var $4255=$count;
 var $4256=((($4255)-(1))|0);
 $count=$4256;
 var $4257=$x;
 var $4258=((($4257)+(1))|0);
 $x=$4258;
 var $4259=$x;
 var $4260=((($4259)*(3))&-1);
 var $4261=$line;
 var $4262=(($4261+$4260)|0);
 HEAP8[($4262)]=-1;
 var $4263=$x;
 var $4264=((($4263)*(3))&-1);
 var $4265=((($4264)+(1))|0);
 var $4266=$line;
 var $4267=(($4266+$4265)|0);
 HEAP8[($4267)]=-1;
 var $4268=$x;
 var $4269=((($4268)*(3))&-1);
 var $4270=((($4269)+(2))|0);
 var $4271=$line;
 var $4272=(($4271+$4270)|0);
 HEAP8[($4272)]=-1;
 var $4273=$count;
 var $4274=((($4273)-(1))|0);
 $count=$4274;
 var $4275=$x;
 var $4276=((($4275)+(1))|0);
 $x=$4276;
 var $4277=$x;
 var $4278=((($4277)*(3))&-1);
 var $4279=$line;
 var $4280=(($4279+$4278)|0);
 HEAP8[($4280)]=-1;
 var $4281=$x;
 var $4282=((($4281)*(3))&-1);
 var $4283=((($4282)+(1))|0);
 var $4284=$line;
 var $4285=(($4284+$4283)|0);
 HEAP8[($4285)]=-1;
 var $4286=$x;
 var $4287=((($4286)*(3))&-1);
 var $4288=((($4287)+(2))|0);
 var $4289=$line;
 var $4290=(($4289+$4288)|0);
 HEAP8[($4290)]=-1;
 var $4291=$count;
 var $4292=((($4291)-(1))|0);
 $count=$4292;
 var $4293=$x;
 var $4294=((($4293)+(1))|0);
 $x=$4294;
 var $4295=$x;
 var $4296=((($4295)*(3))&-1);
 var $4297=$line;
 var $4298=(($4297+$4296)|0);
 HEAP8[($4298)]=-1;
 var $4299=$x;
 var $4300=((($4299)*(3))&-1);
 var $4301=((($4300)+(1))|0);
 var $4302=$line;
 var $4303=(($4302+$4301)|0);
 HEAP8[($4303)]=-1;
 var $4304=$x;
 var $4305=((($4304)*(3))&-1);
 var $4306=((($4305)+(2))|0);
 var $4307=$line;
 var $4308=(($4307+$4306)|0);
 HEAP8[($4308)]=-1;
 var $4309=$count;
 var $4310=((($4309)-(1))|0);
 $count=$4310;
 var $4311=$x;
 var $4312=((($4311)+(1))|0);
 $x=$4312;
 var $4313=$x;
 var $4314=((($4313)*(3))&-1);
 var $4315=$line;
 var $4316=(($4315+$4314)|0);
 HEAP8[($4316)]=-1;
 var $4317=$x;
 var $4318=((($4317)*(3))&-1);
 var $4319=((($4318)+(1))|0);
 var $4320=$line;
 var $4321=(($4320+$4319)|0);
 HEAP8[($4321)]=-1;
 var $4322=$x;
 var $4323=((($4322)*(3))&-1);
 var $4324=((($4323)+(2))|0);
 var $4325=$line;
 var $4326=(($4325+$4324)|0);
 HEAP8[($4326)]=-1;
 var $4327=$count;
 var $4328=((($4327)-(1))|0);
 $count=$4328;
 var $4329=$x;
 var $4330=((($4329)+(1))|0);
 $x=$4330;
 var $4331=$x;
 var $4332=((($4331)*(3))&-1);
 var $4333=$line;
 var $4334=(($4333+$4332)|0);
 HEAP8[($4334)]=-1;
 var $4335=$x;
 var $4336=((($4335)*(3))&-1);
 var $4337=((($4336)+(1))|0);
 var $4338=$line;
 var $4339=(($4338+$4337)|0);
 HEAP8[($4339)]=-1;
 var $4340=$x;
 var $4341=((($4340)*(3))&-1);
 var $4342=((($4341)+(2))|0);
 var $4343=$line;
 var $4344=(($4343+$4342)|0);
 HEAP8[($4344)]=-1;
 var $4345=$count;
 var $4346=((($4345)-(1))|0);
 $count=$4346;
 var $4347=$x;
 var $4348=((($4347)+(1))|0);
 $x=$4348;
 var $4349=$x;
 var $4350=((($4349)*(3))&-1);
 var $4351=$line;
 var $4352=(($4351+$4350)|0);
 HEAP8[($4352)]=-1;
 var $4353=$x;
 var $4354=((($4353)*(3))&-1);
 var $4355=((($4354)+(1))|0);
 var $4356=$line;
 var $4357=(($4356+$4355)|0);
 HEAP8[($4357)]=-1;
 var $4358=$x;
 var $4359=((($4358)*(3))&-1);
 var $4360=((($4359)+(2))|0);
 var $4361=$line;
 var $4362=(($4361+$4360)|0);
 HEAP8[($4362)]=-1;
 var $4363=$count;
 var $4364=((($4363)-(1))|0);
 $count=$4364;
 var $4365=$x;
 var $4366=((($4365)+(1))|0);
 $x=$4366;
 var $4367=$x;
 var $4368=((($4367)*(3))&-1);
 var $4369=$line;
 var $4370=(($4369+$4368)|0);
 HEAP8[($4370)]=-1;
 var $4371=$x;
 var $4372=((($4371)*(3))&-1);
 var $4373=((($4372)+(1))|0);
 var $4374=$line;
 var $4375=(($4374+$4373)|0);
 HEAP8[($4375)]=-1;
 var $4376=$x;
 var $4377=((($4376)*(3))&-1);
 var $4378=((($4377)+(2))|0);
 var $4379=$line;
 var $4380=(($4379+$4378)|0);
 HEAP8[($4380)]=-1;
 var $4381=$count;
 var $4382=((($4381)-(1))|0);
 $count=$4382;
 var $4383=$x;
 var $4384=((($4383)+(1))|0);
 $x=$4384;
 label=322;break;
 case 326: 
 label=327;break;
 case 327: 
 var $4387=$count;
 var $4388=($4387|0)>0;
 if($4388){label=328;break;}else{var $4394=0;label=329;break;}
 case 328: 
 var $4390=$x;
 var $4391=$3;
 var $4392=($4390|0)<($4391|0);
 var $4394=$4392;label=329;break;
 case 329: 
 var $4394;
 if($4394){label=330;break;}else{label=331;break;}
 case 330: 
 var $4396=$x;
 var $4397=((($4396)*(3))&-1);
 var $4398=$line;
 var $4399=(($4398+$4397)|0);
 HEAP8[($4399)]=-1;
 var $4400=$x;
 var $4401=((($4400)*(3))&-1);
 var $4402=((($4401)+(1))|0);
 var $4403=$line;
 var $4404=(($4403+$4402)|0);
 HEAP8[($4404)]=-1;
 var $4405=$x;
 var $4406=((($4405)*(3))&-1);
 var $4407=((($4406)+(2))|0);
 var $4408=$line;
 var $4409=(($4408+$4407)|0);
 HEAP8[($4409)]=-1;
 var $4410=$count;
 var $4411=((($4410)-(1))|0);
 $count=$4411;
 var $4412=$x;
 var $4413=((($4412)+(1))|0);
 $x=$4413;
 label=327;break;
 case 331: 
 label=344;break;
 case 332: 
 label=333;break;
 case 333: 
 var $4417=$count;
 var $4418=$4417&-8;
 var $4419=($4418|0)!=0;
 if($4419){label=334;break;}else{var $4426=0;label=335;break;}
 case 334: 
 var $4421=$x;
 var $4422=((($4421)+(8))|0);
 var $4423=$3;
 var $4424=($4422|0)<($4423|0);
 var $4426=$4424;label=335;break;
 case 335: 
 var $4426;
 if($4426){label=336;break;}else{label=337;break;}
 case 336: 
 var $4428=$x;
 var $4429=((($4428)*(3))&-1);
 var $4430=$line;
 var $4431=(($4430+$4429)|0);
 HEAP8[($4431)]=0;
 var $4432=$x;
 var $4433=((($4432)*(3))&-1);
 var $4434=((($4433)+(1))|0);
 var $4435=$line;
 var $4436=(($4435+$4434)|0);
 HEAP8[($4436)]=0;
 var $4437=$x;
 var $4438=((($4437)*(3))&-1);
 var $4439=((($4438)+(2))|0);
 var $4440=$line;
 var $4441=(($4440+$4439)|0);
 HEAP8[($4441)]=0;
 var $4442=$count;
 var $4443=((($4442)-(1))|0);
 $count=$4443;
 var $4444=$x;
 var $4445=((($4444)+(1))|0);
 $x=$4445;
 var $4446=$x;
 var $4447=((($4446)*(3))&-1);
 var $4448=$line;
 var $4449=(($4448+$4447)|0);
 HEAP8[($4449)]=0;
 var $4450=$x;
 var $4451=((($4450)*(3))&-1);
 var $4452=((($4451)+(1))|0);
 var $4453=$line;
 var $4454=(($4453+$4452)|0);
 HEAP8[($4454)]=0;
 var $4455=$x;
 var $4456=((($4455)*(3))&-1);
 var $4457=((($4456)+(2))|0);
 var $4458=$line;
 var $4459=(($4458+$4457)|0);
 HEAP8[($4459)]=0;
 var $4460=$count;
 var $4461=((($4460)-(1))|0);
 $count=$4461;
 var $4462=$x;
 var $4463=((($4462)+(1))|0);
 $x=$4463;
 var $4464=$x;
 var $4465=((($4464)*(3))&-1);
 var $4466=$line;
 var $4467=(($4466+$4465)|0);
 HEAP8[($4467)]=0;
 var $4468=$x;
 var $4469=((($4468)*(3))&-1);
 var $4470=((($4469)+(1))|0);
 var $4471=$line;
 var $4472=(($4471+$4470)|0);
 HEAP8[($4472)]=0;
 var $4473=$x;
 var $4474=((($4473)*(3))&-1);
 var $4475=((($4474)+(2))|0);
 var $4476=$line;
 var $4477=(($4476+$4475)|0);
 HEAP8[($4477)]=0;
 var $4478=$count;
 var $4479=((($4478)-(1))|0);
 $count=$4479;
 var $4480=$x;
 var $4481=((($4480)+(1))|0);
 $x=$4481;
 var $4482=$x;
 var $4483=((($4482)*(3))&-1);
 var $4484=$line;
 var $4485=(($4484+$4483)|0);
 HEAP8[($4485)]=0;
 var $4486=$x;
 var $4487=((($4486)*(3))&-1);
 var $4488=((($4487)+(1))|0);
 var $4489=$line;
 var $4490=(($4489+$4488)|0);
 HEAP8[($4490)]=0;
 var $4491=$x;
 var $4492=((($4491)*(3))&-1);
 var $4493=((($4492)+(2))|0);
 var $4494=$line;
 var $4495=(($4494+$4493)|0);
 HEAP8[($4495)]=0;
 var $4496=$count;
 var $4497=((($4496)-(1))|0);
 $count=$4497;
 var $4498=$x;
 var $4499=((($4498)+(1))|0);
 $x=$4499;
 var $4500=$x;
 var $4501=((($4500)*(3))&-1);
 var $4502=$line;
 var $4503=(($4502+$4501)|0);
 HEAP8[($4503)]=0;
 var $4504=$x;
 var $4505=((($4504)*(3))&-1);
 var $4506=((($4505)+(1))|0);
 var $4507=$line;
 var $4508=(($4507+$4506)|0);
 HEAP8[($4508)]=0;
 var $4509=$x;
 var $4510=((($4509)*(3))&-1);
 var $4511=((($4510)+(2))|0);
 var $4512=$line;
 var $4513=(($4512+$4511)|0);
 HEAP8[($4513)]=0;
 var $4514=$count;
 var $4515=((($4514)-(1))|0);
 $count=$4515;
 var $4516=$x;
 var $4517=((($4516)+(1))|0);
 $x=$4517;
 var $4518=$x;
 var $4519=((($4518)*(3))&-1);
 var $4520=$line;
 var $4521=(($4520+$4519)|0);
 HEAP8[($4521)]=0;
 var $4522=$x;
 var $4523=((($4522)*(3))&-1);
 var $4524=((($4523)+(1))|0);
 var $4525=$line;
 var $4526=(($4525+$4524)|0);
 HEAP8[($4526)]=0;
 var $4527=$x;
 var $4528=((($4527)*(3))&-1);
 var $4529=((($4528)+(2))|0);
 var $4530=$line;
 var $4531=(($4530+$4529)|0);
 HEAP8[($4531)]=0;
 var $4532=$count;
 var $4533=((($4532)-(1))|0);
 $count=$4533;
 var $4534=$x;
 var $4535=((($4534)+(1))|0);
 $x=$4535;
 var $4536=$x;
 var $4537=((($4536)*(3))&-1);
 var $4538=$line;
 var $4539=(($4538+$4537)|0);
 HEAP8[($4539)]=0;
 var $4540=$x;
 var $4541=((($4540)*(3))&-1);
 var $4542=((($4541)+(1))|0);
 var $4543=$line;
 var $4544=(($4543+$4542)|0);
 HEAP8[($4544)]=0;
 var $4545=$x;
 var $4546=((($4545)*(3))&-1);
 var $4547=((($4546)+(2))|0);
 var $4548=$line;
 var $4549=(($4548+$4547)|0);
 HEAP8[($4549)]=0;
 var $4550=$count;
 var $4551=((($4550)-(1))|0);
 $count=$4551;
 var $4552=$x;
 var $4553=((($4552)+(1))|0);
 $x=$4553;
 var $4554=$x;
 var $4555=((($4554)*(3))&-1);
 var $4556=$line;
 var $4557=(($4556+$4555)|0);
 HEAP8[($4557)]=0;
 var $4558=$x;
 var $4559=((($4558)*(3))&-1);
 var $4560=((($4559)+(1))|0);
 var $4561=$line;
 var $4562=(($4561+$4560)|0);
 HEAP8[($4562)]=0;
 var $4563=$x;
 var $4564=((($4563)*(3))&-1);
 var $4565=((($4564)+(2))|0);
 var $4566=$line;
 var $4567=(($4566+$4565)|0);
 HEAP8[($4567)]=0;
 var $4568=$count;
 var $4569=((($4568)-(1))|0);
 $count=$4569;
 var $4570=$x;
 var $4571=((($4570)+(1))|0);
 $x=$4571;
 label=333;break;
 case 337: 
 label=338;break;
 case 338: 
 var $4574=$count;
 var $4575=($4574|0)>0;
 if($4575){label=339;break;}else{var $4581=0;label=340;break;}
 case 339: 
 var $4577=$x;
 var $4578=$3;
 var $4579=($4577|0)<($4578|0);
 var $4581=$4579;label=340;break;
 case 340: 
 var $4581;
 if($4581){label=341;break;}else{label=342;break;}
 case 341: 
 var $4583=$x;
 var $4584=((($4583)*(3))&-1);
 var $4585=$line;
 var $4586=(($4585+$4584)|0);
 HEAP8[($4586)]=0;
 var $4587=$x;
 var $4588=((($4587)*(3))&-1);
 var $4589=((($4588)+(1))|0);
 var $4590=$line;
 var $4591=(($4590+$4589)|0);
 HEAP8[($4591)]=0;
 var $4592=$x;
 var $4593=((($4592)*(3))&-1);
 var $4594=((($4593)+(2))|0);
 var $4595=$line;
 var $4596=(($4595+$4594)|0);
 HEAP8[($4596)]=0;
 var $4597=$count;
 var $4598=((($4597)-(1))|0);
 $count=$4598;
 var $4599=$x;
 var $4600=((($4599)+(1))|0);
 $x=$4600;
 label=338;break;
 case 342: 
 label=344;break;
 case 343: 
 $1=0;
 label=347;break;
 case 344: 
 label=34;break;
 case 345: 
 label=2;break;
 case 346: 
 $1=1;
 label=347;break;
 case 347: 
 var $4607=$1;
 STACKTOP=sp;return $4607;
  default: assert(0, "bad label: " + label);
 }

}


function _bitmap_decompress_32($output,$output_width,$output_height,$input_width,$input_height,$input,$size){
 var label=0;
 var sp=STACKTOP; (assert((STACKTOP|0) < (STACK_MAX|0))|0);
 label = 1; 
 while(1)switch(label){
 case 1: 
 var $1;
 var $2;
 var $3;
 var $4;
 var $5;
 var $6;
 var $7;
 var $temp;
 var $rv;
 var $y;
 var $x;
 var $r;
 var $g;
 var $b;
 var $a;
 $1=$output;
 $2=$output_width;
 $3=$output_height;
 $4=$input_width;
 $5=$input_height;
 $6=$input;
 $7=$size;
 var $8=$4;
 var $9=$5;
 var $10=(Math_imul($8,$9)|0);
 var $11=($10<<2);
 var $12=_malloc($11);
 $temp=$12;
 var $13=$temp;
 var $14=$4;
 var $15=$5;
 var $16=$6;
 var $17=$7;
 var $18=_bitmap_decompress4($13,$14,$15,$16,$17);
 $rv=$18;
 $y=0;
 label=2;break;
 case 2: 
 var $20=$y;
 var $21=$3;
 var $22=($20|0)<($21|0);
 if($22){label=3;break;}else{label=9;break;}
 case 3: 
 $x=0;
 label=4;break;
 case 4: 
 var $25=$x;
 var $26=$2;
 var $27=($25|0)<($26|0);
 if($27){label=5;break;}else{label=7;break;}
 case 5: 
 var $29=$y;
 var $30=$4;
 var $31=(Math_imul($29,$30)|0);
 var $32=$x;
 var $33=((($31)+($32))|0);
 var $34=($33<<2);
 var $35=$temp;
 var $36=(($35+$34)|0);
 var $37=HEAP8[($36)];
 $r=$37;
 var $38=$y;
 var $39=$4;
 var $40=(Math_imul($38,$39)|0);
 var $41=$x;
 var $42=((($40)+($41))|0);
 var $43=($42<<2);
 var $44=((($43)+(1))|0);
 var $45=$temp;
 var $46=(($45+$44)|0);
 var $47=HEAP8[($46)];
 $g=$47;
 var $48=$y;
 var $49=$4;
 var $50=(Math_imul($48,$49)|0);
 var $51=$x;
 var $52=((($50)+($51))|0);
 var $53=($52<<2);
 var $54=((($53)+(2))|0);
 var $55=$temp;
 var $56=(($55+$54)|0);
 var $57=HEAP8[($56)];
 $b=$57;
 var $58=$y;
 var $59=$4;
 var $60=(Math_imul($58,$59)|0);
 var $61=$x;
 var $62=((($60)+($61))|0);
 var $63=($62<<2);
 var $64=((($63)+(3))|0);
 var $65=$temp;
 var $66=(($65+$64)|0);
 var $67=HEAP8[($66)];
 $a=$67;
 var $68=$r;
 var $69=($68&255);
 var $70=$69<<16;
 var $71=-16777216|$70;
 var $72=$g;
 var $73=($72&255);
 var $74=$73<<8;
 var $75=$71|$74;
 var $76=$b;
 var $77=($76&255);
 var $78=$75|$77;
 var $79=$y;
 var $80=$2;
 var $81=(Math_imul($79,$80)|0);
 var $82=$x;
 var $83=((($81)+($82))|0);
 var $84=$1;
 var $85=$84;
 var $86=(($85+($83<<2))|0);
 HEAP32[(($86)>>2)]=$78;
 label=6;break;
 case 6: 
 var $88=$x;
 var $89=((($88)+(1))|0);
 $x=$89;
 label=4;break;
 case 7: 
 label=8;break;
 case 8: 
 var $92=$y;
 var $93=((($92)+(1))|0);
 $y=$93;
 label=2;break;
 case 9: 
 var $95=$temp;
 _free($95);
 var $96=$rv;
 STACKTOP=sp;return $96;
  default: assert(0, "bad label: " + label);
 }

}
Module["_bitmap_decompress_32"] = _bitmap_decompress_32;

function _bitmap_decompress4($output,$width,$height,$input,$size){
 var label=0;
 var sp=STACKTOP; (assert((STACKTOP|0) < (STACK_MAX|0))|0);
 label = 1; 
 while(1)switch(label){
 case 1: 
 var $1;
 var $2;
 var $3;
 var $4;
 var $5;
 var $6;
 var $code;
 var $bytes_pro;
 var $total_pro;
 $2=$output;
 $3=$width;
 $4=$height;
 $5=$input;
 $6=$size;
 var $7=$5;
 var $8=(($7+1)|0);
 $5=$8;
 var $9=HEAP8[($7)];
 var $10=($9&255);
 $code=$10;
 var $11=$code;
 var $12=($11|0)!=16;
 if($12){label=2;break;}else{label=3;break;}
 case 2: 
 $1=0;
 label=4;break;
 case 3: 
 $total_pro=1;
 var $15=$5;
 var $16=$3;
 var $17=$4;
 var $18=$2;
 var $19=(($18+3)|0);
 var $20=$6;
 var $21=$total_pro;
 var $22=((($20)-($21))|0);
 var $23=_process_plane($15,$16,$17,$19,$22);
 $bytes_pro=$23;
 var $24=$bytes_pro;
 var $25=$total_pro;
 var $26=((($25)+($24))|0);
 $total_pro=$26;
 var $27=$bytes_pro;
 var $28=$5;
 var $29=(($28+$27)|0);
 $5=$29;
 var $30=$5;
 var $31=$3;
 var $32=$4;
 var $33=$2;
 var $34=(($33+2)|0);
 var $35=$6;
 var $36=$total_pro;
 var $37=((($35)-($36))|0);
 var $38=_process_plane($30,$31,$32,$34,$37);
 $bytes_pro=$38;
 var $39=$bytes_pro;
 var $40=$total_pro;
 var $41=((($40)+($39))|0);
 $total_pro=$41;
 var $42=$bytes_pro;
 var $43=$5;
 var $44=(($43+$42)|0);
 $5=$44;
 var $45=$5;
 var $46=$3;
 var $47=$4;
 var $48=$2;
 var $49=(($48+1)|0);
 var $50=$6;
 var $51=$total_pro;
 var $52=((($50)-($51))|0);
 var $53=_process_plane($45,$46,$47,$49,$52);
 $bytes_pro=$53;
 var $54=$bytes_pro;
 var $55=$total_pro;
 var $56=((($55)+($54))|0);
 $total_pro=$56;
 var $57=$bytes_pro;
 var $58=$5;
 var $59=(($58+$57)|0);
 $5=$59;
 var $60=$5;
 var $61=$3;
 var $62=$4;
 var $63=$2;
 var $64=(($63)|0);
 var $65=$6;
 var $66=$total_pro;
 var $67=((($65)-($66))|0);
 var $68=_process_plane($60,$61,$62,$64,$67);
 $bytes_pro=$68;
 var $69=$bytes_pro;
 var $70=$total_pro;
 var $71=((($70)+($69))|0);
 $total_pro=$71;
 var $72=$6;
 var $73=$total_pro;
 var $74=($72|0)==($73|0);
 var $75=($74&1);
 $1=$75;
 label=4;break;
 case 4: 
 var $77=$1;
 STACKTOP=sp;return $77;
  default: assert(0, "bad label: " + label);
 }

}


function _process_plane($in,$width,$height,$out,$size){
 var label=0;
 var sp=STACKTOP; (assert((STACKTOP|0) < (STACK_MAX|0))|0);
 label = 1; 
 while(1)switch(label){
 case 1: 
 var $1;
 var $2;
 var $3;
 var $4;
 var $5;
 var $indexw;
 var $indexh;
 var $code;
 var $collen;
 var $replen;
 var $color;
 var $x;
 var $revcode;
 var $last_line;
 var $this_line;
 var $org_in;
 var $org_out;
 $1=$in;
 $2=$width;
 $3=$height;
 $4=$out;
 $5=$size;
 var $6=$1;
 $org_in=$6;
 var $7=$4;
 $org_out=$7;
 $last_line=0;
 $indexh=0;
 label=2;break;
 case 2: 
 var $9=$indexh;
 var $10=$3;
 var $11=($9|0)<($10|0);
 if($11){label=3;break;}else{label=34;break;}
 case 3: 
 var $13=$org_out;
 var $14=$2;
 var $15=$3;
 var $16=(Math_imul($14,$15)|0);
 var $17=($16<<2);
 var $18=(($13+$17)|0);
 var $19=$indexh;
 var $20=((($19)+(1))|0);
 var $21=$2;
 var $22=(Math_imul($20,$21)|0);
 var $23=($22<<2);
 var $24=(((-$23))|0);
 var $25=(($18+$24)|0);
 $4=$25;
 $color=0;
 var $26=$4;
 $this_line=$26;
 $indexw=0;
 var $27=$last_line;
 var $28=($27|0)==0;
 if($28){label=4;break;}else{label=17;break;}
 case 4: 
 label=5;break;
 case 5: 
 var $31=$indexw;
 var $32=$2;
 var $33=($31|0)<($32|0);
 if($33){label=6;break;}else{label=16;break;}
 case 6: 
 var $35=$1;
 var $36=(($35+1)|0);
 $1=$36;
 var $37=HEAP8[($35)];
 var $38=($37&255);
 $code=$38;
 var $39=$code;
 var $40=$39&15;
 $replen=$40;
 var $41=$code;
 var $42=$41>>4;
 var $43=$42&15;
 $collen=$43;
 var $44=$replen;
 var $45=$44<<4;
 var $46=$collen;
 var $47=$45|$46;
 $revcode=$47;
 var $48=$revcode;
 var $49=($48|0)<=47;
 if($49){label=7;break;}else{label=9;break;}
 case 7: 
 var $51=$revcode;
 var $52=($51|0)>=16;
 if($52){label=8;break;}else{label=9;break;}
 case 8: 
 var $54=$revcode;
 $replen=$54;
 $collen=0;
 label=9;break;
 case 9: 
 label=10;break;
 case 10: 
 var $57=$collen;
 var $58=($57|0)>0;
 if($58){label=11;break;}else{label=12;break;}
 case 11: 
 var $60=$1;
 var $61=(($60+1)|0);
 $1=$61;
 var $62=HEAP8[($60)];
 var $63=($62&255);
 $color=$63;
 var $64=$color;
 var $65=(($64)&255);
 var $66=$4;
 HEAP8[($66)]=$65;
 var $67=$4;
 var $68=(($67+4)|0);
 $4=$68;
 var $69=$indexw;
 var $70=((($69)+(1))|0);
 $indexw=$70;
 var $71=$collen;
 var $72=((($71)-(1))|0);
 $collen=$72;
 label=10;break;
 case 12: 
 label=13;break;
 case 13: 
 var $75=$replen;
 var $76=($75|0)>0;
 if($76){label=14;break;}else{label=15;break;}
 case 14: 
 var $78=$color;
 var $79=(($78)&255);
 var $80=$4;
 HEAP8[($80)]=$79;
 var $81=$4;
 var $82=(($81+4)|0);
 $4=$82;
 var $83=$indexw;
 var $84=((($83)+(1))|0);
 $indexw=$84;
 var $85=$replen;
 var $86=((($85)-(1))|0);
 $replen=$86;
 label=13;break;
 case 15: 
 label=5;break;
 case 16: 
 label=33;break;
 case 17: 
 label=18;break;
 case 18: 
 var $91=$indexw;
 var $92=$2;
 var $93=($91|0)<($92|0);
 if($93){label=19;break;}else{label=32;break;}
 case 19: 
 var $95=$1;
 var $96=(($95+1)|0);
 $1=$96;
 var $97=HEAP8[($95)];
 var $98=($97&255);
 $code=$98;
 var $99=$code;
 var $100=$99&15;
 $replen=$100;
 var $101=$code;
 var $102=$101>>4;
 var $103=$102&15;
 $collen=$103;
 var $104=$replen;
 var $105=$104<<4;
 var $106=$collen;
 var $107=$105|$106;
 $revcode=$107;
 var $108=$revcode;
 var $109=($108|0)<=47;
 if($109){label=20;break;}else{label=22;break;}
 case 20: 
 var $111=$revcode;
 var $112=($111|0)>=16;
 if($112){label=21;break;}else{label=22;break;}
 case 21: 
 var $114=$revcode;
 $replen=$114;
 $collen=0;
 label=22;break;
 case 22: 
 label=23;break;
 case 23: 
 var $117=$collen;
 var $118=($117|0)>0;
 if($118){label=24;break;}else{label=28;break;}
 case 24: 
 var $120=$1;
 var $121=(($120+1)|0);
 $1=$121;
 var $122=HEAP8[($120)];
 var $123=($122&255);
 $x=$123;
 var $124=$x;
 var $125=$124&1;
 var $126=($125|0)!=0;
 if($126){label=25;break;}else{label=26;break;}
 case 25: 
 var $128=$x;
 var $129=$128>>1;
 $x=$129;
 var $130=$x;
 var $131=((($130)+(1))|0);
 $x=$131;
 var $132=$x;
 var $133=(((-$132))|0);
 $color=$133;
 label=27;break;
 case 26: 
 var $135=$x;
 var $136=$135>>1;
 $x=$136;
 var $137=$x;
 $color=$137;
 label=27;break;
 case 27: 
 var $139=$indexw;
 var $140=($139<<2);
 var $141=$last_line;
 var $142=(($141+$140)|0);
 var $143=HEAP8[($142)];
 var $144=($143&255);
 var $145=$color;
 var $146=((($144)+($145))|0);
 $x=$146;
 var $147=$x;
 var $148=(($147)&255);
 var $149=$4;
 HEAP8[($149)]=$148;
 var $150=$4;
 var $151=(($150+4)|0);
 $4=$151;
 var $152=$indexw;
 var $153=((($152)+(1))|0);
 $indexw=$153;
 var $154=$collen;
 var $155=((($154)-(1))|0);
 $collen=$155;
 label=23;break;
 case 28: 
 label=29;break;
 case 29: 
 var $158=$replen;
 var $159=($158|0)>0;
 if($159){label=30;break;}else{label=31;break;}
 case 30: 
 var $161=$indexw;
 var $162=($161<<2);
 var $163=$last_line;
 var $164=(($163+$162)|0);
 var $165=HEAP8[($164)];
 var $166=($165&255);
 var $167=$color;
 var $168=((($166)+($167))|0);
 $x=$168;
 var $169=$x;
 var $170=(($169)&255);
 var $171=$4;
 HEAP8[($171)]=$170;
 var $172=$4;
 var $173=(($172+4)|0);
 $4=$173;
 var $174=$indexw;
 var $175=((($174)+(1))|0);
 $indexw=$175;
 var $176=$replen;
 var $177=((($176)-(1))|0);
 $replen=$177;
 label=29;break;
 case 31: 
 label=18;break;
 case 32: 
 label=33;break;
 case 33: 
 var $181=$indexh;
 var $182=((($181)+(1))|0);
 $indexh=$182;
 var $183=$this_line;
 $last_line=$183;
 label=2;break;
 case 34: 
 var $185=$1;
 var $186=$org_in;
 var $187=$185;
 var $188=$186;
 var $189=((($187)-($188))|0);
 STACKTOP=sp;return $189;
  default: assert(0, "bad label: " + label);
 }

}


function _malloc($bytes){
 var label=0;

 label = 1; 
 while(1)switch(label){
 case 1: 
 var $1=($bytes>>>0)<245;
 if($1){label=2;break;}else{label=78;break;}
 case 2: 
 var $3=($bytes>>>0)<11;
 if($3){var $8=16;label=4;break;}else{label=3;break;}
 case 3: 
 var $5=((($bytes)+(11))|0);
 var $6=$5&-8;
 var $8=$6;label=4;break;
 case 4: 
 var $8;
 var $9=$8>>>3;
 var $10=HEAP32[((40)>>2)];
 var $11=$10>>>($9>>>0);
 var $12=$11&3;
 var $13=($12|0)==0;
 if($13){label=12;break;}else{label=5;break;}
 case 5: 
 var $15=$11&1;
 var $16=$15^1;
 var $17=((($16)+($9))|0);
 var $18=$17<<1;
 var $19=((80+($18<<2))|0);
 var $20=$19;
 var $_sum11=((($18)+(2))|0);
 var $21=((80+($_sum11<<2))|0);
 var $22=HEAP32[(($21)>>2)];
 var $23=(($22+8)|0);
 var $24=HEAP32[(($23)>>2)];
 var $25=($20|0)==($24|0);
 if($25){label=6;break;}else{label=7;break;}
 case 6: 
 var $27=1<<$17;
 var $28=$27^-1;
 var $29=$10&$28;
 HEAP32[((40)>>2)]=$29;
 label=11;break;
 case 7: 
 var $31=$24;
 var $32=HEAP32[((56)>>2)];
 var $33=($31>>>0)<($32>>>0);
 if($33){label=10;break;}else{label=8;break;}
 case 8: 
 var $35=(($24+12)|0);
 var $36=HEAP32[(($35)>>2)];
 var $37=($36|0)==($22|0);
 if($37){label=9;break;}else{label=10;break;}
 case 9: 
 HEAP32[(($35)>>2)]=$20;
 HEAP32[(($21)>>2)]=$24;
 label=11;break;
 case 10: 
 _abort();
 throw "Reached an unreachable!";
 case 11: 
 var $40=$17<<3;
 var $41=$40|3;
 var $42=(($22+4)|0);
 HEAP32[(($42)>>2)]=$41;
 var $43=$22;
 var $_sum1314=$40|4;
 var $44=(($43+$_sum1314)|0);
 var $45=$44;
 var $46=HEAP32[(($45)>>2)];
 var $47=$46|1;
 HEAP32[(($45)>>2)]=$47;
 var $48=$23;
 var $mem_0=$48;label=341;break;
 case 12: 
 var $50=HEAP32[((48)>>2)];
 var $51=($8>>>0)>($50>>>0);
 if($51){label=13;break;}else{var $nb_0=$8;label=160;break;}
 case 13: 
 var $53=($11|0)==0;
 if($53){label=27;break;}else{label=14;break;}
 case 14: 
 var $55=$11<<$9;
 var $56=2<<$9;
 var $57=(((-$56))|0);
 var $58=$56|$57;
 var $59=$55&$58;
 var $60=(((-$59))|0);
 var $61=$59&$60;
 var $62=((($61)-(1))|0);
 var $63=$62>>>12;
 var $64=$63&16;
 var $65=$62>>>($64>>>0);
 var $66=$65>>>5;
 var $67=$66&8;
 var $68=$67|$64;
 var $69=$65>>>($67>>>0);
 var $70=$69>>>2;
 var $71=$70&4;
 var $72=$68|$71;
 var $73=$69>>>($71>>>0);
 var $74=$73>>>1;
 var $75=$74&2;
 var $76=$72|$75;
 var $77=$73>>>($75>>>0);
 var $78=$77>>>1;
 var $79=$78&1;
 var $80=$76|$79;
 var $81=$77>>>($79>>>0);
 var $82=((($80)+($81))|0);
 var $83=$82<<1;
 var $84=((80+($83<<2))|0);
 var $85=$84;
 var $_sum4=((($83)+(2))|0);
 var $86=((80+($_sum4<<2))|0);
 var $87=HEAP32[(($86)>>2)];
 var $88=(($87+8)|0);
 var $89=HEAP32[(($88)>>2)];
 var $90=($85|0)==($89|0);
 if($90){label=15;break;}else{label=16;break;}
 case 15: 
 var $92=1<<$82;
 var $93=$92^-1;
 var $94=$10&$93;
 HEAP32[((40)>>2)]=$94;
 label=20;break;
 case 16: 
 var $96=$89;
 var $97=HEAP32[((56)>>2)];
 var $98=($96>>>0)<($97>>>0);
 if($98){label=19;break;}else{label=17;break;}
 case 17: 
 var $100=(($89+12)|0);
 var $101=HEAP32[(($100)>>2)];
 var $102=($101|0)==($87|0);
 if($102){label=18;break;}else{label=19;break;}
 case 18: 
 HEAP32[(($100)>>2)]=$85;
 HEAP32[(($86)>>2)]=$89;
 label=20;break;
 case 19: 
 _abort();
 throw "Reached an unreachable!";
 case 20: 
 var $105=$82<<3;
 var $106=((($105)-($8))|0);
 var $107=$8|3;
 var $108=(($87+4)|0);
 HEAP32[(($108)>>2)]=$107;
 var $109=$87;
 var $110=(($109+$8)|0);
 var $111=$110;
 var $112=$106|1;
 var $_sum67=$8|4;
 var $113=(($109+$_sum67)|0);
 var $114=$113;
 HEAP32[(($114)>>2)]=$112;
 var $115=(($109+$105)|0);
 var $116=$115;
 HEAP32[(($116)>>2)]=$106;
 var $117=HEAP32[((48)>>2)];
 var $118=($117|0)==0;
 if($118){label=26;break;}else{label=21;break;}
 case 21: 
 var $120=HEAP32[((60)>>2)];
 var $121=$117>>>3;
 var $122=$121<<1;
 var $123=((80+($122<<2))|0);
 var $124=$123;
 var $125=HEAP32[((40)>>2)];
 var $126=1<<$121;
 var $127=$125&$126;
 var $128=($127|0)==0;
 if($128){label=22;break;}else{label=23;break;}
 case 22: 
 var $130=$125|$126;
 HEAP32[((40)>>2)]=$130;
 var $_sum9_pre=((($122)+(2))|0);
 var $_pre=((80+($_sum9_pre<<2))|0);
 var $F4_0=$124;var $_pre_phi=$_pre;label=25;break;
 case 23: 
 var $_sum10=((($122)+(2))|0);
 var $132=((80+($_sum10<<2))|0);
 var $133=HEAP32[(($132)>>2)];
 var $134=$133;
 var $135=HEAP32[((56)>>2)];
 var $136=($134>>>0)<($135>>>0);
 if($136){label=24;break;}else{var $F4_0=$133;var $_pre_phi=$132;label=25;break;}
 case 24: 
 _abort();
 throw "Reached an unreachable!";
 case 25: 
 var $_pre_phi;
 var $F4_0;
 HEAP32[(($_pre_phi)>>2)]=$120;
 var $139=(($F4_0+12)|0);
 HEAP32[(($139)>>2)]=$120;
 var $140=(($120+8)|0);
 HEAP32[(($140)>>2)]=$F4_0;
 var $141=(($120+12)|0);
 HEAP32[(($141)>>2)]=$124;
 label=26;break;
 case 26: 
 HEAP32[((48)>>2)]=$106;
 HEAP32[((60)>>2)]=$111;
 var $143=$88;
 var $mem_0=$143;label=341;break;
 case 27: 
 var $145=HEAP32[((44)>>2)];
 var $146=($145|0)==0;
 if($146){var $nb_0=$8;label=160;break;}else{label=28;break;}
 case 28: 
 var $148=(((-$145))|0);
 var $149=$145&$148;
 var $150=((($149)-(1))|0);
 var $151=$150>>>12;
 var $152=$151&16;
 var $153=$150>>>($152>>>0);
 var $154=$153>>>5;
 var $155=$154&8;
 var $156=$155|$152;
 var $157=$153>>>($155>>>0);
 var $158=$157>>>2;
 var $159=$158&4;
 var $160=$156|$159;
 var $161=$157>>>($159>>>0);
 var $162=$161>>>1;
 var $163=$162&2;
 var $164=$160|$163;
 var $165=$161>>>($163>>>0);
 var $166=$165>>>1;
 var $167=$166&1;
 var $168=$164|$167;
 var $169=$165>>>($167>>>0);
 var $170=((($168)+($169))|0);
 var $171=((344+($170<<2))|0);
 var $172=HEAP32[(($171)>>2)];
 var $173=(($172+4)|0);
 var $174=HEAP32[(($173)>>2)];
 var $175=$174&-8;
 var $176=((($175)-($8))|0);
 var $t_0_i=$172;var $v_0_i=$172;var $rsize_0_i=$176;label=29;break;
 case 29: 
 var $rsize_0_i;
 var $v_0_i;
 var $t_0_i;
 var $178=(($t_0_i+16)|0);
 var $179=HEAP32[(($178)>>2)];
 var $180=($179|0)==0;
 if($180){label=30;break;}else{var $185=$179;label=31;break;}
 case 30: 
 var $182=(($t_0_i+20)|0);
 var $183=HEAP32[(($182)>>2)];
 var $184=($183|0)==0;
 if($184){label=32;break;}else{var $185=$183;label=31;break;}
 case 31: 
 var $185;
 var $186=(($185+4)|0);
 var $187=HEAP32[(($186)>>2)];
 var $188=$187&-8;
 var $189=((($188)-($8))|0);
 var $190=($189>>>0)<($rsize_0_i>>>0);
 var $_rsize_0_i=($190?$189:$rsize_0_i);
 var $_v_0_i=($190?$185:$v_0_i);
 var $t_0_i=$185;var $v_0_i=$_v_0_i;var $rsize_0_i=$_rsize_0_i;label=29;break;
 case 32: 
 var $192=$v_0_i;
 var $193=HEAP32[((56)>>2)];
 var $194=($192>>>0)<($193>>>0);
 if($194){label=76;break;}else{label=33;break;}
 case 33: 
 var $196=(($192+$8)|0);
 var $197=$196;
 var $198=($192>>>0)<($196>>>0);
 if($198){label=34;break;}else{label=76;break;}
 case 34: 
 var $200=(($v_0_i+24)|0);
 var $201=HEAP32[(($200)>>2)];
 var $202=(($v_0_i+12)|0);
 var $203=HEAP32[(($202)>>2)];
 var $204=($203|0)==($v_0_i|0);
 if($204){label=40;break;}else{label=35;break;}
 case 35: 
 var $206=(($v_0_i+8)|0);
 var $207=HEAP32[(($206)>>2)];
 var $208=$207;
 var $209=($208>>>0)<($193>>>0);
 if($209){label=39;break;}else{label=36;break;}
 case 36: 
 var $211=(($207+12)|0);
 var $212=HEAP32[(($211)>>2)];
 var $213=($212|0)==($v_0_i|0);
 if($213){label=37;break;}else{label=39;break;}
 case 37: 
 var $215=(($203+8)|0);
 var $216=HEAP32[(($215)>>2)];
 var $217=($216|0)==($v_0_i|0);
 if($217){label=38;break;}else{label=39;break;}
 case 38: 
 HEAP32[(($211)>>2)]=$203;
 HEAP32[(($215)>>2)]=$207;
 var $R_1_i=$203;label=47;break;
 case 39: 
 _abort();
 throw "Reached an unreachable!";
 case 40: 
 var $220=(($v_0_i+20)|0);
 var $221=HEAP32[(($220)>>2)];
 var $222=($221|0)==0;
 if($222){label=41;break;}else{var $R_0_i=$221;var $RP_0_i=$220;label=42;break;}
 case 41: 
 var $224=(($v_0_i+16)|0);
 var $225=HEAP32[(($224)>>2)];
 var $226=($225|0)==0;
 if($226){var $R_1_i=0;label=47;break;}else{var $R_0_i=$225;var $RP_0_i=$224;label=42;break;}
 case 42: 
 var $RP_0_i;
 var $R_0_i;
 var $227=(($R_0_i+20)|0);
 var $228=HEAP32[(($227)>>2)];
 var $229=($228|0)==0;
 if($229){label=43;break;}else{var $R_0_i=$228;var $RP_0_i=$227;label=42;break;}
 case 43: 
 var $231=(($R_0_i+16)|0);
 var $232=HEAP32[(($231)>>2)];
 var $233=($232|0)==0;
 if($233){label=44;break;}else{var $R_0_i=$232;var $RP_0_i=$231;label=42;break;}
 case 44: 
 var $235=$RP_0_i;
 var $236=($235>>>0)<($193>>>0);
 if($236){label=46;break;}else{label=45;break;}
 case 45: 
 HEAP32[(($RP_0_i)>>2)]=0;
 var $R_1_i=$R_0_i;label=47;break;
 case 46: 
 _abort();
 throw "Reached an unreachable!";
 case 47: 
 var $R_1_i;
 var $240=($201|0)==0;
 if($240){label=67;break;}else{label=48;break;}
 case 48: 
 var $242=(($v_0_i+28)|0);
 var $243=HEAP32[(($242)>>2)];
 var $244=((344+($243<<2))|0);
 var $245=HEAP32[(($244)>>2)];
 var $246=($v_0_i|0)==($245|0);
 if($246){label=49;break;}else{label=51;break;}
 case 49: 
 HEAP32[(($244)>>2)]=$R_1_i;
 var $cond_i=($R_1_i|0)==0;
 if($cond_i){label=50;break;}else{label=57;break;}
 case 50: 
 var $248=HEAP32[(($242)>>2)];
 var $249=1<<$248;
 var $250=$249^-1;
 var $251=HEAP32[((44)>>2)];
 var $252=$251&$250;
 HEAP32[((44)>>2)]=$252;
 label=67;break;
 case 51: 
 var $254=$201;
 var $255=HEAP32[((56)>>2)];
 var $256=($254>>>0)<($255>>>0);
 if($256){label=55;break;}else{label=52;break;}
 case 52: 
 var $258=(($201+16)|0);
 var $259=HEAP32[(($258)>>2)];
 var $260=($259|0)==($v_0_i|0);
 if($260){label=53;break;}else{label=54;break;}
 case 53: 
 HEAP32[(($258)>>2)]=$R_1_i;
 label=56;break;
 case 54: 
 var $263=(($201+20)|0);
 HEAP32[(($263)>>2)]=$R_1_i;
 label=56;break;
 case 55: 
 _abort();
 throw "Reached an unreachable!";
 case 56: 
 var $266=($R_1_i|0)==0;
 if($266){label=67;break;}else{label=57;break;}
 case 57: 
 var $268=$R_1_i;
 var $269=HEAP32[((56)>>2)];
 var $270=($268>>>0)<($269>>>0);
 if($270){label=66;break;}else{label=58;break;}
 case 58: 
 var $272=(($R_1_i+24)|0);
 HEAP32[(($272)>>2)]=$201;
 var $273=(($v_0_i+16)|0);
 var $274=HEAP32[(($273)>>2)];
 var $275=($274|0)==0;
 if($275){label=62;break;}else{label=59;break;}
 case 59: 
 var $277=$274;
 var $278=HEAP32[((56)>>2)];
 var $279=($277>>>0)<($278>>>0);
 if($279){label=61;break;}else{label=60;break;}
 case 60: 
 var $281=(($R_1_i+16)|0);
 HEAP32[(($281)>>2)]=$274;
 var $282=(($274+24)|0);
 HEAP32[(($282)>>2)]=$R_1_i;
 label=62;break;
 case 61: 
 _abort();
 throw "Reached an unreachable!";
 case 62: 
 var $285=(($v_0_i+20)|0);
 var $286=HEAP32[(($285)>>2)];
 var $287=($286|0)==0;
 if($287){label=67;break;}else{label=63;break;}
 case 63: 
 var $289=$286;
 var $290=HEAP32[((56)>>2)];
 var $291=($289>>>0)<($290>>>0);
 if($291){label=65;break;}else{label=64;break;}
 case 64: 
 var $293=(($R_1_i+20)|0);
 HEAP32[(($293)>>2)]=$286;
 var $294=(($286+24)|0);
 HEAP32[(($294)>>2)]=$R_1_i;
 label=67;break;
 case 65: 
 _abort();
 throw "Reached an unreachable!";
 case 66: 
 _abort();
 throw "Reached an unreachable!";
 case 67: 
 var $298=($rsize_0_i>>>0)<16;
 if($298){label=68;break;}else{label=69;break;}
 case 68: 
 var $300=((($rsize_0_i)+($8))|0);
 var $301=$300|3;
 var $302=(($v_0_i+4)|0);
 HEAP32[(($302)>>2)]=$301;
 var $_sum4_i=((($300)+(4))|0);
 var $303=(($192+$_sum4_i)|0);
 var $304=$303;
 var $305=HEAP32[(($304)>>2)];
 var $306=$305|1;
 HEAP32[(($304)>>2)]=$306;
 label=77;break;
 case 69: 
 var $308=$8|3;
 var $309=(($v_0_i+4)|0);
 HEAP32[(($309)>>2)]=$308;
 var $310=$rsize_0_i|1;
 var $_sum_i41=$8|4;
 var $311=(($192+$_sum_i41)|0);
 var $312=$311;
 HEAP32[(($312)>>2)]=$310;
 var $_sum1_i=((($rsize_0_i)+($8))|0);
 var $313=(($192+$_sum1_i)|0);
 var $314=$313;
 HEAP32[(($314)>>2)]=$rsize_0_i;
 var $315=HEAP32[((48)>>2)];
 var $316=($315|0)==0;
 if($316){label=75;break;}else{label=70;break;}
 case 70: 
 var $318=HEAP32[((60)>>2)];
 var $319=$315>>>3;
 var $320=$319<<1;
 var $321=((80+($320<<2))|0);
 var $322=$321;
 var $323=HEAP32[((40)>>2)];
 var $324=1<<$319;
 var $325=$323&$324;
 var $326=($325|0)==0;
 if($326){label=71;break;}else{label=72;break;}
 case 71: 
 var $328=$323|$324;
 HEAP32[((40)>>2)]=$328;
 var $_sum2_pre_i=((($320)+(2))|0);
 var $_pre_i=((80+($_sum2_pre_i<<2))|0);
 var $F1_0_i=$322;var $_pre_phi_i=$_pre_i;label=74;break;
 case 72: 
 var $_sum3_i=((($320)+(2))|0);
 var $330=((80+($_sum3_i<<2))|0);
 var $331=HEAP32[(($330)>>2)];
 var $332=$331;
 var $333=HEAP32[((56)>>2)];
 var $334=($332>>>0)<($333>>>0);
 if($334){label=73;break;}else{var $F1_0_i=$331;var $_pre_phi_i=$330;label=74;break;}
 case 73: 
 _abort();
 throw "Reached an unreachable!";
 case 74: 
 var $_pre_phi_i;
 var $F1_0_i;
 HEAP32[(($_pre_phi_i)>>2)]=$318;
 var $337=(($F1_0_i+12)|0);
 HEAP32[(($337)>>2)]=$318;
 var $338=(($318+8)|0);
 HEAP32[(($338)>>2)]=$F1_0_i;
 var $339=(($318+12)|0);
 HEAP32[(($339)>>2)]=$322;
 label=75;break;
 case 75: 
 HEAP32[((48)>>2)]=$rsize_0_i;
 HEAP32[((60)>>2)]=$197;
 label=77;break;
 case 76: 
 _abort();
 throw "Reached an unreachable!";
 case 77: 
 var $342=(($v_0_i+8)|0);
 var $343=$342;
 var $mem_0=$343;label=341;break;
 case 78: 
 var $345=($bytes>>>0)>4294967231;
 if($345){var $nb_0=-1;label=160;break;}else{label=79;break;}
 case 79: 
 var $347=((($bytes)+(11))|0);
 var $348=$347&-8;
 var $349=HEAP32[((44)>>2)];
 var $350=($349|0)==0;
 if($350){var $nb_0=$348;label=160;break;}else{label=80;break;}
 case 80: 
 var $352=(((-$348))|0);
 var $353=$347>>>8;
 var $354=($353|0)==0;
 if($354){var $idx_0_i=0;label=83;break;}else{label=81;break;}
 case 81: 
 var $356=($348>>>0)>16777215;
 if($356){var $idx_0_i=31;label=83;break;}else{label=82;break;}
 case 82: 
 var $358=((($353)+(1048320))|0);
 var $359=$358>>>16;
 var $360=$359&8;
 var $361=$353<<$360;
 var $362=((($361)+(520192))|0);
 var $363=$362>>>16;
 var $364=$363&4;
 var $365=$364|$360;
 var $366=$361<<$364;
 var $367=((($366)+(245760))|0);
 var $368=$367>>>16;
 var $369=$368&2;
 var $370=$365|$369;
 var $371=(((14)-($370))|0);
 var $372=$366<<$369;
 var $373=$372>>>15;
 var $374=((($371)+($373))|0);
 var $375=$374<<1;
 var $376=((($374)+(7))|0);
 var $377=$348>>>($376>>>0);
 var $378=$377&1;
 var $379=$378|$375;
 var $idx_0_i=$379;label=83;break;
 case 83: 
 var $idx_0_i;
 var $381=((344+($idx_0_i<<2))|0);
 var $382=HEAP32[(($381)>>2)];
 var $383=($382|0)==0;
 if($383){var $v_2_i=0;var $rsize_2_i=$352;var $t_1_i=0;label=90;break;}else{label=84;break;}
 case 84: 
 var $385=($idx_0_i|0)==31;
 if($385){var $390=0;label=86;break;}else{label=85;break;}
 case 85: 
 var $387=$idx_0_i>>>1;
 var $388=(((25)-($387))|0);
 var $390=$388;label=86;break;
 case 86: 
 var $390;
 var $391=$348<<$390;
 var $v_0_i18=0;var $rsize_0_i17=$352;var $t_0_i16=$382;var $sizebits_0_i=$391;var $rst_0_i=0;label=87;break;
 case 87: 
 var $rst_0_i;
 var $sizebits_0_i;
 var $t_0_i16;
 var $rsize_0_i17;
 var $v_0_i18;
 var $393=(($t_0_i16+4)|0);
 var $394=HEAP32[(($393)>>2)];
 var $395=$394&-8;
 var $396=((($395)-($348))|0);
 var $397=($396>>>0)<($rsize_0_i17>>>0);
 if($397){label=88;break;}else{var $v_1_i=$v_0_i18;var $rsize_1_i=$rsize_0_i17;label=89;break;}
 case 88: 
 var $399=($395|0)==($348|0);
 if($399){var $v_2_i=$t_0_i16;var $rsize_2_i=$396;var $t_1_i=$t_0_i16;label=90;break;}else{var $v_1_i=$t_0_i16;var $rsize_1_i=$396;label=89;break;}
 case 89: 
 var $rsize_1_i;
 var $v_1_i;
 var $401=(($t_0_i16+20)|0);
 var $402=HEAP32[(($401)>>2)];
 var $403=$sizebits_0_i>>>31;
 var $404=(($t_0_i16+16+($403<<2))|0);
 var $405=HEAP32[(($404)>>2)];
 var $406=($402|0)==0;
 var $407=($402|0)==($405|0);
 var $or_cond21_i=$406|$407;
 var $rst_1_i=($or_cond21_i?$rst_0_i:$402);
 var $408=($405|0)==0;
 var $409=$sizebits_0_i<<1;
 if($408){var $v_2_i=$v_1_i;var $rsize_2_i=$rsize_1_i;var $t_1_i=$rst_1_i;label=90;break;}else{var $v_0_i18=$v_1_i;var $rsize_0_i17=$rsize_1_i;var $t_0_i16=$405;var $sizebits_0_i=$409;var $rst_0_i=$rst_1_i;label=87;break;}
 case 90: 
 var $t_1_i;
 var $rsize_2_i;
 var $v_2_i;
 var $410=($t_1_i|0)==0;
 var $411=($v_2_i|0)==0;
 var $or_cond_i=$410&$411;
 if($or_cond_i){label=91;break;}else{var $t_2_ph_i=$t_1_i;label=93;break;}
 case 91: 
 var $413=2<<$idx_0_i;
 var $414=(((-$413))|0);
 var $415=$413|$414;
 var $416=$349&$415;
 var $417=($416|0)==0;
 if($417){var $nb_0=$348;label=160;break;}else{label=92;break;}
 case 92: 
 var $419=(((-$416))|0);
 var $420=$416&$419;
 var $421=((($420)-(1))|0);
 var $422=$421>>>12;
 var $423=$422&16;
 var $424=$421>>>($423>>>0);
 var $425=$424>>>5;
 var $426=$425&8;
 var $427=$426|$423;
 var $428=$424>>>($426>>>0);
 var $429=$428>>>2;
 var $430=$429&4;
 var $431=$427|$430;
 var $432=$428>>>($430>>>0);
 var $433=$432>>>1;
 var $434=$433&2;
 var $435=$431|$434;
 var $436=$432>>>($434>>>0);
 var $437=$436>>>1;
 var $438=$437&1;
 var $439=$435|$438;
 var $440=$436>>>($438>>>0);
 var $441=((($439)+($440))|0);
 var $442=((344+($441<<2))|0);
 var $443=HEAP32[(($442)>>2)];
 var $t_2_ph_i=$443;label=93;break;
 case 93: 
 var $t_2_ph_i;
 var $444=($t_2_ph_i|0)==0;
 if($444){var $rsize_3_lcssa_i=$rsize_2_i;var $v_3_lcssa_i=$v_2_i;label=96;break;}else{var $t_232_i=$t_2_ph_i;var $rsize_333_i=$rsize_2_i;var $v_334_i=$v_2_i;label=94;break;}
 case 94: 
 var $v_334_i;
 var $rsize_333_i;
 var $t_232_i;
 var $445=(($t_232_i+4)|0);
 var $446=HEAP32[(($445)>>2)];
 var $447=$446&-8;
 var $448=((($447)-($348))|0);
 var $449=($448>>>0)<($rsize_333_i>>>0);
 var $_rsize_3_i=($449?$448:$rsize_333_i);
 var $t_2_v_3_i=($449?$t_232_i:$v_334_i);
 var $450=(($t_232_i+16)|0);
 var $451=HEAP32[(($450)>>2)];
 var $452=($451|0)==0;
 if($452){label=95;break;}else{var $t_232_i=$451;var $rsize_333_i=$_rsize_3_i;var $v_334_i=$t_2_v_3_i;label=94;break;}
 case 95: 
 var $453=(($t_232_i+20)|0);
 var $454=HEAP32[(($453)>>2)];
 var $455=($454|0)==0;
 if($455){var $rsize_3_lcssa_i=$_rsize_3_i;var $v_3_lcssa_i=$t_2_v_3_i;label=96;break;}else{var $t_232_i=$454;var $rsize_333_i=$_rsize_3_i;var $v_334_i=$t_2_v_3_i;label=94;break;}
 case 96: 
 var $v_3_lcssa_i;
 var $rsize_3_lcssa_i;
 var $456=($v_3_lcssa_i|0)==0;
 if($456){var $nb_0=$348;label=160;break;}else{label=97;break;}
 case 97: 
 var $458=HEAP32[((48)>>2)];
 var $459=((($458)-($348))|0);
 var $460=($rsize_3_lcssa_i>>>0)<($459>>>0);
 if($460){label=98;break;}else{var $nb_0=$348;label=160;break;}
 case 98: 
 var $462=$v_3_lcssa_i;
 var $463=HEAP32[((56)>>2)];
 var $464=($462>>>0)<($463>>>0);
 if($464){label=158;break;}else{label=99;break;}
 case 99: 
 var $466=(($462+$348)|0);
 var $467=$466;
 var $468=($462>>>0)<($466>>>0);
 if($468){label=100;break;}else{label=158;break;}
 case 100: 
 var $470=(($v_3_lcssa_i+24)|0);
 var $471=HEAP32[(($470)>>2)];
 var $472=(($v_3_lcssa_i+12)|0);
 var $473=HEAP32[(($472)>>2)];
 var $474=($473|0)==($v_3_lcssa_i|0);
 if($474){label=106;break;}else{label=101;break;}
 case 101: 
 var $476=(($v_3_lcssa_i+8)|0);
 var $477=HEAP32[(($476)>>2)];
 var $478=$477;
 var $479=($478>>>0)<($463>>>0);
 if($479){label=105;break;}else{label=102;break;}
 case 102: 
 var $481=(($477+12)|0);
 var $482=HEAP32[(($481)>>2)];
 var $483=($482|0)==($v_3_lcssa_i|0);
 if($483){label=103;break;}else{label=105;break;}
 case 103: 
 var $485=(($473+8)|0);
 var $486=HEAP32[(($485)>>2)];
 var $487=($486|0)==($v_3_lcssa_i|0);
 if($487){label=104;break;}else{label=105;break;}
 case 104: 
 HEAP32[(($481)>>2)]=$473;
 HEAP32[(($485)>>2)]=$477;
 var $R_1_i22=$473;label=113;break;
 case 105: 
 _abort();
 throw "Reached an unreachable!";
 case 106: 
 var $490=(($v_3_lcssa_i+20)|0);
 var $491=HEAP32[(($490)>>2)];
 var $492=($491|0)==0;
 if($492){label=107;break;}else{var $R_0_i20=$491;var $RP_0_i19=$490;label=108;break;}
 case 107: 
 var $494=(($v_3_lcssa_i+16)|0);
 var $495=HEAP32[(($494)>>2)];
 var $496=($495|0)==0;
 if($496){var $R_1_i22=0;label=113;break;}else{var $R_0_i20=$495;var $RP_0_i19=$494;label=108;break;}
 case 108: 
 var $RP_0_i19;
 var $R_0_i20;
 var $497=(($R_0_i20+20)|0);
 var $498=HEAP32[(($497)>>2)];
 var $499=($498|0)==0;
 if($499){label=109;break;}else{var $R_0_i20=$498;var $RP_0_i19=$497;label=108;break;}
 case 109: 
 var $501=(($R_0_i20+16)|0);
 var $502=HEAP32[(($501)>>2)];
 var $503=($502|0)==0;
 if($503){label=110;break;}else{var $R_0_i20=$502;var $RP_0_i19=$501;label=108;break;}
 case 110: 
 var $505=$RP_0_i19;
 var $506=($505>>>0)<($463>>>0);
 if($506){label=112;break;}else{label=111;break;}
 case 111: 
 HEAP32[(($RP_0_i19)>>2)]=0;
 var $R_1_i22=$R_0_i20;label=113;break;
 case 112: 
 _abort();
 throw "Reached an unreachable!";
 case 113: 
 var $R_1_i22;
 var $510=($471|0)==0;
 if($510){label=133;break;}else{label=114;break;}
 case 114: 
 var $512=(($v_3_lcssa_i+28)|0);
 var $513=HEAP32[(($512)>>2)];
 var $514=((344+($513<<2))|0);
 var $515=HEAP32[(($514)>>2)];
 var $516=($v_3_lcssa_i|0)==($515|0);
 if($516){label=115;break;}else{label=117;break;}
 case 115: 
 HEAP32[(($514)>>2)]=$R_1_i22;
 var $cond_i23=($R_1_i22|0)==0;
 if($cond_i23){label=116;break;}else{label=123;break;}
 case 116: 
 var $518=HEAP32[(($512)>>2)];
 var $519=1<<$518;
 var $520=$519^-1;
 var $521=HEAP32[((44)>>2)];
 var $522=$521&$520;
 HEAP32[((44)>>2)]=$522;
 label=133;break;
 case 117: 
 var $524=$471;
 var $525=HEAP32[((56)>>2)];
 var $526=($524>>>0)<($525>>>0);
 if($526){label=121;break;}else{label=118;break;}
 case 118: 
 var $528=(($471+16)|0);
 var $529=HEAP32[(($528)>>2)];
 var $530=($529|0)==($v_3_lcssa_i|0);
 if($530){label=119;break;}else{label=120;break;}
 case 119: 
 HEAP32[(($528)>>2)]=$R_1_i22;
 label=122;break;
 case 120: 
 var $533=(($471+20)|0);
 HEAP32[(($533)>>2)]=$R_1_i22;
 label=122;break;
 case 121: 
 _abort();
 throw "Reached an unreachable!";
 case 122: 
 var $536=($R_1_i22|0)==0;
 if($536){label=133;break;}else{label=123;break;}
 case 123: 
 var $538=$R_1_i22;
 var $539=HEAP32[((56)>>2)];
 var $540=($538>>>0)<($539>>>0);
 if($540){label=132;break;}else{label=124;break;}
 case 124: 
 var $542=(($R_1_i22+24)|0);
 HEAP32[(($542)>>2)]=$471;
 var $543=(($v_3_lcssa_i+16)|0);
 var $544=HEAP32[(($543)>>2)];
 var $545=($544|0)==0;
 if($545){label=128;break;}else{label=125;break;}
 case 125: 
 var $547=$544;
 var $548=HEAP32[((56)>>2)];
 var $549=($547>>>0)<($548>>>0);
 if($549){label=127;break;}else{label=126;break;}
 case 126: 
 var $551=(($R_1_i22+16)|0);
 HEAP32[(($551)>>2)]=$544;
 var $552=(($544+24)|0);
 HEAP32[(($552)>>2)]=$R_1_i22;
 label=128;break;
 case 127: 
 _abort();
 throw "Reached an unreachable!";
 case 128: 
 var $555=(($v_3_lcssa_i+20)|0);
 var $556=HEAP32[(($555)>>2)];
 var $557=($556|0)==0;
 if($557){label=133;break;}else{label=129;break;}
 case 129: 
 var $559=$556;
 var $560=HEAP32[((56)>>2)];
 var $561=($559>>>0)<($560>>>0);
 if($561){label=131;break;}else{label=130;break;}
 case 130: 
 var $563=(($R_1_i22+20)|0);
 HEAP32[(($563)>>2)]=$556;
 var $564=(($556+24)|0);
 HEAP32[(($564)>>2)]=$R_1_i22;
 label=133;break;
 case 131: 
 _abort();
 throw "Reached an unreachable!";
 case 132: 
 _abort();
 throw "Reached an unreachable!";
 case 133: 
 var $568=($rsize_3_lcssa_i>>>0)<16;
 if($568){label=134;break;}else{label=135;break;}
 case 134: 
 var $570=((($rsize_3_lcssa_i)+($348))|0);
 var $571=$570|3;
 var $572=(($v_3_lcssa_i+4)|0);
 HEAP32[(($572)>>2)]=$571;
 var $_sum19_i=((($570)+(4))|0);
 var $573=(($462+$_sum19_i)|0);
 var $574=$573;
 var $575=HEAP32[(($574)>>2)];
 var $576=$575|1;
 HEAP32[(($574)>>2)]=$576;
 label=159;break;
 case 135: 
 var $578=$348|3;
 var $579=(($v_3_lcssa_i+4)|0);
 HEAP32[(($579)>>2)]=$578;
 var $580=$rsize_3_lcssa_i|1;
 var $_sum_i2540=$348|4;
 var $581=(($462+$_sum_i2540)|0);
 var $582=$581;
 HEAP32[(($582)>>2)]=$580;
 var $_sum1_i26=((($rsize_3_lcssa_i)+($348))|0);
 var $583=(($462+$_sum1_i26)|0);
 var $584=$583;
 HEAP32[(($584)>>2)]=$rsize_3_lcssa_i;
 var $585=$rsize_3_lcssa_i>>>3;
 var $586=($rsize_3_lcssa_i>>>0)<256;
 if($586){label=136;break;}else{label=141;break;}
 case 136: 
 var $588=$585<<1;
 var $589=((80+($588<<2))|0);
 var $590=$589;
 var $591=HEAP32[((40)>>2)];
 var $592=1<<$585;
 var $593=$591&$592;
 var $594=($593|0)==0;
 if($594){label=137;break;}else{label=138;break;}
 case 137: 
 var $596=$591|$592;
 HEAP32[((40)>>2)]=$596;
 var $_sum15_pre_i=((($588)+(2))|0);
 var $_pre_i27=((80+($_sum15_pre_i<<2))|0);
 var $F5_0_i=$590;var $_pre_phi_i28=$_pre_i27;label=140;break;
 case 138: 
 var $_sum18_i=((($588)+(2))|0);
 var $598=((80+($_sum18_i<<2))|0);
 var $599=HEAP32[(($598)>>2)];
 var $600=$599;
 var $601=HEAP32[((56)>>2)];
 var $602=($600>>>0)<($601>>>0);
 if($602){label=139;break;}else{var $F5_0_i=$599;var $_pre_phi_i28=$598;label=140;break;}
 case 139: 
 _abort();
 throw "Reached an unreachable!";
 case 140: 
 var $_pre_phi_i28;
 var $F5_0_i;
 HEAP32[(($_pre_phi_i28)>>2)]=$467;
 var $605=(($F5_0_i+12)|0);
 HEAP32[(($605)>>2)]=$467;
 var $_sum16_i=((($348)+(8))|0);
 var $606=(($462+$_sum16_i)|0);
 var $607=$606;
 HEAP32[(($607)>>2)]=$F5_0_i;
 var $_sum17_i=((($348)+(12))|0);
 var $608=(($462+$_sum17_i)|0);
 var $609=$608;
 HEAP32[(($609)>>2)]=$590;
 label=159;break;
 case 141: 
 var $611=$466;
 var $612=$rsize_3_lcssa_i>>>8;
 var $613=($612|0)==0;
 if($613){var $I7_0_i=0;label=144;break;}else{label=142;break;}
 case 142: 
 var $615=($rsize_3_lcssa_i>>>0)>16777215;
 if($615){var $I7_0_i=31;label=144;break;}else{label=143;break;}
 case 143: 
 var $617=((($612)+(1048320))|0);
 var $618=$617>>>16;
 var $619=$618&8;
 var $620=$612<<$619;
 var $621=((($620)+(520192))|0);
 var $622=$621>>>16;
 var $623=$622&4;
 var $624=$623|$619;
 var $625=$620<<$623;
 var $626=((($625)+(245760))|0);
 var $627=$626>>>16;
 var $628=$627&2;
 var $629=$624|$628;
 var $630=(((14)-($629))|0);
 var $631=$625<<$628;
 var $632=$631>>>15;
 var $633=((($630)+($632))|0);
 var $634=$633<<1;
 var $635=((($633)+(7))|0);
 var $636=$rsize_3_lcssa_i>>>($635>>>0);
 var $637=$636&1;
 var $638=$637|$634;
 var $I7_0_i=$638;label=144;break;
 case 144: 
 var $I7_0_i;
 var $640=((344+($I7_0_i<<2))|0);
 var $_sum2_i=((($348)+(28))|0);
 var $641=(($462+$_sum2_i)|0);
 var $642=$641;
 HEAP32[(($642)>>2)]=$I7_0_i;
 var $_sum3_i29=((($348)+(16))|0);
 var $643=(($462+$_sum3_i29)|0);
 var $_sum4_i30=((($348)+(20))|0);
 var $644=(($462+$_sum4_i30)|0);
 var $645=$644;
 HEAP32[(($645)>>2)]=0;
 var $646=$643;
 HEAP32[(($646)>>2)]=0;
 var $647=HEAP32[((44)>>2)];
 var $648=1<<$I7_0_i;
 var $649=$647&$648;
 var $650=($649|0)==0;
 if($650){label=145;break;}else{label=146;break;}
 case 145: 
 var $652=$647|$648;
 HEAP32[((44)>>2)]=$652;
 HEAP32[(($640)>>2)]=$611;
 var $653=$640;
 var $_sum5_i=((($348)+(24))|0);
 var $654=(($462+$_sum5_i)|0);
 var $655=$654;
 HEAP32[(($655)>>2)]=$653;
 var $_sum6_i=((($348)+(12))|0);
 var $656=(($462+$_sum6_i)|0);
 var $657=$656;
 HEAP32[(($657)>>2)]=$611;
 var $_sum7_i=((($348)+(8))|0);
 var $658=(($462+$_sum7_i)|0);
 var $659=$658;
 HEAP32[(($659)>>2)]=$611;
 label=159;break;
 case 146: 
 var $661=HEAP32[(($640)>>2)];
 var $662=($I7_0_i|0)==31;
 if($662){var $667=0;label=148;break;}else{label=147;break;}
 case 147: 
 var $664=$I7_0_i>>>1;
 var $665=(((25)-($664))|0);
 var $667=$665;label=148;break;
 case 148: 
 var $667;
 var $668=(($661+4)|0);
 var $669=HEAP32[(($668)>>2)];
 var $670=$669&-8;
 var $671=($670|0)==($rsize_3_lcssa_i|0);
 if($671){var $T_0_lcssa_i=$661;label=155;break;}else{label=149;break;}
 case 149: 
 var $672=$rsize_3_lcssa_i<<$667;
 var $T_028_i=$661;var $K12_029_i=$672;label=151;break;
 case 150: 
 var $674=$K12_029_i<<1;
 var $675=(($682+4)|0);
 var $676=HEAP32[(($675)>>2)];
 var $677=$676&-8;
 var $678=($677|0)==($rsize_3_lcssa_i|0);
 if($678){var $T_0_lcssa_i=$682;label=155;break;}else{var $T_028_i=$682;var $K12_029_i=$674;label=151;break;}
 case 151: 
 var $K12_029_i;
 var $T_028_i;
 var $680=$K12_029_i>>>31;
 var $681=(($T_028_i+16+($680<<2))|0);
 var $682=HEAP32[(($681)>>2)];
 var $683=($682|0)==0;
 if($683){label=152;break;}else{label=150;break;}
 case 152: 
 var $685=$681;
 var $686=HEAP32[((56)>>2)];
 var $687=($685>>>0)<($686>>>0);
 if($687){label=154;break;}else{label=153;break;}
 case 153: 
 HEAP32[(($681)>>2)]=$611;
 var $_sum12_i=((($348)+(24))|0);
 var $689=(($462+$_sum12_i)|0);
 var $690=$689;
 HEAP32[(($690)>>2)]=$T_028_i;
 var $_sum13_i=((($348)+(12))|0);
 var $691=(($462+$_sum13_i)|0);
 var $692=$691;
 HEAP32[(($692)>>2)]=$611;
 var $_sum14_i=((($348)+(8))|0);
 var $693=(($462+$_sum14_i)|0);
 var $694=$693;
 HEAP32[(($694)>>2)]=$611;
 label=159;break;
 case 154: 
 _abort();
 throw "Reached an unreachable!";
 case 155: 
 var $T_0_lcssa_i;
 var $696=(($T_0_lcssa_i+8)|0);
 var $697=HEAP32[(($696)>>2)];
 var $698=$T_0_lcssa_i;
 var $699=HEAP32[((56)>>2)];
 var $700=($698>>>0)>=($699>>>0);
 var $701=$697;
 var $702=($701>>>0)>=($699>>>0);
 var $or_cond26_i=$700&$702;
 if($or_cond26_i){label=156;break;}else{label=157;break;}
 case 156: 
 var $704=(($697+12)|0);
 HEAP32[(($704)>>2)]=$611;
 HEAP32[(($696)>>2)]=$611;
 var $_sum9_i=((($348)+(8))|0);
 var $705=(($462+$_sum9_i)|0);
 var $706=$705;
 HEAP32[(($706)>>2)]=$697;
 var $_sum10_i=((($348)+(12))|0);
 var $707=(($462+$_sum10_i)|0);
 var $708=$707;
 HEAP32[(($708)>>2)]=$T_0_lcssa_i;
 var $_sum11_i=((($348)+(24))|0);
 var $709=(($462+$_sum11_i)|0);
 var $710=$709;
 HEAP32[(($710)>>2)]=0;
 label=159;break;
 case 157: 
 _abort();
 throw "Reached an unreachable!";
 case 158: 
 _abort();
 throw "Reached an unreachable!";
 case 159: 
 var $712=(($v_3_lcssa_i+8)|0);
 var $713=$712;
 var $mem_0=$713;label=341;break;
 case 160: 
 var $nb_0;
 var $714=HEAP32[((48)>>2)];
 var $715=($714>>>0)<($nb_0>>>0);
 if($715){label=165;break;}else{label=161;break;}
 case 161: 
 var $717=((($714)-($nb_0))|0);
 var $718=HEAP32[((60)>>2)];
 var $719=($717>>>0)>15;
 if($719){label=162;break;}else{label=163;break;}
 case 162: 
 var $721=$718;
 var $722=(($721+$nb_0)|0);
 var $723=$722;
 HEAP32[((60)>>2)]=$723;
 HEAP32[((48)>>2)]=$717;
 var $724=$717|1;
 var $_sum2=((($nb_0)+(4))|0);
 var $725=(($721+$_sum2)|0);
 var $726=$725;
 HEAP32[(($726)>>2)]=$724;
 var $727=(($721+$714)|0);
 var $728=$727;
 HEAP32[(($728)>>2)]=$717;
 var $729=$nb_0|3;
 var $730=(($718+4)|0);
 HEAP32[(($730)>>2)]=$729;
 label=164;break;
 case 163: 
 HEAP32[((48)>>2)]=0;
 HEAP32[((60)>>2)]=0;
 var $732=$714|3;
 var $733=(($718+4)|0);
 HEAP32[(($733)>>2)]=$732;
 var $734=$718;
 var $_sum1=((($714)+(4))|0);
 var $735=(($734+$_sum1)|0);
 var $736=$735;
 var $737=HEAP32[(($736)>>2)];
 var $738=$737|1;
 HEAP32[(($736)>>2)]=$738;
 label=164;break;
 case 164: 
 var $740=(($718+8)|0);
 var $741=$740;
 var $mem_0=$741;label=341;break;
 case 165: 
 var $743=HEAP32[((52)>>2)];
 var $744=($743>>>0)>($nb_0>>>0);
 if($744){label=166;break;}else{label=167;break;}
 case 166: 
 var $746=((($743)-($nb_0))|0);
 HEAP32[((52)>>2)]=$746;
 var $747=HEAP32[((64)>>2)];
 var $748=$747;
 var $749=(($748+$nb_0)|0);
 var $750=$749;
 HEAP32[((64)>>2)]=$750;
 var $751=$746|1;
 var $_sum=((($nb_0)+(4))|0);
 var $752=(($748+$_sum)|0);
 var $753=$752;
 HEAP32[(($753)>>2)]=$751;
 var $754=$nb_0|3;
 var $755=(($747+4)|0);
 HEAP32[(($755)>>2)]=$754;
 var $756=(($747+8)|0);
 var $757=$756;
 var $mem_0=$757;label=341;break;
 case 167: 
 var $759=HEAP32[((16)>>2)];
 var $760=($759|0)==0;
 if($760){label=168;break;}else{label=171;break;}
 case 168: 
 var $762=_sysconf(30);
 var $763=((($762)-(1))|0);
 var $764=$763&$762;
 var $765=($764|0)==0;
 if($765){label=170;break;}else{label=169;break;}
 case 169: 
 _abort();
 throw "Reached an unreachable!";
 case 170: 
 HEAP32[((24)>>2)]=$762;
 HEAP32[((20)>>2)]=$762;
 HEAP32[((28)>>2)]=-1;
 HEAP32[((32)>>2)]=-1;
 HEAP32[((36)>>2)]=0;
 HEAP32[((484)>>2)]=0;
 var $767=_time(0);
 var $768=$767&-16;
 var $769=$768^1431655768;
 HEAP32[((16)>>2)]=$769;
 label=171;break;
 case 171: 
 var $771=((($nb_0)+(48))|0);
 var $772=HEAP32[((24)>>2)];
 var $773=((($nb_0)+(47))|0);
 var $774=((($772)+($773))|0);
 var $775=(((-$772))|0);
 var $776=$774&$775;
 var $777=($776>>>0)>($nb_0>>>0);
 if($777){label=172;break;}else{var $mem_0=0;label=341;break;}
 case 172: 
 var $779=HEAP32[((480)>>2)];
 var $780=($779|0)==0;
 if($780){label=174;break;}else{label=173;break;}
 case 173: 
 var $782=HEAP32[((472)>>2)];
 var $783=((($782)+($776))|0);
 var $784=($783>>>0)<=($782>>>0);
 var $785=($783>>>0)>($779>>>0);
 var $or_cond1_i=$784|$785;
 if($or_cond1_i){var $mem_0=0;label=341;break;}else{label=174;break;}
 case 174: 
 var $787=HEAP32[((484)>>2)];
 var $788=$787&4;
 var $789=($788|0)==0;
 if($789){label=175;break;}else{var $tsize_1_i=0;label=198;break;}
 case 175: 
 var $791=HEAP32[((64)>>2)];
 var $792=($791|0)==0;
 if($792){label=181;break;}else{label=176;break;}
 case 176: 
 var $794=$791;
 var $sp_0_i_i=488;label=177;break;
 case 177: 
 var $sp_0_i_i;
 var $796=(($sp_0_i_i)|0);
 var $797=HEAP32[(($796)>>2)];
 var $798=($797>>>0)>($794>>>0);
 if($798){label=179;break;}else{label=178;break;}
 case 178: 
 var $800=(($sp_0_i_i+4)|0);
 var $801=HEAP32[(($800)>>2)];
 var $802=(($797+$801)|0);
 var $803=($802>>>0)>($794>>>0);
 if($803){label=180;break;}else{label=179;break;}
 case 179: 
 var $805=(($sp_0_i_i+8)|0);
 var $806=HEAP32[(($805)>>2)];
 var $807=($806|0)==0;
 if($807){label=181;break;}else{var $sp_0_i_i=$806;label=177;break;}
 case 180: 
 var $808=($sp_0_i_i|0)==0;
 if($808){label=181;break;}else{label=188;break;}
 case 181: 
 var $809=_sbrk(0);
 var $810=($809|0)==-1;
 if($810){var $tsize_03141_i=0;label=197;break;}else{label=182;break;}
 case 182: 
 var $812=$809;
 var $813=HEAP32[((20)>>2)];
 var $814=((($813)-(1))|0);
 var $815=$814&$812;
 var $816=($815|0)==0;
 if($816){var $ssize_0_i=$776;label=184;break;}else{label=183;break;}
 case 183: 
 var $818=((($814)+($812))|0);
 var $819=(((-$813))|0);
 var $820=$818&$819;
 var $821=((($776)-($812))|0);
 var $822=((($821)+($820))|0);
 var $ssize_0_i=$822;label=184;break;
 case 184: 
 var $ssize_0_i;
 var $824=HEAP32[((472)>>2)];
 var $825=((($824)+($ssize_0_i))|0);
 var $826=($ssize_0_i>>>0)>($nb_0>>>0);
 var $827=($ssize_0_i>>>0)<2147483647;
 var $or_cond_i31=$826&$827;
 if($or_cond_i31){label=185;break;}else{var $tsize_03141_i=0;label=197;break;}
 case 185: 
 var $829=HEAP32[((480)>>2)];
 var $830=($829|0)==0;
 if($830){label=187;break;}else{label=186;break;}
 case 186: 
 var $832=($825>>>0)<=($824>>>0);
 var $833=($825>>>0)>($829>>>0);
 var $or_cond2_i=$832|$833;
 if($or_cond2_i){var $tsize_03141_i=0;label=197;break;}else{label=187;break;}
 case 187: 
 var $835=_sbrk($ssize_0_i);
 var $836=($835|0)==($809|0);
 if($836){var $br_0_i=$809;var $ssize_1_i=$ssize_0_i;label=190;break;}else{var $ssize_129_i=$ssize_0_i;var $br_030_i=$835;label=191;break;}
 case 188: 
 var $838=HEAP32[((52)>>2)];
 var $839=((($774)-($838))|0);
 var $840=$839&$775;
 var $841=($840>>>0)<2147483647;
 if($841){label=189;break;}else{var $tsize_03141_i=0;label=197;break;}
 case 189: 
 var $843=_sbrk($840);
 var $844=HEAP32[(($796)>>2)];
 var $845=HEAP32[(($800)>>2)];
 var $846=(($844+$845)|0);
 var $847=($843|0)==($846|0);
 if($847){var $br_0_i=$843;var $ssize_1_i=$840;label=190;break;}else{var $ssize_129_i=$840;var $br_030_i=$843;label=191;break;}
 case 190: 
 var $ssize_1_i;
 var $br_0_i;
 var $849=($br_0_i|0)==-1;
 if($849){var $tsize_03141_i=$ssize_1_i;label=197;break;}else{var $tsize_244_i=$ssize_1_i;var $tbase_245_i=$br_0_i;label=201;break;}
 case 191: 
 var $br_030_i;
 var $ssize_129_i;
 var $850=(((-$ssize_129_i))|0);
 var $851=($br_030_i|0)!=-1;
 var $852=($ssize_129_i>>>0)<2147483647;
 var $or_cond5_i=$851&$852;
 var $853=($771>>>0)>($ssize_129_i>>>0);
 var $or_cond4_i=$or_cond5_i&$853;
 if($or_cond4_i){label=192;break;}else{var $ssize_2_i=$ssize_129_i;label=196;break;}
 case 192: 
 var $855=HEAP32[((24)>>2)];
 var $856=((($773)-($ssize_129_i))|0);
 var $857=((($856)+($855))|0);
 var $858=(((-$855))|0);
 var $859=$857&$858;
 var $860=($859>>>0)<2147483647;
 if($860){label=193;break;}else{var $ssize_2_i=$ssize_129_i;label=196;break;}
 case 193: 
 var $862=_sbrk($859);
 var $863=($862|0)==-1;
 if($863){label=195;break;}else{label=194;break;}
 case 194: 
 var $865=((($859)+($ssize_129_i))|0);
 var $ssize_2_i=$865;label=196;break;
 case 195: 
 var $866=_sbrk($850);
 var $tsize_03141_i=0;label=197;break;
 case 196: 
 var $ssize_2_i;
 var $868=($br_030_i|0)==-1;
 if($868){var $tsize_03141_i=0;label=197;break;}else{var $tsize_244_i=$ssize_2_i;var $tbase_245_i=$br_030_i;label=201;break;}
 case 197: 
 var $tsize_03141_i;
 var $869=HEAP32[((484)>>2)];
 var $870=$869|4;
 HEAP32[((484)>>2)]=$870;
 var $tsize_1_i=$tsize_03141_i;label=198;break;
 case 198: 
 var $tsize_1_i;
 var $872=($776>>>0)<2147483647;
 if($872){label=199;break;}else{label=340;break;}
 case 199: 
 var $874=_sbrk($776);
 var $875=_sbrk(0);
 var $876=($874|0)!=-1;
 var $877=($875|0)!=-1;
 var $or_cond3_i=$876&$877;
 var $878=($874>>>0)<($875>>>0);
 var $or_cond6_i=$or_cond3_i&$878;
 if($or_cond6_i){label=200;break;}else{label=340;break;}
 case 200: 
 var $880=$875;
 var $881=$874;
 var $882=((($880)-($881))|0);
 var $883=((($nb_0)+(40))|0);
 var $884=($882>>>0)>($883>>>0);
 var $_tsize_1_i=($884?$882:$tsize_1_i);
 if($884){var $tsize_244_i=$_tsize_1_i;var $tbase_245_i=$874;label=201;break;}else{label=340;break;}
 case 201: 
 var $tbase_245_i;
 var $tsize_244_i;
 var $885=HEAP32[((472)>>2)];
 var $886=((($885)+($tsize_244_i))|0);
 HEAP32[((472)>>2)]=$886;
 var $887=HEAP32[((476)>>2)];
 var $888=($886>>>0)>($887>>>0);
 if($888){label=202;break;}else{label=203;break;}
 case 202: 
 HEAP32[((476)>>2)]=$886;
 label=203;break;
 case 203: 
 var $891=HEAP32[((64)>>2)];
 var $892=($891|0)==0;
 if($892){label=204;break;}else{var $sp_073_i=488;label=211;break;}
 case 204: 
 var $894=HEAP32[((56)>>2)];
 var $895=($894|0)==0;
 var $896=($tbase_245_i>>>0)<($894>>>0);
 var $or_cond8_i=$895|$896;
 if($or_cond8_i){label=205;break;}else{label=206;break;}
 case 205: 
 HEAP32[((56)>>2)]=$tbase_245_i;
 label=206;break;
 case 206: 
 HEAP32[((488)>>2)]=$tbase_245_i;
 HEAP32[((492)>>2)]=$tsize_244_i;
 HEAP32[((500)>>2)]=0;
 var $899=HEAP32[((16)>>2)];
 HEAP32[((76)>>2)]=$899;
 HEAP32[((72)>>2)]=-1;
 var $i_02_i_i=0;label=207;break;
 case 207: 
 var $i_02_i_i;
 var $901=$i_02_i_i<<1;
 var $902=((80+($901<<2))|0);
 var $903=$902;
 var $_sum_i_i=((($901)+(3))|0);
 var $904=((80+($_sum_i_i<<2))|0);
 HEAP32[(($904)>>2)]=$903;
 var $_sum1_i_i=((($901)+(2))|0);
 var $905=((80+($_sum1_i_i<<2))|0);
 HEAP32[(($905)>>2)]=$903;
 var $906=((($i_02_i_i)+(1))|0);
 var $907=($906>>>0)<32;
 if($907){var $i_02_i_i=$906;label=207;break;}else{label=208;break;}
 case 208: 
 var $908=((($tsize_244_i)-(40))|0);
 var $909=(($tbase_245_i+8)|0);
 var $910=$909;
 var $911=$910&7;
 var $912=($911|0)==0;
 if($912){var $916=0;label=210;break;}else{label=209;break;}
 case 209: 
 var $914=(((-$910))|0);
 var $915=$914&7;
 var $916=$915;label=210;break;
 case 210: 
 var $916;
 var $917=(($tbase_245_i+$916)|0);
 var $918=$917;
 var $919=((($908)-($916))|0);
 HEAP32[((64)>>2)]=$918;
 HEAP32[((52)>>2)]=$919;
 var $920=$919|1;
 var $_sum_i12_i=((($916)+(4))|0);
 var $921=(($tbase_245_i+$_sum_i12_i)|0);
 var $922=$921;
 HEAP32[(($922)>>2)]=$920;
 var $_sum2_i_i=((($tsize_244_i)-(36))|0);
 var $923=(($tbase_245_i+$_sum2_i_i)|0);
 var $924=$923;
 HEAP32[(($924)>>2)]=40;
 var $925=HEAP32[((32)>>2)];
 HEAP32[((68)>>2)]=$925;
 label=338;break;
 case 211: 
 var $sp_073_i;
 var $926=(($sp_073_i)|0);
 var $927=HEAP32[(($926)>>2)];
 var $928=(($sp_073_i+4)|0);
 var $929=HEAP32[(($928)>>2)];
 var $930=(($927+$929)|0);
 var $931=($tbase_245_i|0)==($930|0);
 if($931){label=213;break;}else{label=212;break;}
 case 212: 
 var $933=(($sp_073_i+8)|0);
 var $934=HEAP32[(($933)>>2)];
 var $935=($934|0)==0;
 if($935){label=218;break;}else{var $sp_073_i=$934;label=211;break;}
 case 213: 
 var $936=(($sp_073_i+12)|0);
 var $937=HEAP32[(($936)>>2)];
 var $938=$937&8;
 var $939=($938|0)==0;
 if($939){label=214;break;}else{label=218;break;}
 case 214: 
 var $941=$891;
 var $942=($941>>>0)>=($927>>>0);
 var $943=($941>>>0)<($tbase_245_i>>>0);
 var $or_cond47_i=$942&$943;
 if($or_cond47_i){label=215;break;}else{label=218;break;}
 case 215: 
 var $945=((($929)+($tsize_244_i))|0);
 HEAP32[(($928)>>2)]=$945;
 var $946=HEAP32[((64)>>2)];
 var $947=HEAP32[((52)>>2)];
 var $948=((($947)+($tsize_244_i))|0);
 var $949=$946;
 var $950=(($946+8)|0);
 var $951=$950;
 var $952=$951&7;
 var $953=($952|0)==0;
 if($953){var $957=0;label=217;break;}else{label=216;break;}
 case 216: 
 var $955=(((-$951))|0);
 var $956=$955&7;
 var $957=$956;label=217;break;
 case 217: 
 var $957;
 var $958=(($949+$957)|0);
 var $959=$958;
 var $960=((($948)-($957))|0);
 HEAP32[((64)>>2)]=$959;
 HEAP32[((52)>>2)]=$960;
 var $961=$960|1;
 var $_sum_i16_i=((($957)+(4))|0);
 var $962=(($949+$_sum_i16_i)|0);
 var $963=$962;
 HEAP32[(($963)>>2)]=$961;
 var $_sum2_i17_i=((($948)+(4))|0);
 var $964=(($949+$_sum2_i17_i)|0);
 var $965=$964;
 HEAP32[(($965)>>2)]=40;
 var $966=HEAP32[((32)>>2)];
 HEAP32[((68)>>2)]=$966;
 label=338;break;
 case 218: 
 var $967=HEAP32[((56)>>2)];
 var $968=($tbase_245_i>>>0)<($967>>>0);
 if($968){label=219;break;}else{label=220;break;}
 case 219: 
 HEAP32[((56)>>2)]=$tbase_245_i;
 label=220;break;
 case 220: 
 var $970=(($tbase_245_i+$tsize_244_i)|0);
 var $sp_166_i=488;label=221;break;
 case 221: 
 var $sp_166_i;
 var $972=(($sp_166_i)|0);
 var $973=HEAP32[(($972)>>2)];
 var $974=($973|0)==($970|0);
 if($974){label=223;break;}else{label=222;break;}
 case 222: 
 var $976=(($sp_166_i+8)|0);
 var $977=HEAP32[(($976)>>2)];
 var $978=($977|0)==0;
 if($978){label=304;break;}else{var $sp_166_i=$977;label=221;break;}
 case 223: 
 var $979=(($sp_166_i+12)|0);
 var $980=HEAP32[(($979)>>2)];
 var $981=$980&8;
 var $982=($981|0)==0;
 if($982){label=224;break;}else{label=304;break;}
 case 224: 
 HEAP32[(($972)>>2)]=$tbase_245_i;
 var $984=(($sp_166_i+4)|0);
 var $985=HEAP32[(($984)>>2)];
 var $986=((($985)+($tsize_244_i))|0);
 HEAP32[(($984)>>2)]=$986;
 var $987=(($tbase_245_i+8)|0);
 var $988=$987;
 var $989=$988&7;
 var $990=($989|0)==0;
 if($990){var $995=0;label=226;break;}else{label=225;break;}
 case 225: 
 var $992=(((-$988))|0);
 var $993=$992&7;
 var $995=$993;label=226;break;
 case 226: 
 var $995;
 var $996=(($tbase_245_i+$995)|0);
 var $_sum102_i=((($tsize_244_i)+(8))|0);
 var $997=(($tbase_245_i+$_sum102_i)|0);
 var $998=$997;
 var $999=$998&7;
 var $1000=($999|0)==0;
 if($1000){var $1005=0;label=228;break;}else{label=227;break;}
 case 227: 
 var $1002=(((-$998))|0);
 var $1003=$1002&7;
 var $1005=$1003;label=228;break;
 case 228: 
 var $1005;
 var $_sum103_i=((($1005)+($tsize_244_i))|0);
 var $1006=(($tbase_245_i+$_sum103_i)|0);
 var $1007=$1006;
 var $1008=$1006;
 var $1009=$996;
 var $1010=((($1008)-($1009))|0);
 var $_sum_i19_i=((($995)+($nb_0))|0);
 var $1011=(($tbase_245_i+$_sum_i19_i)|0);
 var $1012=$1011;
 var $1013=((($1010)-($nb_0))|0);
 var $1014=$nb_0|3;
 var $_sum1_i20_i=((($995)+(4))|0);
 var $1015=(($tbase_245_i+$_sum1_i20_i)|0);
 var $1016=$1015;
 HEAP32[(($1016)>>2)]=$1014;
 var $1017=HEAP32[((64)>>2)];
 var $1018=($1007|0)==($1017|0);
 if($1018){label=229;break;}else{label=230;break;}
 case 229: 
 var $1020=HEAP32[((52)>>2)];
 var $1021=((($1020)+($1013))|0);
 HEAP32[((52)>>2)]=$1021;
 HEAP32[((64)>>2)]=$1012;
 var $1022=$1021|1;
 var $_sum46_i_i=((($_sum_i19_i)+(4))|0);
 var $1023=(($tbase_245_i+$_sum46_i_i)|0);
 var $1024=$1023;
 HEAP32[(($1024)>>2)]=$1022;
 label=303;break;
 case 230: 
 var $1026=HEAP32[((60)>>2)];
 var $1027=($1007|0)==($1026|0);
 if($1027){label=231;break;}else{label=232;break;}
 case 231: 
 var $1029=HEAP32[((48)>>2)];
 var $1030=((($1029)+($1013))|0);
 HEAP32[((48)>>2)]=$1030;
 HEAP32[((60)>>2)]=$1012;
 var $1031=$1030|1;
 var $_sum44_i_i=((($_sum_i19_i)+(4))|0);
 var $1032=(($tbase_245_i+$_sum44_i_i)|0);
 var $1033=$1032;
 HEAP32[(($1033)>>2)]=$1031;
 var $_sum45_i_i=((($1030)+($_sum_i19_i))|0);
 var $1034=(($tbase_245_i+$_sum45_i_i)|0);
 var $1035=$1034;
 HEAP32[(($1035)>>2)]=$1030;
 label=303;break;
 case 232: 
 var $_sum2_i21_i=((($tsize_244_i)+(4))|0);
 var $_sum104_i=((($_sum2_i21_i)+($1005))|0);
 var $1037=(($tbase_245_i+$_sum104_i)|0);
 var $1038=$1037;
 var $1039=HEAP32[(($1038)>>2)];
 var $1040=$1039&3;
 var $1041=($1040|0)==1;
 if($1041){label=233;break;}else{var $oldfirst_0_i_i=$1007;var $qsize_0_i_i=$1013;label=280;break;}
 case 233: 
 var $1043=$1039&-8;
 var $1044=$1039>>>3;
 var $1045=($1039>>>0)<256;
 if($1045){label=234;break;}else{label=246;break;}
 case 234: 
 var $_sum3940_i_i=$1005|8;
 var $_sum114_i=((($_sum3940_i_i)+($tsize_244_i))|0);
 var $1047=(($tbase_245_i+$_sum114_i)|0);
 var $1048=$1047;
 var $1049=HEAP32[(($1048)>>2)];
 var $_sum41_i_i=((($tsize_244_i)+(12))|0);
 var $_sum115_i=((($_sum41_i_i)+($1005))|0);
 var $1050=(($tbase_245_i+$_sum115_i)|0);
 var $1051=$1050;
 var $1052=HEAP32[(($1051)>>2)];
 var $1053=$1044<<1;
 var $1054=((80+($1053<<2))|0);
 var $1055=$1054;
 var $1056=($1049|0)==($1055|0);
 if($1056){label=237;break;}else{label=235;break;}
 case 235: 
 var $1058=$1049;
 var $1059=HEAP32[((56)>>2)];
 var $1060=($1058>>>0)<($1059>>>0);
 if($1060){label=245;break;}else{label=236;break;}
 case 236: 
 var $1062=(($1049+12)|0);
 var $1063=HEAP32[(($1062)>>2)];
 var $1064=($1063|0)==($1007|0);
 if($1064){label=237;break;}else{label=245;break;}
 case 237: 
 var $1065=($1052|0)==($1049|0);
 if($1065){label=238;break;}else{label=239;break;}
 case 238: 
 var $1067=1<<$1044;
 var $1068=$1067^-1;
 var $1069=HEAP32[((40)>>2)];
 var $1070=$1069&$1068;
 HEAP32[((40)>>2)]=$1070;
 label=279;break;
 case 239: 
 var $1072=($1052|0)==($1055|0);
 if($1072){label=240;break;}else{label=241;break;}
 case 240: 
 var $_pre62_i_i=(($1052+8)|0);
 var $_pre_phi63_i_i=$_pre62_i_i;label=243;break;
 case 241: 
 var $1074=$1052;
 var $1075=HEAP32[((56)>>2)];
 var $1076=($1074>>>0)<($1075>>>0);
 if($1076){label=244;break;}else{label=242;break;}
 case 242: 
 var $1078=(($1052+8)|0);
 var $1079=HEAP32[(($1078)>>2)];
 var $1080=($1079|0)==($1007|0);
 if($1080){var $_pre_phi63_i_i=$1078;label=243;break;}else{label=244;break;}
 case 243: 
 var $_pre_phi63_i_i;
 var $1081=(($1049+12)|0);
 HEAP32[(($1081)>>2)]=$1052;
 HEAP32[(($_pre_phi63_i_i)>>2)]=$1049;
 label=279;break;
 case 244: 
 _abort();
 throw "Reached an unreachable!";
 case 245: 
 _abort();
 throw "Reached an unreachable!";
 case 246: 
 var $1083=$1006;
 var $_sum34_i_i=$1005|24;
 var $_sum105_i=((($_sum34_i_i)+($tsize_244_i))|0);
 var $1084=(($tbase_245_i+$_sum105_i)|0);
 var $1085=$1084;
 var $1086=HEAP32[(($1085)>>2)];
 var $_sum5_i_i=((($tsize_244_i)+(12))|0);
 var $_sum106_i=((($_sum5_i_i)+($1005))|0);
 var $1087=(($tbase_245_i+$_sum106_i)|0);
 var $1088=$1087;
 var $1089=HEAP32[(($1088)>>2)];
 var $1090=($1089|0)==($1083|0);
 if($1090){label=252;break;}else{label=247;break;}
 case 247: 
 var $_sum3637_i_i=$1005|8;
 var $_sum107_i=((($_sum3637_i_i)+($tsize_244_i))|0);
 var $1092=(($tbase_245_i+$_sum107_i)|0);
 var $1093=$1092;
 var $1094=HEAP32[(($1093)>>2)];
 var $1095=$1094;
 var $1096=HEAP32[((56)>>2)];
 var $1097=($1095>>>0)<($1096>>>0);
 if($1097){label=251;break;}else{label=248;break;}
 case 248: 
 var $1099=(($1094+12)|0);
 var $1100=HEAP32[(($1099)>>2)];
 var $1101=($1100|0)==($1083|0);
 if($1101){label=249;break;}else{label=251;break;}
 case 249: 
 var $1103=(($1089+8)|0);
 var $1104=HEAP32[(($1103)>>2)];
 var $1105=($1104|0)==($1083|0);
 if($1105){label=250;break;}else{label=251;break;}
 case 250: 
 HEAP32[(($1099)>>2)]=$1089;
 HEAP32[(($1103)>>2)]=$1094;
 var $R_1_i_i=$1089;label=259;break;
 case 251: 
 _abort();
 throw "Reached an unreachable!";
 case 252: 
 var $_sum67_i_i=$1005|16;
 var $_sum112_i=((($_sum2_i21_i)+($_sum67_i_i))|0);
 var $1108=(($tbase_245_i+$_sum112_i)|0);
 var $1109=$1108;
 var $1110=HEAP32[(($1109)>>2)];
 var $1111=($1110|0)==0;
 if($1111){label=253;break;}else{var $R_0_i_i=$1110;var $RP_0_i_i=$1109;label=254;break;}
 case 253: 
 var $_sum113_i=((($_sum67_i_i)+($tsize_244_i))|0);
 var $1113=(($tbase_245_i+$_sum113_i)|0);
 var $1114=$1113;
 var $1115=HEAP32[(($1114)>>2)];
 var $1116=($1115|0)==0;
 if($1116){var $R_1_i_i=0;label=259;break;}else{var $R_0_i_i=$1115;var $RP_0_i_i=$1114;label=254;break;}
 case 254: 
 var $RP_0_i_i;
 var $R_0_i_i;
 var $1117=(($R_0_i_i+20)|0);
 var $1118=HEAP32[(($1117)>>2)];
 var $1119=($1118|0)==0;
 if($1119){label=255;break;}else{var $R_0_i_i=$1118;var $RP_0_i_i=$1117;label=254;break;}
 case 255: 
 var $1121=(($R_0_i_i+16)|0);
 var $1122=HEAP32[(($1121)>>2)];
 var $1123=($1122|0)==0;
 if($1123){label=256;break;}else{var $R_0_i_i=$1122;var $RP_0_i_i=$1121;label=254;break;}
 case 256: 
 var $1125=$RP_0_i_i;
 var $1126=HEAP32[((56)>>2)];
 var $1127=($1125>>>0)<($1126>>>0);
 if($1127){label=258;break;}else{label=257;break;}
 case 257: 
 HEAP32[(($RP_0_i_i)>>2)]=0;
 var $R_1_i_i=$R_0_i_i;label=259;break;
 case 258: 
 _abort();
 throw "Reached an unreachable!";
 case 259: 
 var $R_1_i_i;
 var $1131=($1086|0)==0;
 if($1131){label=279;break;}else{label=260;break;}
 case 260: 
 var $_sum31_i_i=((($tsize_244_i)+(28))|0);
 var $_sum108_i=((($_sum31_i_i)+($1005))|0);
 var $1133=(($tbase_245_i+$_sum108_i)|0);
 var $1134=$1133;
 var $1135=HEAP32[(($1134)>>2)];
 var $1136=((344+($1135<<2))|0);
 var $1137=HEAP32[(($1136)>>2)];
 var $1138=($1083|0)==($1137|0);
 if($1138){label=261;break;}else{label=263;break;}
 case 261: 
 HEAP32[(($1136)>>2)]=$R_1_i_i;
 var $cond_i_i=($R_1_i_i|0)==0;
 if($cond_i_i){label=262;break;}else{label=269;break;}
 case 262: 
 var $1140=HEAP32[(($1134)>>2)];
 var $1141=1<<$1140;
 var $1142=$1141^-1;
 var $1143=HEAP32[((44)>>2)];
 var $1144=$1143&$1142;
 HEAP32[((44)>>2)]=$1144;
 label=279;break;
 case 263: 
 var $1146=$1086;
 var $1147=HEAP32[((56)>>2)];
 var $1148=($1146>>>0)<($1147>>>0);
 if($1148){label=267;break;}else{label=264;break;}
 case 264: 
 var $1150=(($1086+16)|0);
 var $1151=HEAP32[(($1150)>>2)];
 var $1152=($1151|0)==($1083|0);
 if($1152){label=265;break;}else{label=266;break;}
 case 265: 
 HEAP32[(($1150)>>2)]=$R_1_i_i;
 label=268;break;
 case 266: 
 var $1155=(($1086+20)|0);
 HEAP32[(($1155)>>2)]=$R_1_i_i;
 label=268;break;
 case 267: 
 _abort();
 throw "Reached an unreachable!";
 case 268: 
 var $1158=($R_1_i_i|0)==0;
 if($1158){label=279;break;}else{label=269;break;}
 case 269: 
 var $1160=$R_1_i_i;
 var $1161=HEAP32[((56)>>2)];
 var $1162=($1160>>>0)<($1161>>>0);
 if($1162){label=278;break;}else{label=270;break;}
 case 270: 
 var $1164=(($R_1_i_i+24)|0);
 HEAP32[(($1164)>>2)]=$1086;
 var $_sum3233_i_i=$1005|16;
 var $_sum109_i=((($_sum3233_i_i)+($tsize_244_i))|0);
 var $1165=(($tbase_245_i+$_sum109_i)|0);
 var $1166=$1165;
 var $1167=HEAP32[(($1166)>>2)];
 var $1168=($1167|0)==0;
 if($1168){label=274;break;}else{label=271;break;}
 case 271: 
 var $1170=$1167;
 var $1171=HEAP32[((56)>>2)];
 var $1172=($1170>>>0)<($1171>>>0);
 if($1172){label=273;break;}else{label=272;break;}
 case 272: 
 var $1174=(($R_1_i_i+16)|0);
 HEAP32[(($1174)>>2)]=$1167;
 var $1175=(($1167+24)|0);
 HEAP32[(($1175)>>2)]=$R_1_i_i;
 label=274;break;
 case 273: 
 _abort();
 throw "Reached an unreachable!";
 case 274: 
 var $_sum110_i=((($_sum2_i21_i)+($_sum3233_i_i))|0);
 var $1178=(($tbase_245_i+$_sum110_i)|0);
 var $1179=$1178;
 var $1180=HEAP32[(($1179)>>2)];
 var $1181=($1180|0)==0;
 if($1181){label=279;break;}else{label=275;break;}
 case 275: 
 var $1183=$1180;
 var $1184=HEAP32[((56)>>2)];
 var $1185=($1183>>>0)<($1184>>>0);
 if($1185){label=277;break;}else{label=276;break;}
 case 276: 
 var $1187=(($R_1_i_i+20)|0);
 HEAP32[(($1187)>>2)]=$1180;
 var $1188=(($1180+24)|0);
 HEAP32[(($1188)>>2)]=$R_1_i_i;
 label=279;break;
 case 277: 
 _abort();
 throw "Reached an unreachable!";
 case 278: 
 _abort();
 throw "Reached an unreachable!";
 case 279: 
 var $_sum9_i_i=$1043|$1005;
 var $_sum111_i=((($_sum9_i_i)+($tsize_244_i))|0);
 var $1192=(($tbase_245_i+$_sum111_i)|0);
 var $1193=$1192;
 var $1194=((($1043)+($1013))|0);
 var $oldfirst_0_i_i=$1193;var $qsize_0_i_i=$1194;label=280;break;
 case 280: 
 var $qsize_0_i_i;
 var $oldfirst_0_i_i;
 var $1196=(($oldfirst_0_i_i+4)|0);
 var $1197=HEAP32[(($1196)>>2)];
 var $1198=$1197&-2;
 HEAP32[(($1196)>>2)]=$1198;
 var $1199=$qsize_0_i_i|1;
 var $_sum10_i_i=((($_sum_i19_i)+(4))|0);
 var $1200=(($tbase_245_i+$_sum10_i_i)|0);
 var $1201=$1200;
 HEAP32[(($1201)>>2)]=$1199;
 var $_sum11_i_i=((($qsize_0_i_i)+($_sum_i19_i))|0);
 var $1202=(($tbase_245_i+$_sum11_i_i)|0);
 var $1203=$1202;
 HEAP32[(($1203)>>2)]=$qsize_0_i_i;
 var $1204=$qsize_0_i_i>>>3;
 var $1205=($qsize_0_i_i>>>0)<256;
 if($1205){label=281;break;}else{label=286;break;}
 case 281: 
 var $1207=$1204<<1;
 var $1208=((80+($1207<<2))|0);
 var $1209=$1208;
 var $1210=HEAP32[((40)>>2)];
 var $1211=1<<$1204;
 var $1212=$1210&$1211;
 var $1213=($1212|0)==0;
 if($1213){label=282;break;}else{label=283;break;}
 case 282: 
 var $1215=$1210|$1211;
 HEAP32[((40)>>2)]=$1215;
 var $_sum27_pre_i_i=((($1207)+(2))|0);
 var $_pre_i22_i=((80+($_sum27_pre_i_i<<2))|0);
 var $F4_0_i_i=$1209;var $_pre_phi_i23_i=$_pre_i22_i;label=285;break;
 case 283: 
 var $_sum30_i_i=((($1207)+(2))|0);
 var $1217=((80+($_sum30_i_i<<2))|0);
 var $1218=HEAP32[(($1217)>>2)];
 var $1219=$1218;
 var $1220=HEAP32[((56)>>2)];
 var $1221=($1219>>>0)<($1220>>>0);
 if($1221){label=284;break;}else{var $F4_0_i_i=$1218;var $_pre_phi_i23_i=$1217;label=285;break;}
 case 284: 
 _abort();
 throw "Reached an unreachable!";
 case 285: 
 var $_pre_phi_i23_i;
 var $F4_0_i_i;
 HEAP32[(($_pre_phi_i23_i)>>2)]=$1012;
 var $1224=(($F4_0_i_i+12)|0);
 HEAP32[(($1224)>>2)]=$1012;
 var $_sum28_i_i=((($_sum_i19_i)+(8))|0);
 var $1225=(($tbase_245_i+$_sum28_i_i)|0);
 var $1226=$1225;
 HEAP32[(($1226)>>2)]=$F4_0_i_i;
 var $_sum29_i_i=((($_sum_i19_i)+(12))|0);
 var $1227=(($tbase_245_i+$_sum29_i_i)|0);
 var $1228=$1227;
 HEAP32[(($1228)>>2)]=$1209;
 label=303;break;
 case 286: 
 var $1230=$1011;
 var $1231=$qsize_0_i_i>>>8;
 var $1232=($1231|0)==0;
 if($1232){var $I7_0_i_i=0;label=289;break;}else{label=287;break;}
 case 287: 
 var $1234=($qsize_0_i_i>>>0)>16777215;
 if($1234){var $I7_0_i_i=31;label=289;break;}else{label=288;break;}
 case 288: 
 var $1236=((($1231)+(1048320))|0);
 var $1237=$1236>>>16;
 var $1238=$1237&8;
 var $1239=$1231<<$1238;
 var $1240=((($1239)+(520192))|0);
 var $1241=$1240>>>16;
 var $1242=$1241&4;
 var $1243=$1242|$1238;
 var $1244=$1239<<$1242;
 var $1245=((($1244)+(245760))|0);
 var $1246=$1245>>>16;
 var $1247=$1246&2;
 var $1248=$1243|$1247;
 var $1249=(((14)-($1248))|0);
 var $1250=$1244<<$1247;
 var $1251=$1250>>>15;
 var $1252=((($1249)+($1251))|0);
 var $1253=$1252<<1;
 var $1254=((($1252)+(7))|0);
 var $1255=$qsize_0_i_i>>>($1254>>>0);
 var $1256=$1255&1;
 var $1257=$1256|$1253;
 var $I7_0_i_i=$1257;label=289;break;
 case 289: 
 var $I7_0_i_i;
 var $1259=((344+($I7_0_i_i<<2))|0);
 var $_sum12_i24_i=((($_sum_i19_i)+(28))|0);
 var $1260=(($tbase_245_i+$_sum12_i24_i)|0);
 var $1261=$1260;
 HEAP32[(($1261)>>2)]=$I7_0_i_i;
 var $_sum13_i_i=((($_sum_i19_i)+(16))|0);
 var $1262=(($tbase_245_i+$_sum13_i_i)|0);
 var $_sum14_i_i=((($_sum_i19_i)+(20))|0);
 var $1263=(($tbase_245_i+$_sum14_i_i)|0);
 var $1264=$1263;
 HEAP32[(($1264)>>2)]=0;
 var $1265=$1262;
 HEAP32[(($1265)>>2)]=0;
 var $1266=HEAP32[((44)>>2)];
 var $1267=1<<$I7_0_i_i;
 var $1268=$1266&$1267;
 var $1269=($1268|0)==0;
 if($1269){label=290;break;}else{label=291;break;}
 case 290: 
 var $1271=$1266|$1267;
 HEAP32[((44)>>2)]=$1271;
 HEAP32[(($1259)>>2)]=$1230;
 var $1272=$1259;
 var $_sum15_i_i=((($_sum_i19_i)+(24))|0);
 var $1273=(($tbase_245_i+$_sum15_i_i)|0);
 var $1274=$1273;
 HEAP32[(($1274)>>2)]=$1272;
 var $_sum16_i_i=((($_sum_i19_i)+(12))|0);
 var $1275=(($tbase_245_i+$_sum16_i_i)|0);
 var $1276=$1275;
 HEAP32[(($1276)>>2)]=$1230;
 var $_sum17_i_i=((($_sum_i19_i)+(8))|0);
 var $1277=(($tbase_245_i+$_sum17_i_i)|0);
 var $1278=$1277;
 HEAP32[(($1278)>>2)]=$1230;
 label=303;break;
 case 291: 
 var $1280=HEAP32[(($1259)>>2)];
 var $1281=($I7_0_i_i|0)==31;
 if($1281){var $1286=0;label=293;break;}else{label=292;break;}
 case 292: 
 var $1283=$I7_0_i_i>>>1;
 var $1284=(((25)-($1283))|0);
 var $1286=$1284;label=293;break;
 case 293: 
 var $1286;
 var $1287=(($1280+4)|0);
 var $1288=HEAP32[(($1287)>>2)];
 var $1289=$1288&-8;
 var $1290=($1289|0)==($qsize_0_i_i|0);
 if($1290){var $T_0_lcssa_i26_i=$1280;label=300;break;}else{label=294;break;}
 case 294: 
 var $1291=$qsize_0_i_i<<$1286;
 var $T_056_i_i=$1280;var $K8_057_i_i=$1291;label=296;break;
 case 295: 
 var $1293=$K8_057_i_i<<1;
 var $1294=(($1301+4)|0);
 var $1295=HEAP32[(($1294)>>2)];
 var $1296=$1295&-8;
 var $1297=($1296|0)==($qsize_0_i_i|0);
 if($1297){var $T_0_lcssa_i26_i=$1301;label=300;break;}else{var $T_056_i_i=$1301;var $K8_057_i_i=$1293;label=296;break;}
 case 296: 
 var $K8_057_i_i;
 var $T_056_i_i;
 var $1299=$K8_057_i_i>>>31;
 var $1300=(($T_056_i_i+16+($1299<<2))|0);
 var $1301=HEAP32[(($1300)>>2)];
 var $1302=($1301|0)==0;
 if($1302){label=297;break;}else{label=295;break;}
 case 297: 
 var $1304=$1300;
 var $1305=HEAP32[((56)>>2)];
 var $1306=($1304>>>0)<($1305>>>0);
 if($1306){label=299;break;}else{label=298;break;}
 case 298: 
 HEAP32[(($1300)>>2)]=$1230;
 var $_sum24_i_i=((($_sum_i19_i)+(24))|0);
 var $1308=(($tbase_245_i+$_sum24_i_i)|0);
 var $1309=$1308;
 HEAP32[(($1309)>>2)]=$T_056_i_i;
 var $_sum25_i_i=((($_sum_i19_i)+(12))|0);
 var $1310=(($tbase_245_i+$_sum25_i_i)|0);
 var $1311=$1310;
 HEAP32[(($1311)>>2)]=$1230;
 var $_sum26_i_i=((($_sum_i19_i)+(8))|0);
 var $1312=(($tbase_245_i+$_sum26_i_i)|0);
 var $1313=$1312;
 HEAP32[(($1313)>>2)]=$1230;
 label=303;break;
 case 299: 
 _abort();
 throw "Reached an unreachable!";
 case 300: 
 var $T_0_lcssa_i26_i;
 var $1315=(($T_0_lcssa_i26_i+8)|0);
 var $1316=HEAP32[(($1315)>>2)];
 var $1317=$T_0_lcssa_i26_i;
 var $1318=HEAP32[((56)>>2)];
 var $1319=($1317>>>0)>=($1318>>>0);
 var $1320=$1316;
 var $1321=($1320>>>0)>=($1318>>>0);
 var $or_cond_i27_i=$1319&$1321;
 if($or_cond_i27_i){label=301;break;}else{label=302;break;}
 case 301: 
 var $1323=(($1316+12)|0);
 HEAP32[(($1323)>>2)]=$1230;
 HEAP32[(($1315)>>2)]=$1230;
 var $_sum21_i_i=((($_sum_i19_i)+(8))|0);
 var $1324=(($tbase_245_i+$_sum21_i_i)|0);
 var $1325=$1324;
 HEAP32[(($1325)>>2)]=$1316;
 var $_sum22_i_i=((($_sum_i19_i)+(12))|0);
 var $1326=(($tbase_245_i+$_sum22_i_i)|0);
 var $1327=$1326;
 HEAP32[(($1327)>>2)]=$T_0_lcssa_i26_i;
 var $_sum23_i_i=((($_sum_i19_i)+(24))|0);
 var $1328=(($tbase_245_i+$_sum23_i_i)|0);
 var $1329=$1328;
 HEAP32[(($1329)>>2)]=0;
 label=303;break;
 case 302: 
 _abort();
 throw "Reached an unreachable!";
 case 303: 
 var $_sum1819_i_i=$995|8;
 var $1330=(($tbase_245_i+$_sum1819_i_i)|0);
 var $mem_0=$1330;label=341;break;
 case 304: 
 var $1331=$891;
 var $sp_0_i_i_i=488;label=305;break;
 case 305: 
 var $sp_0_i_i_i;
 var $1333=(($sp_0_i_i_i)|0);
 var $1334=HEAP32[(($1333)>>2)];
 var $1335=($1334>>>0)>($1331>>>0);
 if($1335){label=307;break;}else{label=306;break;}
 case 306: 
 var $1337=(($sp_0_i_i_i+4)|0);
 var $1338=HEAP32[(($1337)>>2)];
 var $1339=(($1334+$1338)|0);
 var $1340=($1339>>>0)>($1331>>>0);
 if($1340){label=308;break;}else{label=307;break;}
 case 307: 
 var $1342=(($sp_0_i_i_i+8)|0);
 var $1343=HEAP32[(($1342)>>2)];
 var $sp_0_i_i_i=$1343;label=305;break;
 case 308: 
 var $_sum_i13_i=((($1338)-(47))|0);
 var $_sum1_i14_i=((($1338)-(39))|0);
 var $1344=(($1334+$_sum1_i14_i)|0);
 var $1345=$1344;
 var $1346=$1345&7;
 var $1347=($1346|0)==0;
 if($1347){var $1352=0;label=310;break;}else{label=309;break;}
 case 309: 
 var $1349=(((-$1345))|0);
 var $1350=$1349&7;
 var $1352=$1350;label=310;break;
 case 310: 
 var $1352;
 var $_sum2_i15_i=((($_sum_i13_i)+($1352))|0);
 var $1353=(($1334+$_sum2_i15_i)|0);
 var $1354=(($891+16)|0);
 var $1355=$1354;
 var $1356=($1353>>>0)<($1355>>>0);
 var $1357=($1356?$1331:$1353);
 var $1358=(($1357+8)|0);
 var $1359=$1358;
 var $1360=((($tsize_244_i)-(40))|0);
 var $1361=(($tbase_245_i+8)|0);
 var $1362=$1361;
 var $1363=$1362&7;
 var $1364=($1363|0)==0;
 if($1364){var $1368=0;label=312;break;}else{label=311;break;}
 case 311: 
 var $1366=(((-$1362))|0);
 var $1367=$1366&7;
 var $1368=$1367;label=312;break;
 case 312: 
 var $1368;
 var $1369=(($tbase_245_i+$1368)|0);
 var $1370=$1369;
 var $1371=((($1360)-($1368))|0);
 HEAP32[((64)>>2)]=$1370;
 HEAP32[((52)>>2)]=$1371;
 var $1372=$1371|1;
 var $_sum_i_i_i=((($1368)+(4))|0);
 var $1373=(($tbase_245_i+$_sum_i_i_i)|0);
 var $1374=$1373;
 HEAP32[(($1374)>>2)]=$1372;
 var $_sum2_i_i_i=((($tsize_244_i)-(36))|0);
 var $1375=(($tbase_245_i+$_sum2_i_i_i)|0);
 var $1376=$1375;
 HEAP32[(($1376)>>2)]=40;
 var $1377=HEAP32[((32)>>2)];
 HEAP32[((68)>>2)]=$1377;
 var $1378=(($1357+4)|0);
 var $1379=$1378;
 HEAP32[(($1379)>>2)]=27;
 assert(16 % 1 === 0);HEAP32[(($1358)>>2)]=HEAP32[((488)>>2)];HEAP32[((($1358)+(4))>>2)]=HEAP32[((492)>>2)];HEAP32[((($1358)+(8))>>2)]=HEAP32[((496)>>2)];HEAP32[((($1358)+(12))>>2)]=HEAP32[((500)>>2)];
 HEAP32[((488)>>2)]=$tbase_245_i;
 HEAP32[((492)>>2)]=$tsize_244_i;
 HEAP32[((500)>>2)]=0;
 HEAP32[((496)>>2)]=$1359;
 var $1380=(($1357+28)|0);
 var $1381=$1380;
 HEAP32[(($1381)>>2)]=7;
 var $1382=(($1357+32)|0);
 var $1383=($1382>>>0)<($1339>>>0);
 if($1383){var $1384=$1381;label=313;break;}else{label=314;break;}
 case 313: 
 var $1384;
 var $1385=(($1384+4)|0);
 HEAP32[(($1385)>>2)]=7;
 var $1386=(($1384+8)|0);
 var $1387=$1386;
 var $1388=($1387>>>0)<($1339>>>0);
 if($1388){var $1384=$1385;label=313;break;}else{label=314;break;}
 case 314: 
 var $1389=($1357|0)==($1331|0);
 if($1389){label=338;break;}else{label=315;break;}
 case 315: 
 var $1391=$1357;
 var $1392=$891;
 var $1393=((($1391)-($1392))|0);
 var $1394=(($1331+$1393)|0);
 var $_sum3_i_i=((($1393)+(4))|0);
 var $1395=(($1331+$_sum3_i_i)|0);
 var $1396=$1395;
 var $1397=HEAP32[(($1396)>>2)];
 var $1398=$1397&-2;
 HEAP32[(($1396)>>2)]=$1398;
 var $1399=$1393|1;
 var $1400=(($891+4)|0);
 HEAP32[(($1400)>>2)]=$1399;
 var $1401=$1394;
 HEAP32[(($1401)>>2)]=$1393;
 var $1402=$1393>>>3;
 var $1403=($1393>>>0)<256;
 if($1403){label=316;break;}else{label=321;break;}
 case 316: 
 var $1405=$1402<<1;
 var $1406=((80+($1405<<2))|0);
 var $1407=$1406;
 var $1408=HEAP32[((40)>>2)];
 var $1409=1<<$1402;
 var $1410=$1408&$1409;
 var $1411=($1410|0)==0;
 if($1411){label=317;break;}else{label=318;break;}
 case 317: 
 var $1413=$1408|$1409;
 HEAP32[((40)>>2)]=$1413;
 var $_sum11_pre_i_i=((($1405)+(2))|0);
 var $_pre_i_i=((80+($_sum11_pre_i_i<<2))|0);
 var $F_0_i_i=$1407;var $_pre_phi_i_i=$_pre_i_i;label=320;break;
 case 318: 
 var $_sum12_i_i=((($1405)+(2))|0);
 var $1415=((80+($_sum12_i_i<<2))|0);
 var $1416=HEAP32[(($1415)>>2)];
 var $1417=$1416;
 var $1418=HEAP32[((56)>>2)];
 var $1419=($1417>>>0)<($1418>>>0);
 if($1419){label=319;break;}else{var $F_0_i_i=$1416;var $_pre_phi_i_i=$1415;label=320;break;}
 case 319: 
 _abort();
 throw "Reached an unreachable!";
 case 320: 
 var $_pre_phi_i_i;
 var $F_0_i_i;
 HEAP32[(($_pre_phi_i_i)>>2)]=$891;
 var $1422=(($F_0_i_i+12)|0);
 HEAP32[(($1422)>>2)]=$891;
 var $1423=(($891+8)|0);
 HEAP32[(($1423)>>2)]=$F_0_i_i;
 var $1424=(($891+12)|0);
 HEAP32[(($1424)>>2)]=$1407;
 label=338;break;
 case 321: 
 var $1426=$891;
 var $1427=$1393>>>8;
 var $1428=($1427|0)==0;
 if($1428){var $I1_0_i_i=0;label=324;break;}else{label=322;break;}
 case 322: 
 var $1430=($1393>>>0)>16777215;
 if($1430){var $I1_0_i_i=31;label=324;break;}else{label=323;break;}
 case 323: 
 var $1432=((($1427)+(1048320))|0);
 var $1433=$1432>>>16;
 var $1434=$1433&8;
 var $1435=$1427<<$1434;
 var $1436=((($1435)+(520192))|0);
 var $1437=$1436>>>16;
 var $1438=$1437&4;
 var $1439=$1438|$1434;
 var $1440=$1435<<$1438;
 var $1441=((($1440)+(245760))|0);
 var $1442=$1441>>>16;
 var $1443=$1442&2;
 var $1444=$1439|$1443;
 var $1445=(((14)-($1444))|0);
 var $1446=$1440<<$1443;
 var $1447=$1446>>>15;
 var $1448=((($1445)+($1447))|0);
 var $1449=$1448<<1;
 var $1450=((($1448)+(7))|0);
 var $1451=$1393>>>($1450>>>0);
 var $1452=$1451&1;
 var $1453=$1452|$1449;
 var $I1_0_i_i=$1453;label=324;break;
 case 324: 
 var $I1_0_i_i;
 var $1455=((344+($I1_0_i_i<<2))|0);
 var $1456=(($891+28)|0);
 var $I1_0_c_i_i=$I1_0_i_i;
 HEAP32[(($1456)>>2)]=$I1_0_c_i_i;
 var $1457=(($891+20)|0);
 HEAP32[(($1457)>>2)]=0;
 var $1458=(($891+16)|0);
 HEAP32[(($1458)>>2)]=0;
 var $1459=HEAP32[((44)>>2)];
 var $1460=1<<$I1_0_i_i;
 var $1461=$1459&$1460;
 var $1462=($1461|0)==0;
 if($1462){label=325;break;}else{label=326;break;}
 case 325: 
 var $1464=$1459|$1460;
 HEAP32[((44)>>2)]=$1464;
 HEAP32[(($1455)>>2)]=$1426;
 var $1465=(($891+24)|0);
 var $_c_i_i=$1455;
 HEAP32[(($1465)>>2)]=$_c_i_i;
 var $1466=(($891+12)|0);
 HEAP32[(($1466)>>2)]=$891;
 var $1467=(($891+8)|0);
 HEAP32[(($1467)>>2)]=$891;
 label=338;break;
 case 326: 
 var $1469=HEAP32[(($1455)>>2)];
 var $1470=($I1_0_i_i|0)==31;
 if($1470){var $1475=0;label=328;break;}else{label=327;break;}
 case 327: 
 var $1472=$I1_0_i_i>>>1;
 var $1473=(((25)-($1472))|0);
 var $1475=$1473;label=328;break;
 case 328: 
 var $1475;
 var $1476=(($1469+4)|0);
 var $1477=HEAP32[(($1476)>>2)];
 var $1478=$1477&-8;
 var $1479=($1478|0)==($1393|0);
 if($1479){var $T_0_lcssa_i_i=$1469;label=335;break;}else{label=329;break;}
 case 329: 
 var $1480=$1393<<$1475;
 var $T_015_i_i=$1469;var $K2_016_i_i=$1480;label=331;break;
 case 330: 
 var $1482=$K2_016_i_i<<1;
 var $1483=(($1490+4)|0);
 var $1484=HEAP32[(($1483)>>2)];
 var $1485=$1484&-8;
 var $1486=($1485|0)==($1393|0);
 if($1486){var $T_0_lcssa_i_i=$1490;label=335;break;}else{var $T_015_i_i=$1490;var $K2_016_i_i=$1482;label=331;break;}
 case 331: 
 var $K2_016_i_i;
 var $T_015_i_i;
 var $1488=$K2_016_i_i>>>31;
 var $1489=(($T_015_i_i+16+($1488<<2))|0);
 var $1490=HEAP32[(($1489)>>2)];
 var $1491=($1490|0)==0;
 if($1491){label=332;break;}else{label=330;break;}
 case 332: 
 var $1493=$1489;
 var $1494=HEAP32[((56)>>2)];
 var $1495=($1493>>>0)<($1494>>>0);
 if($1495){label=334;break;}else{label=333;break;}
 case 333: 
 HEAP32[(($1489)>>2)]=$1426;
 var $1497=(($891+24)|0);
 var $T_0_c8_i_i=$T_015_i_i;
 HEAP32[(($1497)>>2)]=$T_0_c8_i_i;
 var $1498=(($891+12)|0);
 HEAP32[(($1498)>>2)]=$891;
 var $1499=(($891+8)|0);
 HEAP32[(($1499)>>2)]=$891;
 label=338;break;
 case 334: 
 _abort();
 throw "Reached an unreachable!";
 case 335: 
 var $T_0_lcssa_i_i;
 var $1501=(($T_0_lcssa_i_i+8)|0);
 var $1502=HEAP32[(($1501)>>2)];
 var $1503=$T_0_lcssa_i_i;
 var $1504=HEAP32[((56)>>2)];
 var $1505=($1503>>>0)>=($1504>>>0);
 var $1506=$1502;
 var $1507=($1506>>>0)>=($1504>>>0);
 var $or_cond_i_i=$1505&$1507;
 if($or_cond_i_i){label=336;break;}else{label=337;break;}
 case 336: 
 var $1509=(($1502+12)|0);
 HEAP32[(($1509)>>2)]=$1426;
 HEAP32[(($1501)>>2)]=$1426;
 var $1510=(($891+8)|0);
 var $_c7_i_i=$1502;
 HEAP32[(($1510)>>2)]=$_c7_i_i;
 var $1511=(($891+12)|0);
 var $T_0_c_i_i=$T_0_lcssa_i_i;
 HEAP32[(($1511)>>2)]=$T_0_c_i_i;
 var $1512=(($891+24)|0);
 HEAP32[(($1512)>>2)]=0;
 label=338;break;
 case 337: 
 _abort();
 throw "Reached an unreachable!";
 case 338: 
 var $1513=HEAP32[((52)>>2)];
 var $1514=($1513>>>0)>($nb_0>>>0);
 if($1514){label=339;break;}else{label=340;break;}
 case 339: 
 var $1516=((($1513)-($nb_0))|0);
 HEAP32[((52)>>2)]=$1516;
 var $1517=HEAP32[((64)>>2)];
 var $1518=$1517;
 var $1519=(($1518+$nb_0)|0);
 var $1520=$1519;
 HEAP32[((64)>>2)]=$1520;
 var $1521=$1516|1;
 var $_sum_i34=((($nb_0)+(4))|0);
 var $1522=(($1518+$_sum_i34)|0);
 var $1523=$1522;
 HEAP32[(($1523)>>2)]=$1521;
 var $1524=$nb_0|3;
 var $1525=(($1517+4)|0);
 HEAP32[(($1525)>>2)]=$1524;
 var $1526=(($1517+8)|0);
 var $1527=$1526;
 var $mem_0=$1527;label=341;break;
 case 340: 
 var $1528=___errno_location();
 HEAP32[(($1528)>>2)]=12;
 var $mem_0=0;label=341;break;
 case 341: 
 var $mem_0;
 return $mem_0;
  default: assert(0, "bad label: " + label);
 }

}
Module["_malloc"] = _malloc;

function _free($mem){
 var label=0;

 label = 1; 
 while(1)switch(label){
 case 1: 
 var $1=($mem|0)==0;
 if($1){label=140;break;}else{label=2;break;}
 case 2: 
 var $3=((($mem)-(8))|0);
 var $4=$3;
 var $5=HEAP32[((56)>>2)];
 var $6=($3>>>0)<($5>>>0);
 if($6){label=139;break;}else{label=3;break;}
 case 3: 
 var $8=((($mem)-(4))|0);
 var $9=$8;
 var $10=HEAP32[(($9)>>2)];
 var $11=$10&3;
 var $12=($11|0)==1;
 if($12){label=139;break;}else{label=4;break;}
 case 4: 
 var $14=$10&-8;
 var $_sum=((($14)-(8))|0);
 var $15=(($mem+$_sum)|0);
 var $16=$15;
 var $17=$10&1;
 var $18=($17|0)==0;
 if($18){label=5;break;}else{var $p_0=$4;var $psize_0=$14;label=56;break;}
 case 5: 
 var $20=$3;
 var $21=HEAP32[(($20)>>2)];
 var $22=($11|0)==0;
 if($22){label=140;break;}else{label=6;break;}
 case 6: 
 var $_sum3=(((-8)-($21))|0);
 var $24=(($mem+$_sum3)|0);
 var $25=$24;
 var $26=((($21)+($14))|0);
 var $27=($24>>>0)<($5>>>0);
 if($27){label=139;break;}else{label=7;break;}
 case 7: 
 var $29=HEAP32[((60)>>2)];
 var $30=($25|0)==($29|0);
 if($30){label=54;break;}else{label=8;break;}
 case 8: 
 var $32=$21>>>3;
 var $33=($21>>>0)<256;
 if($33){label=9;break;}else{label=21;break;}
 case 9: 
 var $_sum47=((($_sum3)+(8))|0);
 var $35=(($mem+$_sum47)|0);
 var $36=$35;
 var $37=HEAP32[(($36)>>2)];
 var $_sum48=((($_sum3)+(12))|0);
 var $38=(($mem+$_sum48)|0);
 var $39=$38;
 var $40=HEAP32[(($39)>>2)];
 var $41=$32<<1;
 var $42=((80+($41<<2))|0);
 var $43=$42;
 var $44=($37|0)==($43|0);
 if($44){label=12;break;}else{label=10;break;}
 case 10: 
 var $46=$37;
 var $47=($46>>>0)<($5>>>0);
 if($47){label=20;break;}else{label=11;break;}
 case 11: 
 var $49=(($37+12)|0);
 var $50=HEAP32[(($49)>>2)];
 var $51=($50|0)==($25|0);
 if($51){label=12;break;}else{label=20;break;}
 case 12: 
 var $52=($40|0)==($37|0);
 if($52){label=13;break;}else{label=14;break;}
 case 13: 
 var $54=1<<$32;
 var $55=$54^-1;
 var $56=HEAP32[((40)>>2)];
 var $57=$56&$55;
 HEAP32[((40)>>2)]=$57;
 var $p_0=$25;var $psize_0=$26;label=56;break;
 case 14: 
 var $59=($40|0)==($43|0);
 if($59){label=15;break;}else{label=16;break;}
 case 15: 
 var $_pre82=(($40+8)|0);
 var $_pre_phi83=$_pre82;label=18;break;
 case 16: 
 var $61=$40;
 var $62=($61>>>0)<($5>>>0);
 if($62){label=19;break;}else{label=17;break;}
 case 17: 
 var $64=(($40+8)|0);
 var $65=HEAP32[(($64)>>2)];
 var $66=($65|0)==($25|0);
 if($66){var $_pre_phi83=$64;label=18;break;}else{label=19;break;}
 case 18: 
 var $_pre_phi83;
 var $67=(($37+12)|0);
 HEAP32[(($67)>>2)]=$40;
 HEAP32[(($_pre_phi83)>>2)]=$37;
 var $p_0=$25;var $psize_0=$26;label=56;break;
 case 19: 
 _abort();
 throw "Reached an unreachable!";
 case 20: 
 _abort();
 throw "Reached an unreachable!";
 case 21: 
 var $69=$24;
 var $_sum37=((($_sum3)+(24))|0);
 var $70=(($mem+$_sum37)|0);
 var $71=$70;
 var $72=HEAP32[(($71)>>2)];
 var $_sum38=((($_sum3)+(12))|0);
 var $73=(($mem+$_sum38)|0);
 var $74=$73;
 var $75=HEAP32[(($74)>>2)];
 var $76=($75|0)==($69|0);
 if($76){label=27;break;}else{label=22;break;}
 case 22: 
 var $_sum44=((($_sum3)+(8))|0);
 var $78=(($mem+$_sum44)|0);
 var $79=$78;
 var $80=HEAP32[(($79)>>2)];
 var $81=$80;
 var $82=($81>>>0)<($5>>>0);
 if($82){label=26;break;}else{label=23;break;}
 case 23: 
 var $84=(($80+12)|0);
 var $85=HEAP32[(($84)>>2)];
 var $86=($85|0)==($69|0);
 if($86){label=24;break;}else{label=26;break;}
 case 24: 
 var $88=(($75+8)|0);
 var $89=HEAP32[(($88)>>2)];
 var $90=($89|0)==($69|0);
 if($90){label=25;break;}else{label=26;break;}
 case 25: 
 HEAP32[(($84)>>2)]=$75;
 HEAP32[(($88)>>2)]=$80;
 var $R_1=$75;label=34;break;
 case 26: 
 _abort();
 throw "Reached an unreachable!";
 case 27: 
 var $_sum40=((($_sum3)+(20))|0);
 var $93=(($mem+$_sum40)|0);
 var $94=$93;
 var $95=HEAP32[(($94)>>2)];
 var $96=($95|0)==0;
 if($96){label=28;break;}else{var $R_0=$95;var $RP_0=$94;label=29;break;}
 case 28: 
 var $_sum39=((($_sum3)+(16))|0);
 var $98=(($mem+$_sum39)|0);
 var $99=$98;
 var $100=HEAP32[(($99)>>2)];
 var $101=($100|0)==0;
 if($101){var $R_1=0;label=34;break;}else{var $R_0=$100;var $RP_0=$99;label=29;break;}
 case 29: 
 var $RP_0;
 var $R_0;
 var $102=(($R_0+20)|0);
 var $103=HEAP32[(($102)>>2)];
 var $104=($103|0)==0;
 if($104){label=30;break;}else{var $R_0=$103;var $RP_0=$102;label=29;break;}
 case 30: 
 var $106=(($R_0+16)|0);
 var $107=HEAP32[(($106)>>2)];
 var $108=($107|0)==0;
 if($108){label=31;break;}else{var $R_0=$107;var $RP_0=$106;label=29;break;}
 case 31: 
 var $110=$RP_0;
 var $111=($110>>>0)<($5>>>0);
 if($111){label=33;break;}else{label=32;break;}
 case 32: 
 HEAP32[(($RP_0)>>2)]=0;
 var $R_1=$R_0;label=34;break;
 case 33: 
 _abort();
 throw "Reached an unreachable!";
 case 34: 
 var $R_1;
 var $115=($72|0)==0;
 if($115){var $p_0=$25;var $psize_0=$26;label=56;break;}else{label=35;break;}
 case 35: 
 var $_sum41=((($_sum3)+(28))|0);
 var $117=(($mem+$_sum41)|0);
 var $118=$117;
 var $119=HEAP32[(($118)>>2)];
 var $120=((344+($119<<2))|0);
 var $121=HEAP32[(($120)>>2)];
 var $122=($69|0)==($121|0);
 if($122){label=36;break;}else{label=38;break;}
 case 36: 
 HEAP32[(($120)>>2)]=$R_1;
 var $cond=($R_1|0)==0;
 if($cond){label=37;break;}else{label=44;break;}
 case 37: 
 var $124=HEAP32[(($118)>>2)];
 var $125=1<<$124;
 var $126=$125^-1;
 var $127=HEAP32[((44)>>2)];
 var $128=$127&$126;
 HEAP32[((44)>>2)]=$128;
 var $p_0=$25;var $psize_0=$26;label=56;break;
 case 38: 
 var $130=$72;
 var $131=HEAP32[((56)>>2)];
 var $132=($130>>>0)<($131>>>0);
 if($132){label=42;break;}else{label=39;break;}
 case 39: 
 var $134=(($72+16)|0);
 var $135=HEAP32[(($134)>>2)];
 var $136=($135|0)==($69|0);
 if($136){label=40;break;}else{label=41;break;}
 case 40: 
 HEAP32[(($134)>>2)]=$R_1;
 label=43;break;
 case 41: 
 var $139=(($72+20)|0);
 HEAP32[(($139)>>2)]=$R_1;
 label=43;break;
 case 42: 
 _abort();
 throw "Reached an unreachable!";
 case 43: 
 var $142=($R_1|0)==0;
 if($142){var $p_0=$25;var $psize_0=$26;label=56;break;}else{label=44;break;}
 case 44: 
 var $144=$R_1;
 var $145=HEAP32[((56)>>2)];
 var $146=($144>>>0)<($145>>>0);
 if($146){label=53;break;}else{label=45;break;}
 case 45: 
 var $148=(($R_1+24)|0);
 HEAP32[(($148)>>2)]=$72;
 var $_sum42=((($_sum3)+(16))|0);
 var $149=(($mem+$_sum42)|0);
 var $150=$149;
 var $151=HEAP32[(($150)>>2)];
 var $152=($151|0)==0;
 if($152){label=49;break;}else{label=46;break;}
 case 46: 
 var $154=$151;
 var $155=HEAP32[((56)>>2)];
 var $156=($154>>>0)<($155>>>0);
 if($156){label=48;break;}else{label=47;break;}
 case 47: 
 var $158=(($R_1+16)|0);
 HEAP32[(($158)>>2)]=$151;
 var $159=(($151+24)|0);
 HEAP32[(($159)>>2)]=$R_1;
 label=49;break;
 case 48: 
 _abort();
 throw "Reached an unreachable!";
 case 49: 
 var $_sum43=((($_sum3)+(20))|0);
 var $162=(($mem+$_sum43)|0);
 var $163=$162;
 var $164=HEAP32[(($163)>>2)];
 var $165=($164|0)==0;
 if($165){var $p_0=$25;var $psize_0=$26;label=56;break;}else{label=50;break;}
 case 50: 
 var $167=$164;
 var $168=HEAP32[((56)>>2)];
 var $169=($167>>>0)<($168>>>0);
 if($169){label=52;break;}else{label=51;break;}
 case 51: 
 var $171=(($R_1+20)|0);
 HEAP32[(($171)>>2)]=$164;
 var $172=(($164+24)|0);
 HEAP32[(($172)>>2)]=$R_1;
 var $p_0=$25;var $psize_0=$26;label=56;break;
 case 52: 
 _abort();
 throw "Reached an unreachable!";
 case 53: 
 _abort();
 throw "Reached an unreachable!";
 case 54: 
 var $_sum4=((($14)-(4))|0);
 var $176=(($mem+$_sum4)|0);
 var $177=$176;
 var $178=HEAP32[(($177)>>2)];
 var $179=$178&3;
 var $180=($179|0)==3;
 if($180){label=55;break;}else{var $p_0=$25;var $psize_0=$26;label=56;break;}
 case 55: 
 HEAP32[((48)>>2)]=$26;
 var $182=HEAP32[(($177)>>2)];
 var $183=$182&-2;
 HEAP32[(($177)>>2)]=$183;
 var $184=$26|1;
 var $_sum35=((($_sum3)+(4))|0);
 var $185=(($mem+$_sum35)|0);
 var $186=$185;
 HEAP32[(($186)>>2)]=$184;
 var $187=$15;
 HEAP32[(($187)>>2)]=$26;
 label=140;break;
 case 56: 
 var $psize_0;
 var $p_0;
 var $189=$p_0;
 var $190=($189>>>0)<($15>>>0);
 if($190){label=57;break;}else{label=139;break;}
 case 57: 
 var $_sum34=((($14)-(4))|0);
 var $192=(($mem+$_sum34)|0);
 var $193=$192;
 var $194=HEAP32[(($193)>>2)];
 var $195=$194&1;
 var $phitmp=($195|0)==0;
 if($phitmp){label=139;break;}else{label=58;break;}
 case 58: 
 var $197=$194&2;
 var $198=($197|0)==0;
 if($198){label=59;break;}else{label=112;break;}
 case 59: 
 var $200=HEAP32[((64)>>2)];
 var $201=($16|0)==($200|0);
 if($201){label=60;break;}else{label=62;break;}
 case 60: 
 var $203=HEAP32[((52)>>2)];
 var $204=((($203)+($psize_0))|0);
 HEAP32[((52)>>2)]=$204;
 HEAP32[((64)>>2)]=$p_0;
 var $205=$204|1;
 var $206=(($p_0+4)|0);
 HEAP32[(($206)>>2)]=$205;
 var $207=HEAP32[((60)>>2)];
 var $208=($p_0|0)==($207|0);
 if($208){label=61;break;}else{label=140;break;}
 case 61: 
 HEAP32[((60)>>2)]=0;
 HEAP32[((48)>>2)]=0;
 label=140;break;
 case 62: 
 var $211=HEAP32[((60)>>2)];
 var $212=($16|0)==($211|0);
 if($212){label=63;break;}else{label=64;break;}
 case 63: 
 var $214=HEAP32[((48)>>2)];
 var $215=((($214)+($psize_0))|0);
 HEAP32[((48)>>2)]=$215;
 HEAP32[((60)>>2)]=$p_0;
 var $216=$215|1;
 var $217=(($p_0+4)|0);
 HEAP32[(($217)>>2)]=$216;
 var $218=(($189+$215)|0);
 var $219=$218;
 HEAP32[(($219)>>2)]=$215;
 label=140;break;
 case 64: 
 var $221=$194&-8;
 var $222=((($221)+($psize_0))|0);
 var $223=$194>>>3;
 var $224=($194>>>0)<256;
 if($224){label=65;break;}else{label=77;break;}
 case 65: 
 var $226=(($mem+$14)|0);
 var $227=$226;
 var $228=HEAP32[(($227)>>2)];
 var $_sum2829=$14|4;
 var $229=(($mem+$_sum2829)|0);
 var $230=$229;
 var $231=HEAP32[(($230)>>2)];
 var $232=$223<<1;
 var $233=((80+($232<<2))|0);
 var $234=$233;
 var $235=($228|0)==($234|0);
 if($235){label=68;break;}else{label=66;break;}
 case 66: 
 var $237=$228;
 var $238=HEAP32[((56)>>2)];
 var $239=($237>>>0)<($238>>>0);
 if($239){label=76;break;}else{label=67;break;}
 case 67: 
 var $241=(($228+12)|0);
 var $242=HEAP32[(($241)>>2)];
 var $243=($242|0)==($16|0);
 if($243){label=68;break;}else{label=76;break;}
 case 68: 
 var $244=($231|0)==($228|0);
 if($244){label=69;break;}else{label=70;break;}
 case 69: 
 var $246=1<<$223;
 var $247=$246^-1;
 var $248=HEAP32[((40)>>2)];
 var $249=$248&$247;
 HEAP32[((40)>>2)]=$249;
 label=110;break;
 case 70: 
 var $251=($231|0)==($234|0);
 if($251){label=71;break;}else{label=72;break;}
 case 71: 
 var $_pre80=(($231+8)|0);
 var $_pre_phi81=$_pre80;label=74;break;
 case 72: 
 var $253=$231;
 var $254=HEAP32[((56)>>2)];
 var $255=($253>>>0)<($254>>>0);
 if($255){label=75;break;}else{label=73;break;}
 case 73: 
 var $257=(($231+8)|0);
 var $258=HEAP32[(($257)>>2)];
 var $259=($258|0)==($16|0);
 if($259){var $_pre_phi81=$257;label=74;break;}else{label=75;break;}
 case 74: 
 var $_pre_phi81;
 var $260=(($228+12)|0);
 HEAP32[(($260)>>2)]=$231;
 HEAP32[(($_pre_phi81)>>2)]=$228;
 label=110;break;
 case 75: 
 _abort();
 throw "Reached an unreachable!";
 case 76: 
 _abort();
 throw "Reached an unreachable!";
 case 77: 
 var $262=$15;
 var $_sum6=((($14)+(16))|0);
 var $263=(($mem+$_sum6)|0);
 var $264=$263;
 var $265=HEAP32[(($264)>>2)];
 var $_sum78=$14|4;
 var $266=(($mem+$_sum78)|0);
 var $267=$266;
 var $268=HEAP32[(($267)>>2)];
 var $269=($268|0)==($262|0);
 if($269){label=83;break;}else{label=78;break;}
 case 78: 
 var $271=(($mem+$14)|0);
 var $272=$271;
 var $273=HEAP32[(($272)>>2)];
 var $274=$273;
 var $275=HEAP32[((56)>>2)];
 var $276=($274>>>0)<($275>>>0);
 if($276){label=82;break;}else{label=79;break;}
 case 79: 
 var $278=(($273+12)|0);
 var $279=HEAP32[(($278)>>2)];
 var $280=($279|0)==($262|0);
 if($280){label=80;break;}else{label=82;break;}
 case 80: 
 var $282=(($268+8)|0);
 var $283=HEAP32[(($282)>>2)];
 var $284=($283|0)==($262|0);
 if($284){label=81;break;}else{label=82;break;}
 case 81: 
 HEAP32[(($278)>>2)]=$268;
 HEAP32[(($282)>>2)]=$273;
 var $R7_1=$268;label=90;break;
 case 82: 
 _abort();
 throw "Reached an unreachable!";
 case 83: 
 var $_sum10=((($14)+(12))|0);
 var $287=(($mem+$_sum10)|0);
 var $288=$287;
 var $289=HEAP32[(($288)>>2)];
 var $290=($289|0)==0;
 if($290){label=84;break;}else{var $R7_0=$289;var $RP9_0=$288;label=85;break;}
 case 84: 
 var $_sum9=((($14)+(8))|0);
 var $292=(($mem+$_sum9)|0);
 var $293=$292;
 var $294=HEAP32[(($293)>>2)];
 var $295=($294|0)==0;
 if($295){var $R7_1=0;label=90;break;}else{var $R7_0=$294;var $RP9_0=$293;label=85;break;}
 case 85: 
 var $RP9_0;
 var $R7_0;
 var $296=(($R7_0+20)|0);
 var $297=HEAP32[(($296)>>2)];
 var $298=($297|0)==0;
 if($298){label=86;break;}else{var $R7_0=$297;var $RP9_0=$296;label=85;break;}
 case 86: 
 var $300=(($R7_0+16)|0);
 var $301=HEAP32[(($300)>>2)];
 var $302=($301|0)==0;
 if($302){label=87;break;}else{var $R7_0=$301;var $RP9_0=$300;label=85;break;}
 case 87: 
 var $304=$RP9_0;
 var $305=HEAP32[((56)>>2)];
 var $306=($304>>>0)<($305>>>0);
 if($306){label=89;break;}else{label=88;break;}
 case 88: 
 HEAP32[(($RP9_0)>>2)]=0;
 var $R7_1=$R7_0;label=90;break;
 case 89: 
 _abort();
 throw "Reached an unreachable!";
 case 90: 
 var $R7_1;
 var $310=($265|0)==0;
 if($310){label=110;break;}else{label=91;break;}
 case 91: 
 var $_sum21=((($14)+(20))|0);
 var $312=(($mem+$_sum21)|0);
 var $313=$312;
 var $314=HEAP32[(($313)>>2)];
 var $315=((344+($314<<2))|0);
 var $316=HEAP32[(($315)>>2)];
 var $317=($262|0)==($316|0);
 if($317){label=92;break;}else{label=94;break;}
 case 92: 
 HEAP32[(($315)>>2)]=$R7_1;
 var $cond69=($R7_1|0)==0;
 if($cond69){label=93;break;}else{label=100;break;}
 case 93: 
 var $319=HEAP32[(($313)>>2)];
 var $320=1<<$319;
 var $321=$320^-1;
 var $322=HEAP32[((44)>>2)];
 var $323=$322&$321;
 HEAP32[((44)>>2)]=$323;
 label=110;break;
 case 94: 
 var $325=$265;
 var $326=HEAP32[((56)>>2)];
 var $327=($325>>>0)<($326>>>0);
 if($327){label=98;break;}else{label=95;break;}
 case 95: 
 var $329=(($265+16)|0);
 var $330=HEAP32[(($329)>>2)];
 var $331=($330|0)==($262|0);
 if($331){label=96;break;}else{label=97;break;}
 case 96: 
 HEAP32[(($329)>>2)]=$R7_1;
 label=99;break;
 case 97: 
 var $334=(($265+20)|0);
 HEAP32[(($334)>>2)]=$R7_1;
 label=99;break;
 case 98: 
 _abort();
 throw "Reached an unreachable!";
 case 99: 
 var $337=($R7_1|0)==0;
 if($337){label=110;break;}else{label=100;break;}
 case 100: 
 var $339=$R7_1;
 var $340=HEAP32[((56)>>2)];
 var $341=($339>>>0)<($340>>>0);
 if($341){label=109;break;}else{label=101;break;}
 case 101: 
 var $343=(($R7_1+24)|0);
 HEAP32[(($343)>>2)]=$265;
 var $_sum22=((($14)+(8))|0);
 var $344=(($mem+$_sum22)|0);
 var $345=$344;
 var $346=HEAP32[(($345)>>2)];
 var $347=($346|0)==0;
 if($347){label=105;break;}else{label=102;break;}
 case 102: 
 var $349=$346;
 var $350=HEAP32[((56)>>2)];
 var $351=($349>>>0)<($350>>>0);
 if($351){label=104;break;}else{label=103;break;}
 case 103: 
 var $353=(($R7_1+16)|0);
 HEAP32[(($353)>>2)]=$346;
 var $354=(($346+24)|0);
 HEAP32[(($354)>>2)]=$R7_1;
 label=105;break;
 case 104: 
 _abort();
 throw "Reached an unreachable!";
 case 105: 
 var $_sum23=((($14)+(12))|0);
 var $357=(($mem+$_sum23)|0);
 var $358=$357;
 var $359=HEAP32[(($358)>>2)];
 var $360=($359|0)==0;
 if($360){label=110;break;}else{label=106;break;}
 case 106: 
 var $362=$359;
 var $363=HEAP32[((56)>>2)];
 var $364=($362>>>0)<($363>>>0);
 if($364){label=108;break;}else{label=107;break;}
 case 107: 
 var $366=(($R7_1+20)|0);
 HEAP32[(($366)>>2)]=$359;
 var $367=(($359+24)|0);
 HEAP32[(($367)>>2)]=$R7_1;
 label=110;break;
 case 108: 
 _abort();
 throw "Reached an unreachable!";
 case 109: 
 _abort();
 throw "Reached an unreachable!";
 case 110: 
 var $371=$222|1;
 var $372=(($p_0+4)|0);
 HEAP32[(($372)>>2)]=$371;
 var $373=(($189+$222)|0);
 var $374=$373;
 HEAP32[(($374)>>2)]=$222;
 var $375=HEAP32[((60)>>2)];
 var $376=($p_0|0)==($375|0);
 if($376){label=111;break;}else{var $psize_1=$222;label=113;break;}
 case 111: 
 HEAP32[((48)>>2)]=$222;
 label=140;break;
 case 112: 
 var $379=$194&-2;
 HEAP32[(($193)>>2)]=$379;
 var $380=$psize_0|1;
 var $381=(($p_0+4)|0);
 HEAP32[(($381)>>2)]=$380;
 var $382=(($189+$psize_0)|0);
 var $383=$382;
 HEAP32[(($383)>>2)]=$psize_0;
 var $psize_1=$psize_0;label=113;break;
 case 113: 
 var $psize_1;
 var $385=$psize_1>>>3;
 var $386=($psize_1>>>0)<256;
 if($386){label=114;break;}else{label=119;break;}
 case 114: 
 var $388=$385<<1;
 var $389=((80+($388<<2))|0);
 var $390=$389;
 var $391=HEAP32[((40)>>2)];
 var $392=1<<$385;
 var $393=$391&$392;
 var $394=($393|0)==0;
 if($394){label=115;break;}else{label=116;break;}
 case 115: 
 var $396=$391|$392;
 HEAP32[((40)>>2)]=$396;
 var $_sum19_pre=((($388)+(2))|0);
 var $_pre=((80+($_sum19_pre<<2))|0);
 var $F16_0=$390;var $_pre_phi=$_pre;label=118;break;
 case 116: 
 var $_sum20=((($388)+(2))|0);
 var $398=((80+($_sum20<<2))|0);
 var $399=HEAP32[(($398)>>2)];
 var $400=$399;
 var $401=HEAP32[((56)>>2)];
 var $402=($400>>>0)<($401>>>0);
 if($402){label=117;break;}else{var $F16_0=$399;var $_pre_phi=$398;label=118;break;}
 case 117: 
 _abort();
 throw "Reached an unreachable!";
 case 118: 
 var $_pre_phi;
 var $F16_0;
 HEAP32[(($_pre_phi)>>2)]=$p_0;
 var $405=(($F16_0+12)|0);
 HEAP32[(($405)>>2)]=$p_0;
 var $406=(($p_0+8)|0);
 HEAP32[(($406)>>2)]=$F16_0;
 var $407=(($p_0+12)|0);
 HEAP32[(($407)>>2)]=$390;
 label=140;break;
 case 119: 
 var $409=$p_0;
 var $410=$psize_1>>>8;
 var $411=($410|0)==0;
 if($411){var $I18_0=0;label=122;break;}else{label=120;break;}
 case 120: 
 var $413=($psize_1>>>0)>16777215;
 if($413){var $I18_0=31;label=122;break;}else{label=121;break;}
 case 121: 
 var $415=((($410)+(1048320))|0);
 var $416=$415>>>16;
 var $417=$416&8;
 var $418=$410<<$417;
 var $419=((($418)+(520192))|0);
 var $420=$419>>>16;
 var $421=$420&4;
 var $422=$421|$417;
 var $423=$418<<$421;
 var $424=((($423)+(245760))|0);
 var $425=$424>>>16;
 var $426=$425&2;
 var $427=$422|$426;
 var $428=(((14)-($427))|0);
 var $429=$423<<$426;
 var $430=$429>>>15;
 var $431=((($428)+($430))|0);
 var $432=$431<<1;
 var $433=((($431)+(7))|0);
 var $434=$psize_1>>>($433>>>0);
 var $435=$434&1;
 var $436=$435|$432;
 var $I18_0=$436;label=122;break;
 case 122: 
 var $I18_0;
 var $438=((344+($I18_0<<2))|0);
 var $439=(($p_0+28)|0);
 var $I18_0_c=$I18_0;
 HEAP32[(($439)>>2)]=$I18_0_c;
 var $440=(($p_0+20)|0);
 HEAP32[(($440)>>2)]=0;
 var $441=(($p_0+16)|0);
 HEAP32[(($441)>>2)]=0;
 var $442=HEAP32[((44)>>2)];
 var $443=1<<$I18_0;
 var $444=$442&$443;
 var $445=($444|0)==0;
 if($445){label=123;break;}else{label=124;break;}
 case 123: 
 var $447=$442|$443;
 HEAP32[((44)>>2)]=$447;
 HEAP32[(($438)>>2)]=$409;
 var $448=(($p_0+24)|0);
 var $_c=$438;
 HEAP32[(($448)>>2)]=$_c;
 var $449=(($p_0+12)|0);
 HEAP32[(($449)>>2)]=$p_0;
 var $450=(($p_0+8)|0);
 HEAP32[(($450)>>2)]=$p_0;
 label=136;break;
 case 124: 
 var $452=HEAP32[(($438)>>2)];
 var $453=($I18_0|0)==31;
 if($453){var $458=0;label=126;break;}else{label=125;break;}
 case 125: 
 var $455=$I18_0>>>1;
 var $456=(((25)-($455))|0);
 var $458=$456;label=126;break;
 case 126: 
 var $458;
 var $459=(($452+4)|0);
 var $460=HEAP32[(($459)>>2)];
 var $461=$460&-8;
 var $462=($461|0)==($psize_1|0);
 if($462){var $T_0_lcssa=$452;label=133;break;}else{label=127;break;}
 case 127: 
 var $463=$psize_1<<$458;
 var $T_072=$452;var $K19_073=$463;label=129;break;
 case 128: 
 var $465=$K19_073<<1;
 var $466=(($473+4)|0);
 var $467=HEAP32[(($466)>>2)];
 var $468=$467&-8;
 var $469=($468|0)==($psize_1|0);
 if($469){var $T_0_lcssa=$473;label=133;break;}else{var $T_072=$473;var $K19_073=$465;label=129;break;}
 case 129: 
 var $K19_073;
 var $T_072;
 var $471=$K19_073>>>31;
 var $472=(($T_072+16+($471<<2))|0);
 var $473=HEAP32[(($472)>>2)];
 var $474=($473|0)==0;
 if($474){label=130;break;}else{label=128;break;}
 case 130: 
 var $476=$472;
 var $477=HEAP32[((56)>>2)];
 var $478=($476>>>0)<($477>>>0);
 if($478){label=132;break;}else{label=131;break;}
 case 131: 
 HEAP32[(($472)>>2)]=$409;
 var $480=(($p_0+24)|0);
 var $T_0_c16=$T_072;
 HEAP32[(($480)>>2)]=$T_0_c16;
 var $481=(($p_0+12)|0);
 HEAP32[(($481)>>2)]=$p_0;
 var $482=(($p_0+8)|0);
 HEAP32[(($482)>>2)]=$p_0;
 label=136;break;
 case 132: 
 _abort();
 throw "Reached an unreachable!";
 case 133: 
 var $T_0_lcssa;
 var $484=(($T_0_lcssa+8)|0);
 var $485=HEAP32[(($484)>>2)];
 var $486=$T_0_lcssa;
 var $487=HEAP32[((56)>>2)];
 var $488=($486>>>0)>=($487>>>0);
 var $489=$485;
 var $490=($489>>>0)>=($487>>>0);
 var $or_cond=$488&$490;
 if($or_cond){label=134;break;}else{label=135;break;}
 case 134: 
 var $492=(($485+12)|0);
 HEAP32[(($492)>>2)]=$409;
 HEAP32[(($484)>>2)]=$409;
 var $493=(($p_0+8)|0);
 var $_c15=$485;
 HEAP32[(($493)>>2)]=$_c15;
 var $494=(($p_0+12)|0);
 var $T_0_c=$T_0_lcssa;
 HEAP32[(($494)>>2)]=$T_0_c;
 var $495=(($p_0+24)|0);
 HEAP32[(($495)>>2)]=0;
 label=136;break;
 case 135: 
 _abort();
 throw "Reached an unreachable!";
 case 136: 
 var $497=HEAP32[((72)>>2)];
 var $498=((($497)-(1))|0);
 HEAP32[((72)>>2)]=$498;
 var $499=($498|0)==0;
 if($499){var $sp_0_in_i=496;label=137;break;}else{label=140;break;}
 case 137: 
 var $sp_0_in_i;
 var $sp_0_i=HEAP32[(($sp_0_in_i)>>2)];
 var $500=($sp_0_i|0)==0;
 var $501=(($sp_0_i+8)|0);
 if($500){label=138;break;}else{var $sp_0_in_i=$501;label=137;break;}
 case 138: 
 HEAP32[((72)>>2)]=-1;
 label=140;break;
 case 139: 
 _abort();
 throw "Reached an unreachable!";
 case 140: 
 return;
  default: assert(0, "bad label: " + label);
 }

}
Module["_free"] = _free;


// EMSCRIPTEN_END_FUNCS
// EMSCRIPTEN_END_FUNCS

// Warning: printing of i64 values may be slightly rounded! No deep i64 math used, so precise i64 code not included
var i64Math = null;

// === Auto-generated postamble setup entry stuff ===

if (memoryInitializer) {
  function applyData(data) {
    HEAPU8.set(data, STATIC_BASE);
  }
  if (ENVIRONMENT_IS_NODE || ENVIRONMENT_IS_SHELL) {
    applyData(Module['readBinary'](memoryInitializer));
  } else {
    addRunDependency('memory initializer');
    Browser.asyncLoad(memoryInitializer, function(data) {
      applyData(data);
      removeRunDependency('memory initializer');
    }, function(data) {
      throw 'could not load memory initializer ' + memoryInitializer;
    });
  }
}

function ExitStatus(status) {
  this.name = "ExitStatus";
  this.message = "Program terminated with exit(" + status + ")";
  this.status = status;
};
ExitStatus.prototype = new Error();
ExitStatus.prototype.constructor = ExitStatus;

var initialStackTop;
var preloadStartTime = null;
var calledMain = false;

dependenciesFulfilled = function runCaller() {
  // If run has never been called, and we should call run (INVOKE_RUN is true, and Module.noInitialRun is not false)
  if (!Module['calledRun'] && shouldRunNow) run();
  if (!Module['calledRun']) dependenciesFulfilled = runCaller; // try this again later, after new deps are fulfilled
}

Module['callMain'] = Module.callMain = function callMain(args) {
  assert(runDependencies == 0, 'cannot call main when async dependencies remain! (listen on __ATMAIN__)');
  assert(__ATPRERUN__.length == 0, 'cannot call main when preRun functions remain to be called');

  args = args || [];

  if (ENVIRONMENT_IS_WEB && preloadStartTime !== null) {
    Module.printErr('preload time: ' + (Date.now() - preloadStartTime) + ' ms');
  }

  ensureInitRuntime();

  var argc = args.length+1;
  function pad() {
    for (var i = 0; i < 4-1; i++) {
      argv.push(0);
    }
  }
  var argv = [allocate(intArrayFromString("/bin/this.program"), 'i8', ALLOC_NORMAL) ];
  pad();
  for (var i = 0; i < argc-1; i = i + 1) {
    argv.push(allocate(intArrayFromString(args[i]), 'i8', ALLOC_NORMAL));
    pad();
  }
  argv.push(0);
  argv = allocate(argv, 'i32', ALLOC_NORMAL);

  initialStackTop = STACKTOP;

  try {

    var ret = Module['_main'](argc, argv, 0);


    // if we're not running an evented main loop, it's time to exit
    if (!Module['noExitRuntime']) {
      exit(ret);
    }
  }
  catch(e) {
    if (e instanceof ExitStatus) {
      // exit() throws this once it's done to make sure execution
      // has been stopped completely
      return;
    } else if (e == 'SimulateInfiniteLoop') {
      // running an evented main loop, don't immediately exit
      Module['noExitRuntime'] = true;
      return;
    } else {
      if (e && typeof e === 'object' && e.stack) Module.printErr('exception thrown: ' + [e, e.stack]);
      throw e;
    }
  } finally {
    calledMain = true;
  }
}




function run(args) {
  args = args || Module['arguments'];

  if (preloadStartTime === null) preloadStartTime = Date.now();

  if (runDependencies > 0) {
    Module.printErr('run() called, but dependencies remain, so not running');
    return;
  }

  preRun();

  if (runDependencies > 0) return; // a preRun added a dependency, run will be called later
  if (Module['calledRun']) return; // run may have just been called through dependencies being fulfilled just in this very frame

  function doRun() {
    if (Module['calledRun']) return; // run may have just been called while the async setStatus time below was happening
    Module['calledRun'] = true;

    ensureInitRuntime();

    preMain();

    if (Module['_main'] && shouldRunNow) {
      Module['callMain'](args);
    }

    postRun();
  }

  if (Module['setStatus']) {
    Module['setStatus']('Running...');
    setTimeout(function() {
      setTimeout(function() {
        Module['setStatus']('');
      }, 1);
      if (!ABORT) doRun();
    }, 1);
  } else {
    doRun();
  }
}
Module['run'] = Module.run = run;

function exit(status) {
  ABORT = true;
  EXITSTATUS = status;
  STACKTOP = initialStackTop;

  // exit the runtime
  exitRuntime();

  // TODO We should handle this differently based on environment.
  // In the browser, the best we can do is throw an exception
  // to halt execution, but in node we could process.exit and
  // I'd imagine SM shell would have something equivalent.
  // This would let us set a proper exit status (which
  // would be great for checking test exit statuses).
  // https://github.com/kripken/emscripten/issues/1371

  // throw an exception to halt the current execution
  throw new ExitStatus(status);
}
Module['exit'] = Module.exit = exit;

function abort(text) {
  if (text) {
    Module.print(text);
    Module.printErr(text);
  }

  ABORT = true;
  EXITSTATUS = 1;

  throw 'abort() at ' + stackTrace();
}
Module['abort'] = Module.abort = abort;

// {{PRE_RUN_ADDITIONS}}

if (Module['preInit']) {
  if (typeof Module['preInit'] == 'function') Module['preInit'] = [Module['preInit']];
  while (Module['preInit'].length > 0) {
    Module['preInit'].pop()();
  }
}

// shouldRunNow refers to calling main(), not run().
var shouldRunNow = true;
if (Module['noInitialRun']) {
  shouldRunNow = false;
}

run();

// {{POST_RUN_ADDITIONS}}






// {{MODULE_ADDITIONS}}
