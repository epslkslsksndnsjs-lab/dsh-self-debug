// Sample node project (issue #8 / T7). Clean source so `lint`/`test` pass in the
// happy path; the bug variants live in sibling files invoked by the bug:* and
// build scripts.
function add(a, b) {
  return a + b;
}

module.exports = { add };
