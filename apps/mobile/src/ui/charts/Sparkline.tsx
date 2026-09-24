import { useState } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { useTheme } from '@/design';
import { areaPath, niceDomain, smoothPath, toSegments } from './path';

export interface SparklineProps {
  values: readonly (number | null)[];
  height?: number;
  color?: string;
  domain?: [number, number];
  accessibilityLabel?: string;
}

/** Minimal line + gradient area chart that fills its container width. */
export function Sparkline({ values, height = 64, color, domain, accessibilityLabel }: SparklineProps) {
  const t = useTheme();
  const c = color ?? t.colors.water;
  const [width, setWidth] = useState(0);
  const segs = width ? toSegments(values, width, height, domain ?? niceDomain(values, [0, 100])) : [];
  const gradId = `spark-${c.replace(/[^a-z0-9]/gi, '')}`;

  return (
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
            <LinearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={c} stopOpacity={0.35} />
              <Stop offset="1" stopColor={c} stopOpacity={0} />
            </LinearGradient>
          </Defs>
          {segs.map((s, i) => (
            <Path key={`a${i}`} d={areaPath(s, height)} fill={`url(#${gradId})`} />
          ))}
          {segs.map((s, i) => (
            <Path key={`l${i}`} d={smoothPath(s)} stroke={c} strokeWidth={2.5} fill="none" strokeLinecap="round" />
          ))}
        </Svg>
      ) : null}
    </View>
  );
}
