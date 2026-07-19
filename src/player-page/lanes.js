// Arrangement lanes: the actual note and sample events of every sound
// family, rendered piano-roll style under the section chips. Pitched lanes
// draw pitch height, percussive lanes draw hit ticks; section boundaries
// from the arrangement are drawn as vertical lines.

import { drawLane } from '../laneRendering.js';

const NOTE_LANE_HEIGHT = 30;
const HIT_LANE_HEIGHT = 22;
const GUTTER = 58;

function emberColor(alpha, role, amplitude = 0.5) {
  if (role === 'wave') {
    // The "colorful wave": hue rises with amplitude like a DAW audio clip.
    const hue = 16 + amplitude * 30;
    return `hsla(${hue}, 70%, ${34 + amplitude * 28}%, ${alpha})`;
  }
  if (role === 'center') {
    return `rgba(232, 221, 200, ${alpha})`;
  }
  if (role === 'tick') {
    return `rgba(201, 111, 47, ${alpha})`;
  }
  return `rgba(222, 155, 90, ${alpha})`;
}

export async function fetchPreview(pieceId, fetchImpl = fetch) {
  try {
    const response = await fetchImpl(`/timeline-previews/${pieceId}.json`);
    if (!response.ok) {
      return null;
    }
    return await response.json();
  } catch {
    return null;
  }
}

export function createLaneView(container, { onSeek } = {}) {
  container.classList.add('pp-lanes');
  container.innerHTML = `
    <canvas class="pp-lanes-canvas"></canvas>
    <div class="pp-lanes-playhead" hidden></div>
  `;

  const canvas = container.querySelector('canvas');
  const playhead = container.querySelector('.pp-lanes-playhead');
  const ctx = canvas.getContext('2d');

  let preview = null;
  let boundariesSeconds = [];

  function laneHeight(lane) {
    return lane.kind === 'notes' ? NOTE_LANE_HEIGHT : HIT_LANE_HEIGHT;
  }

  function draw() {
    if (!preview) {
      container.hidden = true;
      return;
    }

    container.hidden = false;

    const ratio = window.devicePixelRatio || 1;
    const cssWidth = container.clientWidth;
    const cssHeight = preview.lanes.reduce((sum, lane) => sum + laneHeight(lane), 0);

    canvas.style.height = `${cssHeight}px`;
    canvas.width = Math.max(1, Math.round(cssWidth * ratio));
    canvas.height = Math.max(1, Math.round(cssHeight * ratio));

    const width = canvas.width;
    const gutter = GUTTER * ratio;
    const plotWidth = width - gutter;
    const totalSteps = preview.bars * preview.stepsPerBar;

    ctx.clearRect(0, 0, width, canvas.height);

    let top = 0;

    preview.lanes.forEach((lane, index) => {
      const height = laneHeight(lane) * ratio;

      // Alternating lane background.
      ctx.fillStyle = index % 2 === 0 ? 'rgba(255,255,255,.025)' : 'rgba(0,0,0,.12)';
      ctx.fillRect(0, top, width, height);

      // Label in the gutter.
      ctx.fillStyle = 'rgba(214,202,178,.55)';
      ctx.font = `${9.5 * ratio}px system-ui, sans-serif`;
      ctx.textBaseline = 'middle';
      ctx.fillText(lane.label.slice(0, 9), 6 * ratio, top + height / 2);

      drawLane(ctx, lane, {
        x: gutter,
        y: top,
        width: plotWidth,
        height,
        ratio,
        totalSteps,
        color: emberColor,
      });

      top += height;
    });

    // Section boundaries across all lanes.
    ctx.fillStyle = 'rgba(232, 221, 200, .28)';
    for (const seconds of boundariesSeconds) {
      const x = gutter + (seconds / preview.durationSeconds) * plotWidth;
      ctx.fillRect(x, 0, ratio, canvas.height);
    }
    ctx.fillStyle = 'rgba(232,221,200,.12)';
    ctx.fillRect(gutter, 0, ratio, canvas.height);
  }

  function setPosition(seconds, visible) {
    if (!preview || !visible) {
      playhead.hidden = true;
      return;
    }

    const cssWidth = container.clientWidth;
    const plotWidth = cssWidth - GUTTER;
    const x = GUTTER + Math.min(1, seconds / preview.durationSeconds) * plotWidth;
    playhead.hidden = false;
    playhead.style.left = `${x}px`;
  }

  container.addEventListener('click', (event) => {
    if (!preview || !onSeek) {
      return;
    }

    const box = container.getBoundingClientRect();
    const ratio = (event.clientX - box.left - GUTTER) / (box.width - GUTTER);

    if (ratio >= 0 && ratio <= 1) {
      onSeek(Math.round(ratio * preview.durationSeconds));
    }
  });

  window.addEventListener('resize', draw);

  return {
    load(nextPreview, boundaries = []) {
      preview = nextPreview;
      boundariesSeconds = boundaries;
      playhead.hidden = true;
      draw();
    },
    setPosition,
    clear() {
      preview = null;
      boundariesSeconds = [];
      container.hidden = true;
    },
  };
}
