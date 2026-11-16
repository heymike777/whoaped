import React from 'react';
import {
  AbsoluteFill, Audio, Easing, Img, interpolate, spring, staticFile,
  useCurrentFrame,
} from 'remotion';
import { loadFont } from '@remotion/fonts';
import { TransitionSeries, linearTiming } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';

loadFont({ family: 'Space Grotesk', url: staticFile('fonts/SpaceGrotesk-Bold.ttf'), weight: '700' });
loadFont({ family: 'Space Grotesk', url: staticFile('fonts/SpaceGrotesk-Regular.ttf'), weight: '400' });

const C = { paper: '#F4F4EF', ink: '#111313', orange: '#F04B2F', quiet: '#5A605D', rule: '#D8DBD4', green: '#137A52' };
const ease = Easing.bezier(0.22, 1, 0.36, 1);
const tween = (f: number, a: number, b: number, x: number, y: number) => interpolate(f, [a, b], [x, y], {
  easing: ease, extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
});
const reveal = (f: number, delay = 0) => spring({ frame: f - delay, fps: 30,
  config: { damping: 200, stiffness: 230 }, durationInFrames: 25 });

const Arrow: React.FC<{ size?: number; color?: string }> = ({ size = 40, color = C.ink }) => (
  <svg width={size} height={size} viewBox="0 0 40 40" fill="none">
    <path d="M7 20h26M22 9l11 11-11 11" stroke={color} strokeWidth="2.7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const Brand: React.FC<{ dark?: boolean; size?: number }> = ({ dark = false, size = 36 }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 15, color: dark ? C.paper : C.ink }}>
    <Img src={staticFile('mark.svg')} style={{ width: size * 1.5, height: size * 1.5, borderRadius: size * .32 }} />
    <span style={{ fontSize: size, fontWeight: 700, letterSpacing: '-.055em' }}>WhoAped</span>
  </div>
);

const Enter: React.FC<React.PropsWithChildren<{ delay?: number; style?: React.CSSProperties }>> = ({ children, delay = 0, style }) => {
  const f = useCurrentFrame();
  const p = reveal(f, delay);
  return <div style={{ opacity: p, transform: `translateY(${(1 - p) * 35}px)`, ...style }}>{children}</div>;
};

const Frame: React.FC<React.PropsWithChildren<{ dark?: boolean; footer?: string; index?: string }>> = ({ children, dark = false, footer, index }) => (
  <AbsoluteFill style={{ background: dark ? C.ink : C.paper, color: dark ? C.paper : C.ink }}>
    <div style={{ position: 'absolute', top: 54, left: 64 }}><Brand dark={dark} /></div>
    <div style={{ position: 'absolute', top: 69, right: 64, fontSize: 27,
      color: dark ? '#AEB6AF' : C.quiet }}>Solana wallet activity</div>
    {children}
    <div style={{ position: 'absolute', left: 64, right: 64, top: 1008, height: 1,
      background: dark ? '#3C423D' : C.rule }} />
    <div style={{ position: 'absolute', left: 64, top: 1026, fontSize: 23,
      color: dark ? '#AEB6AF' : C.quiet }}>{footer ?? 'Watch-only. No private keys.'}</div>
    <div style={{ position: 'absolute', right: 64, top: 1026, fontSize: 23,
      color: dark ? '#AEB6AF' : C.quiet }}>{index ?? 'whoaped.com'}</div>
  </AbsoluteFill>
);

// Launch-film mockup: keep the source capture untouched and replace only the two
// promotional token labels when it is composed into the video.
const CaptureImage: React.FC<{ src: string; width: number }> = ({ src, width }) => {
  const scale = width / 1206;
  return <div style={{ position: 'relative', width, height: width * 2622 / 1206 }}>
    <Img src={staticFile(src)} style={{ width, display: 'block' }} />
    {src === 'activity.png' ? <>
      <div style={{ position: 'absolute', left: 97 * scale, top: 1058 * scale,
        width: 438 * scale, height: 62 * scale, background: '#FFFFFF',
        display: 'flex', alignItems: 'center', color: C.quiet, fontSize: 38 * scale,
        fontWeight: 700, letterSpacing: '-.025em' }}>Trade $WHOAPED</div>
      <div style={{ position: 'absolute', left: 97 * scale, top: 1281 * scale,
        width: 422 * scale, height: 59 * scale, background: '#FFFFFF',
        display: 'flex', alignItems: 'center', color: C.quiet, fontSize: 36 * scale,
        fontWeight: 400 }}>WHOAPED</div>
    </> : null}
  </div>;
};

