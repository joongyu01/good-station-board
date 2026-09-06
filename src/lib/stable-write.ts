/**
 * 내용이 그대로면 다시 쓰지 않는다.
 *
 * 집계 산출물에는 `generatedAt`, 수집 원본에는 `collectedAt` 처럼 **실행한
 * 시각** 이 박혀 있다. 매번 달라지는 값이라, 가격이 한 줄도 바뀌지 않은 날에도
 * 파일 바이트가 달라진다. 그러면 워크플로의 `변경 없음` 분기가 영영 잡히지
 * 않고 실행할 때마다 데이터 커밋이 하나씩 쌓인다 — 커밋 로그만 봐서는 진짜
 * 갱신인지 헛돈 것인지 구분할 수가 없다.
 *
 * 9월 6일이 그랬다. 오피넷에 그날 치가 한 건도 없어 전날 것을 그대로 다시
 * 집었는데, 판정 결과가 완전히 같은데도 커밋(a92b953)이 하나 올라갔다.
 *
 * 그래서 시각 필드를 빼고 견준다. 같으면 옛 파일을 손대지 않는다. 옛 시각이
 * 남는 것이 맞다 — 그 시각은 '이 값이 만들어진 때' 이고, 값이 안 바뀌었으면
 * 만들어진 때도 안 바뀐 것이다.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

/** 견줄 때 무시할 최상위 키를 떼어 낸 JSON 문자열. */
function stripped(value: unknown, ignore: readonly string[]): string {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return JSON.stringify(value);
  }
  const rest: Record<string, unknown> = { ...(value as Record<string, unknown>) };
  for (const k of ignore) delete rest[k];
  return JSON.stringify(rest);
}

/**
 * 시각 필드를 뺀 나머지가 같은가.
 *
 * 키 순서까지 같아야 같다고 본다. 두 값 모두 같은 코드가 같은 순서로 만들기
 * 때문에 실제로는 문제가 없고, 필드 순서를 바꾸는 날에 한 번 더 쓰일 뿐이다.
 */
export function sameIgnoring(a: unknown, b: unknown, ignore: readonly string[]): boolean {
  return stripped(a, ignore) === stripped(b, ignore);
}

/**
 * 달라졌을 때만 쓴다. 실제로 썼으면 true.
 *
 * 파일이 깨져 있거나 없으면 따지지 않고 새로 쓴다.
 */
export function writeJsonIfChanged(
  file: string,
  value: unknown,
  ignore: readonly string[] = [],
): boolean {
  if (existsSync(file)) {
    try {
      if (sameIgnoring(JSON.parse(readFileSync(file, "utf8")), value, ignore)) return false;
    } catch {
      // 읽거나 파싱하지 못하면 견줄 것이 없다. 새로 쓴다.
    }
  }
  writeFileSync(file, JSON.stringify(value), "utf8");
  return true;
}
