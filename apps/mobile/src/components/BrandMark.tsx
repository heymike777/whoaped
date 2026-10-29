import Svg, { Circle, Path } from 'react-native-svg';

export function BrandMark({ size = 20 }: { size?: number }) {
  return (
    <Svg accessibilityLabel="WhoAped" height={size} viewBox="0 0 256 256" width={size}>
      <Path
        d="M52 64C17 99 17 157 52 192"
        fill="none"
        stroke="#F4F4EF"
        strokeLinecap="round"
        strokeWidth={22}
      />
      <Path
        d="M204 64C239 99 239 157 204 192"
        fill="none"
        stroke="#F4F4EF"
        strokeLinecap="round"
        strokeWidth={22}
      />
      <Path
        d="M82 91C59 113 59 143 82 165L108 191L128 170L148 191L174 165C197 143 197 113 174 91"
        fill="none"
        stroke="#F4F4EF"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={22}
      />
      <Circle cx={128} cy={126} fill="#F04B2F" r={14} />
    </Svg>
  );
}
