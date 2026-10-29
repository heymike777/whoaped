import Svg, { Circle, Path } from 'react-native-svg';

export function BrandMark({ size = 20 }: { size?: number }) {
  return (
    <Svg accessibilityLabel="WhoAped" height={size} viewBox="0 0 256 256" width={size}>
      <Path
        d="M91 51H63C56 51 51 56 51 63V91M166 51H194C200 51 205 56 205 63V91M91 205H63C56 205 51 200 51 194V166M166 205H194C200 205 205 200 205 194V166"
        fill="none"
        stroke="#F4F4EF"
        strokeLinecap="round"
        strokeWidth={19}
      />
      <Path
        d="M81 128C93 107 108 96 128 96C148 96 164 107 176 128C164 150 148 161 128 161C108 161 93 150 81 128Z"
        fill="none"
        stroke="#F4F4EF"
        strokeLinejoin="round"
        strokeWidth={17}
      />
      <Circle cx={128} cy={128} fill="#F04B2F" r={15} />
    </Svg>
  );
}
