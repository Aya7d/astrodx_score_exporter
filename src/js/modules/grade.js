/**
 * Grade Calculator Module
 * Calculates maimai DX play grades based on achievement rate percentages.
 */

export function calculateGrade(rate) {
  if (rate >= 100.5) return { text: 'SSS+', className: 'grade-sss-plus' };
  if (rate >= 100.0) return { text: 'SSS', className: 'grade-sss' };
  if (rate >= 99.5)  return { text: 'SS+', className: 'grade-ss-plus' };
  if (rate >= 99.0)  return { text: 'SS', className: 'grade-ss' };
  if (rate >= 98.0)  return { text: 'S+', className: 'grade-s-plus' };
  if (rate >= 97.0)  return { text: 'S', className: 'grade-s' };
  if (rate >= 94.0)  return { text: 'AAA', className: 'grade-other' };
  if (rate >= 90.0)  return { text: 'AA', className: 'grade-other' };
  if (rate >= 80.0)  return { text: 'A', className: 'grade-other' };
  if (rate >= 75.0)  return { text: 'BBB', className: 'grade-other' };
  if (rate >= 70.0)  return { text: 'BB', className: 'grade-other' };
  if (rate >= 60.0)  return { text: 'B', className: 'grade-other' };
  if (rate >= 50.0)  return { text: 'C', className: 'grade-other' };
  return { text: 'D', className: 'grade-other' };
}
