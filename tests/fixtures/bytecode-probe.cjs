// Compiled to bytecode by bytecode-loader.test.js. The nesting is the point: a function body that
// V8 compiled lazily is compiled from the loader's blank placeholder at first call, and dies on
// "Unexpected end of input". Three levels down is where that shows up.
const deep = () => () => () => 'DOCTRINE-CANARY-9f2b';
console.log(JSON.stringify({ deep: deep()()(), dirname: typeof __dirname, req: typeof require }));
