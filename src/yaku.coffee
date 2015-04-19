

do -> class Yaku

	###*
	 * This class follows the [Promises/A+](https://promisesaplus.com) and
	 * [ES6](http://people.mozilla.org/~jorendorff/es6-draft.html#sec-promise-objects) spec
	 * with some extra helpers.
	 * @param  {Function} executor Function object with two arguments resolve and reject.
	 * The first argument fulfills the promise, the second argument rejects it.
	 * We can call these functions, once our operation is completed.
	###
	constructor: (executor) ->
		return if executor == $noop
		executor genResolver(@, $resolved), genResolver(@, $rejected)

	###*
	 * Appends fulfillment and rejection handlers to the promise,
	 * and returns a new promise resolving to the return value of the called handler.
	 * @param  {Function} onFulfilled Optional. Called when the Promise is resolved.
	 * @param  {Function} onRejected  Optional. Called when the Promise is rejected.
	 * @return {Yaku} It will return a new Yaku which will resolve or reject after
	 * the current Promise.
	###
	then: (onFulfilled, onRejected) ->
		p = new Yaku $noop

		offset = @_hCount
		@[offset] = onFulfilled
		@[offset + 1] = onRejected
		@[offset + 2] = p
		@_hCount += $groupNum

		if @_state != $pending
			resolveHanlers @, offset

		p

	###*
	 * The catch() method returns a Promise and deals with rejected cases only.
	 * It behaves the same as calling `Promise.prototype.then(undefined, onRejected)`.
	 * @param  {Function} onRejected A Function called when the Promise is rejected.
	 * This function has one argument, the rejection reason.
	 * @return {Yaku} A Promise that deals with rejected cases only.
	###
	catch: (onRejected) ->
		@then undefined, onRejected

	###*
	 * The Promise. resolve(value) method returns a Promise object that is resolved with the given value.
	 * If the value is a thenable (i.e. has a then method), the returned promise will "follow" that thenable,
	 * adopting its eventual state; otherwise the returned promise will be fulfilled with the value.
	 * @param  {Any} value Argument to be resolved by this Promise.
	 * Can also be a Promise or a thenable to resolve.
	 * @return {Yaku}
	###
	@resolve: (value) ->
		resolvePromise new Yaku($noop), $resolved, value

	###*
	 * The Promise.reject(reason) method returns a Promise object that is rejected with the given reason.
	 * @param  {Any} reason Reason why this Promise rejected.
	 * @return {Yaku}
	###
	@reject: (reason) ->
		resolvePromise new Yaku($noop), $rejected, reason

	###*
	 * The Promise.race(iterable) method returns a promise that resolves or rejects
	 * as soon as one of the promises in the iterable resolves or rejects,
	 * with the value or reason from that promise.
	 * @param  {iterable} iterable An iterable object, such as an Array.
	 * @return {Yaku} The race function returns a Promise that is settled
	 * the same way as the first passed promise to settle.
	 * It resolves or rejects, whichever happens first.
	###
	@race: (iterable) ->
		new Yaku (resolve, reject) ->
			for x in iterable
				resolveValue x, resolve, reject
			return

	###*
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
	###
	@all: (iterable) ->
		new Yaku (resolve, reject) ->
			res = []
			countDown = iterable.length

			iter = (i) ->
				resolveValue x, (v) ->
					res[i] = v
					if --countDown == 0
						resolve res
				, reject

				return

			for x, i in iterable
				iter i

			return

# ********************** Private **********************

	###
	 * 'bind' and 'call' is slow, so we use Python
	 * style "self" with curry and closure.
	 * See: http://jsperf.com/call-vs-arguments
	 * @private
	###

	# ************************ Private Constant Start *************************

	###*
	 * These are some static symbolys.
	 * The state value is designed to be 0, 1, 2. Not by chance.
	 * See the genResolver part's selector.
	 * @private
	###
	$resolved = 0
	$rejected = 1
	$pending = 2

	###*
	 * This is one of the most tricky part.
	 *
	 * For better performance, both memory and speed, the array is like below,
	 * every 5 entities are paired together as a group:
	 * ```
	 *   0            1           2       ...
	 * [ onFulfilled, onRejected, promise ... ]
	 * ```
	 * To save memory the position of 0 and 1 may be replaced with their returned values,
	 * then these values will be passed to 2 and 3.
	 * @private
	###
	$groupNum = 3

	$circularErrorInfo = 'circular promise resolution chain'

	$tryErr = {}

	$noop = {}

	# ************************* Private Constant End **************************

	_state: $pending

	###*
	 * The number of current handlers that attach to this Yaku instance.
	 * @private
	###
	_hCount: 0

	fnQueue = Array 1000
	fnQueueLen = 0

	flush = ->
		i = 0
		while i < fnQueueLen
			fnQueue[i]()
			fnQueue[i++] = undefined

		fnQueueLen = 0

		return

	schedule = (fn) ->
		fnQueue[fnQueueLen++] = fn

		scheduleFlush() if fnQueueLen == 1

		return

	###*
	 * Create cross platform nextTick helper.
	 * @private
	 * @return {Function} `(fn) -> undefined` The fn will be called until
	 * the execution context stack contains only platform code.
	###
	scheduleFlush =
		if process? and process.nextTick
			-> process.nextTick flush

		else if setImmediate?
			-> setImmediate flush

		else if MutationObserver?
			i = 1
			n = document.createTextNode ''
			observer = new MutationObserver flush
			observer.observe n, characterData: true
			-> n.data = (i = -i)

		else if document? and document.createEvent?
			addEventListener '__yakuNextTick', flush
			->
				evt = document.createEvent 'CustomEvent'
				evt.initCustomEvent '__yakuNextTick', false, false
				dispatchEvent evt

		else
			-> setTimeout flush

	###*
	 * Resolve or reject primise with value x. The x can also be a thenable.
	 * @private
	 * @param {Yaku} [p]
	 * @param {Any | Thenable} x A normal value or a thenable.
	###
	resolveValue = (p, x) ->
		type = typeof x
		if x != null and (type == 'function' or type == 'object')
			xthen = getXthen p, x
			return if xthen == $tryErr

			if typeof xthen == 'function'
				resolveXthen p, x, xthen
			else
				resolvePromise p, $resolved, x
		else
			resolvePromise p, $resolved, x

		return

	resolveXthen = (p, x, xthen) ->
		isResolved = false

		try
			xthen.call x, (y) ->
				return if isResolved
				isResolved = true
				resolveValue p, y
			, (r) ->
				return if isResolved
				isResolved = true
				resolvePromise p, $rejected, r
		catch e
			resolvePromise p, $rejected, e if not isResolved

		return

	getXthen = (p, x) ->
		try
			x.then
		catch e
			resolvePromise p, $rejected, e
			return $tryErr

	getX = (self, p, handler) ->
		try
			handler self._value
		catch e
			resolvePromise p, $rejected, e
			return $tryErr

	###*
	 * Decide how handlers works.
	 * @private
	 * @param  {Yaku} self
	 * @param  {Integer} offset The offset of the handler group.
	###
	resolveHanlers = (self, offset) ->
		# Trick: Reuse the value of state as the handler selector.
		# The "i + state" shows the math nature of promise.
		handler = self[offset + self._state]
		p = self[offset + 2]

		if typeof handler == 'function'
			schedule ->
				x = getX self, p, handler
				return if x == $tryErr

				# Prevent circular chain.
				if x == p and x
					return x[offset + 1]? new TypeError $circularErrorInfo

				resolveValue p, x
		else
			resolvePromise p, self._state, self._value

		return

	resolvePromise = (self, state, value) ->
		return if self._state != $pending

		self._state = state
		self._value = value

		offset = 0

		while offset < self._hCount
			resolveHanlers self, offset

			offset += $groupNum

		self

	###*
	 * It will produce a resolvePromise function to user.
	 * Such as the resolve and reject in this `new Yaku (resolve, reject) ->`.
	 * @private
	 * @param  {Yaku} self
	 * @param  {Integer} state The value is one of `$pending`, `$resolved` or `$rejected`.
	 * @return {Function} `(value) -> undefined` A resolve or reject function.
	###
	genResolver = (self, state) -> (value) ->
		resolvePromise self, state, value

	# AMD Support
	if typeof module == 'object' and typeof module.exports == 'object'
		module.exports = Yaku
	else
		# CMD
		if typeof define == 'function' and define.amd
			define -> Yaku
		else
			window?.Yaku = Yaku
