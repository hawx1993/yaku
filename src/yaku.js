(function () {
    "use strict";

    var $nil
    , root = typeof global === "object" ? global : window
    , isLongStackTrace = false

    , $rejected = 0
    , $resolved = 1
    , $pending = 2

    , $promiseTrace = "_pt"
    , $settlerTrace = "_st"

    , $fromPrevious = "From previous event:"
    , $unhandledRejection = "unhandledRejection";

    /**
     * This class follows the [Promises/A+](https://promisesaplus.com) and
     * [ES6](http://people.mozilla.org/~jorendorff/es6-draft.html#sec-promise-objects) spec
     * with some extra helpers.
     * @param  {Function} executor Function object with three arguments resolve, reject and
     * the promise itself.
     * The first argument fulfills the promise, the second argument rejects it.
     * We can call these functions, once our operation is completed.
     * The `this` context of the executor is the promise itself, it can be used to add custom handlers,
     * such as `abort` or `progress` helpers.
     * @example
     * Here's an abort example.
     * ```js
     * var Promise = require('yaku');
     * var p = new Promise((resolve, reject) => {
     *     var tmr = setTimeout(resolve, 3000);
     *     this.abort = (reason) => {
     *         clearTimeout(tmr);
     *         reject(reason);
     *     };
     * });
     *
     * p.abort(new Error('abort'));
     * ```
     * @example
     * Here's a progress example.
     * ```js
     * var Promise = require('yaku');
     * var p = new Promise((resolve, reject) => {
     *     var self = this;
     *     var count = 0;
     *     var all = 100;
     *     var tmr = setInterval(() => {
     *         try {
     *             self.progress && self.progress(count, all);
     *         } catch (err) {
     *             reject(err);
     *         }
     *
     *         if (count < all)
     *             count++;
     *         else {
     *             resolve();
     *             clearInterval(tmr);
     *         }
     *     }, 1000);
     * });
     *
     * p.progress = (curr, all) => {
     *     console.log(curr, '/', all);
     * };
     * ```
     */
    var Yaku = module.exports = function Promise (executor) {
        var self = this,
            err;

        if (isLongStackTrace) self[$promiseTrace] = genTraceInfo();

        if (executor !== $noop) {
            err = genTryCatcher(executor, self)(
                genSettler(self, $resolved),
                genSettler(self, $rejected)
            );

            if (err === $tryErr)
                settlePromise(self, $rejected, err.e);
        }
    };

    extendPrototype(Yaku, {
        /**
         * Appends fulfillment and rejection handlers to the promise,
         * and returns a new promise resolving to the return value of the called handler.
         * @param  {Function} onFulfilled Optional. Called when the Promise is resolved.
         * @param  {Function} onRejected  Optional. Called when the Promise is rejected.
         * @return {Yaku} It will return a new Yaku which will resolve or reject after
         * @example
         * the current Promise.
         * ```js
         * var Promise = require('yaku');
         * var p = Promise.resolve(10);
         *
         * p.then((v) => {
         *     console.log(v);
         * });
         * ```
         */
        then: function then (onFulfilled, onRejected) {
            return addHandler(this, newEmptyYaku(), onFulfilled, onRejected);
        },

        /**
         * The `catch()` method returns a Promise and deals with rejected cases only.
         * It behaves the same as calling `Promise.prototype.then(undefined, onRejected)`.
         * @param  {Function} onRejected A Function called when the Promise is rejected.
         * This function has one argument, the rejection reason.
         * @return {Yaku} A Promise that deals with rejected cases only.
         * @example
         * ```js
         * var Promise = require('yaku');
         * var p = Promise.reject(new Error("ERR"));
         *
         * p['catch']((v) => {
         *     console.log(v);
         * });
         * ```
         */
        "catch": function (onRejected) {
            return this.then($nil, onRejected);
        },

        // Default state
        _state: $pending,

        // The number of current promises that attach to this Yaku instance.
        _pCount: 0,

        // The parent Yaku.
        _pre: null,

        // A unique type flag, it helps different versions of Yaku know each other.
        _Yaku: 1
    });

    /**
     * The `Promise.resolve(value)` method returns a Promise object that is resolved with the given value.
     * If the value is a thenable (i.e. has a then method), the returned promise will "follow" that thenable,
     * adopting its eventual state; otherwise the returned promise will be fulfilled with the value.
     * @param  {Any} value Argument to be resolved by this Promise.
     * Can also be a Promise or a thenable to resolve.
     * @return {Yaku}
     * @example
     * ```js
     * var Promise = require('yaku');
     * var p = Promise.resolve(10);
     * ```
     */
    Yaku.resolve = function resolve (val) {
        return isYaku(val) ? val : settleWithX(newEmptyYaku(), val);
    };

    /**
     * The `Promise.reject(reason)` method returns a Promise object that is rejected with the given reason.
     * @param  {Any} reason Reason why this Promise rejected.
     * @return {Yaku}
     * @example
     * ```js
     * var Promise = require('yaku');
     * var p = Promise.reject(new Error("ERR"));
     * ```
     */
    Yaku.reject = function reject (reason) {
        return settlePromise(newEmptyYaku(), $rejected, reason);
    };

    /**
     * The `Promise.race(iterable)` method returns a promise that resolves or rejects
     * as soon as one of the promises in the iterable resolves or rejects,
     * with the value or reason from that promise.
     * @param  {iterable} iterable An iterable object, such as an Array.
     * @return {Yaku} The race function returns a Promise that is settled
     * the same way as the first passed promise to settle.
     * It resolves or rejects, whichever happens first.
     * @example
     * ```js
     * var Promise = require('yaku');
     * Promise.race([
     *     123,
     *     Promise.resolve(0)
     * ])
     * .then((value) => {
     *     console.log(value); // => 123
     * });
     * ```
     */
    Yaku.race = function race (iterable) {
        var iter, len, i = 0;

        var p = newEmptyYaku(), item;

        if (iterable instanceof Array) {
            len = iterable.length;
            while (i < len) {
                settleWithX(p, iterable[i++]);
                if (p._state !== $pending) break;
            }
        } else {
            iter = genIterator(iterable);
            while (!(item = iter.next()).done) {
                settleWithX(p, item.value);
                if (p._state !== $pending) break;
            }
        }

        return p;
    };

    /**
     * The `Promise.all(iterable)` method returns a promise that resolves when
     * all of the promises in the iterable argument have resolved.
     *
     * The result is passed as an array of values from all the promises.
     * If something passed in the iterable array is not a promise,
     * it's converted to one by Promise.resolve. If any of the passed in promises rejects,
     * the all Promise immediately rejects with the value of the promise that rejected,
     * discarding all the other promises whether or not they have resolved.
     * @param  {iterable} iterable An iterable object, such as an Array.
     * @return {Yaku}
     * @example
     * ```js
     * var Promise = require('yaku');
     * Promise.all([
     *     123,
     *     Promise.resolve(0)
     * ])
     * .then((values) => {
     *     console.log(values); // => [123, 0]
     * });
     * ```
     * @example
     * Use with iterable.
     * ```js
     * var Promise = require('yaku');
     * Promise.all((function * () {
     *     yield 10;
     *     yield new Promise(function (r) { setTimeout(r, 1000, "OK") });
     * })())
     * .then((values) => {
     *     console.log(values); // => [123, 0]
     * });
     * ```
     */
    Yaku.all = function all (iterable) {
        var p1 = newEmptyYaku()
        , res = []
        , item
        , countDown = 0
        , iter
        , len;

        function onRejected (reason) {
            settlePromise(p1, $rejected, reason);
        }

        if (iterable instanceof Array) {
            len = iterable.length;
            while (countDown < len) {
                runAll(countDown, iterable[countDown++], p1, res, onRejected);
            }
        } else {
            iter = genIterator(iterable);
            while (!(item = iter.next()).done) {
                runAll(countDown++, item.value, p1, res, onRejected);
            }
        }

        onRejected._c = countDown;

        if (!countDown) settlePromise(p1, $resolved, []);

        return p1;
    };

    function runAll (i, el, p1, res, onRejected) {
        Yaku.resolve(el).then(function (value) {
            res[i] = value;
            if (!--onRejected._c) settlePromise(p1, $resolved, res);
        }, onRejected);
    }

    /**
     * The ES6 Symbol object that Yaku should use, by default it will use the
     * global one.
     * @type {Object}
     * @example
     * ```js
     * var core = require("core-js/library");
     * var Promise = require("yaku");
     * Promise.Symbol = core.Symbol;
     * ```
     */
    Yaku.Symbol = root.Symbol || {};

    /**
     * Catch all possibly unhandled rejections. If you want to use specific
     * format to display the error stack, overwrite it.
     * If it is set, auto `console.error` unhandled rejection will be disabled.
     * @param {Any} reason The rejection reason.
     * @param {Yaku} p The promise that was rejected.
     * @example
     * ```js
     * var Promise = require('yaku');
     * Promise.onUnhandledRejection = (reason) => {
     *     console.error(reason);
     * };
     *
     * // The console will log an unhandled rejection error message.
     * Promise.reject('my reason');
     *
     * // The below won't log the unhandled rejection error message.
     * Promise.reject('v').catch(() => {});
     * ```
     */
    Yaku.onUnhandledRejection = function (reason, p) {
        var con = root.console;
        if (con) {
            var info = genStackInfo(reason, p);
            con.error($unhandledRejection, info[0], info[1] || "");
        }
    };

    /**
     * It is used to enable the long stack trace.
     * Once it is enabled, it can't be reverted.
     * While it is very helpful in development and testing environments,
     * it is not recommended to use it in production. It will slow down your
     * application and waste your memory.
     * @example
     * ```js
     * var Promise = require('yaku');
     * Promise.enableLongStackTrace();
     * ```
     */
    Yaku.enableLongStackTrace = function () {
        isLongStackTrace = true;
    };

    /**
     * Only Node has `process.nextTick` function. For browser there are
     * so many ways to polyfill it. Yaku won't do it for you, instead you
     * can choose what you prefer. For example, this project
     * [setImmediate](https://github.com/YuzuJS/setImmediate).
     * By default, Yaku will use `process.nextTick` on Node, `setTimeout` on browser.
     * @type {Function}
     * @example
     * ```js
     * var Promise = require('yaku');
     * Promise.nextTick = fn => window.setImmediate(fn);
     * ```
     * @example
     * You can even use sync resolution if you really know what you are doing.
     * ```js
     * var Promise = require('yaku');
     * Promise.nextTick = fn => fn();
     * ```
     */
    Yaku.nextTick = root.process ?
        root.process.nextTick :
        function (fn) { setTimeout(fn); };

    // ********************** Private **********************

    /**
     * All static variable name will begin with `$`. Such as `$rejected`.
     * @private
     */

    // ******************************* Utils ********************************

    var $tryCatchFn
    , $tryCatchThis
    , $tryErr = { e: null }
    , $noop = {};

    function extendPrototype (src, target) {
        for (var k in target) {
            src.prototype[k] = target[k];
        }
        return src;
    }

    function isObject (obj) {
        return typeof obj === "object";
    }

    function isFunction (obj) {
        return typeof obj === "function";
    }

    /**
     * Wrap a function into a try-catch.
     * @private
     * @return {Any | $tryErr}
     */
    function tryCatcher () {
        try {
            return $tryCatchFn.apply($tryCatchThis, arguments);
        } catch (e) {
            $tryErr.e = e;
            return $tryErr;
        }
    }

    /**
     * Generate a try-catch wrapped function.
     * @private
     * @param  {Function} fn
     * @return {Function}
     */
    function genTryCatcher (fn, self) {
        $tryCatchFn = fn;
        $tryCatchThis = self;
        return tryCatcher;
    }

    /**
     * Generate a scheduler.
     * @private
     * @param  {Integer}  initQueueSize
     * @param  {Function} fn `(Yaku, Value) ->` The schedule handler.
     * @return {Function} `(Yaku, Value) ->` The scheduler.
     */
    function genScheduler (initQueueSize, fn) {
        /**
         * All async promise will be scheduled in
         * here, so that they can be execute on the next tick.
         * @private
         */
        var fnQueue = Array(initQueueSize)
        , fnQueueLen = 0;

        /**
         * Run all queued functions.
         * @private
         */
        function flush () {
            var i = 0;
            while (i < fnQueueLen) {
                fn(fnQueue[i], fnQueue[i + 1]);
                fnQueue[i++] = $nil;
                fnQueue[i++] = $nil;
            }

            fnQueueLen = 0;
            if (fnQueue.length > initQueueSize) fnQueue.length = initQueueSize;
        }

        return function (v, arg) {
            fnQueue[fnQueueLen++] = v;
            fnQueue[fnQueueLen++] = arg;

            if (fnQueueLen === 2) Yaku.nextTick(flush);
        };
    }

    /**
     * Generate a iterator
     * @param  {Any} obj
     * @return {Function}
     */
    function genIterator (obj) {
        if (obj) {
            var gen = obj[Yaku.Symbol.iterator];
            if (isFunction(gen)) {
                return gen.call(obj);
            }

            if (isFunction(obj.next)) {
                return obj;
            }
        }
        throw genTypeError("invalid_argument");
    }

    /**
     * Generate type error object.
     * @private
     * @param  {String} msg
     * @return {TypeError}
     */
    function genTypeError (msg) {
        return new TypeError(msg);
    }

    function genTraceInfo (noTitle) {
        return ((new Error()).stack || "").replace(
            "Error",
            noTitle ? "" : $fromPrevious
        );
    }


    // *************************** Promise Helpers ****************************

    /**
     * Resolve the value returned by onFulfilled or onRejected.
     * @private
     * @param {Yaku} p1
     * @param {Yaku} p2
     */
    var scheduleHandler = genScheduler(999, function (p1, p2) {
        var x, handler;

        // 2.2.2
        // 2.2.3
        handler = p1._state ? p2._onFulfilled : p2._onRejected;

        // 2.2.7.3
        // 2.2.7.4
        if (handler === $nil) {
            settlePromise(p2, p1._state, p1._value);
            return;
        }

        // 2.2.7.1
        x = genTryCatcher(callHanler)(handler, p1._value);
        if (x === $tryErr) {
            // 2.2.7.2
            settlePromise(p2, $rejected, x.e);
            return;
        }

        settleWithX(p2, x);
    });

    var scheduleUnhandledRejection = genScheduler(9, function (p) {
        if (!hashOnRejected(p)) {
            var process = root.process
            , onunhandledrejection = root.onunhandledrejection
            , reason = p._value;

            if (process && process.listeners($unhandledRejection).length)
                process.emit($unhandledRejection, reason, p);
            else if (onunhandledrejection)
                onunhandledrejection({ promise: p, reason: reason });
            else
                Yaku.onUnhandledRejection(reason, p);
        }
    });

    function isYaku (val) { return val && val._Yaku; }

    /**
     * Create an empty promise.
     * @private
     * @return {Yaku}
     */
    function newEmptyYaku () { return new Yaku($noop); }

    /**
     * It will produce a settlePromise function to user.
     * Such as the resolve and reject in this `new Yaku (resolve, reject) ->`.
     * @private
     * @param  {Yaku} self
     * @param  {Integer} state The value is one of `$pending`, `$resolved` or `$rejected`.
     * @return {Function} `(value) -> undefined` A resolve or reject function.
     */
    function genSettler (self, state) { return function (value) {
        if (isLongStackTrace)
            self[$settlerTrace] = genTraceInfo(true);

        if (state === $resolved)
            settleWithX(self, value);
        else
            settlePromise(self, state, value);
    }; }

    /**
     * Link the promise1 to the promise2.
     * @private
     * @param {Yaku} p1
     * @param {Yaku} p2
     * @param {Function} onFulfilled
     * @param {Function} onRejected
     */
    function addHandler (p1, p2, onFulfilled, onRejected) {
        // 2.2.1
        if (isFunction(onFulfilled))
            p2._onFulfilled = onFulfilled;
        if (isFunction(onRejected))
            p2._onRejected = onRejected;

        if (isLongStackTrace) p2._pre = p1;
        p1[p1._pCount++] = p2;

        // 2.2.6
        if (p1._state !== $pending)
            scheduleHandler(p1, p2);

        // 2.2.7
        return p2;
    }

    // iterate tree
    function hashOnRejected (node) {
        // A node shouldn't be checked twice.
        if (node._umark)
            return true;
        else
            node._umark = true;

        var i = 0
        , len = node._pCount
        , child;

        while (i < len) {
            child = node[i++];
            if (child._onRejected || hashOnRejected(child)) return true;
        }
    }

    function genStackInfo (reason, p) {
        var stackInfo = []
        , stackStr
        , i;

        function trim (str) { return str.replace(/^\s+|\s+$/g, ""); }

        function push (trace) {
            return stackInfo.push(trim(trace));
        }

        if (isLongStackTrace && p[$promiseTrace]) {
            if (p[$settlerTrace])
                push(p[$settlerTrace]);

            // Hope you guys could understand how the back trace works.
            // We only have to iterate through the tree from the bottom to root.
            (function iter (node) {
                if (node) {
                    iter(node._next);
                    push(node[$promiseTrace]);
                    iter(node._pre);
                }
            })(p);
        }

        stackStr = "\n" + stackInfo.join("\n");

        function clean (stack, cleanPrev) {
            if (cleanPrev && (i = stack.indexOf("\n" + $fromPrevious)) > 0)
                stack = stack.slice(0, i);

            return stack.replace(/^.+\/node_modules\/yaku\/.+\n?/mg, "");
        }

        return [(
            reason ?
                reason.stack ?
                    clean(trim(reason.stack), true)
                :
                    reason
            :
                reason
        ), clean(stackStr)];
    }

    function callHanler (handler, value) {
        // 2.2.5
        return handler(value);
    }

    /**
     * Resolve or reject a promise.
     * @private
     * @param  {Yaku} p
     * @param  {Integer} state
     * @param  {Any} value
     */
    function settlePromise (p, state, value) {
        var i = 0
        , len = p._pCount
        , p2
        , stack;

        // 2.1.2
        // 2.1.3
        if (p._state === $pending) {
            // 2.1.1.1
            p._state = state;
            p._value = value;

            if (state === $rejected) {
                if (isLongStackTrace && value && value.stack) {
                    stack = genStackInfo(value, p);
                    value.stack = stack[0] + stack[1];
                }

                scheduleUnhandledRejection(p);
            }

            // 2.2.4
            while (i < len) {
                p2 = p[i++];

                if (p2._state !== $pending) continue;

                scheduleHandler(p, p2);
            }
        }

        return p;
    }

    /**
     * Resolve or reject promise with value x. The x can also be a thenable.
     * @private
     * @param {Yaku} p
     * @param {Any | Thenable} x A normal value or a thenable.
     */
    function settleWithX (p, x) {
        // 2.3.1
        if (x === p && x) {
            settlePromise(p, $rejected, genTypeError("promise_circular_chain"));
            return p;
        }

        // 2.3.2
        // 2.3.3
        if (x != null && (isFunction(x) || isObject(x))) {
            // 2.3.2.1
            var xthen = genTryCatcher(getThen)(x);

            if (xthen === $tryErr) {
                // 2.3.3.2
                settlePromise(p, $rejected, xthen.e);
                return p;
            }

            if (isFunction(xthen)) {
                if (isLongStackTrace && isYaku(x))
                    p._next = x;

                settleXthen(p, x, xthen);
            }
            else
                // 2.3.3.4
                settlePromise(p, $resolved, x);
        } else
            // 2.3.4
            settlePromise(p, $resolved, x);

        return p;
    }

    /**
     * Try to get a promise's then method.
     * @private
     * @param  {Thenable} x
     * @return {Function}
     */
    function getThen (x) { return x.then; }

    /**
     * Resolve then with its promise.
     * @private
     * @param  {Yaku} p
     * @param  {Thenable} x
     * @param  {Function} xthen
     */
    function settleXthen (p, x, xthen) {
        // 2.3.3.3
        var err = genTryCatcher(xthen, x)(function (y) {
            // 2.3.3.3.3
            if (x) {
                x = null;

                // 2.3.3.3.1
                settleWithX(p, y);
            }
        }, function (r) {
            // 2.3.3.3.3
            if (x) {
                x = null;

                // 2.3.3.3.2
                settlePromise(p, $rejected, r);
            }
        });

        // 2.3.3.3.4.1
        if (err === $tryErr && x) {
            // 2.3.3.3.4.2
            settlePromise(p, $rejected, err.e);
            x = null;
        }
    }

})();
