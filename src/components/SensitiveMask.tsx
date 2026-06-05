import { useSensitive } from "../hooks/useSensitive";

/**
 * Patterns that match API tokens, keys, secrets, passwords, etc.
 * Each match will be blurred when sensitive mode is on.
 */
const SENSITIVE_PATTERNS = [
  /(?<=(?:key|token|secret|password|apikey|api_key|api-key|bearer|authorization)\s*[:=]\s*)[A-Za-z0-9_\-./+]{16,}/gi,
  /pplx-[A-Za-z0-9]{40,}/g,
  /sk-[A-Za-z0-9_\-]{32,}/g,
  /re_[A-Za-z0-9_]{20,}/g,
  /ghp_[A-Za-z0-9]{36,}/g,
  /gho_[A-Za-z0-9]{36,}/g,
  /xai-[A-Za-z0-9]{40,}/g,
  /GOCSPX-[A-Za-z0-9_\-]{20,}/g,
  /AIza[A-Za-z0-9_\-]{30,}/g,
  /[0-9a-f]{48,}/g,
  /eyJ[A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-]+/g,
];

function maskSensitiveText(text: string, hidden: boolean): (string | JSX.Element)[] {
  if (!hidden) return [text];

  const ranges: { start: number; end: number }[] = [];
  for (const pattern of SENSITIVE_PATTERNS) {
    const re = new RegExp(pattern.source, pattern.flags);
    let m;
    while ((m = re.exec(text)) !== null) {
      ranges.push({ start: m.index, end: m.index + m[0].length });
    }
  }

  if (ranges.length === 0) return [text];

  ranges.sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number }[] = [ranges[0]];
  for (let i = 1; i < ranges.length; i++) {
    const last = merged[merged.length - 1];
    if (ranges[i].start <= last.end) {
      last.end = Math.max(last.end, ranges[i].end);
    } else {
      merged.push(ranges[i]);
    }
  }

  const result: (string | JSX.Element)[] = [];
  let pos = 0;
  for (const { start, end } of merged) {
    if (start > pos) result.push(text.slice(pos, start));
    result.push(
      <span key={start} className="sensitive-blur" title="Sensitive content hidden">
        {text.slice(start, end)}
      </span>
    );
    pos = end;
  }
  if (pos < text.length) result.push(text.slice(pos));
  return result;
}


export function SensitiveText({ children }: { children: string }) {
  if (typeof children !== "string") return <>{children}</>;
  const { hidden } = useSensitive();
  return <>{maskSensitiveText(children, hidden)}</>;
}
