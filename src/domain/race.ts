import type { Activity } from './activity';
import { formatClock } from './format';

export interface RaceOutcome {
  winner: 'p1' | 'rival' | 'tie';
  winnerName: string;
  marginLabel: string;
  p1PaceSecPerKm: number;
  rivalPaceSecPerKm: number;
}

function displayName(name: string, fallback: string): string {
  const cleaned = name.trim().toUpperCase().slice(0, 12);
  return cleaned.length > 0 ? cleaned : fallback;
}

export function compareRace(
  primary: Activity,
  rival: Activity,
  primaryName = 'KUBITA',
  rivalName = 'RIVAL',
): RaceOutcome {
  const nameA = displayName(primaryName, 'KUBITA');
  const nameB = displayName(rivalName, 'RIVAL');
  const paceA = primary.totalDurationSec / Math.max(0.05, primary.totalDistanceKm);
  const paceB = rival.totalDurationSec / Math.max(0.05, rival.totalDistanceKm);
  const distanceDelta =
    Math.abs(primary.totalDistanceKm - rival.totalDistanceKm) /
    Math.max(0.1, Math.max(primary.totalDistanceKm, rival.totalDistanceKm));

  if (distanceDelta <= 0.08) {
    const gap = Math.round(Math.abs(primary.totalDurationSec - rival.totalDurationSec));
    if (gap <= 1) {
      return {
        winner: 'tie',
        winnerName: 'SERI',
        marginLabel: 'PHOTO FINISH!',
        p1PaceSecPerKm: paceA,
        rivalPaceSecPerKm: paceB,
      };
    }
    const primaryWon = primary.totalDurationSec < rival.totalDurationSec;
    return {
      winner: primaryWon ? 'p1' : 'rival',
      winnerName: primaryWon ? nameA : nameB,
      marginLabel: `UNGGUL ${formatClock(gap)}`,
      p1PaceSecPerKm: paceA,
      rivalPaceSecPerKm: paceB,
    };
  }

  const paceGap = Math.round(Math.abs(paceA - paceB));
  if (paceGap <= 1) {
    return {
      winner: 'tie',
      winnerName: 'SERI',
      marginLabel: 'PACE SEIMBANG!',
      p1PaceSecPerKm: paceA,
      rivalPaceSecPerKm: paceB,
    };
  }
  const primaryWon = paceA < paceB;
  return {
    winner: primaryWon ? 'p1' : 'rival',
    winnerName: primaryWon ? nameA : nameB,
    marginLabel: `PACE -${formatClock(paceGap)}/KM`,
    p1PaceSecPerKm: paceA,
    rivalPaceSecPerKm: paceB,
  };
}