const Phone: React.FC<{ src: string; width: number; x: number; y: number; style?: React.CSSProperties }> = ({ src, width, x, y, style }) => (
  <div style={{ position: 'absolute', left: x, top: y, width, height: width * 2622 / 1206,
    border: '7px solid #111313', boxSizing: 'content-box', borderRadius: width * .115,
    overflow: 'hidden', background: C.paper, ...style }}>
    <CaptureImage src={src} width={width} />
    <div style={{ position: 'absolute', width: width * .25, height: width * .065,
      left: width * .375, top: width * .022, background: C.ink, borderRadius: 50 }} />
  </div>
);

// Crop the composed capture; the original screenshot asset remains unchanged.
const Crop: React.FC<{ src: string; sx: number; sy: number; sw: number; sh: number; width: number; style?: React.CSSProperties }> = ({ src, sx, sy, sw, sh, width, style }) => {
  const scale = width / sw;
  return <div style={{ position: 'relative', width, height: sh * scale, overflow: 'hidden', ...style }}>
    <div style={{ position: 'absolute', left: -sx * scale, top: -sy * scale }}>
      <CaptureImage src={src} width={1206 * scale} />
    </div>
  </div>;
};

const Hook: React.FC = () => {
  const f = useCurrentFrame();
  const dotX = tween(f, 57, 93, 904, 993);
  const dotY = tween(f, 57, 93, 750, 1038);
  return <Frame dark>
    <div style={{ position: 'absolute', left: 64, top: 230, fontSize: 174,
      lineHeight: .97, fontWeight: 700, letterSpacing: '-.075em' }}>
      <div>Who just</div>
      <Enter delay={6}><span>aped<span style={{ color: C.orange }}>?</span></span></Enter>
    </div>
    <Enter delay={17} style={{ position: 'absolute', left: 70, top: 690 }}>
      <div style={{ fontSize: 37, letterSpacing: '-.035em', maxWidth: 620 }}>Follow the wallets<br />that move first.</div>
      <div style={{ fontSize: 28, marginTop: 22, color: '#AEB6AF' }}>Their next move. In plain English.</div>
    </Enter>
    <div style={{ position: 'absolute', left: dotX - 11.33, top: dotY - 11.33, width: 22.66, height: 22.66,
      borderRadius: '50%', background: C.orange, transform: `scale(${1 + Math.sin(f * .1) * .06})` }} />
    <svg style={{ position: 'absolute', left: 804, top: 650, opacity: tween(f, 15, 38, 0, 1) * tween(f, 60, 85, 1, 0) }} width="200" height="200" viewBox="0 0 1024 1024" fill="none">
      <path d="M362 204H250C224 204 204 224 204 250V362M662 204H774C800 204 820 224 820 250V362M362 820H250C224 820 204 800 204 774V662M662 820H774C800 820 820 800 820 774V662" stroke="#F4F4EF" strokeWidth="76" strokeLinecap="round" />
      <path d="M322 512C370 426 432 382 512 382C592 382 654 426 702 512C654 598 592 642 512 642C432 642 370 598 322 512Z" stroke="#F4F4EF" strokeWidth="66" strokeLinejoin="round" />
    </svg>
  </Frame>;
};

const AddWallet: React.FC = () => {
  const f = useCurrentFrame();
  const entrance = reveal(f, 8);
  const focus = tween(f, 34, 104, 1, 1.018);
  const tap = tween(f, 71, 88, 0, 1);
  return <Frame footer="Demo sequence · real app captures" index="01 / Add a wallet">
    <Enter style={{ position: 'absolute', left: 64, right: 64, top: 183, textAlign: 'center' }}>
      <div style={{ fontSize: 71, lineHeight: 1.12, letterSpacing: '-.05em', fontWeight: 700 }}>
        Watch the wallets<span style={{ color: C.orange }}>.</span>
      </div>
    </Enter>
    <Enter delay={6} style={{ position: 'absolute', left: 64, right: 64, top: 279,
      fontSize: 29, color: C.quiet, textAlign: 'center' }}>One public address. That's all.</Enter>
    <div style={{ position: 'absolute', left: 260, top: 350, width: 560, height: 646,
      transformOrigin: '50% 70%', transform: `translateY(${(1 - entrance) * 38}px) scale(${focus})`,
      opacity: entrance }}>
      <Crop src="add-wallet.png" sx={0} sy={1230} sw={1206} sh={1392} width={560}
        style={{ borderRadius: 46 }} />
      <div style={{ position: 'absolute', left: 413 - 29 * tap, top: 522 - 29 * tap,
        width: 58 * tap, height: 58 * tap, borderRadius: '50%', border: '2px solid white',
        background: '#FFFFFF18', opacity: tween(f, 71, 76, 0, .9) * tween(f, 82, 96, 1, 0) }} />
    </div>
  </Frame>;
};

