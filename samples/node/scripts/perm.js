// permission_error reproduction: writes to a root-owned path as a non-root
// user. On macOS/Linux this raises EACCES ("permission denied"). Captured output
// classifies as permission_error.
const fs = require('node:fs');
fs.writeFileSync('/etc/dsh-self-debug-sample-node', 'x');
