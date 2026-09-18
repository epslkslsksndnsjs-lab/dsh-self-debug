// timeout reproduction: prints a timeout marker, then hangs. The runner kills
// the process group at timeoutMs, so the captured output is a genuine timeout
// output. Captured output classifies as timeout.
console.log('Exceeded timeout of 2000 ms for a test');
const start = Date.now();
while (Date.now() - start < 60_000) {
  // busy-wait so the process keeps running until the runner SIGKILLs it
}
