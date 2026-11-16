"""Original, deterministic soft synth bed and tactile UI accents. No stock audio."""
import array
import math
from pathlib import Path
import random
import wave

RATE = 48000
DURATION = 30
left = [0.0] * (RATE * DURATION)
right = [0.0] * (RATE * DURATION)
rng = random.Random(412)


def tone(start, duration, hz, level, pan=0, kind='pluck'):
    begin = int(start * RATE)
    for i in range(int(duration * RATE)):
        if begin + i >= len(left):
            break
        t = i / RATE
        if kind == 'pad':
            env = min(1, t / .7) * min(1, (duration - t) / 1.1)
        else:
            env = min(1, t / .006) * math.exp(-t * 7 / duration)
        sound = math.sin(2 * math.pi * hz * t)
        sound += .18 * math.sin(2 * math.pi * hz * 2 * t)
        sound *= level * env
        left[begin + i] += sound * (1 - pan * .3)
        right[begin + i] += sound * (1 + pan * .3)


def sweep(start, duration=.26, level=.032):
    begin = int(start * RATE)
    low = 0
    for i in range(int(duration * RATE)):
        t = i / RATE
        low = low * .78 + rng.uniform(-1, 1) * .22
        env = math.sin(math.pi * t / duration) ** 2
        value = low * env * level
        left[begin + i] += value
        right[begin + i] += value * .85


# Warm, restrained harmonic bed; a little space between phrases.
for start, length, notes in [(0, 7, [130.813, 195.998, 261.626]),
                             (7, 8, [146.832, 220, 293.665]),
                             (15, 5, [164.814, 246.942, 329.628]),
                             (20, 5, [130.813, 195.998, 261.626]),
                             (25, 5, [130.813, 195.998, 261.626])]:
    for j, hz in enumerate(notes):
        tone(start, length, hz, .012, (j - 1) * .6, 'pad')

for start, hz in [(0.02, 523.251), (.28, 783.991), (3.13, 523.251),
                  (5.55, 659.255), (5.69, 783.991), (7.2, 587.33),
                  (9.57, 587.33), (10.7, 739.989), (11.83, 880),
                  (14.62, 1046.502), (14.78, 1318.51), (19.2, 523.251),
                  (19.45, 659.255), (20.1, 783.991), (24.45, 523.251),
                  (24.58, 783.991), (25.1, 1046.502), (26.8, 783.991)]:
    tone(start, .7, hz, .055, -.2)
    tone(start + .11, .8, hz, .012, .7)

for s in [2.95, 6.95, 13.95, 18.95, 24.45]:
    sweep(s)

pcm = array.array('h')
peak = 0
for i, (l, r) in enumerate(zip(left, right)):
    t = i / RATE
    env = min(1, t / .025, (DURATION - t) / .65)
    for v in (l, r):
        # Master at roughly -20 LUFS before the composition's gentle trim.
        v *= env * 5
        peak = max(peak, abs(v))
        pcm.append(round(max(-1, min(1, v)) * 32767))
out = Path(__file__).resolve().parent.parent / 'public' / 'soundtrack.wav'
with wave.open(str(out), 'wb') as stream:
    stream.setnchannels(2)
    stream.setsampwidth(2)
    stream.setframerate(RATE)
    stream.writeframes(pcm.tobytes())
print(f'{out}: {DURATION}s stereo, peak {20 * math.log10(peak):.1f} dBFS')
