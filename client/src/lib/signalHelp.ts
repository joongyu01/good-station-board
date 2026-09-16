import type { BoardData, Judging, SignalColor, ViewMode } from './board.ts';

export function signalHelp(key: SignalColor, board: BoardData, j: Judging | null, mode: ViewMode): string {
  if (key === 'cancel') return '최초 선정 공시일 다음 날부터 휘발유 또는 경유 중 하나라도 해당 날짜의 단위지역 유종별 평균을 하루 이상 초과한 주유소입니다. 합산값이 평균 이하여도 포함됩니다. 현재 신호등과 중복 집계하며 실제 선정 취소 확정은 아닙니다.';
  if (key === 'unknown') return '현재 가격이 없거나 선택한 판정에 필요한 순위·기준선 등이 없어 판정하지 못한 경우입니다. 0원·미신고 가격은 유효한 판매가로 보지 않습니다.';
  if (key === 'stale') return '현재 가격은 있지만 과거 가격에 결측이 있는 주유소입니다. 현재 가격 판정보다 과거 미신고 표시가 우선합니다.';
  const rank = `단위지역 내 서로 다른 가격 기준 조밀 순위입니다(공동 1위 다음은 2위). 적합 범위: 서울·경기 ${j?.rankGreenMetro ?? board.stations.find(s=>s.sido==='서울')?.greenRank ?? 10}위, 전남광주 통합 이후 10위, 그 외 ${j?.rankGreenDefault ?? board.stations.find(s=>s.sido==='강원')?.greenRank ?? 5}위 이내. `;
  const rule = key === 'green' ? '적합 순위 이내입니다.' : key === 'yellow'
    ? `적합 순위를 넘지만 ${j ? `적합 순위 × ${j.rankYellowFactor}` : '저장된 근접 순위'} 이내입니다.`
    : '근접 순위 상한을 초과했습니다.';
  if (board.judgeMode !== 'adjusted' || mode !== 'sum') return rank + rule + ' 과거 미신고 이력이 있으면 미신고 표시가 우선합니다.';
  const combine = j?.adjustedCombine ?? board.baseline?.combine;
  const g = j?.driftGreen ?? board.baseline?.driftGreen;
  const y = j?.driftYellow ?? board.baseline?.driftYellow;
  const drift = `이탈률 = 현재 합계 ÷ (선정 당시 가격 × 단위지역 시장변동 배율) − 1. 적합: ${g == null ? '설정값' : (g*100)+'%'} 이하, 근접: 적합 상한 초과~${y == null ? '설정값' : (y*100)+'%'} 이하, 초과: 근접 상한 초과.`;
  return combine === 'drift' ? drift : combine === 'rank' ? '시장변동 보정 모집단을 기준으로 ' + rank + rule
    : '보정 순위와 이탈률 중 나쁜 쪽으로 판정합니다. ' + rank + rule + ' ' + drift;
}
