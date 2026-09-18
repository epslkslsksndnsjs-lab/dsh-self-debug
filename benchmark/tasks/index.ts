// Committed benchmark task list (T8, issue #9).
//
// 17 tasks, uniform shape (see benchmark/tasks/README.md): a buggy scaffold,
// hash-guarded acceptance-test file(s), an independent acceptance command the
// harness runs itself, and a canonical `solution` (used only by the offline
// scripted driver). Mix per ADR-0001 decision 7:
//   - HumanEval-style function-completion items (node) seeded with a bug the
//     agent must fix (tasks 01-10).
//   - Hand-constructed bug styles mirroring samples/ (node build_error,
//     assertion_failure, environment_error) (tasks 11-13).
//   - Python tasks exercising the same difficulty offline (tasks 14-15).
//   - Go tasks (tasks 16-17) committed with real `go test` acceptance; they run
//     at T9 where the go toolchain exists — the verdict path is language-agnostic
//     and proven via node/python here.
//
// All content is hand-written; nothing is fetched from the network.

import type { BenchmarkTask } from '../types.ts';

const NODE_PKG = JSON.stringify(
  { name: 'bench-task', version: '0.1.0', private: true, type: 'commonjs', scripts: { test: 'node --test' } },
  null,
  2,
);

/** Build a node task: package.json + index.js (buggy) + index.test.js. */
function nodeTask(
  id: string,
  title: string,
  prompt: string,
  implBuggy: string,
  implFixed: string,
  testBody: string,
  expectedPass: string,
): BenchmarkTask {
  return {
    id,
    title,
    language: 'node',
    prompt,
    scaffold: {
      'package.json': NODE_PKG,
      'index.js': implBuggy,
      'index.test.js': testBody,
    },
    acceptanceFiles: ['index.test.js'],
    acceptanceCommand: 'node --test',
    expectedPass,
    solution: { 'index.js': implFixed },
    offlineRunnable: true,
  };
}

const NODE_TEST_HEADER = "const t = require('node:test');\nconst a = require('node:assert');\nconst { ";

