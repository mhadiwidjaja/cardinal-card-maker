
/** ln(n!) by summing logs; decks are small (a few hundred cards), so this is exact enough and fast. */
function logFactorial(n: number): number {
  let s = 0;
  for (let i = 2; i <= n; i++) s += Math.log(i);
  return s;
}

function logChoose(n: number, k: number): number {
  if (k < 0 || k > n) return -Infinity;
  return logFactorial(n) - logFactorial(k) - logFactorial(n - k);
}

export function hypergeometric(N: number, K: number, n: number, x: number): number {
  if (x < 0 || x > K || x > n || n - x > N - K) return 0;
  return Math.exp(logChoose(K, x) + logChoose(N - K, n - x) - logChoose(N, n));
}

export function atLeast(N: number, K: number, n: number, k: number): number {
  const draws = Math.max(0, Math.min(n, N));
  if (k <= 0) return 1;
  let p = 0;
  for (let x = k; x <= Math.min(K, draws); x++) p += hypergeometric(N, K, draws, x);
  return Math.min(1, p);
}

export function cardsSeen(handSize: number, drawPerTurn: number, turn: number, goingFirst: boolean): number {
  const draws = goingFirst ? turn - 1 : turn;
  return handSize + Math.max(0, draws) * drawPerTurn;
}
