// The V8 flags a bytecode release is compiled AND run with. One list, because the two sides must
// agree exactly: V8 hashes the flags into the cached data, and any difference is either an outright
// rejection or — worse — a process that runs correctly and then fails minutes later.
//
//   --no-lazy            everything is compiled into the cache up front. Without it, any function
//                        not called during load is compiled from the blank placeholder at first
//                        call and dies on "Unexpected end of input".
//
//   --no-flush-bytecode  V8 discards the bytecode of functions it has not seen for a few GCs and
//                        recompiles them from source on the next call. The source is blanks. This
//                        is why a release booted, served requests, and then started throwing
//                        SyntaxError from route handlers after a few minutes of real work — a
//                        failure no unit test and no short smoke test can reach.
export const V8_FLAGS = ['--no-lazy', '--no-flush-bytecode'];
