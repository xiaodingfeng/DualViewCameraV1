let sequence = 0;

export function createCaptureId(now = Date.now()): string {
  sequence = (sequence + 1) % 10000;
  return `cap_${now}_${sequence.toString().padStart(4, '0')}`;
}
