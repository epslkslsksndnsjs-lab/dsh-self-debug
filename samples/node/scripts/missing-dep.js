// environment_error reproduction: requires a module that is not installed.
// Captured output classifies as environment_error ("cannot find module").
require('this-module-does-not-exist-dsh');
