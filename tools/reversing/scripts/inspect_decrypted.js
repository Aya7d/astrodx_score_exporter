const fs = require('fs');
const data = JSON.parse(fs.readFileSync('data/samples/cache_decrypted.json', 'utf8'));

const records = [];
for (const [key, song] of Object.entries(data.level_metadata || {})) {
  if (!song.difficulties) continue;
  song.difficulties.forEach((diff, idx) => {
    const stats = diff.stats || {};
    const rate = stats.achievementRate || 0;
    if (rate > 0 || (stats.playCount && stats.playCount > 0)) {
      records.push({
        songKey: key,
        title: song.title || key,
        artist: song.artist,
        charter: diff.charter,
        diffName: diff.alias || 'Unknown',
        diffLevel: diff.value,
        rate: rate,
        dxScore: stats.dxScore,
        clearType: stats.clearType,
        clearedPlays: stats.clearedPlays,
        completePlays: stats.completePlays,
        critical: stats.criticalCount,
        perfect: stats.perfectCount,
        great: stats.greatCount,
        good: stats.goodCount,
        maxCombo: stats.maxCombo
      });
    }
  });
}

// Sort by achievementRate descending
records.sort((a, b) => b.rate - a.rate);

console.log('Total played records:', records.length);
console.log('\nTop 10 highest achievement records:');
console.log(JSON.stringify(records.slice(0, 10), null, 2));

const clearTypeMap = { 
  0: 'Failed/Played', 
  1: 'Clear', 
  2: 'FC (Full Combo)', 
  3: 'FC+ (Full Combo+)', 
  4: 'AP (All Perfect)', 
  5: 'AP+ (All Perfect+)' 
};

console.log('\nDetailed Breakdown of Top Records:');
records.slice(0, 8).forEach((r, idx) => {
  console.log(`\n#${idx + 1}: "${r.title}" [${r.diffName} Lv.${r.diffLevel}]`);
  console.log(`    Artist: ${r.artist}`);
  console.log(`    Charter: ${r.charter || '(none)'}`);
  console.log(`    Achievement Rate: ${r.rate.toFixed(4)}%`);
  console.log(`    Clear Type: ${clearTypeMap[r.clearType] || r.clearType}`);
  console.log(`    DX Score: ${r.dxScore}`);
  console.log(`    Judgments: ${r.critical} Critical, ${r.perfect} Perfect, ${r.great} Great, ${r.good} Good`);
  console.log(`    Play Counts: ${r.completePlays} completed, ${r.clearedPlays} cleared`);
});
