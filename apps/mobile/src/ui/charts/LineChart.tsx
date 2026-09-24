import { useMemo, useState } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { scheduleOnRN } from 'react-native-worklets';
import Svg, { Circle, Defs, G, Line, LinearGradient, Path, Rect, Stop, Text as SvgText } from 'react-native-svg';
import { useTheme } from '@/design';
import { Text } from '../Text';
import { areaPath, niceDomain, smoothPath, type Pt } from './path';

export interface ChartPoint {
  t: number;
  v: number | null;
}

export interface LineChartProps {
  points: readonly ChartPoint[];
  /** Time spans to shade (e.g. pump running). */
  bands?: readonly { start: number; end: number }[];
  refLines?: readonly { value: number; label: string; color?: string }[];
  color?: string;
  height?: number;
  domain?: [number, number];
  clamp?: [number, number];
  unit?: string;
  formatX: (t: number) => string;
  formatTooltipX?: (t: number) => string;
  formatY?: (v: number) => string;
  accessibilityLabel: string;
  testID?: string;
}

const PAD = { left: 36, right: 12, top: 12, bottom: 26 };

/** Time-series line chart with gridlines, shaded bands, reference lines and a touch scrubber. */
export function LineChart({
  points,
  bands = [],
  refLines = [],
  color,
  height = 220,
  domain,
  clamp,
  unit = '',
  formatX,
  formatTooltipX,
  formatY = (v) => v.toFixed(0),
  accessibilityLabel,
  testID,
}: LineChartProps) {
  const t = useTheme();
  const c = color ?? t.colors.water;
  const [width, setWidth] = useState(0);
  const [cursor, setCursor] = useState<number | null>(null);

  const plotW = Math.max(1, width - PAD.left - PAD.right);
  const plotH = height - PAD.top - PAD.bottom;
  const t0 = points[0]?.t ?? 0;
  const t1 = points[points.length - 1]?.t ?? 1;
  const span = t1 - t0 || 1;
  const [lo, hi] = domain ?? niceDomain([...points.map((p) => p.v), ...refLines.map((r) => r.value)], clamp);
  const x = (tt: number) => PAD.left + ((tt - t0) / span) * plotW;
  const y = (v: number) => PAD.top + (1 - (v - lo) / (hi - lo || 1)) * plotH;

  const segments = useMemo(() => {
    const segs: Pt[][] = [];
    let cur: Pt[] = [];
    for (const p of points) {
      if (p.v === null) {
        if (cur.length) segs.push(cur);
        cur = [];
      } else cur.push({ x: x(p.t), y: y(p.v) });
    }
    if (cur.length) segs.push(cur);
    return segs;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, width, lo, hi]);

  const ticksY = [lo, lo + (hi - lo) / 2, hi];
  const ticksX = points.length > 1 ? [t0, t0 + span / 2, t1] : [];

  const nearest = (px: number) => {
    if (!points.length) return null;
    const tt = t0 + ((px - PAD.left) / plotW) * span;
    let best = 0;
    for (let i = 1; i < points.length; i++) {
      if (Math.abs(points[i]!.t - tt) < Math.abs(points[best]!.t - tt)) best = i;
    }
    return best;
  };
  const onScrub = (px: number) => setCursor(nearest(px));
  const clear = () => setCursor(null);

  const pan = Gesture.Pan()
    .minDistance(0)
    .onBegin((e) => scheduleOnRN(onScrub, e.x))
    .onUpdate((e) => scheduleOnRN(onScrub, e.x))
    .onFinalize(() => scheduleOnRN(clear));

  const sel = cursor !== null ? points[cursor] : undefined;

  return (
    <View testID={testID}>
      <View style={{ height: 40, justifyContent: 'center' }}>
        {sel ? (
          <View accessibilityLiveRegion="polite">
            <Text variant="metric" tabular>
              {sel.v === null ? '—' : `${formatY(sel.v)}${unit}`}
            </Text>
            <Text variant="caption" tone="textSecondary">
              {(formatTooltipX ?? formatX)(sel.t)}
            </Text>
          </View>
        ) : (
          <Text variant="caption" tone="textTertiary">
            Touch and drag the chart to inspect values
          </Text>
        )}
      </View>
      <GestureDetector gesture={pan}>
        <View
          accessible
          accessibilityRole="image"
          accessibilityLabel={accessibilityLabel}
          style={{ height }}
          onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
        >
          {width ? (
            <Svg width={width} height={height}>
              <Defs>
                <LinearGradient id="lc-fill" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor={c} stopOpacity={0.28} />
                  <Stop offset="1" stopColor={c} stopOpacity={0} />
                </LinearGradient>
              </Defs>
              {bands.map((b, i) => {
                const bx = Math.max(PAD.left, x(b.start));
                const bw = Math.min(PAD.left + plotW, x(b.end)) - bx;
                return bw > 0 ? (
                  <Rect key={i} x={bx} y={PAD.top} width={Math.max(bw, 1.5)} height={plotH} fill={t.colors.water} opacity={0.12} />
                ) : null;
              })}
              {ticksY.map((v, i) => (
                <G key={`y${i}`}>
                  <Line x1={PAD.left} x2={PAD.left + plotW} y1={y(v)} y2={y(v)} stroke={t.colors.border} strokeWidth={1} />
                  <SvgText x={PAD.left - 6} y={y(v) + 4} fontSize={10} fill={t.colors.textTertiary} textAnchor="end">
                    {formatY(v)}
                  </SvgText>
                </G>
              ))}
              {ticksX.map((tt, i) => (
                <SvgText
                  key={`x${i}`}
                  x={x(tt)}
                  y={height - 8}
                  fontSize={10}
                  fill={t.colors.textTertiary}
                  textAnchor={i === 0 ? 'start' : i === ticksX.length - 1 ? 'end' : 'middle'}
                >
                  {formatX(tt)}
                </SvgText>
              ))}
              {refLines.map((r, i) =>
                r.value >= lo && r.value <= hi ? (
                  <G key={`r${i}`}>
                    <Line
                      x1={PAD.left}
                      x2={PAD.left + plotW}
                      y1={y(r.value)}
                      y2={y(r.value)}
                      stroke={r.color ?? t.colors.accent}
                      strokeDasharray="4 4"
                      strokeWidth={1.2}
                      opacity={0.8}
                    />
                    <SvgText x={PAD.left + plotW - 2} y={y(r.value) - 4} fontSize={9} fill={r.color ?? t.colors.accent} textAnchor="end">
                      {r.label}
                    </SvgText>
                  </G>
                ) : null,
              )}
              {segments.map((s, i) => (
                <Path key={`a${i}`} d={areaPath(s, PAD.top + plotH)} fill="url(#lc-fill)" />
              ))}
              {segments.map((s, i) =>
                s.length === 1 ? (
                  <Circle key={`d${i}`} cx={s[0]!.x} cy={s[0]!.y} r={2.5} fill={c} />
                ) : (
                  <Path key={`l${i}`} d={smoothPath(s)} stroke={c} strokeWidth={2.5} fill="none" strokeLinecap="round" />
                ),
              )}
              {sel ? (
                <G>
                  <Line x1={x(sel.t)} x2={x(sel.t)} y1={PAD.top} y2={PAD.top + plotH} stroke={t.colors.textSecondary} strokeWidth={1} />
                  {sel.v !== null ? (
                    <Circle cx={x(sel.t)} cy={y(sel.v)} r={6} fill={t.colors.surface} stroke={c} strokeWidth={3} />
                  ) : null}
                </G>
              ) : null}
            </Svg>
          ) : null}
        </View>
      </GestureDetector>
    </View>
  );
}