export const TASKS: BenchmarkTask[] = [
  // ---- HumanEval-style node function completion (seeded with a bug) ----
  nodeTask(
    'node-has-close-elements',
    'Detect close elements',
    'Implement hasCloseElements(numbers, threshold): true if any two distinct elements differ by less than threshold.',
    `function hasCloseElements(numbers, threshold) {
  for (let i = 0; i < numbers.length; i++) {
    for (let j = i; j < numbers.length; j++) {
      if (Math.abs(numbers[i] - numbers[j]) < threshold) return true;
    }
  }
  return false;
}
module.exports.hasCloseElements = hasCloseElements;
`,
    `function hasCloseElements(numbers, threshold) {
  for (let i = 0; i < numbers.length; i++) {
    for (let j = i + 1; j < numbers.length; j++) {
      if (Math.abs(numbers[i] - numbers[j]) < threshold) return true;
    }
  }
  return false;
}
module.exports.hasCloseElements = hasCloseElements;
`,
    `${NODE_TEST_HEADER}hasCloseElements } = require('./index.js');
t('distant numbers are not close', () => a.strictEqual(hasCloseElements([1.0, 2.0, 3.0], 0.5), false));
t('adjacent numbers are close', () => a.strictEqual(hasCloseElements([1.0, 1.8, 2.0], 0.5), true));
`,
    'returns false for well-separated inputs, true when a pair is within threshold',
  ),

  nodeTask(
    'node-string-xor',
    'Bitwise XOR of binary strings',
    'Implement stringXor(a, b): a binary string where each bit is 1 iff the inputs differ at that position (equal length assumed).',
    `function stringXor(a, b) {
  let r = '';
  for (let i = 0; i < a.length; i++) {
    r += (a[i] === '1' && b[i] === '0') ? '1' : '0';
  }
  return r;
}
module.exports.stringXor = stringXor;
`,
    `function stringXor(a, b) {
  let r = '';
  for (let i = 0; i < a.length; i++) {
    r += (a[i] !== b[i]) ? '1' : '0';
  }
  return r;
}
module.exports.stringXor = stringXor;
`,
    `${NODE_TEST_HEADER}stringXor } = require('./index.js');
t('mixed inputs', () => a.strictEqual(stringXor('010', '101'), '111'));
t('all ones', () => a.strictEqual(stringXor('111', '111'), '000'));
t('disjoint', () => a.strictEqual(stringXor('000', '111'), '111'));
`,
    'produces 1 only where the two bits differ',
  ),

  nodeTask(
    'node-median',
    'Median of a list',
    'Implement median(numbers): the median value (average of the two middle elements for even length).',
    `function median(numbers) {
  const s = [...numbers].sort((x, y) => x - y);
  const n = s.length;
  if (n % 2 === 1) return s[Math.floor(n / 2)];
  return s[Math.floor(n / 2)];
}
module.exports.median = median;
`,
    `function median(numbers) {
  const s = [...numbers].sort((x, y) => x - y);
  const n = s.length;
  if (n % 2 === 1) return s[(n - 1) / 2];
  return (s[n / 2 - 1] + s[n / 2]) / 2;
}
module.exports.median = median;
`,
    `${NODE_TEST_HEADER}median } = require('./index.js');
t('even length', () => a.strictEqual(median([1, 2, 3, 4]), 2.5));
t('odd length', () => a.strictEqual(median([3, 1, 2]), 2));
t('single', () => a.strictEqual(median([5]), 5));
`,
    'averages the two middle elements for even-length inputs',
  ),

  nodeTask(
    'node-fib',
    'Fibonacci',
    'Implement fib(n): the nth Fibonacci number with fib(0)=0, fib(1)=1.',
    `function fib(n) {
  if (n <= 1) return 1;
  return fib(n - 1) + fib(n - 2);
}
module.exports.fib = fib;
`,
    `function fib(n) {
  if (n < 2) return n;
  return fib(n - 1) + fib(n - 2);
}
module.exports.fib = fib;
`,
    `${NODE_TEST_HEADER}fib } = require('./index.js');
t('fib(0)', () => a.strictEqual(fib(0), 0));
t('fib(1)', () => a.strictEqual(fib(1), 1));
t('fib(10)', () => a.strictEqual(fib(10), 55));
`,
    'fib(0) is 0 and the sequence is correct',
  ),

  nodeTask(
    'node-count-digit',
    'Count digit occurrences',
    'Implement countDigit(n, d): how many times digit d appears in the decimal representation of n.',
    `function countDigit(n, d) {
  let c = 0;
  while (n > 0) {
    if (n % 10 === d) c++;
    n = Math.floor(n / 10);
  }
  return c;
}
module.exports.countDigit = countDigit;
`,
    `function countDigit(n, d) {
  if (n === 0) return d === 0 ? 1 : 0;
  let c = 0;
  let x = n;
  while (x > 0) {
    if (x % 10 === d) c++;
    x = Math.floor(x / 10);
  }
  return c;
}
module.exports.countDigit = countDigit;
`,
    `${NODE_TEST_HEADER}countDigit } = require('./index.js');
t('zero counts itself', () => a.strictEqual(countDigit(0, 0), 1));
t('repeated digit', () => a.strictEqual(countDigit(122, 2), 2));
t('absent digit', () => a.strictEqual(countDigit(12345, 9), 0));
t('leading/trailing zero digit', () => a.strictEqual(countDigit(1001, 0), 2));
`,
    'handles n===0 and counts every decimal position',
  ),

  nodeTask(
    'node-is-prime',
    'Primality test',
    'Implement isPrime(n): true iff n is a prime number (n >= 2).',
    `function isPrime(n) {
  for (let i = 1; i < n; i++) {
    if (n % i === 0) return false;
  }
  return true;
}
module.exports.isPrime = isPrime;
`,
    `function isPrime(n) {
  if (n < 2) return false;
  for (let i = 2; i * i <= n; i++) {
    if (n % i === 0) return false;
  }
  return true;
}
module.exports.isPrime = isPrime;
`,
    `${NODE_TEST_HEADER}isPrime } = require('./index.js');
t('small prime', () => a.strictEqual(isPrime(7), true));
t('one is not prime', () => a.strictEqual(isPrime(1), false));
t('composite', () => a.strictEqual(isPrime(9), false));
t('two is prime', () => a.strictEqual(isPrime(2), true));
`,
    'excludes 1 and uses a correct trial-division bound',
  ),

  nodeTask(
    'node-max-element',
    'Maximum element',
    'Implement maxElement(lst): the largest element of a non-empty list of numbers.',
    `function maxElement(lst) {
  let m = 0;
  for (const x of lst) if (x > m) m = x;
  return m;
}
module.exports.maxElement = maxElement;
`,
    `function maxElement(lst) {
  let m = lst[0];
  for (const x of lst) if (x > m) m = x;
  return m;
}
module.exports.maxElement = maxElement;
`,
    `${NODE_TEST_HEADER}maxElement } = require('./index.js');
t('all negative', () => a.strictEqual(maxElement([-5, -2, -9]), -2));
t('mixed', () => a.strictEqual(maxElement([3, 7, 1]), 7));
`,
    'initialises from the first element, not from 0',
  ),

  nodeTask(
    'node-truncate',
    'Truncate string',
    'Implement truncate(s, n): the first n characters of s.',
    `function truncate(s, n) {
  return s.slice(0, n + 1);
}
module.exports.truncate = truncate;
`,
    `function truncate(s, n) {
  return s.slice(0, n);
}
module.exports.truncate = truncate;
`,
    `${NODE_TEST_HEADER}truncate } = require('./index.js');
t('within length', () => a.strictEqual(truncate('hello', 3), 'hel'));
t('longer than string', () => a.strictEqual(truncate('hi', 10), 'hi'));
`,
    'keeps exactly the first n characters (no off-by-one)',
  ),

  nodeTask(
    'node-sum-to-n',
    'Sum 1..n',
    'Implement sumToN(n): the sum of integers from 1 to n inclusive.',
    `function sumToN(n) {
  let s = 0;
  for (let i = 1; i < n; i++) s += i;
  return s;
}
module.exports.sumToN = sumToN;
`,
    `function sumToN(n) {
  let s = 0;
  for (let i = 1; i <= n; i++) s += i;
  return s;
}
module.exports.sumToN = sumToN;
`,
    `${NODE_TEST_HEADER}sumToN } = require('./index.js');
t('sum to 5', () => a.strictEqual(sumToN(5), 15));
t('sum to 1', () => a.strictEqual(sumToN(1), 1));
t('sum to 0', () => a.strictEqual(sumToN(0), 0));
`,
    'includes n in the summation',
  ),

  nodeTask(
    'node-reverse-vowels',
    'Reverse vowels',
    'Implement reverseVowels(s): reverse only the vowel characters, preserving positions of non-vowels.',
    `function reverseVowels(s) {
  const v = 'aeiouAEIOU';
  const arr = s.split('');
  const vals = [];
  for (const c of arr) if (v.includes(c)) vals.push(c);
  let k = 0;
  for (let i = 0; i < arr.length; i++) {
    if (v.includes(arr[i])) arr[i] = vals[k++];
  }
  return arr.join('');
}
module.exports.reverseVowels = reverseVowels;
`,
    `function reverseVowels(s) {
  const v = 'aeiouAEIOU';
  const arr = s.split('');
  const vals = [];
  for (const c of arr) if (v.includes(c)) vals.push(c);
  let k = vals.length - 1;
  for (let i = 0; i < arr.length; i++) {
    if (v.includes(arr[i])) arr[i] = vals[k--];
  }
  return arr.join('');
}
module.exports.reverseVowels = reverseVowels;
`,
    `${NODE_TEST_HEADER}reverseVowels } = require('./index.js');
t('lowercase', () => a.strictEqual(reverseVowels('hello'), 'holle'));
t('with caps', () => a.strictEqual(reverseVowels('leetcode'), 'leotcede'));
t('two vowels', () => a.strictEqual(reverseVowels('aA'), 'Aa'));
`,
    'reverses the vowel sequence, not just copies it',
  ),

  // ---- Hand-constructed bug styles mirroring samples/ ----
  nodeTask(
    'node-build-syntax',
    'Build error: syntax',
    'Fix the syntax error so the module loads and hello() returns its greeting.',
    `const x = ;
module.exports.hello = () => 'hi';
`,
    `module.exports.hello = () => 'hi';
`,
    `${NODE_TEST_HEADER}hello } = require('./index.js');
t('hello returns greeting', () => a.strictEqual(hello(), 'hi'));
`,
    'module loads and exports hello() returning "hi"',
  ),

  nodeTask(
    'node-assertion-bug',
    'Assertion failure: wrong comparator',
    'Fix max(a, b) so it returns the larger argument.',
    `module.exports.max = (a, b) => (a < b ? a : b);
`,
    `module.exports.max = (a, b) => (a > b ? a : b);
`,
    `${NODE_TEST_HEADER}max } = require('./index.js');
t('larger second', () => a.strictEqual(max(3, 7), 7));
t('equal', () => a.strictEqual(max(5, 5), 5));
t('larger first', () => a.strictEqual(max(9, 2), 9));
`,
    'returns the larger of the two arguments',
  ),

  {
    id: 'node-missing-module',
    title: 'Environment error: missing dependency',
    language: 'node',
    prompt: 'The module requires ./helpers.js which is missing. Provide it so greet() works.',
    scaffold: {
      'package.json': NODE_PKG,
      'index.js': "require('./helpers.js');\nmodule.exports.greet = (n) => `hi ${n}`;\n",
      'index.test.js': `${NODE_TEST_HEADER}greet } = require('./index.js');
t('greet', () => a.strictEqual(greet('bob'), 'hi bob'));
`,
    },
    acceptanceFiles: ['index.test.js'],
    acceptanceCommand: 'node --test',
    expectedPass: 'helpers.js resolves and greet("bob") returns "hi bob"',
    // The buggy scaffold imports a missing file; the fix supplies it.
    solution: { 'helpers.js': 'module.exports.help = () => 1;\n' },
    offlineRunnable: true,
  },

  // ---- Python tasks (offline via python3) ----
  {
    id: 'py-count-vowels',
    title: 'Python: count vowels',
    language: 'python',
    prompt: 'Fix count_vowels(s) so it counts every vowel (case-insensitive).',
    scaffold: {
      'count_vowels.py': `def count_vowels(s):
    return s.count('a')
`,
      'tests/run.py': `import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from count_vowels import count_vowels

failed = []
def check(cond, msg):
    if not cond:
        failed.append(msg)

check(count_vowels('hello') == 2, 'hello -> 2')
check(count_vowels('PYTHON') == 1, 'PYTHON -> 1 (o)')
check(count_vowels('') == 0, 'empty -> 0')
check(count_vowels('RHYTHM') == 0, 'RHYTHM -> 0')

if failed:
    print('FAIL:', *failed, sep='\\nFAIL: ')
    sys.exit(1)
print('ok')
`,
    },
    acceptanceFiles: ['tests/run.py'],
    acceptanceCommand: 'python3 tests/run.py',
    expectedPass: 'counts all vowels case-insensitively (hello=2, PYTHON=1)',
    solution: {
      'count_vowels.py': `def count_vowels(s):
    return sum(1 for c in s if c.lower() in 'aeiou')
`,
    },
    offlineRunnable: true,
  },

  {
    id: 'py-flatten',
    title: 'Python: deep flatten',
    language: 'python',
    prompt: 'Fix flatten(nested) so it recursively flattens arbitrarily nested lists.',
    scaffold: {
      'flatten.py': `def flatten(nested):
    return [y for x in nested for y in x]
`,
      'tests/run.py': `import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from flatten import flatten

failed = []
def check(cond, msg):
    if not cond:
        failed.append(msg)

check(flatten([1, 2, 3]) == [1, 2, 3], 'flat')
check(flatten([1, [2, 3]]) == [1, 2, 3], 'one level')
check(flatten([1, [2, [3, 4]]]) == [1, 2, 3, 4], 'two levels')
check(flatten([]) == [], 'empty')

if failed:
    print('FAIL:', *failed, sep='\\nFAIL: ')
    sys.exit(1)
print('ok')
`,
    },
    acceptanceFiles: ['tests/run.py'],
    acceptanceCommand: 'python3 tests/run.py',
    expectedPass: 'recursively flattens nested lists of any depth',
    solution: {
      'flatten.py': `def flatten(nested):
    out = []
    for x in nested:
        if isinstance(x, list):
            out.extend(flatten(x))
        else:
            out.append(x)
    return out
`,
    },
    offlineRunnable: true,
  },

  // ---- Go tasks (run at T9; go toolchain not in this environment) ----
  {
    id: 'go-add',
    title: 'Go: integer add',
    language: 'go',
    prompt: 'Fix Add(a, b) so it returns the sum, not the difference.',
    scaffold: {
      'go.mod': 'module bench.add\n\ngo 1.22\n',
      'main.go': `package main

func Add(a, b int) int {
	return a - b
}
`,
      'main_test.go': `package main

import "testing"

func TestAdd(t *testing.T) {
	if Add(2, 3) != 5 {
		t.Errorf("Add(2,3)=%d; want 5", Add(2, 3))
	}
}
`,
    },
    acceptanceFiles: ['main_test.go'],
    acceptanceCommand: 'go test ./... -count=1',
    expectedPass: 'go test passes: Add(2,3) == 5',
    solution: {
      'main.go': `package main

func Add(a, b int) int {
	return a + b
}
`,
    },
    offlineRunnable: false,
  },

  {
    id: 'go-sum',
    title: 'Go: sum to n',
    language: 'go',
    prompt: 'Fix SumTo(n) so it includes n in the summation.',
    scaffold: {
      'go.mod': 'module bench.sum\n\ngo 1.22\n',
      'main.go': `package main

func SumTo(n int) int {
	s := 0
	for i := 1; i < n; i++ {
		s += i
	}
	return s
}
`,
      'main_test.go': `package main

import "testing"

func TestSumTo(t *testing.T) {
	if SumTo(5) != 15 {
		t.Errorf("SumTo(5)=%d; want 15", SumTo(5))
	}
}
`,
    },
    acceptanceFiles: ['main_test.go'],
    acceptanceCommand: 'go test ./... -count=1',
    expectedPass: 'go test passes: SumTo(5) == 15',
    solution: {
      'main.go': `package main

func SumTo(n int) int {
	s := 0
	for i := 1; i <= n; i++ {
		s += i
	}
	return s
}
`,
    },
    offlineRunnable: false,
  },
];
