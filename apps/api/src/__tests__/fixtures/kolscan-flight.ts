export function kolscanFlightPage(directory: unknown[], leaderboard: unknown[] = []): string {
  const data = [
    '5:' + JSON.stringify(['$', '$L11', null, { initLeaderboard: leaderboard }]),
    '2:' + JSON.stringify(['$', '$L12', null, { initialData: directory }]),
  ].join('\n') + '\n';
  const middle = Math.floor(data.length / 2);
  return [data.slice(0, middle), data.slice(middle)].map(chunk =>
    '<script>self.__next_f.push(' + JSON.stringify([1, chunk]) + ')</script>').join('');
}