const Activity: React.FC = () => {
  const f = useCurrentFrame();
  const focus = tween(f, 43, 83, 0, 1);
  const x = interpolate(focus, [0, 1], [646, 626], { extrapolateRight: 'clamp' });
  return <Frame footer="Illustrative UI · token labels adapted for launch" index="02 / Read the move">
    <Enter style={{ position: 'absolute', left: 64, top: 213 }}>
      <div style={{ fontSize: 86, lineHeight: 1.02, letterSpacing: '-.065em', fontWeight: 700 }}>
        The move.<br />Not the<br />hash<span style={{ color: C.orange }}>.</span>
      </div>
    </Enter>
    <div style={{ opacity: 1 - focus, transform: `translateX(${focus * 65}px)` }}>
      <Phone src="activity.png" width={342} x={x} y={166} />
    </div>
    <div style={{ position: 'absolute', top: 207, left: 625, opacity: focus,
      transform: `translateY(${(1 - focus) * 35}px)` }}>
      <Crop src="activity.png" sx={63} sy={435} sw={1080} sh={903} width={390}
        style={{ borderRadius: 19, border: `1px solid ${C.rule}` }} />
    </div>
    <Enter delay={13} style={{ position: 'absolute', left: 68, top: 540,
      width: 480, color: C.quiet, fontSize: 30, lineHeight: 1.35 }}>
      See who moved,<br />what changed,<br />and where it happened.
    </Enter>
    <div style={{ position: 'absolute', left: 68, top: 741, width: 944 }}>
      {[
        { delay: 77, label: 'Who', value: 'Signal watch', color: C.ink },
        { delay: 111, label: 'What', value: 'SOL → $CLMFND', color: C.green },
        { delay: 145, label: 'Where', value: 'Pump.fun', color: C.ink },
      ].map((r) => <Enter key={r.label} delay={r.delay}>
        <div style={{ display: 'flex', height: 73, alignItems: 'center', borderTop: `1px solid ${C.rule}`, gap: 20 }}>
          <span style={{ fontSize: 28, color: C.quiet, width: 137 }}>{r.label}</span>
          <span style={{ fontSize: 35, fontWeight: 700, color: r.color, letterSpacing: '-.025em' }}>{r.value}</span>
          {r.label === 'What' ? <span style={{ fontSize: 26, marginLeft: 'auto', color: C.quiet }}>Sent → received</span> : null}
        </div>
      </Enter>)}
    </div>
  </Frame>;
};

const Notification: React.FC = () => {
  const f = useCurrentFrame();
  return <Frame dark footer="Illustrative notification · sample values" index="03 / Get the alert">
    <Enter style={{ position: 'absolute', left: 64, top: 211, fontSize: 104,
      lineHeight: 1.02, letterSpacing: '-.065em', fontWeight: 700 }}>
      Wallet activity.<br /><span style={{ color: '#B9C2B9' }}>In plain English.</span>
    </Enter>
    <Enter delay={17} style={{ position: 'absolute', left: 64, top: 525, width: 952 }}>
      <div style={{ background: C.paper, color: C.ink, borderRadius: 25,
        padding: '29px 32px 34px', transform: `translateY(${Math.sin(f * .025) * 2}px)` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <Img src={staticFile('mark.svg')} style={{ width: 43, height: 43, borderRadius: 10 }} />
          <span style={{ fontSize: 27, color: C.quiet }}>WhoAped</span>
          <span style={{ fontSize: 25, color: C.quiet, marginLeft: 'auto' }}>now</span>
        </div>
        <div style={{ fontSize: 39, fontWeight: 700, marginTop: 23, letterSpacing: '-.035em' }}>Signal watch</div>
        <div style={{ fontSize: 33, marginTop: 8, lineHeight: 1.37, letterSpacing: '-.025em' }}>
          Swapped 0.0984676 SOL → 41,073 $CLMFND
        </div>
      </div>
    </Enter>
    <Enter delay={50} style={{ position: 'absolute', left: 68, top: 865,
      fontSize: 31, color: '#B9C2B9', display: 'flex', alignItems: 'center', gap: 16 }}>
      <span style={{ height: 11, width: 11, borderRadius: '50%', background: C.orange }} />
      Alerts in the app and Telegram.
    </Enter>
  </Frame>;
};

const CTA: React.FC = () => {
  const f = useCurrentFrame();
  return <AbsoluteFill style={{ background: C.paper, color: C.ink }}>
    <Enter style={{ position: 'absolute', left: 64, top: 83 }}><Brand size={55} /></Enter>
    <Enter delay={7} style={{ position: 'absolute', left: 64, top: 290,
      fontSize: 104, lineHeight: 1.03, fontWeight: 700, letterSpacing: '-.065em' }}>
      WhoAped<br />is launching<span style={{ color: C.orange }}>.</span>
    </Enter>
    <Enter delay={19} style={{ position: 'absolute', left: 70, top: 578, color: C.quiet, fontSize: 33 }}>
      The Solana wallet tracker for traders.
    </Enter>
    <Enter delay={30} style={{ position: 'absolute', left: 64, right: 64, top: 721 }}>
      <div style={{ height: 1, background: C.rule, marginBottom: 29 }} />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 77, fontWeight: 700, letterSpacing: '-.06em' }}>whoaped.com</span>
        <div style={{ width: 80, height: 80, background: C.orange, borderRadius: 17,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transform: `translateX(${tween(f, 38, 65, -8, 0)}px)` }}><Arrow size={45} color="white" /></div>
      </div>
      <div style={{ fontSize: 30, color: C.quiet, marginTop: 18 }}>Follow the launch.</div>
    </Enter>
    <div style={{ position: 'absolute', left: 70, top: 1007, color: C.quiet, fontSize: 25 }}>Watch-only Solana tracking. No private keys.</div>
  </AbsoluteFill>;
};

