// Shared lane drawing for timeline previews (player page and studio).
//
// Two DAW-style representations:
//   - "notes" lanes: piano-roll blocks — x is time, block length is
//     duration, block height position is pitch, brightness is velocity;
//   - "audio" lanes: a waveform — the precomputed peak envelope of the
//     actual recorded one-shots, mirrored around the lane center.

export function drawNotesLane(ctx, lane, { x, y, width, height, ratio, totalSteps, color }) {
  const [minPitch, maxPitch] = lane.pitchRange ?? [0, 1];
  const pitchSpan = Math.max(1, maxPitch - minPitch);
  const pad = 3 * ratio;
  const blockHeight = Math.max(2 * ratio, Math.min(4 * ratio, (height - 2 * pad) / (pitchSpan + 1)));

  for (const [startStep, durationSteps, pitch, velocity] of lane.events) {
    const eventX = x + (startStep / totalSteps) * width;
    const alpha = 0.3 + (velocity / 9) * 0.6;
    const blockWidth = Math.max(1.5 * ratio, (durationSteps / totalSteps) * width - ratio);

    if (pitch >= 0) {
      const eventY =
        y + pad + (1 - (pitch - minPitch) / pitchSpan) * (height - 2 * pad - blockHeight);
      ctx.fillStyle = color(alpha, 'note');
      ctx.fillRect(eventX, eventY, blockWidth, blockHeight);
    } else {
      ctx.fillStyle = color(alpha * 0.8, 'tick');
      ctx.fillRect(eventX, y + pad, Math.max(1, 1.2 * ratio), height - 2 * pad);
    }
  }
}

export function drawAudioLane(ctx, lane, { x, y, width, height, ratio, color }) {
  const wave = lane.wave ?? [];
  const center = y + height / 2;
  const maxHalf = height / 2 - 2 * ratio;
  const binWidth = width / wave.length;

  for (let bin = 0; bin < wave.length; bin += 1) {
    const amplitude = wave[bin] / 9;

    if (amplitude <= 0) {
      continue;
    }

    const half = Math.max(0.8 * ratio, amplitude * maxHalf);
    ctx.fillStyle = color(0.35 + amplitude * 0.6, 'wave', amplitude);
    ctx.fillRect(x + bin * binWidth, center - half, Math.max(1, binWidth + 0.5), half * 2);
  }

  // Center line, like a DAW audio clip.
  ctx.fillStyle = color(0.25, 'center');
  ctx.fillRect(x, center - ratio / 2, width, ratio);
}

export function drawLane(ctx, lane, options) {
  if (lane.kind === 'audio') {
    drawAudioLane(ctx, lane, options);
  } else {
    drawNotesLane(ctx, lane, options);
  }
}