const TokenReveal: React.FC = () => {
  const f = useCurrentFrame();
  const mark = reveal(f, 6);
  const headline = reveal(f, 21);
  const underline = tween(f, 44, 78, 0, 1);
  const signalX = tween(f, 42, 85, 70, 1008);
  return <AbsoluteFill style={{ background: C.ink, color: C.paper }}>
    <div style={{ position: 'absolute', top: 166, left: 0, width: '100%', display: 'flex', justifyContent: 'center',
      opacity: mark, transform: `translateY(${(1 - mark) * 34}px) scale(${.94 + mark * .06})` }}>
      <Img src={staticFile('mark.svg')} style={{ width: 184, height: 184, borderRadius: 36 }} />
    </div>
    <div style={{ position: 'absolute', top: 446, left: 64, right: 64, textAlign: 'center',
      opacity: headline, transform: `translateY(${(1 - headline) * 28}px)` }}>
      <div style={{ fontSize: 56, color: '#AEB6AF', letterSpacing: '-.035em' }}>Powered by</div>
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'baseline', marginTop: 15,
        fontSize: 130, lineHeight: 1.05, fontWeight: 700, letterSpacing: '-.075em', whiteSpace: 'nowrap' }}>
        <span style={{ color: C.orange }}>$</span><span>WHOAPED</span>
      </div>
    </div>
    <div style={{ position: 'absolute', left: 70, right: 70, top: 723, height: 2, background: '#39413B' }}>
      <div style={{ width: `${underline * 100}%`, height: '100%', background: C.orange }} />
    </div>
    <div style={{ position: 'absolute', top: 714, left: signalX, width: 18, height: 18, borderRadius: '50%',
      background: C.orange, opacity: tween(f, 42, 54, 0, 1) }} />
    <div style={{ position: 'absolute', left: 70, right: 70, bottom: 63, display: 'flex', justifyContent: 'space-between',
      color: '#AEB6AF', fontSize: 23, letterSpacing: '.015em' }}>
      <span>WHOAPED</span><span>SOLANA</span>
    </div>
  </AbsoluteFill>;
};

export const LaunchVideo: React.FC = () => (
  <AbsoluteFill style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
    <Audio src={staticFile('soundtrack.wav')} volume={.8} />
    <TransitionSeries>
      <TransitionSeries.Sequence durationInFrames={100}><Hook /></TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: 10 })} />
      <TransitionSeries.Sequence durationInFrames={130} premountFor={30}><AddWallet /></TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: 10 })} />
      <TransitionSeries.Sequence durationInFrames={240} premountFor={30}><Activity /></TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: 10 })} />
      <TransitionSeries.Sequence durationInFrames={160} premountFor={30}><Notification /></TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: 10 })} />
      <TransitionSeries.Sequence durationInFrames={155} premountFor={30}><CTA /></TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: 10 })} />
      <TransitionSeries.Sequence durationInFrames={165} premountFor={30}><TokenReveal /></TransitionSeries.Sequence>
    </TransitionSeries>
  </AbsoluteFill>
);
